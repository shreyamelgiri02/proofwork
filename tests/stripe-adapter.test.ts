/**
 * Stripe test-mode adapter tests WITHOUT real Stripe credentials.
 *  A. Against Stripe's official stripe-mock (validates requests against Stripe's OpenAPI spec).
 *  B. Against a local capture server (exact request bytes + every error mapping).
 * Real Stripe sandbox behavior (state changes, idempotent replay) is NOT covered here.
 * Run: stripe-mock on :12111, then  npx tsx --test tests/stripe-adapter.test.ts
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { evaluate } from "../packages/domain/src/index";
import { AdapterConfigurationError, normalizeStripeSubscription, resolveAdapter, StripeTestAdapter, stripeApiBase } from "../packages/adapters/src/index";

const MOCK = "http://127.0.0.1:12111";

describe("A. stripe-mock (official Stripe API mock)", () => {
  before(() => {
    process.env.STRIPE_API_BASE = MOCK;
  });
  const adapter = () => new StripeTestAdapter({ secretKey: "sk_test_proofwork123", boundAccountId: null });

  it("account validation reads account identity", async () => {
    const v = await adapter().validateConnection();
    assert.equal(v.ok, true, JSON.stringify(v));
    if (v.ok) assert.match(v.source_account_id, /^acct_/);
  });
  it("subscription read normalizes Stripe's real response shape", async () => {
    const r = await new StripeTestAdapter({ secretKey: "sk_test_proofwork123", boundAccountId: "acct_bound" }).getSubscription("sub_testProofwork1");
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    const s = r.snapshot;
    assert.equal(s.adapter, "STRIPE_TEST");
    assert.equal(s.environment, "STRIPE_TEST_MODE");
    assert.equal(s.livemode, false);
    assert.equal(s.source_account_id, "acct_bound", "account identity comes from the validated binding");
    assert.equal(s.subscription_id, "sub_testProofwork1");
    assert.match(s.customer_id, /^cus_/);
    assert.equal(typeof s.cancel_at_period_end, "boolean");
    assert.ok(s.item_count >= 1);
    // The evaluator accepts the normalized snapshot without throwing and returns a typed verdict.
    const e = evaluate({
      request: { status: "ACTIVE", adapter: "STRIPE_TEST", source_account_id: "acct_bound", customer_id: s.customer_id, subscription_id: s.subscription_id, expected_period_end: s.current_period_end ?? new Date().toISOString() },
      read: r,
      now: new Date(),
    });
    assert.ok(["SATISFIED_SCHEDULED", "SATISFIED_ENDED", "MISMATCH", "UNVERIFIABLE", "OUT_OF_SCOPE"].includes(e.verdict));
  });
  it("the recovery write is accepted by Stripe's API spec (only cancel_at_period_end=true)", async () => {
    const w = await adapter().schedulePeriodEndCancellation({ subscriptionId: "sub_testProofwork1", idempotencyKey: "pw_op_test_1" });
    assert.equal(w.outcome, "ACCEPTED", JSON.stringify(w));
  });
  it("stripe-mock rejects parameters outside the spec (sanity check that validation is real)", async () => {
    const res = await fetch(`${MOCK}/v1/subscriptions/sub_x`, { method: "POST", headers: { authorization: "Bearer sk_test_x", "content-type": "application/x-www-form-urlencoded" }, body: "not_a_real_param=1" });
    assert.equal(res.status, 400);
  });
  it("subscription list for selection works", async () => {
    const l = await new StripeTestAdapter({ secretKey: "sk_test_proofwork123", boundAccountId: "acct_bound" }).listSubscriptions(5);
    assert.equal(l.ok, true, JSON.stringify(l));
  });
});

// ---------------------------------------------------------------------------
type Captured = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };
let server: Server;
let base = "";
let captured: Captured[] = [];
let respond: (c: Captured) => { status: number; body?: unknown; delayMs?: number; headers?: Record<string, string> } = () => ({ status: 200, body: {} });

const subscription = (over: Record<string, unknown> = {}) => ({
  object: "subscription",
  id: "sub_capture1",
  livemode: false,
  customer: "cus_capture1",
  status: "active",
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  ended_at: null,
  collection_method: "charge_automatically",
  schedule: null,
  pause_collection: null,
  pending_update: null,
  items: { object: "list", has_more: false, total_count: 1, data: [{ current_period_start: 1789000000, current_period_end: 1791600000, price: { recurring: { usage_type: "licensed" } } }] },
  ...over,
});

describe("B. exact request contract and error mapping (capture server)", () => {
  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const c = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
        captured.push(c);
        const r = respond(c);
        setTimeout(() => {
          res.writeHead(r.status, { "content-type": "application/json", "request-id": "req_capture", ...r.headers });
          res.end(JSON.stringify(r.body ?? {}));
        }, r.delayMs ?? 0);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    process.env.STRIPE_API_BASE = base;
  });
  after(() => {
    server.close();
    delete process.env.STRIPE_API_BASE;
  });
  const bound = (timeoutMs?: number) => new StripeTestAdapter({ secretKey: "sk_test_capture", boundAccountId: "acct_bound", apiVersion: "2026-08-26.dahlia", timeoutMs });

  it("write sends exactly one allowlisted parameter, pinned version, stable idempotency key", async () => {
    captured = [];
    respond = () => ({ status: 200, body: subscription({ cancel_at_period_end: true }) });
    const w = await bound().schedulePeriodEndCancellation({ subscriptionId: "sub_capture1", idempotencyKey: "pw_op_abc" });
    assert.equal(w.outcome, "ACCEPTED");
    const c = captured[0];
    assert.equal(c.method, "POST");
    assert.equal(c.url, "/v1/subscriptions/sub_capture1");
    assert.equal(c.body, "cancel_at_period_end=true", "no refund, price, proration or immediate-cancel fields");
    assert.equal(c.headers["idempotency-key"], "pw_op_abc");
    assert.equal(c.headers["stripe-version"], "2026-08-26.dahlia");
    assert.equal(c.headers.authorization, "Bearer sk_test_capture");
  });
  it("read uses GET with the pinned version and records the provider request id", async () => {
    captured = [];
    respond = () => ({ status: 200, body: subscription() });
    const r = await bound().getSubscription("sub_capture1");
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].headers["stripe-version"], "2026-08-26.dahlia");
    assert.equal(r.ok && r.provider_request_id, "req_capture");
    assert.equal(r.ok && r.snapshot.current_period_end, new Date(1791600000 * 1000).toISOString(), "period end comes from the single item");
  });
  it("livemode:true resources are rejected", async () => {
    respond = () => ({ status: 200, body: subscription({ livemode: true }) });
    const r = await bound().getSubscription("sub_capture1");
    assert.equal(!r.ok && r.error_code, "LIVE_MODE_BLOCKED");
    const w = await bound().schedulePeriodEndCancellation({ subscriptionId: "sub_capture1", idempotencyKey: "k1234567" });
    assert.equal(w.outcome, "REJECTED");
  });
  for (const [status, code] of [[404, "SOURCE_NOT_FOUND"], [401, "SOURCE_ACCESS_DENIED"], [403, "SOURCE_ACCESS_DENIED"], [429, "SOURCE_RATE_LIMITED"], [500, "SOURCE_UNAVAILABLE"], [503, "SOURCE_UNAVAILABLE"]] as const) {
    it(`read HTTP ${status} → ${code} (never treated as cancelled)`, async () => {
      respond = () => ({ status, body: { error: { type: "api_error" } } });
      const r = await bound().getSubscription("sub_capture1");
      assert.equal(!r.ok && r.error_code, code);
    });
  }
  it("read timeout → SOURCE_TIMEOUT", async () => {
    respond = () => ({ status: 200, body: subscription(), delayMs: 600 });
    const r = await bound(150).getSubscription("sub_capture1");
    assert.equal(!r.ok && r.error_code, "SOURCE_TIMEOUT");
  });
  it("write 5xx or timeout → UNCERTAIN (may have applied)", async () => {
    respond = () => ({ status: 502, body: {} });
    assert.equal((await bound().schedulePeriodEndCancellation({ subscriptionId: "sub_capture1", idempotencyKey: "k1234567" })).outcome, "UNCERTAIN");
    respond = () => ({ status: 200, body: subscription(), delayMs: 600 });
    assert.equal((await bound(150).schedulePeriodEndCancellation({ subscriptionId: "sub_capture1", idempotencyKey: "k1234567" })).outcome, "UNCERTAIN");
  });
  it("write 4xx → REJECTED with the Stripe error code", async () => {
    respond = () => ({ status: 400, body: { error: { type: "invalid_request_error", code: "resource_missing" } } });
    const w = await bound().schedulePeriodEndCancellation({ subscriptionId: "sub_capture1", idempotencyKey: "k1234567" });
    assert.equal(w.outcome, "REJECTED");
    assert.equal(w.outcome === "REJECTED" && w.error_code, "RESOURCE_MISSING");
  });
  it("malformed or unsupported shapes are not guessed", async () => {
    respond = () => ({ status: 200, body: { object: "subscription", id: "sub_capture1" } });
    assert.equal((await bound().getSubscription("sub_capture1")).ok, false);
    const multi = normalizeStripeSubscription(subscription({ items: { has_more: true, total_count: 3, data: [{}, {}] } }) as never, "acct_bound");
    assert.equal(multi?.current_period_end, null);
    assert.equal(multi?.items_complete, false);
  });
  it("unsafe subscription ids never reach the network", async () => {
    captured = [];
    const r = await bound().getSubscription("../v1/customers");
    assert.equal(r.ok, false);
    assert.equal(captured.length, 0);
  });
  it("account bound to a different credential fails validation", async () => {
    respond = () => ({ status: 200, body: { id: "acct_other" } });
    const v = await bound().validateConnection();
    assert.equal(v.ok, false);
  });
});

describe("C. configuration guards", () => {
  it("live keys are rejected before any request", () => {
    assert.throws(() => new StripeTestAdapter({ secretKey: "sk_live_abc", boundAccountId: null }), (e: unknown) => e instanceof AdapterConfigurationError && e.code === "LIVE_MODE_BLOCKED");
    assert.throws(() => new StripeTestAdapter({ secretKey: "rk_live_abc", boundAccountId: null }), /Live-mode/);
  });
  it("demo workspaces can never resolve Stripe", () => {
    assert.throws(() => resolveAdapter({ adapter: "STRIPE_TEST", source_account_id: "acct_x" }, { workspaceId: "w1", workspaceKind: "DEMO", purpose: "read", env: { STRIPE_TEST_SECRET_KEY: "sk_test_x", PROOFWORK_STRIPE_WORKSPACE_ID: "w1" } as NodeJS.ProcessEnv }), (e: unknown) => e instanceof AdapterConfigurationError && e.code === "DEMO_EXTERNAL_ACCESS_BLOCKED");
  });
  it("credential is bound to exactly one workspace", () => {
    const env = { STRIPE_TEST_SECRET_KEY: "sk_test_x", PROOFWORK_STRIPE_WORKSPACE_ID: "w1" } as NodeJS.ProcessEnv;
    assert.throws(() => resolveAdapter({ adapter: "STRIPE_TEST", source_account_id: "acct_x" }, { workspaceId: "w2", workspaceKind: "PRIVATE", purpose: "read", env }), (e: unknown) => e instanceof AdapterConfigurationError && e.code === "WORKSPACE_NOT_BOUND");
    assert.ok(resolveAdapter({ adapter: "STRIPE_TEST", source_account_id: "acct_x" }, { workspaceId: "w1", workspaceKind: "PRIVATE", purpose: "read", env }));
  });
  it("API base override is loopback-only and ignored in production", () => {
    assert.equal(stripeApiBase({ STRIPE_API_BASE: "https://evil.example" } as NodeJS.ProcessEnv), "https://api.stripe.com");
    assert.equal(stripeApiBase({ STRIPE_API_BASE: "http://127.0.0.1:12111", NODE_ENV: "production" } as NodeJS.ProcessEnv), "https://api.stripe.com");
    assert.equal(stripeApiBase({ STRIPE_API_BASE: "http://127.0.0.1:12111" } as NodeJS.ProcessEnv), "http://127.0.0.1:12111");
  });
});
