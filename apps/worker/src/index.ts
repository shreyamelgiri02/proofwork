/**
 * Proofwork background worker.
 *
 * A dedicated long-running TypeScript process (not a web request) that drains the
 * durable Postgres queue. Work survives the browser closing and worker restarts:
 * jobs are leased with expiry, reclaimed after crashes, retried with bounded
 * backoff, and every recovery write goes through the persisted operation ledger.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });

const {
  checkConnection,
  ensureReconciliationQueued,
  expireProposals,
  getSql,
  leaseJobs,
  processReconcileJob,
  processRecoverJob,
  processVerificationJob,
  purgeExpiredDemos,
  reclaimExpiredLeases,
  recordHeartbeat,
  settleJob,
  heartbeatLease,
  SYSTEM_ACTOR,
} = await import("@proofwork/database");

type JobRow = Awaited<ReturnType<typeof leaseJobs>>[number];

const WORKER_NAME = process.env.WORKER_NAME ?? `worker-${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
const BATCH = Math.min(Number(process.env.WORKER_BATCH_SIZE ?? 20), 20);
const CONCURRENCY = Math.min(Number(process.env.WORKER_CONCURRENCY ?? 5), 5);

if (!process.env.DATABASE_URL) {
  console.error("[worker] DATABASE_URL is required. See LOCAL-SETUP.md.");
  process.exit(1);
}

const sql = getSql();
let stopping = false;
const running = new Set<Promise<unknown>>();
const lastRun: Record<string, number> = {};

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  // Structured, secret-free log lines.
  console.log(JSON.stringify({ t: new Date().toISOString(), worker: WORKER_NAME, msg, ...extra }));

function due(name: string, everyMs: number) {
  const now = Date.now();
  if (!lastRun[name] || now - lastRun[name] >= everyMs) {
    lastRun[name] = now;
    return true;
  }
  return false;
}

async function runJob(job: JobRow) {
  // Keep the lease alive while network calls are in flight.
  const keepAlive = setInterval(() => {
    heartbeatLease(sql, job).catch(() => undefined);
  }, 30_000);
  const started = Date.now();
  try {
    const result = await settleJob(sql, job, async () => {
      switch (job.kind) {
        case "VERIFY":
        case "RECHECK":
        case "MONITOR":
          return processVerificationJob(sql, job, WORKER_NAME);
        case "RECOVER":
          return processRecoverJob(sql, job, WORKER_NAME);
        case "RECONCILE":
          return processReconcileJob(sql, job, WORKER_NAME);
        case "PROPOSAL_EXPIRY":
          return { expired: await expireProposals(sql) };
        case "DEMO_PURGE":
          return purgeExpiredDemos(sql);
        default:
          return { skipped: `unsupported kind ${job.kind}` };
      }
    });
    log("job.completed", { job_id: job.id, kind: job.kind, attempt: job.attempt_count, ms: Date.now() - started, result });
  } catch (err) {
    log("job.failed", { job_id: job.id, kind: job.kind, attempt: job.attempt_count, error: err instanceof Error ? err.message.slice(0, 120) : "unknown" });
  } finally {
    clearInterval(keepAlive);
  }
}

async function maintenance() {
  if (due("reclaim", 15_000)) {
    const n = await reclaimExpiredLeases(sql);
    if (n) log("leases.reclaimed", { count: n });
  }
  if (due("expire", 30_000)) {
    const n = await expireProposals(sql);
    if (n) log("proposals.expired", { count: n });
  }
  if (due("reconcile-scan", 60_000)) {
    const n = await ensureReconciliationQueued(sql);
    if (n) log("reconciliation.requeued", { count: n });
  }
  if (due("demo-purge", 10 * 60_000)) {
    const r = await purgeExpiredDemos(sql);
    if (r.purged || r.skipped) log("demo.purge", r);
  }
  if (due("connection-health", 5 * 60_000)) {
    // Necessary connection-health refresh for active connections not read recently.
    const stale = await sql<{ id: string; workspace_id: string; kind: "PRIVATE" | "DEMO" }[]>`
      select c.id, c.workspace_id, w.kind from app.connections c join app.workspaces w on w.id = c.workspace_id
      where c.is_active and (c.last_checked_at is null or c.last_checked_at < now() - interval '15 minutes')
        and (w.kind = 'PRIVATE' or w.expires_at > now())
      limit 20
    `;
    for (const c of stale) {
      await checkConnection(sql, { workspace: { id: c.workspace_id, kind: c.kind }, actor: SYSTEM_ACTOR, correlationId: crypto.randomUUID() }, c.id).catch(() => undefined);
    }
  }
}

async function tick() {
  await recordHeartbeat(sql, WORKER_NAME, "start");
  let errorCode: string | null = null;
  let leased = 0;
  try {
    await maintenance();
    const capacity = CONCURRENCY - running.size;
    if (capacity > 0) {
      const jobs = await leaseJobs(sql, WORKER_NAME, Math.min(BATCH, capacity));
      leased = jobs.length;
      for (const job of jobs) {
        const p = runJob(job).finally(() => running.delete(p));
        running.add(p);
      }
    }
  } catch (err) {
    errorCode = err instanceof Error ? err.message.slice(0, 60) : "TICK_ERROR";
    log("tick.error", { error: errorCode });
  }
  await recordHeartbeat(sql, WORKER_NAME, "complete", leased, errorCode).catch(() => undefined);
}

async function main() {
  log("worker.started", { poll_ms: POLL_MS, batch: BATCH, concurrency: CONCURRENCY });
  while (!stopping) {
    await tick();
    await new Promise((r) => setTimeout(r, running.size >= CONCURRENCY ? 250 : POLL_MS));
  }
  log("worker.draining", { in_flight: running.size });
  await Promise.allSettled([...running]);
  await sql.end({ timeout: 5 });
  log("worker.stopped");
  process.exit(0);
}

const stop = () => {
  // Stop leasing new work; in-flight jobs finish or their leases expire and are reclaimed.
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

main().catch((err) => {
  console.error("[worker] fatal", err instanceof Error ? err.message : err);
  process.exit(1);
});
