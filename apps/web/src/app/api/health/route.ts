import { getSql, workerHeartbeatStatus } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { isDatabaseReady, isSupabaseConfigured } from "@/lib/env";

/** Minimal public liveness. Reveals no workspace data or configuration values. */
export const GET = route(async (_req, { correlationId }) => {
  let database: "ok" | "unavailable" | "not_configured" = "not_configured";
  let worker: "healthy" | "stale" | "never_seen" | "unavailable" | "not_configured" = "not_configured";
  if (isDatabaseReady()) {
    try {
      const sql = getSql();
      await sql`select 1`;
      database = "ok";
      const [heartbeat] = await sql<{ last_completed_at: Date | null }[]>`
        select last_completed_at from app.worker_heartbeats
        order by last_completed_at desc nulls last limit 1
      `;
      worker = workerHeartbeatStatus(heartbeat?.last_completed_at ? new Date(heartbeat.last_completed_at) : null);
    } catch {
      database = "unavailable";
      worker = "unavailable";
    }
  }

  const auth = isSupabaseConfigured() ? "configured" : "not_configured";
  let sandbox: "ok" | "unavailable" | "not_configured" = "not_configured";
  if (process.env.SANDBOX_API_URL) {
    try {
      const response = await fetch(new URL("/health", process.env.SANDBOX_API_URL), {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      sandbox = response.ok ? "ok" : "unavailable";
    } catch {
      sandbox = "unavailable";
    }
  }

  const healthy = database === "ok" && auth === "configured" && sandbox === "ok" && worker === "healthy";
  return json({ status: healthy ? "ok" : "degraded", database, auth, sandbox, worker }, correlationId, {
    status: healthy ? 200 : 503,
  });
});
