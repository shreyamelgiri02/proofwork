import postgres from "postgres";
import { AppError } from "@proofwork/domain";

/** Parameterized Postgres access for application services (web + worker). */

export type Sql = postgres.Sql<Record<string, never>>;

const globalForDb = globalThis as unknown as { __proofworkSql?: Sql };

export interface DatabaseClientConfig {
  max: number;
  prepare: boolean;
  ssl: false | "require";
  applicationName: string;
}

export function databaseClientConfig(env: NodeJS.ProcessEnv = process.env): DatabaseClientConfig {
  const runtime = env.DATABASE_RUNTIME ?? (env.VERCEL ? "serverless" : "persistent");
  const requestedPoolSize = Number(env.DATABASE_POOL_SIZE ?? 10);
  const persistentPoolSize = Number.isFinite(requestedPoolSize) ? Math.min(10, Math.max(1, Math.trunc(requestedPoolSize))) : 10;
  return {
    max: runtime === "serverless" ? 1 : persistentPoolSize,
    prepare: runtime !== "serverless",
    ssl: env.NODE_ENV === "production" ? "require" : false,
    applicationName: env.WORKER_NAME ? "proofwork-worker" : "proofwork-web",
  };
}

export function isDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL);
}

export function getSql(): Sql {
  if (!process.env.DATABASE_URL) {
    throw new AppError("SETUP_REQUIRED", "Proofwork is temporarily unavailable. Try again later.");
  }
  if (!globalForDb.__proofworkSql) {
    const config = databaseClientConfig();
    globalForDb.__proofworkSql = postgres(process.env.DATABASE_URL, {
      max: config.max,
      prepare: config.prepare,
      ssl: config.ssl,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => undefined,
      connection: { application_name: config.applicationName, search_path: "app,public" },
    }) as unknown as Sql;
  }
  return globalForDb.__proofworkSql;
}

/** postgres.js JSON parameter helper with a permissive type. */
export function json(sql: Sql, value: unknown) {
  return sql.json(value as never);
}

/** Map Postgres unique-violation errors to a boolean check. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint_name?: string; constraint?: string };
  if (e?.code !== "23505") return false;
  if (!constraint) return true;
  return (e.constraint_name ?? e.constraint) === constraint;
}
