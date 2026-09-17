// Local Supabase Auth WITHOUT Docker (for machines where Docker/WSL cannot run).
// Uses the official Supabase Auth server built from source (.local/bin/supabase-auth.exe)
// plus Mailpit for email capture. Secrets go to .local/auth.env and .env (both git-ignored).
//
//   node scripts/local-auth-setup.mjs [--reset-shim]
//
// --reset-shim: if the database was created with scripts/local-postgres-shim.sql (plain
// auth.users without Supabase columns), DROP the app, billing_sandbox and auth schemas so
// the real auth schema can be installed. This deletes all local Proofwork data.
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const envPath = join(root, ".env");
const authEnvPath = join(root, ".local", "auth.env");
const env = dotenv.parse(readFileSync(envPath));
const existing = existsSync(authEnvPath) ? dotenv.parse(readFileSync(authEnvPath)) : {};

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload, secret) => {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url(payload);
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
};

const jwtSecret = existing.GOTRUE_JWT_SECRET || randomBytes(48).toString("base64url");
const authDbPassword = existing.AUTH_DB_PASSWORD || randomBytes(24).toString("hex");
const tenYears = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
const anonKey = jwt({ iss: "supabase-local", role: "anon", exp: tenYears }, jwtSecret);
const serviceKey = jwt({ iss: "supabase-local", role: "service_role", exp: tenYears }, jwtSecret);

const adminUrl = new URL(env.DATABASE_ADMIN_URL);
const authDbUrl = `postgres://supabase_auth_admin:${authDbPassword}@${adminUrl.host}${adminUrl.pathname}?search_path=auth`;

const authEnv = {
  AUTH_DB_PASSWORD: authDbPassword,
  GOTRUE_API_HOST: "127.0.0.1",
  PORT: "9999",
  API_EXTERNAL_URL: "http://127.0.0.1:54321",
  GOTRUE_DB_DRIVER: "postgres",
  GOTRUE_DB_DATABASE_URL: authDbUrl,
  GOTRUE_DB_NAMESPACE: "auth",
  GOTRUE_DB_MIGRATIONS_PATH: join(root, ".local", "src", "auth", "migrations"),
  GOTRUE_SITE_URL: env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  GOTRUE_URI_ALLOW_LIST: "http://localhost:3000/**,http://127.0.0.1:3000/**",
  GOTRUE_DISABLE_SIGNUP: "false",
  GOTRUE_JWT_SECRET: jwtSecret,
  GOTRUE_JWT_EXP: "3600",
  GOTRUE_JWT_AUD: "authenticated",
  GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
  GOTRUE_JWT_ADMIN_ROLES: "service_role",
  GOTRUE_JWT_ISSUER: "http://127.0.0.1:54321/auth/v1",
  GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
  GOTRUE_MAILER_AUTOCONFIRM: "false",
  GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED: "true",
  GOTRUE_PASSWORD_MIN_LENGTH: "8",
  GOTRUE_SMTP_HOST: "127.0.0.1",
  GOTRUE_SMTP_PORT: "54325",
  GOTRUE_SMTP_ADMIN_EMAIL: "no-reply@proofwork.local",
  GOTRUE_SMTP_SENDER_NAME: "Proofwork",
  GOTRUE_SMTP_MAX_FREQUENCY: "1s",
  GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000",
  GOTRUE_MAILER_URLPATHS_CONFIRMATION: "/auth/v1/verify",
  GOTRUE_MAILER_URLPATHS_INVITE: "/auth/v1/verify",
  GOTRUE_MAILER_URLPATHS_RECOVERY: "/auth/v1/verify",
  GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: "/auth/v1/verify",
  GOTRUE_EXTERNAL_GOOGLE_ENABLED: env.LOCAL_GOOGLE_CLIENT_ID ? "true" : "false",
  GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: env.LOCAL_GOOGLE_CLIENT_ID || "",
  GOTRUE_EXTERNAL_GOOGLE_SECRET: env.LOCAL_GOOGLE_SECRET || "",
  GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: "http://127.0.0.1:54321/auth/v1/callback",
  GOTRUE_LOG_LEVEL: "info",
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
};
writeFileSync(authEnvPath, Object.entries(authEnv).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n");

// Point the web app at the local auth gateway.
let envText = readFileSync(envPath, "utf8");
const setVar = (k, v) => {
  envText = new RegExp(`^${k}=.*$`, "m").test(envText) ? envText.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${envText.trimEnd()}\n${k}=${v}\n`;
};
setVar("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
setVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", anonKey);
writeFileSync(envPath, envText);

// Database: roles, schema and auth migrations.
const sql = postgres(env.DATABASE_ADMIN_URL, { max: 1, onnotice: () => undefined });
const [shim] = await sql`
  select exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') as has_users,
         exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') as real_auth
`;
if (shim.has_users && !shim.real_auth) {
  if (!process.argv.includes("--reset-shim")) {
    console.error("The database uses the plain-Postgres auth shim. Re-run with --reset-shim (deletes local Proofwork data).");
    process.exit(2);
  }
  await sql.unsafe("drop schema if exists app cascade; drop schema if exists billing_sandbox cascade; drop schema if exists auth cascade; drop table if exists public.proofwork_schema_migrations;");
  console.log("reset  removed shim schemas (local data deleted)");
}
await sql.unsafe(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login noinherit createrole; end if;
  end $$;
`);
await sql.unsafe(`alter role supabase_auth_admin with login password '${authDbPassword}'`);
await sql.unsafe("create schema if not exists auth authorization supabase_auth_admin; grant usage on schema auth to postgres; alter role supabase_auth_admin set search_path = auth;");
await sql.end();

const exe = join(root, ".local", "bin", process.platform === "win32" ? "supabase-auth.exe" : "supabase-auth");
const migrate = spawnSync(exe, ["migrate"], { env: { ...process.env, ...authEnv }, stdio: "inherit" });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
console.log("Local Supabase Auth is set up. Now run: npm run db:migrate, then npm run auth:start (see LOCAL-SETUP.md).");
