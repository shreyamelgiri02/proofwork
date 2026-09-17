/**
 * Local load test (TEST_PLAN J-style capacity check on this laptop, not a production benchmark).
 *  1. HTTP read load on key pages/APIs with autocannon.
 *  2. Ingestion API burst: rate limit must hold (60/min per token) with no 5xx.
 *  3. Worker throughput: 200 queued tasks verified end-to-end through the sandbox.
 * Run with web, sandbox, worker and Postgres running:  npx tsx tests/load-test.ts
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import { config } from "dotenv";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });
process.env.PROOFWORK_ENABLE_DEV_SCENARIOS = "true";
const BASE = "http://localhost:3000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const summary: Record<string, unknown> = { started_at: new Date().toISOString() };

async function newDemoCookie() {
  const res = await fetch(`${BASE}/api/demo`, { method: "POST", headers: { origin: BASE, "content-type": "application/json" } });
  const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("pw_demo="))?.split(";")[0];
  if (!cookie) throw new Error(`demo create failed ${res.status}`);
  return cookie;
}

function cannon(name: string, opts: autocannon.Options): Promise<Record<string, unknown>> {
  return new Promise((res, rej) => {
    autocannon(opts, (err, r) => {
      if (err) return rej(err);
      const out = {
        name,
        connections: opts.connections,
        duration_s: opts.duration,
        requests_total: r.requests.total,
        requests_per_sec_avg: Math.round(r.requests.average),
        latency_ms_p50: r.latency.p50,
        latency_ms_p90: r.latency.p90,
        latency_ms_p99: r.latency.p99,
        latency_ms_max: r.latency.max,
        status_2xx: r["2xx"],
        non_2xx: r.non2xx,
        errors: r.errors,
        timeouts: r.timeouts,
      };
      console.log(JSON.stringify(out));
      res(out);
    });
  });
}

async function main() {
  const cookie = await newDemoCookie();
  await sleep(8000); // let the worker verify the demo's starter tasks
  const tasks = (await (await fetch(`${BASE}/api/tasks?range=all`, { headers: { cookie } })).json()) as { items: { id: string }[] };
  const taskId = tasks.items[0].id;

  // ---- 1. HTTP read load
  const http = [];
  http.push(await cannon("GET / (homepage, SSR)", { url: `${BASE}/`, connections: 20, duration: 15 }));
  http.push(await cannon("GET /api/health", { url: `${BASE}/api/health`, connections: 50, duration: 15 }));
  http.push(await cannon("GET /api/tasks (demo session)", { url: `${BASE}/api/tasks?range=all`, connections: 25, duration: 20, headers: { cookie } }));
  http.push(await cannon("GET /api/tasks/:id (evidence detail)", { url: `${BASE}/api/tasks/${taskId}`, connections: 25, duration: 20, headers: { cookie } }));
  http.push(await cannon("GET /app/tasks (page render)", { url: `${BASE}/app/tasks`, connections: 20, duration: 15, headers: { cookie } }));
  http.push(await cannon("GET /api/insights", { url: `${BASE}/api/insights?range=all`, connections: 20, duration: 15, headers: { cookie } }));
  summary.http = http;

  // ---- Private workspace + token for ingestion and throughput tests
  const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 2, onnotice: () => undefined });
  const db = await import("../packages/database/src/index");
  const sql = db.getSql();
  const [user] = await admin<{ id: string }[]>`
    insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role, created_at, updated_at)
    values (gen_random_uuid(), ${`load-${randomUUID()}@example.test`}, ${admin.json({ full_name: "Load Owner" })}, now(), 'authenticated', 'authenticated', now(), now())
    returning id
  `.catch(async () =>
    admin<{ id: string }[]>`insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values (${`load-${randomUUID()}@example.test`}, ${admin.json({ full_name: "Load Owner" })}, now()) returning id`,
  );
  const correlationId = randomUUID();
  const ws = await db.ensurePrivateWorkspace(sql, { id: user.id, email: "load@example.test", fullName: "Load Owner", organization: "Load Org" }, correlationId);
  const ctx = { workspace: { id: ws.id, kind: "PRIVATE" as const }, actor: db.actorForUser({ id: user.id }, "Load Owner"), correlationId };
  await db.saveWorkspaceProfile(sql, ctx, { organization: "Load Org", name: "Load", timezone: "UTC" }, { onboarding: true });
  await db.createPolicyVersion(sql, ctx, { mode: "REQUIRE_APPROVAL" }, { onboarding: true });
  await db.configureLocalSandbox(sql, ctx, { seedStarter: true });
  await db.activateConnection(sql, ctx, "LOCAL_SANDBOX");
  await db.markOnboardingComplete(sql, ctx);
  const preview = await db.previewRequest(sql, ctx, { subscription_id: "sub_sbx_1048", source_reference: "load-1" });
  const req = await db.confirmRequest(sql, ctx, { preview_token: preview.preview_token });
  const { token } = await db.createToken(sql, ctx, "load");

  // ---- 2. Ingestion burst: 150 unique claims as fast as possible from 10 connections
  let n = 0;
  const statuses: Record<string, number> = {};
  const burstStart = Date.now();
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      while (n < 150) {
        n++;
        const res = await fetch(`${BASE}/api/v1/claims`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "idempotency-key": `load-${randomUUID()}`, "content-type": "application/json" },
          body: JSON.stringify({ authorized_request_id: req.id, agent: { name: "Load Agent" }, report_text: "Cancellation scheduled." }),
        });
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        await res.text();
      }
    }),
  );
  const [receipts] = await admin<{ n: number }[]>`select count(*)::int as n from app.claim_receipts where workspace_id = ${ws.id}`;
  const [taskCount] = await admin<{ n: number }[]>`select count(*)::int as n from app.tasks where workspace_id = ${ws.id}`;
  summary.ingestion_burst = {
    requests: 150,
    duration_ms: Date.now() - burstStart,
    status_counts: statuses,
    receipts_stored: receipts.n,
    tasks_created: taskCount.n,
    expectation: "≤60 accepted per minute per token, the rest 429; no 5xx; all accepted claims attach to ONE task",
  };
  console.log(JSON.stringify(summary.ingestion_burst));

  // ---- 3. Worker throughput: 200 tasks queued at once
  const scenarioStart = Date.now();
  const created: string[] = [];
  const keys = ["missing_schedule", "already_scheduled", "unsupported_structure", "period_changed"] as const;
  for (let i = 0; i < 200; i++) {
    const r = await db.createScenario(sql, ctx, keys[i % keys.length]);
    created.push(r.task_id);
  }
  const queuedAt = Date.now();
  let pending = created.length;
  while (pending > 0 && Date.now() - queuedAt < 300_000) {
    const [row] = await admin<{ n: number }[]>`select count(*)::int as n from app.tasks where id = any(${created}) and verdict = 'PENDING'`;
    pending = row.n;
    if (pending > 0) await sleep(500);
  }
  const drainedMs = Date.now() - queuedAt;
  const verdicts = await admin<{ verdict: string; n: number }[]>`select verdict, count(*)::int as n from app.tasks where id = any(${created}) group by verdict order by verdict`;
  const [dead] = await admin<{ n: number }[]>`select count(*)::int as n from app.jobs where workspace_id = ${ws.id} and status in ('DEAD', 'FAILED')`;
  const [proposals] = await admin<{ n: number }[]>`select count(*)::int as n from app.recovery_proposals where workspace_id = ${ws.id} and status = 'AWAITING_APPROVAL'`;
  summary.worker_throughput = {
    tasks: created.length,
    fixture_creation_ms: queuedAt - scenarioStart,
    all_verified: pending === 0,
    time_to_verify_all_ms: drainedMs,
    tasks_per_second: Math.round((created.length / (drainedMs / 1000)) * 10) / 10,
    verdicts: Object.fromEntries(verdicts.map((v) => [v.verdict, v.n])),
    failed_or_dead_jobs: dead.n,
    proposals_awaiting_approval: proposals.n,
    worker_config: "1 worker process, batch 20, concurrency 5, poll 2s",
  };
  console.log(JSON.stringify(summary.worker_throughput));

  summary.finished_at = new Date().toISOString();
  writeFileSync(join(root, "tests", "load-results.json"), JSON.stringify(summary, null, 2));
  await admin.end({ timeout: 2 });
  await sql.end({ timeout: 2 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
