import { randomUUID } from "node:crypto";
import { LIMITS, type ErrorClass, type JobKind } from "@proofwork/domain";
import { json, type Sql } from "./client";

/**
 * Durable Postgres job queue.
 *  - Atomic claim with FOR UPDATE SKIP LOCKED inside a short transaction.
 *  - Leases with expiry; expired leases are reclaimed.
 *  - Bounded attempts with exponential backoff + jitter.
 *  - Fair workspace handling: at most `perWorkspace` jobs per workspace per batch.
 */

export interface JobRow {
  id: string;
  workspace_id: string | null;
  task_id: string | null;
  kind: JobKind;
  dedupe_key: string | null;
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  lease_token: string;
  correlation_id: string;
  due_at: Date;
}

export interface EnqueueInput {
  kind: JobKind;
  workspaceId?: string | null;
  taskId?: string | null;
  dedupeKey?: string | null;
  payload?: Record<string, unknown>;
  dueAt?: Date;
  priority?: number;
  maxAttempts?: number;
  correlationId?: string;
}

const PRIORITY: Record<JobKind, number> = {
  RECONCILE: 10,
  RECOVER: 20,
  MONITOR: 30,
  VERIFY: 40,
  RECHECK: 40,
  PROPOSAL_EXPIRY: 60,
  CONNECTION_HEALTH: 70,
  DEMO_PURGE: 90,
};

/** Enqueue a job. A live job with the same dedupe key is returned instead of a duplicate. */
export async function enqueueJob(sql: Sql, input: EnqueueInput): Promise<{ id: string; deduplicated: boolean }> {
  const rows = await sql<{ id: string }[]>`
    insert into app.jobs (workspace_id, task_id, kind, dedupe_key, payload, due_at, priority, max_attempts, correlation_id)
    values (
      ${input.workspaceId ?? null}, ${input.taskId ?? null}, ${input.kind}, ${input.dedupeKey ?? null},
      ${json(sql, input.payload ?? {})}, ${input.dueAt ?? new Date()}, ${input.priority ?? PRIORITY[input.kind]},
      ${input.maxAttempts ?? 5}, ${input.correlationId ?? randomUUID()}
    )
    on conflict (dedupe_key) where dedupe_key is not null and status in ('READY', 'LEASED') do nothing
    returning id
  `;
  if (rows.length) return { id: rows[0].id, deduplicated: false };
  const [existing] = await sql<{ id: string }[]>`
    select id from app.jobs where dedupe_key = ${input.dedupeKey ?? null} and status in ('READY', 'LEASED') limit 1
  `;
  return { id: existing?.id ?? "", deduplicated: true };
}

/** Reclaim expired leases so a crashed worker never leaves permanent "processing". */
export async function reclaimExpiredLeases(sql: Sql): Promise<number> {
  const rows = await sql`
    update app.jobs
    set status = case when attempt_count >= max_attempts then 'DEAD' else 'READY' end,
        lease_token = null, leased_by = null, leased_until = null,
        last_error_code = coalesce(last_error_code, 'LEASE_EXPIRED'),
        due_at = now()
    where status = 'LEASED' and leased_until < now()
    returning id
  `;
  return rows.length;
}

export async function leaseJobs(sql: Sql, workerName: string, limit: number = 20, perWorkspace = 5): Promise<JobRow[]> {
  const leaseSeconds = Number(process.env.WORKER_LEASE_SECONDS ?? LIMITS.LEASE_SECONDS);
  return sql.begin(async (tx) => {
    const rows = await tx<JobRow[]>`
      with locked as (
        select id, workspace_id, priority, due_at
        from app.jobs
        where status = 'READY' and due_at <= now()
        order by priority, due_at
        limit ${limit * 4}
        for update skip locked
      ),
      ranked as (
        select id, priority, due_at,
               row_number() over (partition by coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid) order by priority, due_at) as rn
        from locked
      ),
      picked as (
        select id from ranked where rn <= ${perWorkspace} order by priority, due_at limit ${limit}
      )
      update app.jobs j
      set status = 'LEASED', lease_token = gen_random_uuid(), leased_by = ${workerName},
          leased_until = now() + make_interval(secs => ${leaseSeconds}), attempt_count = j.attempt_count + 1
      from picked
      where j.id = picked.id
      returning j.id, j.workspace_id, j.task_id, j.kind, j.dedupe_key, j.payload, j.attempt_count, j.max_attempts,
                j.lease_token, j.correlation_id, j.due_at
    `;
    return rows;
  }) as Promise<JobRow[]>;
}

/** Extend a lease while long work continues. Returns false when the lease was lost (fencing). */
export async function heartbeatLease(sql: Sql, job: Pick<JobRow, "id" | "lease_token">): Promise<boolean> {
  const leaseSeconds = Number(process.env.WORKER_LEASE_SECONDS ?? LIMITS.LEASE_SECONDS);
  const rows = await sql`
    update app.jobs set leased_until = now() + make_interval(secs => ${leaseSeconds})
    where id = ${job.id} and lease_token = ${job.lease_token} and status = 'LEASED'
    returning id
  `;
  return rows.length > 0;
}

export async function isLeaseValid(sql: Sql, job: Pick<JobRow, "id" | "lease_token">): Promise<boolean> {
  const rows = await sql`
    select 1 from app.jobs where id = ${job.id} and lease_token = ${job.lease_token} and status = 'LEASED' and leased_until > now()
  `;
  return rows.length > 0;
}

export async function completeJob(sql: Sql, job: Pick<JobRow, "id" | "lease_token">, result: Record<string, unknown> = {}): Promise<void> {
  await sql`
    update app.jobs set status = 'SUCCEEDED', result = ${json(sql, result)}, finished_at = now(), lease_token = null, leased_until = null
    where id = ${job.id} and lease_token = ${job.lease_token}
  `;
}

export async function cancelJob(sql: Sql, job: Pick<JobRow, "id" | "lease_token">, reason: string): Promise<void> {
  await sql`
    update app.jobs set status = 'CANCELED', last_error_code = ${reason}, finished_at = now(), lease_token = null, leased_until = null
    where id = ${job.id} and lease_token = ${job.lease_token}
  `;
}

/** Backoff with full jitter, bounded. */
export function backoffSeconds(attempt: number): number {
  const base = Math.min(900, 15 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base / 2 + Math.random() * (base / 2));
}

export async function failJob(
  sql: Sql,
  job: Pick<JobRow, "id" | "lease_token" | "attempt_count" | "max_attempts">,
  errorCode: string,
  errorClass: ErrorClass,
): Promise<"RETRY" | "DEAD" | "FAILED"> {
  if (errorClass === "PERMANENT") {
    await sql`
      update app.jobs set status = 'FAILED', last_error_code = ${errorCode}, last_error_class = ${errorClass},
        finished_at = now(), lease_token = null, leased_until = null
      where id = ${job.id} and lease_token = ${job.lease_token}
    `;
    return "FAILED";
  }
  if (job.attempt_count >= job.max_attempts) {
    await sql`
      update app.jobs set status = 'DEAD', last_error_code = ${errorCode}, last_error_class = ${errorClass},
        finished_at = now(), lease_token = null, leased_until = null
      where id = ${job.id} and lease_token = ${job.lease_token}
    `;
    return "DEAD";
  }
  const delay = backoffSeconds(job.attempt_count);
  await sql`
    update app.jobs set status = 'READY', last_error_code = ${errorCode}, last_error_class = ${errorClass},
      due_at = now() + make_interval(secs => ${delay}), lease_token = null, leased_by = null, leased_until = null
    where id = ${job.id} and lease_token = ${job.lease_token}
  `;
  return "RETRY";
}

/** Cancel future (not yet leased) jobs for a task; used by retirement and demo reset. */
export async function cancelPendingTaskJobs(sql: Sql, workspaceId: string, taskId: string, kinds: JobKind[]): Promise<number> {
  const rows = await sql`
    update app.jobs set status = 'CANCELED', last_error_code = 'CANCELED_BY_COMMAND', finished_at = now()
    where workspace_id = ${workspaceId} and task_id = ${taskId} and status = 'READY' and kind = any(${kinds})
    returning id
  `;
  return rows.length;
}

export async function recordHeartbeat(sql: Sql, workerName: string, phase: "start" | "complete", batchCount = 0, errorCode: string | null = null) {
  if (phase === "start") {
    await sql`
      insert into app.worker_heartbeats (worker_name, last_started_at, updated_at) values (${workerName}, now(), now())
      on conflict (worker_name) do update set last_started_at = now(), updated_at = now()
    `;
  } else {
    await sql`
      insert into app.worker_heartbeats (worker_name, last_completed_at, last_batch_count, last_error_code, updated_at)
      values (${workerName}, now(), ${batchCount}, ${errorCode}, now())
      on conflict (worker_name) do update set last_completed_at = now(), last_batch_count = ${batchCount}, last_error_code = ${errorCode}, updated_at = now()
    `;
  }
}
