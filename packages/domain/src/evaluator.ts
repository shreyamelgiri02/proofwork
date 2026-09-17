import { EVALUATOR_VERSION, LIMITS } from "./constants";
import { addSeconds, isValidDate, secondsBetween, toEpochSeconds } from "./clock";
import { isCompleteSnapshot, type NormalizedSubscription, type SourceRead } from "./observation";
import type { AdapterKind, RequestStatus, Verdict } from "./types";

/**
 * Pure, versioned evaluator for subscription.cancel_at_period_end.v1.
 * No network, no clock reads, no persistence: same inputs → same result.
 * An agent's report text is deliberately NOT an input.
 */

export type ReasonCode =
  | "REQUEST_NOT_ACTIVE"
  | "MISSING_CONTEXT"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_ACCESS_DENIED"
  | "SOURCE_DATA_INVALID"
  | "EVIDENCE_STALE"
  | "IDENTITY_MISMATCH"
  | "END_TIME_MISSING"
  | "END_TIME_INVALID"
  | "ENDED_ON_TIME"
  | "ENDED_EARLY"
  | "ENDED_LATE"
  | "UNSUPPORTED_SHAPE"
  | "PERIOD_CHANGED"
  | "CONFLICTING_CANCEL_DATE"
  | "CANCELLATION_SCHEDULED"
  | "SCHEDULE_MISSING"
  | "CANCELLATION_MODE_MISMATCH"
  | "FINALIZATION_PENDING"
  | "NOT_ENDED";

export interface EvaluationRequest {
  status: RequestStatus;
  adapter: AdapterKind;
  source_account_id: string;
  customer_id: string;
  subscription_id: string;
  /** Immutable authorized boundary T (ISO, UTC). */
  expected_period_end: string;
}

export interface ComparisonRow {
  field: string;
  label: string;
  expected: string | boolean | null;
  observed: string | boolean | null;
  result: "MATCH" | "MISMATCH" | "UNKNOWN" | "NOT_APPLICABLE";
}

export interface EvaluationResult {
  evaluator_version: typeof EVALUATOR_VERSION;
  verdict: Exclude<Verdict, "PENDING">;
  reason_codes: ReasonCode[];
  primary_reason: ReasonCode;
  /** Classification only. Execution still requires every recovery gate. */
  recovery_candidate: boolean;
  /** True when the failure is a transport/availability problem worth a bounded retry. */
  transient: boolean;
  /** Suggested next routine check (ISO) or null. */
  next_check_at: string | null;
  comparison: ComparisonRow[];
  facts: Record<string, unknown>;
  evaluated_at: string;
}

export interface EvaluateInput {
  request: EvaluationRequest | null;
  read: SourceRead | null;
  now: Date;
  maxEvidenceAgeSeconds?: number;
}

const yesNo = (v: boolean | null | undefined) => (v == null ? null : v);

function supportedShape(s: NormalizedSubscription): boolean {
  return (
    s.status === "active" &&
    s.item_count === 1 &&
    s.items_complete === true &&
    s.usage_type === "licensed" &&
    s.collection_method === "charge_automatically" &&
    !s.schedule_id &&
    !s.pause_collection &&
    !s.pending_update
  );
}

function buildComparison(req: EvaluationRequest, s: NormalizedSubscription | null, beforeBoundary: boolean): ComparisonRow[] {
  const cmp = (a: string | null, b: string | null | undefined): ComparisonRow["result"] =>
    b == null ? "UNKNOWN" : a === b ? "MATCH" : "MISMATCH";
  const rows: ComparisonRow[] = [
    { field: "customer_id", label: "Customer", expected: req.customer_id, observed: s?.customer_id ?? null, result: cmp(req.customer_id, s?.customer_id) },
    { field: "subscription_id", label: "Subscription", expected: req.subscription_id, observed: s?.subscription_id ?? null, result: cmp(req.subscription_id, s?.subscription_id) },
    { field: "source_account_id", label: "Source account", expected: req.source_account_id, observed: s?.source_account_id ?? null, result: cmp(req.source_account_id, s?.source_account_id) },
  ];
  if (!s) {
    rows.push(
      { field: "cancel_at_period_end", label: "Cancellation scheduled", expected: true, observed: null, result: "UNKNOWN" },
      { field: "current_period_end", label: "Period end", expected: req.expected_period_end, observed: null, result: "UNKNOWN" },
    );
    return rows;
  }
  if (s.status === "canceled") {
    const endedOk =
      s.ended_at != null &&
      toEpochSeconds(s.ended_at) >= toEpochSeconds(req.expected_period_end) &&
      toEpochSeconds(s.ended_at) <= toEpochSeconds(req.expected_period_end) + LIMITS.FINALIZATION_GRACE_SECONDS;
    rows.push({
      field: "ended_at",
      label: "Service ended",
      expected: req.expected_period_end,
      observed: s.ended_at,
      result: s.ended_at == null ? "UNKNOWN" : endedOk ? "MATCH" : "MISMATCH",
    });
    return rows;
  }
  rows.push({
    field: "cancel_at_period_end",
    label: "Cancellation scheduled",
    expected: true,
    observed: yesNo(s.cancel_at_period_end),
    result: beforeBoundary || s.cancel_at_period_end ? (s.cancel_at_period_end ? "MATCH" : "MISMATCH") : "MISMATCH",
  });
  rows.push({
    field: "current_period_end",
    label: "Period end",
    expected: req.expected_period_end,
    observed: s.current_period_end,
    result: s.current_period_end == null ? "UNKNOWN" : toEpochSeconds(s.current_period_end) === toEpochSeconds(req.expected_period_end) ? "MATCH" : "MISMATCH",
  });
  if (s.cancel_at) {
    rows.push({
      field: "cancel_at",
      label: "Custom cancellation date",
      expected: null,
      observed: s.cancel_at,
      result: toEpochSeconds(s.cancel_at) === toEpochSeconds(req.expected_period_end) ? "MATCH" : "MISMATCH",
    });
  }
  return rows;
}

export function evaluate(input: EvaluateInput): EvaluationResult {
  const { request, read, now } = input;
  const maxAge = input.maxEvidenceAgeSeconds ?? LIMITS.EVIDENCE_MAX_AGE_SECONDS;
  const evaluated_at = now.toISOString();

  const result = (
    verdict: EvaluationResult["verdict"],
    reason: ReasonCode,
    opts: {
      candidate?: boolean;
      transient?: boolean;
      nextCheckAt?: Date | null;
      snapshot?: NormalizedSubscription | null;
      extraFacts?: Record<string, unknown>;
      beforeBoundary?: boolean;
    } = {},
  ): EvaluationResult => ({
    evaluator_version: EVALUATOR_VERSION,
    verdict,
    reason_codes: [reason],
    primary_reason: reason,
    recovery_candidate: opts.candidate ?? false,
    transient: opts.transient ?? false,
    next_check_at: opts.nextCheckAt ? opts.nextCheckAt.toISOString() : null,
    comparison: request ? buildComparison(request, opts.snapshot ?? null, opts.beforeBoundary ?? true) : [],
    facts: {
      authorized_period_end: request?.expected_period_end ?? null,
      request_status: request?.status ?? null,
      observed_at: read?.observed_at ?? null,
      provider_request_id: read?.provider_request_id ?? null,
      source_status: opts.snapshot?.status ?? null,
      source_cancel_at_period_end: opts.snapshot?.cancel_at_period_end ?? null,
      source_cancel_at: opts.snapshot?.cancel_at ?? null,
      source_ended_at: opts.snapshot?.ended_at ?? null,
      source_current_period_end: opts.snapshot?.current_period_end ?? null,
      evaluation_time: evaluated_at,
      ...opts.extraFacts,
    },
    evaluated_at,
  });

  // Rule 1–2: authority and context.
  if (!request || !isValidDate(request.expected_period_end)) return result("UNVERIFIABLE", "MISSING_CONTEXT");
  if (request.status !== "ACTIVE") return result("MISMATCH", "REQUEST_NOT_ACTIVE");
  if (!read) return result("UNVERIFIABLE", "MISSING_CONTEXT");

  // Rules 3–6: source availability.
  if (!read.ok) {
    const retryAt = (s: number) => addSeconds(now, Math.max(s, read.retry_after_seconds ?? 0));
    switch (read.error_code) {
      case "SOURCE_UNAVAILABLE":
      case "SOURCE_TIMEOUT":
      case "SOURCE_RATE_LIMITED":
        return result("UNVERIFIABLE", "SOURCE_UNAVAILABLE", { transient: true, nextCheckAt: retryAt(LIMITS.READ_RETRY_DELAYS_SECONDS[0]) });
      case "SOURCE_NOT_FOUND":
        return result("UNVERIFIABLE", "SOURCE_NOT_FOUND");
      case "SOURCE_ACCESS_DENIED":
      case "LIVE_MODE_BLOCKED":
      case "NOT_CONFIGURED":
        return result("UNVERIFIABLE", "SOURCE_ACCESS_DENIED", { extraFacts: { source_error: read.error_code } });
      default:
        return result("UNVERIFIABLE", "SOURCE_DATA_INVALID");
    }
  }

  const s = read.snapshot;
  if (!isCompleteSnapshot(s) || !isValidDate(read.observed_at)) return result("UNVERIFIABLE", "SOURCE_DATA_INVALID");
  const observedAt = new Date(read.observed_at);
  // Future observation time is invalid evidence (allow 2s clock skew).
  if (secondsBetween(observedAt, now) > 2) return result("UNVERIFIABLE", "SOURCE_DATA_INVALID", { snapshot: s });

  // Rule 7: freshness.
  if (secondsBetween(now, observedAt) > maxAge) {
    return result("UNVERIFIABLE", "EVIDENCE_STALE", { transient: true, nextCheckAt: now, snapshot: s });
  }

  // Rule 8: identity and environment.
  const expectedEnvironment = request.adapter === "STRIPE_TEST" ? "STRIPE_TEST_MODE" : "SYNTHETIC_SANDBOX";
  if (
    s.livemode ||
    s.adapter !== request.adapter ||
    s.environment !== expectedEnvironment ||
    s.source_account_id !== request.source_account_id ||
    s.customer_id !== request.customer_id ||
    s.subscription_id !== request.subscription_id
  ) {
    return result("MISMATCH", "IDENTITY_MISMATCH", { snapshot: s });
  }

  const T = toEpochSeconds(request.expected_period_end);
  const nowS = toEpochSeconds(now);
  const grace = LIMITS.FINALIZATION_GRACE_SECONDS;
  const beforeBoundary = nowS < T;

  // Rules 9–12: ended subscription.
  if (s.status === "canceled") {
    if (!s.ended_at || !isValidDate(s.ended_at)) return result("UNVERIFIABLE", "END_TIME_MISSING", { snapshot: s });
    const ended = toEpochSeconds(s.ended_at);
    if (ended > toEpochSeconds(observedAt)) return result("UNVERIFIABLE", "END_TIME_INVALID", { snapshot: s });
    if (ended >= T && ended <= T + grace) return result("SATISFIED_ENDED", "ENDED_ON_TIME", { snapshot: s });
    return result("MISMATCH", ended < T ? "ENDED_EARLY" : "ENDED_LATE", { snapshot: s });
  }

  // Rule 13: supported shape for non-ended subscriptions.
  if (!supportedShape(s)) {
    return result("OUT_OF_SCOPE", "UNSUPPORTED_SHAPE", {
      snapshot: s,
      extraFacts: {
        item_count: s.item_count,
        usage_type: s.usage_type,
        collection_method: s.collection_method,
        schedule_id: s.schedule_id,
        pause_collection: s.pause_collection,
        pending_update: s.pending_update,
      },
    });
  }

  // Rule 14: period boundary changed since authorization.
  if (!s.current_period_end || !isValidDate(s.current_period_end)) return result("UNVERIFIABLE", "SOURCE_DATA_INVALID", { snapshot: s });
  if (toEpochSeconds(s.current_period_end) !== T) return result("MISMATCH", "PERIOD_CHANGED", { snapshot: s, beforeBoundary });

  const customDate = s.cancel_at ? toEpochSeconds(s.cancel_at) : null;
  // Rule 15: conflicting custom cancellation date.
  if (customDate !== null && customDate !== T) return result("MISMATCH", "CONFLICTING_CANCEL_DATE", { snapshot: s, beforeBoundary });

  if (beforeBoundary) {
    // Rule 16: correct schedule.
    if (s.cancel_at_period_end) {
      const monitorAt = new Date(Math.min(now.getTime() + LIMITS.MONITOR_INTERVAL_SECONDS * 1000, (T + LIMITS.RECOVERY_CUTOFF_SECONDS) * 1000));
      return result("SATISFIED_SCHEDULED", "CANCELLATION_SCHEDULED", { snapshot: s, nextCheckAt: monitorAt, beforeBoundary });
    }
    // Rule 17: missing schedule — the only recovery candidate.
    if (customDate === null) return result("MISMATCH", "SCHEDULE_MISSING", { snapshot: s, candidate: true, beforeBoundary });
    // Rule 18: custom date equals T but flag false.
    return result("MISMATCH", "CANCELLATION_MODE_MISMATCH", { snapshot: s, beforeBoundary });
  }

  if (nowS < T + grace) {
    // Rule 19: waiting for the source to finalize.
    if (s.cancel_at_period_end) {
      return result("UNVERIFIABLE", "FINALIZATION_PENDING", { snapshot: s, nextCheckAt: new Date((T + grace + 5) * 1000), beforeBoundary });
    }
    // Rule 20: boundary reached without a schedule — not recoverable any more.
    return result("MISMATCH", "SCHEDULE_MISSING", { snapshot: s, beforeBoundary });
  }

  // Rule 21: still active after the grace window.
  return result("MISMATCH", "NOT_ENDED", { snapshot: s, beforeBoundary });
}

/** Evidence counts as trustworthy when the source was read reliably. */
export function isTrustworthyVerdict(reason: ReasonCode): boolean {
  return !["SOURCE_UNAVAILABLE", "SOURCE_NOT_FOUND", "SOURCE_ACCESS_DENIED", "SOURCE_DATA_INVALID", "EVIDENCE_STALE", "MISSING_CONTEXT"].includes(reason);
}
