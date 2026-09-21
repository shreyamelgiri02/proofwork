import { LIMITS } from "@proofwork/domain";
import type { Sql } from "./client";
import type { ServiceContext } from "./context";

export type WorkerHeartbeatStatus = "healthy" | "stale" | "never_seen";

export function workerHeartbeatStatus(lastCompletedAt: Date | null, now = Date.now()): WorkerHeartbeatStatus {
  if (!lastCompletedAt) return "never_seen";
  return now - lastCompletedAt.getTime() > 180_000 ? "stale" : "healthy";
}

/** Actual operational state for Settings → Operations. Never inferred from a page loading. */
export async function getOperationsHealth(sql: Sql, ctx: ServiceContext) {
  const [heartbeat] = await sql<{ worker_name: string; last_started_at: Date | null; last_completed_at: Date | null; last_error_code: string | null; last_batch_count: number }[]>`
    select worker_name, last_started_at, last_completed_at, last_error_code, last_batch_count
    from app.worker_heartbeats order by last_completed_at desc nulls last limit 1
  `;
  const [queue] = await sql<{ ready: number; leased: number; dead: number; oldest_due: Date | null; expired_leases: number }[]>`
    select
      count(*) filter (where status = 'READY')::int as ready,
      count(*) filter (where status = 'LEASED')::int as leased,
      count(*) filter (where status = 'DEAD')::int as dead,
      min(due_at) filter (where status = 'READY' and due_at <= now()) as oldest_due,
      count(*) filter (where status = 'LEASED' and leased_until < now())::int as expired_leases
    from app.jobs where workspace_id = ${ctx.workspace.id}
  `;
  const [ops] = await sql<{ unresolved: number; escalated: number }[]>`
    select count(*) filter (where resolved_at is null)::int as unresolved,
           count(*) filter (where resolved_at is null and escalated_at is not null)::int as escalated
    from app.recovery_operations where workspace_id = ${ctx.workspace.id}
  `;
  const completedAgo = heartbeat?.last_completed_at ? (Date.now() - new Date(heartbeat.last_completed_at).getTime()) / 1000 : null;
  const overdueSeconds = queue.oldest_due ? (Date.now() - new Date(queue.oldest_due).getTime()) / 1000 : 0;
  const workerStatus = workerHeartbeatStatus(heartbeat?.last_completed_at ? new Date(heartbeat.last_completed_at) : null).toUpperCase() as "NEVER_SEEN" | "STALE" | "HEALTHY";
  return {
    worker: {
      status: workerStatus,
      name: heartbeat?.worker_name ?? null,
      last_started_at: heartbeat?.last_started_at ?? null,
      last_completed_at: heartbeat?.last_completed_at ?? null,
      last_error_code: heartbeat?.last_error_code ?? null,
      guidance:
        workerStatus === "HEALTHY"
          ? null
          : "Background checking is delayed. Queued work remains visible and will resume when the worker reconnects. Contact the deployment owner if this continues.",
    },
    queue: { ...queue, overdue_seconds: Math.max(0, Math.round(overdueSeconds)), backlog: overdueSeconds > 180 },
    operations: ops,
    limits: {
      read_freshness_seconds: LIMITS.PRECHECK_MAX_AGE_SECONDS,
      evidence_max_age_seconds: LIMITS.EVIDENCE_MAX_AGE_SECONDS,
      approval_window_seconds: LIMITS.APPROVAL_TTL_SECONDS,
      recovery_cutoff_seconds: LIMITS.RECOVERY_CUTOFF_SECONDS,
      finalization_grace_seconds: LIMITS.FINALIZATION_GRACE_SECONDS,
      max_write_dispatches: LIMITS.MAX_WRITE_DISPATCHES,
      lease_seconds: LIMITS.LEASE_SECONDS,
    },
  };
}
