/**
 * Worker crash / lease-expiry durability tests (TEST_PLAN F7, F8, F9, F11).
 * Requires web (:3000), billing sandbox (:4010) and Postgres running, and NO other worker.
 * The test spawns and kills worker processes itself.
 * Run: npx tsx --test --test-concurrency=1 --test-timeout=300000 tests/crash-recovery.test.ts
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });
const BASE = "http://localhost:3000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 2, onnotice: () => undefined });

type Json = Record<string, any>;
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const workerEntry = join(root, "apps", "worker", "src", "index.ts");

function startWorker(name: string, extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, [tsxCli, workerEntry], {
    cwd: root,
    env: { ...process.env, WORKER_NAME: name, WORKER_POLL_INTERVAL_MS: "500", NODE_ENV: "development", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d) => (output += d.toString()));
  child.stderr?.on("data", (d) => (output += d.toString()));
  const exited = new Promise<number | null>((res) => child.on("exit", (code) => res(code)));
  return { child, exited, output: () => output };
}

async function stopWorker(w: { child: ChildProcess; exited: Promise<number | null> }) {
  if (w.child.exitCode === null) w.child.kill();
  await Promise.race([w.exited, sleep(10_000)]);
}

class Session {
  cookie = "";
  async req(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
    for (let i = 0; i < 6; i++) {
      const res = await fetch(BASE + path, {
        method,
        headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(method !== "GET" ? { origin: BASE, "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.getSetCookie?.() ?? [];
      for (const c of set) if (c.startsWith("pw_demo=")) this.cookie = c.split(";")[0];
      const text = await res.text();
      if (res.status === 429) {
        await sleep((Number(res.headers.get("retry-after") ?? 10) + 1) * 1000);
        continue;
      }
      return { status: res.status, body: text ? JSON.parse(text) : {} };
    }
    throw new Error("rate limited");
  }
}

async function waitFor<T>(label: string, fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)?.slice(0, 500)}`);
}

async function operationFor(taskId: string) {
  const [op] = await admin<Json[]>`select * from app.recovery_operations where task_id = ${taskId} order by created_at desc limit 1`;
  return op ?? null;
}

async function sourceWrites(idempotencyKey: string) {
  const [row] = await admin<{ n: number }[]>`
    select count(*)::int as n from billing_sandbox.operations
    where idempotency_key = ${idempotencyKey} and operation = 'schedule_period_end_cancellation' and result_status = 200
  `;
  return row.n;
}

async function prepareApprovedTask() {
  const s = new Session();
  const demo = await s.req("POST", "/api/demo");
  assert.equal(demo.status, 201, JSON.stringify(demo.body));
  const created = await s.req("POST", "/api/demo/scenarios", { key: "missing_schedule" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const taskId = created.body.task_id as string;
  // A normal worker verifies the task and creates the proposal.
  const w = startWorker("crash-test-setup");
  try {
    const detail = await waitFor("proposal", () => s.req("GET", `/api/tasks/${taskId}`).then((r) => r.body), (d) => d.live_proposal?.status === "AWAITING_APPROVAL");
    await stopWorker(w);
    const p = detail.live_proposal;
    const approved = await s.req("POST", `/api/approvals/${p.id}/decision`, { decision: "APPROVE", proposal_hash: p.proposal_hash, reason: "Crash test approval." });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
  } finally {
    await stopWorker(w);
  }
  return { s, taskId };
}

describe("Worker crash and lease recovery (real processes)", () => {
  after(async () => {
    await admin.end({ timeout: 2 });
  });

  const cases = [
    { point: "after_prepare", stateAfterCrash: "PREPARED", dispatchAfterCrash: 0, writesAfterCrash: 0, finalDispatches: 1 },
    { point: "after_dispatch_reserved", stateAfterCrash: "DISPATCHED", dispatchAfterCrash: 1, writesAfterCrash: 0, finalDispatches: 2 },
    { point: "after_write", stateAfterCrash: "DISPATCHED", dispatchAfterCrash: 1, writesAfterCrash: 1, finalDispatches: 1 },
  ] as const;

  for (const c of cases) {
    it(`crash ${c.point}: lease expires, a new worker reconciles the SAME operation, exactly one write reaches billing`, async () => {
      const { s, taskId } = await prepareApprovedTask();

      // 1. Worker that crashes (exit 137) at the injected point, with a short lease.
      const crashing = startWorker(`crash-${c.point}`, { PROOFWORK_TEST_CRASH_AT: c.point, WORKER_LEASE_SECONDS: "5" });
      const code = await Promise.race([crashing.exited, sleep(60_000).then(() => "timeout")]);
      assert.equal(code, 137, `worker should crash at ${c.point}; output:\n${crashing.output().slice(-800)}`);

      // 2. State left behind by the crash.
      const op = await operationFor(taskId);
      assert.ok(op, "durable operation intent exists before any network call");
      assert.equal(op.state, c.stateAfterCrash);
      assert.equal(op.dispatch_count, c.dispatchAfterCrash);
      assert.equal(op.resolved_at, null, "operation stays unresolved");
      assert.equal(await sourceWrites(op.idempotency_key), c.writesAfterCrash);
      const [leased] = await admin<Json[]>`select status from app.jobs where task_id = ${taskId} and kind = 'RECOVER' order by created_at desc limit 1`;
      assert.equal(leased.status, "LEASED", "crashed worker left its job leased (no permanent processing: lease will expire)");

      // 3. Competing write is blocked while unresolved (database guard).
      await assert.rejects(
        admin`insert into app.recovery_operations (workspace_id, task_id, proposal_id, approval_decision_id, connection_id, connection_config_version, subscription_id, parameters, parameter_hash, idempotency_key, state, authorized_until)
              select workspace_id, task_id, gen_random_uuid(), approval_decision_id, connection_id, connection_config_version, subscription_id, parameters, parameter_hash, 'pw_op_competing_' || gen_random_uuid(), 'PREPARED', now()
              from app.recovery_operations where id = ${op.id}`,
        /duplicate key|unique|foreign key/,
      );

      // 4. A healthy worker reclaims the expired lease and reconciles.
      const healthy = startWorker(`recover-${c.point}`);
      try {
        const final = await waitFor(
          "reconciled",
          async () => ({ op: await operationFor(taskId), task: (await s.req("GET", `/api/tasks/${taskId}`)).body.task }),
          (v) => Boolean(v.op?.resolved_at) && v.task?.verdict === "SATISFIED_SCHEDULED",
          120_000,
        );
        assert.equal(final.op.id, op.id, "same operation was continued, not replaced");
        assert.equal(final.op.idempotency_key, op.idempotency_key, "same idempotency key reused");
        assert.equal(final.op.state, "VERIFIED");
        assert.equal(final.op.attribution, "PROOFWORK");
        assert.equal(final.op.dispatch_count, c.finalDispatches);
        assert.equal(await sourceWrites(op.idempotency_key), 1, "exactly one applied write at the billing source");
        const [ops] = await admin<{ n: number }[]>`select count(*)::int as n from app.recovery_operations where task_id = ${taskId}`;
        assert.equal(ops.n, 1, "no second operation created");
      } finally {
        await stopWorker(healthy);
      }
    });
  }

  it("late commit from a worker that lost its lease is discarded (fencing)", async () => {
    const s = new Session();
    assert.equal((await s.req("POST", "/api/demo")).status, 201);
    const created = await s.req("POST", "/api/demo/scenarios", { key: "already_scheduled" });
    const taskId = created.body.task_id as string;
    const w = startWorker("fencing-setup");
    try {
      await waitFor("first verification", () => s.req("GET", `/api/tasks/${taskId}`).then((r) => r.body), (d) => d.task?.verdict === "SATISFIED_SCHEDULED");
    } finally {
      await stopWorker(w);
    }
    // Simulate a stale worker: processing version moves on while an old read is committed.
    const db = await import("../packages/database/src/index");
    const sql = db.getSql();
    const [t] = await admin<Json[]>`select workspace_id from app.tasks where id = ${taskId}`;
    const ctx = await db.loadTaskContext(sql, t.workspace_id, taskId);
    const staleVersion = await db.beginProcessing(sql, t.workspace_id, taskId);
    await db.beginProcessing(sql, t.workspace_id, taskId); // newer owner
    const read = await db.readSource(ctx);
    const res = await db.recordEvaluation(sql, { ctx, read, trigger: "RETRY", processingVersion: staleVersion, actor: db.WORKER_ACTOR("stale"), correlationId: crypto.randomUUID(), allowProposal: true });
    assert.equal(res.committed, false, "stale commit rejected");
    const [obs] = await admin<Json[]>`select discarded from app.observations where id = ${res.observationId}`;
    assert.equal(obs.discarded, true, "late read kept only for diagnostics");
    await sql.end({ timeout: 2 });
  });
});
