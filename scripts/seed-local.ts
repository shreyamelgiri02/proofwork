/**
 * Reproducible local seed for a REAL signed-up account (never a fake login).
 *
 *   npm run db:seed -- --email you@company.com [--scenarios all]
 *
 * 1. Finds the confirmed Supabase Auth user by email (sign up in the app first).
 * 2. Ensures the private workspace, profile, "Require human approval" policy and a
 *    validated local sandbox connection (the sandbox and its admin token must be running).
 * 3. Creates synthetic scenarios through the same path as the demo: independent source
 *    seed → request registration → claim → queued verification. No verdicts are inserted;
 *    start the worker to produce them.
 */
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });
process.env.PROOFWORK_ENABLE_DEV_SCENARIOS = "true";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const email = arg("email");
  if (!email) throw new Error("Usage: npm run db:seed -- --email you@company.com [--scenarios all]");
  const db = await import("@proofwork/database");
  const domain = await import("@proofwork/domain");
  const sql = db.getSql();

  // auth.users is read with the admin URL only; the application role has no access to it.
  if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is required to look up the auth user for seeding.");
  const admin = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
  const [user] = await admin<{ id: string; email: string; raw_user_meta_data: Record<string, string> | null; email_confirmed_at: Date | null }[]>`
    select id, email, raw_user_meta_data, email_confirmed_at from auth.users where lower(email) = lower(${email}) limit 1
  `;
  await admin.end({ timeout: 5 });
  if (!user) throw new Error(`No Supabase Auth user for ${email}. Sign up in the app and confirm the email first.`);
  if (!user.email_confirmed_at) throw new Error("Confirm the account email first (local inbox: http://127.0.0.1:54324).");

  const correlationId = randomUUID();
  const meta = user.raw_user_meta_data ?? {};
  const workspace = await db.ensurePrivateWorkspace(sql, { id: user.id, email: user.email, fullName: meta.full_name ?? null, organization: meta.organization ?? null }, correlationId);
  const ctx = {
    workspace: { id: workspace.id, kind: "PRIVATE" as const },
    actor: db.actorForUser({ id: user.id, email: user.email }, meta.full_name ?? user.email),
    correlationId,
  };

  if (!workspace.onboarding_completed_at) {
    await db.saveWorkspaceProfile(sql, ctx, { organization: meta.organization || "Acme Support", name: workspace.name || "Customer operations", timezone: workspace.timezone || "UTC" }, { onboarding: true });
    await db.createPolicyVersion(sql, ctx, { mode: "REQUIRE_APPROVAL", reason: "Local seed default" }, { onboarding: true });
    const connection = await db.configureLocalSandbox(sql, ctx, { seedStarter: false });
    if (connection.health !== "CONNECTED") throw new Error(`Local sandbox did not validate (${connection.last_error_code}). Is npm run dev:sandbox running?`);
    await db.activateConnection(sql, ctx, "LOCAL_SANDBOX");
    await db.markOnboardingComplete(sql, ctx);
    console.log(`Workspace ${workspace.id} onboarded with the local billing sandbox.`);
  }

  const keys = arg("scenarios") === "all" ? domain.SCENARIOS.map((s) => s.key) : domain.STARTER_SCENARIOS;
  for (const key of keys) {
    const result = await db.createScenario(sql, ctx, key);
    console.log(`scenario ${key.padEnd(24)} task ${result.task_id}`);
  }
  console.log("Seed complete. Start the worker (npm run dev:worker) to verify the queued tasks.");
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
