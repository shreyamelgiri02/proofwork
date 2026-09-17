/**
 * Applies supabase/migrations/*.sql in order using DATABASE_ADMIN_URL, then enables
 * LOGIN for the restricted service roles with passwords taken from DATABASE_URL and
 * SANDBOX_DATABASE_URL (so passwords never live in SQL files).
 *
 * Safe to run after `supabase start`: files already recorded by the Supabase CLI
 * (supabase_migrations.schema_migrations) or by this script are skipped.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("DATABASE_ADMIN_URL is required (see .env.example).");
  process.exit(1);
}

const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });

function credentials(url: string | undefined): { user: string; password: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
  } catch {
    return null;
  }
}

async function main() {
  await sql`create table if not exists public.proofwork_schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
  const [authSchema] = await sql`select exists (select 1 from pg_namespace where nspname = 'auth') as present`;
  if (!authSchema.present) {
    console.warn("warn   No Supabase `auth` schema found: applying scripts/local-postgres-shim.sql (plain Postgres; auth flows stay unavailable).");
    await sql.unsafe(readFileSync(join(root, "scripts", "local-postgres-shim.sql"), "utf8"));
  }
  const [cliTable] = await sql`select to_regclass('supabase_migrations.schema_migrations') as t`;
  const cliApplied = new Set<string>();
  if (cliTable?.t) {
    for (const r of await sql`select version from supabase_migrations.schema_migrations`) cliApplied.add(String(r.version));
  }
  const applied = new Set((await sql`select version from public.proofwork_schema_migrations`).map((r) => String(r.version)));

  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const version = file.split("_")[0];
    if (applied.has(version) || cliApplied.has(version)) {
      console.log(`skip   ${file}`);
      continue;
    }
    const body = readFileSync(join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.proofwork_schema_migrations (version) values (${version})`;
    });
    console.log(`apply  ${file}`);
  }

  for (const [role, url] of [
    ["proofwork_app", process.env.DATABASE_URL],
    ["billing_sandbox_service", process.env.SANDBOX_DATABASE_URL],
  ] as const) {
    const cred = credentials(url);
    if (!cred || cred.user !== role || !cred.password || cred.password.startsWith("replace-")) {
      console.warn(`warn   ${role}: set a generated password in its connection URL to enable login (npm run secrets:generate).`);
      continue;
    }
    // Identifiers are fixed above; the password is passed as a literal via format().
    await sql.unsafe(`do $$ begin execute format('alter role ${role} with login password %L', ${sqlLiteral(cred.password)}); end $$;`);
    console.log(`role   ${role}: login enabled`);
  }
  await sql.end();
  console.log("Migrations complete.");
}

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

main().catch(async (err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
