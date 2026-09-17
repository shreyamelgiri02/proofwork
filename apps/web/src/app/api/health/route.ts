import { getSql } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { isDatabaseReady, isSupabaseConfigured } from "@/lib/env";

/** Minimal public liveness. Reveals no workspace data or configuration values. */
export const GET = route(async (_req, { correlationId }) => {
  let database = "not_configured";
  if (isDatabaseReady()) {
    try {
      await getSql()`select 1`;
      database = "ok";
    } catch {
      database = "unavailable";
    }
  }
  return json({ status: database === "ok" ? "ok" : "degraded", database, auth: isSupabaseConfigured() ? "configured" : "not_configured" }, correlationId, {
    status: database === "ok" ? 200 : 503,
  });
});
