/**
 * End-to-end API tests against the RUNNING local stack (web :3000, worker, sandbox :4010, Postgres).
 * Covers TEST_PLAN sections C, E, F, H, A7 and the ingestion API.
 * Run: npx tsx --test --test-concurrency=1 tests/e2e-api.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ORIGIN = "http://localhost:3000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, any>;

class Session {
  cookies = new Map<string, string>();
  constructor(public name: string) {}
  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Json; text: string }> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(BASE + path, {
        method,
        redirect: "manual",
        headers: {
          ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
          ...(method !== "GET" ? { origin: ORIGIN, "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        const k = pair.slice(0, i);
        const v = pair.slice(i + 1);
        if (!v || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.cookies.delete(k);
        else this.cookies.set(k, v);
      }
      const text = await res.text();
      let parsed: Json = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = {};
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after") ?? parsed.error?.retry_after_seconds ?? 10);
        await sleep((wait + 1) * 1000);
        continue;
      }
      return { status: res.status, body: parsed, text };
    }
    throw new Error("rate limited repeatedly");
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b: unknown = {}, h: Record<string, string> = {}) => this.req("POST", p, b, h);
}

async function waitFor<T>(label: string, fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 45_000): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)?.slice(0, 600)}`);
}

async function newDemo(name: string) {
  const s = new Session(name);
  const r = await s.post("/api/demo");
  assert.equal(r.status, 201, `demo create ${JSON.stringify(r.body)}`);
  return s;
}

const task = (s: Session, id: string) => s.get(`/api/tasks/${id}`).then((r) => r.body);
async function scenario(s: Session, key: string) {
  const r = await s.post("/api/demo/scenarios", { key });
  assert.equal(r.status, 201, `scenario ${key}: ${JSON.stringify(r.body)}`);
  return r.body.task_id as string;
}
async function waitProposal(s: Session, taskId: string) {
  const d = await waitFor(`proposal for ${taskId}`, () => task(s, taskId), (t) => t.live_proposal?.status === "AWAITING_APPROVAL");
  return d.live_proposal as { id: string; proposal_hash: string };
}
const approve = (s: Session, p: { id: string; proposal_hash: string }, decision = "APPROVE", reason = "Matches the customer's recorded cancellation request.") =>
  s.post(`/api/approvals/${p.id}/decision`, { decision, proposal_hash: p.proposal_hash, reason });

describe("Proofwork end-to-end (running stack)", () => {
  let A: Session;
  let B: Session;

  before(async () => {
    const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
    assert.equal(health.database, "ok", "web app must be running with the database");
    A = await newDemo("A");
    B = await newDemo("B");
  });

  // ------------------------------------------------------------------ C. isolation & access
  describe("C. workspace isolation and access control", () => {
    it("anonymous API access is rejected", async () => {
      const r = await new Session("anon").get("/api/tasks");
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, "AUTH_REQUIRED");
      assert.ok(r.body.error.correlation_id);
    });
    it("forged demo cookie grants nothing", async () => {
      const s = new Session("forged");
      s.cookies.set("pw_demo", `${randomUUID()}.${"x".repeat(43)}.${Math.floor(Date.now() / 1000) + 3600}.forgedmac`);
      const r = await s.get("/api/tasks");
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, "DEMO_EXPIRED");
    });
    it("two demo sessions are isolated (task, approvals, activity)", async () => {
      const aTasks = await waitFor("A starter tasks", () => A.get("/api/tasks?range=all").then((r) => r.body), (b) => b.counts?.total === 6 && b.counts.pending === 0);
      const bTasks = await waitFor("B starter tasks", () => B.get("/api/tasks?range=all").then((r) => r.body), (b) => b.counts?.total === 6 && b.counts.pending === 0);
      const aIds = new Set(aTasks.items.map((t: Json) => t.id));
      for (const t of bTasks.items) assert.ok(!aIds.has(t.id), "no shared task ids");
      const cross = await B.get(`/api/tasks/${aTasks.items[0].id}`);
      assert.equal(cross.status, 404, "other workspace task is not found");
      const aProposal = (await A.get("/api/approvals")).body.items[0];
      const crossApprove = await B.post(`/api/approvals/${aProposal.id}/decision`, { decision: "APPROVE", proposal_hash: aProposal.proposal_hash, reason: "cross tenant attempt" });
      assert.equal(crossApprove.status, 404);
      const bActivity = (await B.get(`/api/activity?range=all&task=${aTasks.items[0].id}`)).body;
      assert.equal(bActivity.page.total, 0);
    });
    it("cross-origin state-changing request is rejected (CSRF)", async () => {
      const r = await A.req("POST", "/api/settings/pause", { paused: true }, { origin: "https://evil.example" });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, "ORIGIN_REJECTED");
    });
    it("demo cannot create tokens, change identity or use Stripe", async () => {
      assert.equal((await A.post("/api/settings/tokens", { name: "x" })).status, 403);
      assert.equal((await A.req("PATCH", "/api/settings/profile", { organization: "X", name: "Y", timezone: "UTC" })).status, 403);
      const stripe = await A.post("/api/settings/connections", { action: "configure", adapter: "STRIPE_TEST" });
      assert.equal(stripe.status, 403);
      assert.equal(stripe.body.error.code, "DEMO_EXTERNAL_ACCESS_BLOCKED");
    });
    it("ingestion API requires a valid token", async () => {
      const r = await new Session("agent").post("/api/v1/claims", {}, { authorization: "Bearer pwk_deadbeef_notarealtokennotarealtokennotarealtoken" });
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, "INVALID_INGESTION_TOKEN");
    });
    it("invalid payloads return field errors, not stack traces", async () => {
      const r = await A.post("/api/claims", { authorized_request_id: "nope" }, { "idempotency-key": `test-${randomUUID()}` });
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, "INVALID_PAYLOAD");
      assert.ok(r.body.error.field_errors);
      assert.ok(!r.text.includes(" at "), "no stack trace");
    });
  });

  // ------------------------------------------------------------------ B (without Supabase)
  describe("B. authentication endpoints", () => {
    it("auth routes fail safely (SETUP_REQUIRED without Supabase, generic 401 with it)", async () => {
      const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
      const r = await new Session("x").post("/api/auth/sign-in", { email: `nobody-${randomUUID()}@example.test`, password: "whatever1" });
      if (health.auth === "configured") {
        assert.equal(r.status, 401);
        assert.ok(!/stack|at \w+ \(/.test(r.text), "no stack traces");
      } else {
        assert.equal(r.status, 503);
        assert.equal(r.body.error.code, "SETUP_REQUIRED");
      }
    });
    it("protected pages redirect anonymous visitors to sign-in with a safe next", async () => {
      const res = await fetch(`${BASE}/app/approvals`, { redirect: "manual" });
      assert.equal(res.status, 307);
      assert.match(res.headers.get("location") ?? "", /\/sign-in\?next=%2Fapp%2Fapprovals/);
    });
  });

  // ------------------------------------------------------------------ F. idempotency & concurrency
  describe("F. durable execution, idempotency and concurrency", () => {
    let requestId: string;
    before(async () => {
      const reqs = (await A.get("/api/requests")).body.items as Json[];
      requestId = reqs[0].id;
    });
    const body = (text = "Cancellation scheduled for the end of the current paid period.") => ({ authorized_request_id: requestId, agent_name: "Support Agent", report_text: text });

    it("same key + same payload returns the original receipt", async () => {
      const key = `e2e-${randomUUID()}`;
      const first = await A.post("/api/claims", body(), { "idempotency-key": key });
      const second = await A.post("/api/claims", body(), { "idempotency-key": key });
      assert.equal(first.status, 202, JSON.stringify(first.body));
      assert.equal(second.status, 200);
      assert.equal(second.body.duplicate, true);
      assert.equal(second.body.receipt_id, first.body.receipt_id);
    });
    it("same key + changed payload is a conflict", async () => {
      const key = `e2e-${randomUUID()}`;
      await A.post("/api/claims", body(), { "idempotency-key": key });
      const changed = await A.post("/api/claims", body("Different text"), { "idempotency-key": key });
      assert.equal(changed.status, 409);
      assert.equal(changed.body.error.code, "DUPLICATE_PAYLOAD_CONFLICT");
    });
    it("10 concurrent identical submissions create exactly one receipt", async () => {
      const key = `e2e-${randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 10 }, () => A.post("/api/claims", body(), { "idempotency-key": key })));
      const receipts = new Set(results.map((r) => r.body.receipt_id));
      assert.equal(receipts.size, 1, JSON.stringify(results.map((r) => [r.status, r.body.error?.code])));
      assert.ok(results.every((r) => r.status === 200 || r.status === 202));
    });
    it("different keys for the same request attach to one logical task", async () => {
      const a = await A.post("/api/claims", body(), { "idempotency-key": `e2e-${randomUUID()}` });
      const b = await A.post("/api/claims", body(), { "idempotency-key": `e2e-${randomUUID()}` });
      assert.equal(a.body.task_id, b.body.task_id);
      const total = (await A.get("/api/tasks?range=all")).body.counts.total;
      assert.equal(total, 6, "no extra tasks");
    });
    it("claims are never returned as verified at acceptance", async () => {
      const req = (await B.get("/api/requests")).body.items[0];
      const r = await B.post("/api/claims", { authorized_request_id: req.id, agent_name: "Support Agent", report_text: "done" }, { "idempotency-key": `e2e-${randomUUID()}` });
      assert.ok(["PENDING", "SATISFIED_SCHEDULED", "SATISFIED_ENDED", "MISMATCH", "UNVERIFIABLE", "OUT_OF_SCOPE"].includes(r.body.verdict));
      assert.ok(r.status === 202 || r.status === 200);
    });
    it("two concurrent approvals of one proposal record a single decision", async () => {
      const t = await scenario(B, "missing_schedule");
      const p = await waitProposal(B, t);
      const [x, y] = await Promise.all([approve(B, p), approve(B, p)]);
      const statuses = [x.status, y.status].sort();
      assert.deepEqual(statuses, [200, 409], JSON.stringify([x.body, y.body]));
      const d = await waitFor("verified", () => task(B, t), (v) => v.task.verdict === "SATISFIED_SCHEDULED");
      assert.equal(d.operations.length, 1);
      assert.equal(d.operations[0].dispatch_count, 1);
    });
    it("competing recovery for the same subscription dispatches only once", async () => {
      const t = await scenario(B, "competing_recovery");
      const p = await waitProposal(B, t);
      assert.equal((await approve(B, p)).status, 200);
      await B.post("/api/demo/controls", { task_id: t, control: "QUEUE_COMPETING_RECOVERY" });
      await B.post("/api/demo/controls", { task_id: t, control: "QUEUE_COMPETING_RECOVERY" });
      const d = await waitFor("verified", () => task(B, t), (v) => v.task.verdict === "SATISFIED_SCHEDULED" && v.operations.every((o: Json) => o.resolved_at));
      await sleep(6000);
      const final = await task(B, t);
      assert.equal(final.operations.length, 1, "one operation");
      assert.equal(final.operations[0].dispatch_count, 1, "one dispatch");
      assert.equal(d.operations[0].state, "VERIFIED");
    });
    it("lost write response is reconciled without a second write", async () => {
      const t = await scenario(B, "response_lost");
      const p = await waitProposal(B, t);
      assert.equal((await approve(B, p)).status, 200);
      const d = await waitFor("reconciled", () => task(B, t), (v) => v.operations[0]?.resolved_at);
      const op = d.operations[0];
      assert.equal(op.outcome_certainty, "UNCERTAIN");
      assert.equal(op.state, "VERIFIED");
      assert.equal(op.attribution, "PROOFWORK", "source operation history attributes the write");
      assert.equal(op.dispatch_count, 1);
      assert.equal(d.task.verdict, "SATISFIED_SCHEDULED");
    });
  });

  // ------------------------------------------------------------------ E. recovery behavior
  describe("E. recovery behavior", () => {
    let C: Session;
    let D: Session;
    before(async () => {
      C = await newDemo("C");
      D = await newDemo("D");
    });

    it("rejected source write ends FAILED_CONFIRMED and stays Needs action", async () => {
      const t = await scenario(C, "mutation_rejected");
      const p = await waitProposal(C, t);
      assert.equal((await approve(C, p)).status, 200);
      const d = await waitFor("failed", () => task(C, t), (v) => v.operations[0]?.resolved_at);
      assert.equal(d.operations[0].state, "FAILED_CONFIRMED");
      assert.equal(d.task.verdict, "MISMATCH");
    });
    it("rejection requires a reason, persists, and does not change the verdict", async () => {
      const t = await scenario(C, "missing_schedule");
      const p = await waitProposal(C, t);
      const noReason = await C.post(`/api/approvals/${p.id}/decision`, { decision: "REJECT", proposal_hash: p.proposal_hash, reason: "" });
      assert.equal(noReason.status, 400);
      const r = await approve(C, p, "REJECT", "Customer withdrew the cancellation by phone.");
      assert.equal(r.status, 200);
      const d = await task(C, t);
      assert.equal(d.task.verdict, "MISMATCH");
      assert.equal(d.task.recovery_state, "REJECTED");
      assert.equal(d.operations.length, 0, "no write");
      assert.ok(d.interventions.some((i: Json) => i.kind === "APPROVAL_REJECTED"));
    });
    it("expired proposal cannot be approved", async () => {
      const t = await scenario(C, "expired_approval");
      const p = await waitProposal(C, t);
      assert.equal((await C.post("/api/demo/controls", { task_id: t, control: "EXPIRE_PROPOSAL" })).status, 200);
      const r = await approve(C, p);
      assert.equal(r.status, 409);
      assert.ok(["APPROVAL_EXPIRED", "APPROVAL_STALE"].includes(r.body.error.code), r.body.error.code);
      assert.equal((await task(C, t)).operations.length, 0);
    });
    it("source drift after approval blocks the stale write", async () => {
      const t = await scenario(C, "material_change");
      const p = await waitProposal(C, t);
      assert.equal((await C.post("/api/demo/source-changes", { task_id: t, change: "SHIFT_PERIOD" })).status, 200);
      assert.equal((await approve(C, p)).status, 200);
      const d = await waitFor("period changed", () => task(C, t), (v) => v.task.primary_reason_code === "PERIOD_CHANGED" && !["QUEUED", "VERIFYING", "RECOVERING"].includes(v.task.processing_state));
      assert.equal(d.operations.length, 0, "no write after drift");
    });
    it("wrong customer identity → Needs action, recovery blocked", async () => {
      const t = await scenario(C, "wrong_identity");
      const d = await waitFor("identity", () => task(C, t), (v) => v.task.verdict !== "PENDING");
      assert.equal(d.task.primary_reason_code, "IDENTITY_MISMATCH");
      assert.equal(d.live_proposal, null);
    });
    it("external correction before dispatch → no write, Cancellation scheduled", async () => {
      const t = await scenario(C, "missing_schedule");
      const p = await waitProposal(C, t);
      await C.post("/api/demo/source-changes", { task_id: t, change: "SCHEDULE_EXTERNALLY" });
      assert.equal((await approve(C, p)).status, 200);
      const d = await waitFor("no-op", () => task(C, t), (v) => v.task.verdict === "SATISFIED_SCHEDULED");
      assert.equal(d.operations.length, 0);
    });
    it("reversal after a verified recovery → human review, no automatic re-write", async () => {
      const t = await scenario(C, "missing_schedule");
      const p = await waitProposal(C, t);
      assert.equal((await approve(C, p)).status, 200);
      await waitFor("verified", () => task(C, t), (v) => v.task.verdict === "SATISFIED_SCHEDULED" && v.operations[0]?.state === "VERIFIED");
      await C.post("/api/demo/source-changes", { task_id: t, change: "REVERSE_SCHEDULE" });
      assert.equal((await C.post(`/api/tasks/${t}/recheck`)).status, 202);
      const d = await waitFor("reversal", () => task(C, t), (v) => v.task.verdict === "MISMATCH" && v.task.processing_state !== "QUEUED" && v.task.processing_state !== "VERIFYING");
      assert.equal(d.task.gate_decision, "PRIOR_REVERSAL");
      assert.equal(d.live_proposal, null);
      assert.equal(d.operations.length, 1);
    });
    it("source outage stays Could not verify; recovers after restore + recheck", async () => {
      const t = await scenario(C, "missing_schedule");
      await waitProposal(C, t);
      await C.post("/api/demo/source-changes", { task_id: t, change: "SOURCE_OUTAGE" });
      await C.post(`/api/tasks/${t}/recheck`);
      const u = await waitFor("unverifiable", () => task(C, t), (v) => v.task.verdict === "UNVERIFIABLE");
      assert.equal(u.task.primary_reason_code, "SOURCE_UNAVAILABLE");
      assert.equal(u.operations.length, 0);
      await C.post("/api/demo/source-changes", { task_id: t, change: "SOURCE_RESTORE" });
      await C.post(`/api/tasks/${t}/recheck`);
      await waitFor("mismatch again", () => task(C, t), (v) => v.task.verdict === "MISMATCH");
    });
    it("write pause holds an approved recovery until writes resume", async () => {
      const t = await scenario(D, "write_pause");
      const p = await waitProposal(D, t);
      assert.equal((await approve(D, p)).status, 200);
      await sleep(8000);
      const held = await task(D, t);
      assert.equal(held.operations.filter((o: Json) => o.dispatch_count > 0).length, 0, "nothing dispatched while paused");
      assert.equal(held.task.verdict, "MISMATCH");
      assert.equal((await D.post("/api/settings/pause", { paused: false })).status, 200);
      await waitFor("verified after resume", () => task(D, t), (v) => v.task.verdict === "SATISFIED_SCHEDULED");
    });
    it("observe-only never proposes; auto-recover repairs without approval", async () => {
      assert.equal((await D.post("/api/settings/policy", { mode: "OBSERVE_ONLY" })).status, 200);
      const t1 = await scenario(D, "missing_schedule");
      const o = await waitFor("observe", () => task(D, t1), (v) => v.task.verdict === "MISMATCH");
      assert.equal(o.task.gate_decision, "OBSERVE_ONLY");
      assert.equal(o.live_proposal, null);
      const noConfirm = await D.post("/api/settings/policy", { mode: "AUTO_RECOVER" });
      assert.equal(noConfirm.status, 400, "auto-recover needs explicit confirmation");
      assert.equal((await D.post("/api/settings/policy", { mode: "AUTO_RECOVER", confirmAutoRecover: true })).status, 200);
      const t2 = await scenario(D, "missing_schedule");
      const a = await waitFor("auto recovered", () => task(D, t2), (v) => v.task.verdict === "SATISFIED_SCHEDULED" && v.operations[0]?.state === "VERIFIED");
      assert.equal(a.proposals[0].decision, "AUTO_POLICY");
    });
  });

  // ------------------------------------------------------------------ H. reporting
  describe("H. reporting and exports", () => {
    it("insights use the same cohort as tasks and keep hard cases in the denominator", async () => {
      const tasks = (await B.get("/api/tasks?range=all")).body.counts;
      const ins = (await B.get("/api/insights?range=all")).body;
      assert.equal(ins.outcomes.total, tasks.total);
      assert.equal(ins.main_metric.denominator, tasks.total);
      assert.equal(ins.outcomes.unverifiable, tasks.unverifiable);
      assert.ok(ins.main_metric.numerator <= ins.outcomes.satisfied);
    });
    it("approval-driven recoveries are excluded from the autonomous numerator", async () => {
      const ins = (await B.get("/api/insights?range=all")).body;
      assert.ok(ins.recovery.verified_human_approved >= 1);
      assert.equal(ins.main_metric.numerator, ins.outcomes.satisfied - ins.human_effort.tasks_with_intervention + Math.max(0, 0), "satisfied tasks with interventions are excluded");
    });
    it("correctness is Not measured until a review label exists", async () => {
      const before = (await A.get("/api/insights?range=all")).body.correctness;
      assert.equal(before.measured, false);
      const tasks = (await A.get("/api/tasks?status=scheduled&range=all")).body.items;
      const d = await task(A, tasks[0].id);
      const r = await A.post(`/api/tasks/${d.task.id}/reviews`, { decision_id: d.latest_decision.id, label: "CORRECT", evidence_basis: "Checked the synthetic source record manually." });
      assert.equal(r.status, 201);
      const after = (await A.get("/api/insights?range=all")).body.correctness;
      assert.equal(after.measured, true);
      assert.equal(after.denominator, 1);
      assert.equal(after.numerator, 0);
    });
    it("CSV export contains exactly the filtered scope", async () => {
      const r = await B.get("/api/activity/export?range=all&type=recovery");
      assert.equal(r.status, 200);
      const rows = r.text.trim().split("\r\n").slice(1);
      assert.ok(rows.length > 0);
      for (const row of rows) assert.match(row, /^"[^"]+","recovery\./);
      const list = (await B.get("/api/activity?range=all&type=recovery")).body;
      assert.equal(rows.length, list.page.total);
    });
  });

  // ------------------------------------------------------------------ Ingestion API with a private workspace
  describe("Ingestion API (private workspace provisioned directly, no Supabase login)", () => {
    const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => undefined });
    let token = "";
    let requestId = "";
    after(async () => {
      await admin.end({ timeout: 2 });
    });
    before(async () => {
      process.env.PROOFWORK_ENABLE_DEV_SCENARIOS = "true";
      const db = await import("../packages/database/src/index");
      const sql = db.getSql();
      const [user] = await admin<{ id: string }[]>`
        insert into auth.users (id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at) values (gen_random_uuid(), 'authenticated', 'authenticated', ${`e2e-${randomUUID()}@example.test`}, ${admin.json({ full_name: "E2E Owner", organization: "E2E Org" })}, now(), now(), now()) returning id
      `;
      const correlationId = randomUUID();
      const ws = await db.ensurePrivateWorkspace(sql, { id: user.id, email: "e2e@example.test", fullName: "E2E Owner", organization: "E2E Org" }, correlationId);
      const ctx = { workspace: { id: ws.id, kind: "PRIVATE" as const }, actor: db.actorForUser({ id: user.id }, "E2E Owner"), correlationId };
      await db.saveWorkspaceProfile(sql, ctx, { organization: "E2E Org", name: "Ops", timezone: "UTC" }, { onboarding: true });
      await db.createPolicyVersion(sql, ctx, { mode: "REQUIRE_APPROVAL" }, { onboarding: true });
      const conn = await db.configureLocalSandbox(sql, ctx, { seedStarter: true });
      assert.equal(conn.health, "CONNECTED");
      await db.activateConnection(sql, ctx, "LOCAL_SANDBOX");
      await db.markOnboardingComplete(sql, ctx);
      // Real preview → confirm path (not a fixture).
      const preview = await db.previewRequest(sql, ctx, { subscription_id: "sub_sbx_1048", source_reference: "support-ticket-1048" });
      const req = await db.confirmRequest(sql, ctx, { preview_token: preview.preview_token });
      requestId = req.id;
      token = (await db.createToken(sql, ctx, "E2E agent")).token;
      const [hash] = await admin`select token_hash from app.agent_credentials where token_prefix = ${token.split("_").slice(0, 2).join("_")}`;
      assert.ok(hash.token_hash && hash.token_hash !== token, "token stored hashed");
    });
    it("accepts a claim with 202, then verification decides", async () => {
      const agent = new Session("agent");
      const headers = { authorization: `Bearer ${token}`, "idempotency-key": `run-${randomUUID()}` };
      const payload = { authorized_request_id: requestId, agent: { name: "Support Agent" }, report_text: "Cancellation scheduled." };
      const r = await agent.post("/api/v1/claims", payload, headers);
      assert.equal(r.status, 202, JSON.stringify(r.body));
      assert.equal(r.body.verification.verdict, "PENDING");
      const again = await agent.post("/api/v1/claims", payload, headers);
      assert.equal(again.status, 200);
      assert.equal(again.body.receipt_id, r.body.receipt_id);
      const status = await waitFor("decided", () => agent.req("GET", r.body.status_url, undefined, { authorization: `Bearer ${token}` }).then((x) => x.body), (b) => b.verdict && b.verdict !== "PENDING");
      assert.equal(status.verdict, "MISMATCH");
      assert.equal(status.primary_reason_code, "SCHEDULE_MISSING");
    });
    it("rejects unknown fields (agent cannot define the outcome)", async () => {
      const r = await new Session("agent").post(
        "/api/v1/claims",
        { authorized_request_id: requestId, agent: { name: "A" }, report_text: "x", expected_period_end: "2030-01-01T00:00:00Z" },
        { authorization: `Bearer ${token}`, "idempotency-key": `run-${randomUUID()}` },
      );
      assert.equal(r.status, 400);
    });
    it("requires an Idempotency-Key", async () => {
      const r = await new Session("agent").post("/api/v1/claims", { authorized_request_id: requestId, agent: { name: "A" }, report_text: "x" }, { authorization: `Bearer ${token}` });
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
    });
    it("revoked token stops working", async () => {
      const [cred] = await admin`select id, workspace_id from app.agent_credentials where token_prefix = ${token.split("_").slice(0, 2).join("_")}`;
      await admin`update app.agent_credentials set revoked_at = now() where id = ${cred.id}`;
      const r = await new Session("agent").post("/api/v1/claims", { authorized_request_id: requestId, agent: { name: "A" }, report_text: "x" }, { authorization: `Bearer ${token}`, "idempotency-key": `run-${randomUUID()}` });
      assert.equal(r.status, 401);
    });
  });

  // ------------------------------------------------------------------ A7. database guards
  describe("A7. append-only and immutability guards (as proofwork_app)", () => {
    const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined });
    after(async () => {
      await app.end({ timeout: 2 });
    });
    for (const table of ["audit_events", "decisions", "claim_receipts", "policy_versions", "approval_decisions"]) {
      it(`${table} rejects UPDATE and DELETE`, async () => {
        await assert.rejects(app.unsafe(`update app.${table} set workspace_id = workspace_id where true`), /append-only/);
        await assert.rejects(app.unsafe(`delete from app.${table} where true`), /append-only/);
      });
    }
    it("authorized request boundary is immutable", async () => {
      await assert.rejects(app`update app.authorized_requests set expected_period_end = expected_period_end + interval '1 day'`, /immutable/);
    });
    it("application role cannot read the billing sandbox schema", async () => {
      await assert.rejects(app`select * from billing_sandbox.subscriptions limit 1`, /permission denied/);
    });
    it("unresolved dispatched operations cannot be deleted", async () => {
      await app.begin(async (tx) => {
        await tx`select set_config('proofwork.purge', 'on', true)`;
        const [op] = await tx`select id from app.recovery_operations where resolved_at is null and dispatch_count > 0 limit 1`;
        if (op) await assert.rejects(tx`delete from app.recovery_operations where id = ${op.id}`, /unresolved/);
      }).catch((e) => {
        if (!/unresolved/.test(String(e))) throw e;
      });
    });
  });
});
