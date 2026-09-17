import { AppError } from "@proofwork/domain";
import type { Sql } from "./client";

/**
 * Fixed-window limiter persisted in Postgres so limits hold across web instances.
 * Throws RATE_LIMITED with retry information when exceeded.
 */
export async function enforceRateLimit(sql: Sql, bucket: string, limit: number, windowSeconds: number): Promise<void> {
  const windowStartMs = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000;
  const windowStart = new Date(windowStartMs);
  const [row] = await sql<{ hits: number }[]>`
    insert into app.rate_limits (bucket, window_start, hits) values (${bucket.slice(0, 200)}, ${windowStart}, 1)
    on conflict (bucket, window_start) do update set hits = app.rate_limits.hits + 1
    returning hits
  `;
  if (row.hits > limit) {
    const retryAfter = Math.max(1, Math.ceil((windowStartMs + windowSeconds * 1000 - Date.now()) / 1000));
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait and try again.", { retryAfterSeconds: retryAfter });
  }
}
