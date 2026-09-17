/**
 * TEST_PLAN section D (evaluator) + recovery gate unit tests.
 * Run: npx tsx --test tests/evaluator.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluate, evaluateRecoveryGate, type EvaluationRequest, type NormalizedSubscription, type SourceRead } from "../packages/domain/src/index";

const NOW = new Date("2026-09-17T10:00:00Z");
const T = "2026-09-24T10:00:00.000Z";
const iso = (ms: number) => new Date(ms).toISOString();

const request = (over: Partial<EvaluationRequest> = {}): EvaluationRequest => ({
  status: "ACTIVE",
  adapter: "LOCAL_SANDBOX",
  source_account_id: "acct_sbx_1234abcd",
  customer_id: "cus_demo_1048",
  subscription_id: "sub_demo_1048",
  expected_period_end: T,
  ...over,
});

const snap = (over: Partial<NormalizedSubscription> = {}): NormalizedSubscription => ({
  adapter: "LOCAL_SANDBOX",
  environment: "SYNTHETIC_SANDBOX",
  livemode: false,
  source_account_id: "acct_sbx_1234abcd",
  customer_id: "cus_demo_1048",
  subscription_id: "sub_demo_1048",
  customer_label: "Rivera Logistics",
  status: "active",
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  ended_at: null,
  current_period_start: "2026-08-25T10:00:00.000Z",
  current_period_end: T,
  item_count: 1,
  items_complete: true,
  usage_type: "licensed",
  collection_method: "charge_automatically",
  schedule_id: null,
  pause_collection: false,
  pending_update: false,
  source_version: "1",
  ...over,
});

const ok = (s: NormalizedSubscription, at: Date = NOW): SourceRead => ({ ok: true, snapshot: s, observed_at: at.toISOString(), provider_request_id: "req_1" });
const fail = (code: Extract<SourceRead, { ok: false }>["error_code"], at: Date = NOW): SourceRead => ({ ok: false, error_code: code, http_status: 503, observed_at: at.toISOString(), provider_request_id: null });
const run = (read: SourceRead | null, now: Date = NOW, req: EvaluationRequest | null = request()) => evaluate({ request: req, read, now });
const Tms = new Date(T).getTime();

describe("evaluator — ordered verdict rules", () => {
  it("correct schedule before T → SATISFIED_SCHEDULED", () => {
    const r = run(ok(snap({ cancel_at_period_end: true })));
    assert.equal(r.verdict, "SATISFIED_SCHEDULED");
    assert.equal(r.primary_reason, "CANCELLATION_SCHEDULED");
    assert.ok(r.next_check_at, "monitoring scheduled");
  });
  it("missing schedule → MISMATCH/SCHEDULE_MISSING and recovery candidate", () => {
    const r = run(ok(snap()));
    assert.equal(r.verdict, "MISMATCH");
    assert.equal(r.primary_reason, "SCHEDULE_MISSING");
    assert.equal(r.recovery_candidate, true);
  });
  it("ended exactly at T → SATISFIED_ENDED", () => {
    const now = new Date(Tms + 3600_000);
    const r = run(ok(snap({ status: "canceled", ended_at: T, cancel_at_period_end: true }), now), now);
    assert.equal(r.verdict, "SATISFIED_ENDED");
  });
  it("ended at T+300s → SATISFIED_ENDED (inclusive grace)", () => {
    const now = new Date(Tms + 3600_000);
    assert.equal(run(ok(snap({ status: "canceled", ended_at: iso(Tms + 300_000) }), now), now).verdict, "SATISFIED_ENDED");
  });
  it("ended T−1s → MISMATCH/ENDED_EARLY", () => {
    const now = new Date(Tms + 3600_000);
    assert.equal(run(ok(snap({ status: "canceled", ended_at: iso(Tms - 1000) }), now), now).primary_reason, "ENDED_EARLY");
  });
  it("ended after grace → MISMATCH/ENDED_LATE", () => {
    const now = new Date(Tms + 3600_000);
    assert.equal(run(ok(snap({ status: "canceled", ended_at: iso(Tms + 301_000) }), now), now).primary_reason, "ENDED_LATE");
  });
  it("canceled without ended_at → UNVERIFIABLE/END_TIME_MISSING", () => {
    assert.equal(run(ok(snap({ status: "canceled", ended_at: null }))).primary_reason, "END_TIME_MISSING");
  });
  it("custom cancel date ≠ T → CONFLICTING_CANCEL_DATE, not a candidate", () => {
    const r = run(ok(snap({ cancel_at: iso(Tms - 86_400_000) })));
    assert.equal(r.primary_reason, "CONFLICTING_CANCEL_DATE");
    assert.equal(r.recovery_candidate, false);
  });
  it("flag false but custom date = T → CANCELLATION_MODE_MISMATCH", () => {
    assert.equal(run(ok(snap({ cancel_at: T }))).primary_reason, "CANCELLATION_MODE_MISMATCH");
  });
  it("period changed → MISMATCH/PERIOD_CHANGED, not a candidate", () => {
    const r = run(ok(snap({ current_period_end: iso(Tms + 30 * 86_400_000) })));
    assert.equal(r.primary_reason, "PERIOD_CHANGED");
    assert.equal(r.recovery_candidate, false);
  });
  for (const [field, value] of [
    ["customer_id", "cus_other"],
    ["subscription_id", "sub_other_1"],
    ["source_account_id", "acct_sbx_other000"],
  ] as const) {
    it(`identity mismatch on ${field} → IDENTITY_MISMATCH`, () => {
      assert.equal(run(ok(snap({ [field]: value }))).primary_reason, "IDENTITY_MISMATCH");
    });
  }
  it("livemode=true → IDENTITY_MISMATCH (never trusted)", () => {
    assert.equal(run(ok(snap({ livemode: true }))).primary_reason, "IDENTITY_MISMATCH");
  });
  it("wrong environment for adapter → IDENTITY_MISMATCH", () => {
    assert.equal(run(ok(snap({ environment: "STRIPE_TEST_MODE" }))).primary_reason, "IDENTITY_MISMATCH");
  });
  for (const [label, over] of [
    ["two items", { item_count: 2 }],
    ["incomplete items", { items_complete: false }],
    ["schedule attached", { schedule_id: "sub_sched_1" }],
    ["paused collection", { pause_collection: true }],
    ["pending update", { pending_update: true }],
    ["metered usage", { usage_type: "metered" }],
    ["invoice collection", { collection_method: "send_invoice" }],
    ["past_due status", { status: "past_due" }],
  ] as const) {
    it(`unsupported shape (${label}) → OUT_OF_SCOPE`, () => {
      assert.equal(run(ok(snap(over as Partial<NormalizedSubscription>))).verdict, "OUT_OF_SCOPE");
    });
  }
  it("timeout → UNVERIFIABLE/SOURCE_UNAVAILABLE, transient with retry", () => {
    const r = run(fail("SOURCE_TIMEOUT"));
    assert.equal(r.verdict, "UNVERIFIABLE");
    assert.equal(r.transient, true);
    assert.ok(r.next_check_at);
  });
  it("404 → UNVERIFIABLE/SOURCE_NOT_FOUND (never inferred cancelled)", () => {
    assert.equal(run(fail("SOURCE_NOT_FOUND")).primary_reason, "SOURCE_NOT_FOUND");
  });
  it("provider denial → SOURCE_ACCESS_DENIED", () => {
    assert.equal(run(fail("SOURCE_ACCESS_DENIED")).primary_reason, "SOURCE_ACCESS_DENIED");
  });
  it("malformed snapshot → SOURCE_DATA_INVALID", () => {
    const bad = snap() as unknown as Record<string, unknown>;
    delete bad.cancel_at_period_end;
    assert.equal(run(ok(bad as unknown as NormalizedSubscription)).primary_reason, "SOURCE_DATA_INVALID");
  });
  it("stale read (>30s) → EVIDENCE_STALE", () => {
    assert.equal(run(ok(snap({ cancel_at_period_end: true }), new Date(NOW.getTime() - 31_000))).primary_reason, "EVIDENCE_STALE");
  });
  it("future observation time → SOURCE_DATA_INVALID", () => {
    assert.equal(run(ok(snap(), new Date(NOW.getTime() + 60_000))).primary_reason, "SOURCE_DATA_INVALID");
  });
  it("T+299s still active with schedule → FINALIZATION_PENDING", () => {
    const now = new Date(Tms + 299_000);
    assert.equal(run(ok(snap({ cancel_at_period_end: true }), now), now).primary_reason, "FINALIZATION_PENDING");
  });
  it("T+300s still active → NOT_ENDED", () => {
    const now = new Date(Tms + 300_000);
    assert.equal(run(ok(snap({ cancel_at_period_end: true }), now), now).primary_reason, "NOT_ENDED");
  });
  it("at T without schedule → SCHEDULE_MISSING but not recoverable", () => {
    const now = new Date(Tms);
    const r = run(ok(snap(), now), now);
    assert.equal(r.primary_reason, "SCHEDULE_MISSING");
    assert.equal(r.recovery_candidate, false);
  });
  it("superseded request → MISMATCH/REQUEST_NOT_ACTIVE", () => {
    assert.equal(run(ok(snap({ cancel_at_period_end: true })), NOW, request({ status: "SUPERSEDED" })).primary_reason, "REQUEST_NOT_ACTIVE");
  });
  it("missing request → UNVERIFIABLE/MISSING_CONTEXT", () => {
    assert.equal(run(ok(snap()), NOW, null).primary_reason, "MISSING_CONTEXT");
  });
  it("is deterministic for identical inputs", () => {
    assert.deepEqual(run(ok(snap())), run(ok(snap())));
  });
});

describe("recovery gate", () => {
  const base = {
    now: NOW,
    evaluation: { verdict: "MISMATCH" as const, primary_reason: "SCHEDULE_MISSING" as const, recovery_candidate: true },
    request: { status: "ACTIVE" as const, version: 1, expected_period_end: T },
    policy: { mode: "REQUIRE_APPROVAL" as const, version: 1 },
    workspace: { writes_paused: false },
    connection: { config_version: 1 },
    has_unresolved_operation: false,
    prior_verified_recovery: false,
    stage: "proposal" as const,
  };
  const proposal = { status: "AUTHORIZED" as const, request_version: 1, policy_version: 1, connection_config_version: 1, source_fingerprint: "fp", expires_at: iso(NOW.getTime() + 600_000) };

  it("observe only blocks writes", () => assert.equal(evaluateRecoveryGate({ ...base, policy: { mode: "OBSERVE_ONLY", version: 1 } }).decision, "OBSERVE_ONLY"));
  it("require approval asks for approval", () => assert.equal(evaluateRecoveryGate(base).decision, "APPROVAL_REQUIRED"));
  it("auto recover allows when unpaused", () => assert.equal(evaluateRecoveryGate({ ...base, policy: { mode: "AUTO_RECOVER", version: 1 } }).decision, "EXECUTION_ALLOWED"));
  it("write pause blocks auto recover", () => assert.equal(evaluateRecoveryGate({ ...base, policy: { mode: "AUTO_RECOVER", version: 1 }, workspace: { writes_paused: true } }).decision, "WRITES_PAUSED"));
  it("cutoff within 120s blocks", () => assert.equal(evaluateRecoveryGate({ ...base, now: new Date(Tms - 100_000) }).decision, "CUTOFF_REACHED"));
  it("unresolved operation blocks", () => assert.equal(evaluateRecoveryGate({ ...base, has_unresolved_operation: true }).decision, "OPERATION_UNRESOLVED"));
  it("prior verified reversal blocks", () => assert.equal(evaluateRecoveryGate({ ...base, prior_verified_recovery: true }).decision, "PRIOR_REVERSAL"));
  it("non-candidate blocks", () => assert.equal(evaluateRecoveryGate({ ...base, evaluation: { verdict: "MISMATCH", primary_reason: "PERIOD_CHANGED", recovery_candidate: false } }).decision, "NOT_CANDIDATE"));
  it("already satisfied → no write", () => assert.equal(evaluateRecoveryGate({ ...base, evaluation: { verdict: "SATISFIED_SCHEDULED", primary_reason: "CANCELLATION_SCHEDULED", recovery_candidate: false } }).decision, "ALREADY_SATISFIED"));
  it("dispatch allowed with valid approval and fresh evidence", () =>
    assert.equal(evaluateRecoveryGate({ ...base, stage: "dispatch", proposal, current_fingerprint: "fp", evidence_age_seconds: 2 }).decision, "EXECUTION_ALLOWED"));
  it("dispatch blocked by old precheck (>10s)", () =>
    assert.equal(evaluateRecoveryGate({ ...base, stage: "dispatch", proposal, current_fingerprint: "fp", evidence_age_seconds: 11 }).decision, "EVIDENCE_TOO_OLD"));
  it("dispatch blocked by fingerprint drift", () =>
    assert.equal(evaluateRecoveryGate({ ...base, stage: "dispatch", proposal, current_fingerprint: "changed", evidence_age_seconds: 1 }).decision, "APPROVAL_STALE"));
  it("dispatch blocked by policy change", () =>
    assert.equal(evaluateRecoveryGate({ ...base, stage: "dispatch", policy: { mode: "REQUIRE_APPROVAL", version: 2 }, proposal, current_fingerprint: "fp", evidence_age_seconds: 1 }).decision, "APPROVAL_STALE"));
  it("dispatch blocked by expiry", () =>
    assert.equal(evaluateRecoveryGate({ ...base, stage: "dispatch", proposal: { ...proposal, expires_at: iso(NOW.getTime() - 1) }, current_fingerprint: "fp", evidence_age_seconds: 1 }).decision, "APPROVAL_EXPIRED"));
  it("dispatch without approval under REQUIRE_APPROVAL is blocked", () =>
    assert.equal(evaluateRecoveryGate({ ...base, stage: "dispatch", proposal: { ...proposal, status: "AWAITING_APPROVAL" }, current_fingerprint: "fp", evidence_age_seconds: 1 }).decision, "APPROVAL_REQUIRED"));
});
