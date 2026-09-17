import { LIMITS, RECOVERY_ACTION } from "./constants";
import { toEpochSeconds } from "./clock";
import type { EvaluationResult } from "./evaluator";
import type { GateDecision, PolicyMode, ProposalStatus, RequestStatus } from "./types";

/**
 * Pure recovery gate. The same function is used when creating a proposal,
 * when approving, when preparing an operation and when reserving a dispatch.
 */

export interface GateContext {
  now: Date;
  evaluation: Pick<EvaluationResult, "verdict" | "primary_reason" | "recovery_candidate">;
  request: { status: RequestStatus; version: number; expected_period_end: string };
  policy: { mode: PolicyMode; version: number; recovery_cutoff_seconds?: number };
  workspace: { writes_paused: boolean };
  connection: { config_version: number };
  /** Present when checking an existing proposal. */
  proposal?: {
    status: ProposalStatus;
    request_version: number;
    policy_version: number;
    connection_config_version: number;
    source_fingerprint: string;
    expires_at: string;
  } | null;
  /** Fingerprint of the fresh observation being evaluated. */
  current_fingerprint?: string | null;
  /** Age in seconds of the evidence used for this gate. */
  evidence_age_seconds?: number | null;
  maxEvidenceAgeSeconds?: number;
  has_unresolved_operation: boolean;
  /** A previous Proofwork recovery was verified and the source later lost the schedule. */
  prior_verified_recovery: boolean;
  /** "proposal" = creating/refreshing a proposal; "dispatch" = about to write. */
  stage: "proposal" | "approval" | "dispatch";
}

export interface GateResult {
  decision: GateDecision;
  allowed: boolean;
  detail: string;
}

const gate = (decision: GateDecision, detail: string): GateResult => ({
  decision,
  allowed: decision === "EXECUTION_ALLOWED",
  detail,
});

export function evaluateRecoveryGate(ctx: GateContext): GateResult {
  if (ctx.evaluation.verdict === "SATISFIED_SCHEDULED" || ctx.evaluation.verdict === "SATISFIED_ENDED") {
    return gate("ALREADY_SATISFIED", "The source already shows the authorized outcome. No write is needed.");
  }
  if (ctx.request.status !== "ACTIVE") return gate("REQUEST_NOT_ACTIVE", "The authorized request is no longer active.");
  if (!ctx.evaluation.recovery_candidate || ctx.evaluation.primary_reason !== "SCHEDULE_MISSING") {
    return gate("NOT_CANDIDATE", "Only a missing period-end schedule with matching identity and boundary can be recovered.");
  }
  if (ctx.prior_verified_recovery) {
    return gate("PRIOR_REVERSAL", "A verified recovery was later reversed at the source. A person must review it; Proofwork will not repeat the write.");
  }
  if (ctx.has_unresolved_operation) {
    return gate("OPERATION_UNRESOLVED", "An earlier recovery operation is still unresolved and must be reconciled first.");
  }
  if (ctx.policy.mode === "OBSERVE_ONLY") {
    return gate("OBSERVE_ONLY", "The workspace policy is Observe only. Proofwork verifies but never writes.");
  }
  const cutoff = ctx.policy.recovery_cutoff_seconds ?? LIMITS.RECOVERY_CUTOFF_SECONDS;
  if (toEpochSeconds(ctx.request.expected_period_end) <= toEpochSeconds(ctx.now) + cutoff) {
    return gate("CUTOFF_REACHED", `The authorized period end is within ${cutoff} seconds. Automatic writes stop near the boundary.`);
  }

  if (ctx.proposal) {
    const p = ctx.proposal;
    if (p.status === "EXPIRED" || new Date(p.expires_at).getTime() <= ctx.now.getTime()) {
      return gate("APPROVAL_EXPIRED", "The proposal expired. Review a new proposal based on current evidence.");
    }
    if (p.request_version !== ctx.request.version) return gate("APPROVAL_STALE", "The customer request changed after this proposal was prepared.");
    if (p.policy_version !== ctx.policy.version) return gate("APPROVAL_STALE", "The recovery policy changed after this proposal was prepared.");
    if (p.connection_config_version !== ctx.connection.config_version) return gate("CONNECTION_CHANGED", "The evidence source configuration changed after this proposal was prepared.");
    if (ctx.current_fingerprint && ctx.current_fingerprint !== p.source_fingerprint) {
      return gate("APPROVAL_STALE", "The subscription changed. Review the latest evidence before approving again.");
    }
  }

  if (ctx.stage === "dispatch") {
    const maxAge = ctx.maxEvidenceAgeSeconds ?? LIMITS.PRECHECK_MAX_AGE_SECONDS;
    if (ctx.evidence_age_seconds == null || ctx.evidence_age_seconds > maxAge) {
      return gate("EVIDENCE_TOO_OLD", `The precheck is older than ${maxAge} seconds.`);
    }
    if (ctx.workspace.writes_paused) return gate("WRITES_PAUSED", "Recovery writes are paused for this workspace. Verification continues.");
    if (ctx.policy.mode === "REQUIRE_APPROVAL" && ctx.proposal?.status !== "AUTHORIZED" && ctx.proposal?.status !== "CONSUMED") {
      return gate("APPROVAL_REQUIRED", "A valid human approval is required before this write.");
    }
    return gate("EXECUTION_ALLOWED", "Every recovery condition currently holds.");
  }

  if (ctx.policy.mode === "REQUIRE_APPROVAL") {
    if (ctx.stage === "approval") {
      return ctx.workspace.writes_paused
        ? gate("WRITES_PAUSED", "Recovery writes are paused. The approval can be recorded, but dispatch will wait until writes resume.")
        : gate("EXECUTION_ALLOWED", "The proposal can be approved.");
    }
    return gate("APPROVAL_REQUIRED", "Human approval required before Proofwork schedules the cancellation.");
  }
  // AUTO_RECOVER
  if (ctx.workspace.writes_paused) return gate("WRITES_PAUSED", "Recovery writes are paused for this workspace. Verification continues.");
  return gate("EXECUTION_ALLOWED", "Policy allows this bounded recovery automatically.");
}

export interface ProposalDiff {
  action: typeof RECOVERY_ACTION;
  parameters: { cancel_at_period_end: true };
  changes: { field: string; label: string; before: string | boolean | null; after: string | boolean | null }[];
  unchanged: { field: string; label: string; value: string | boolean | null }[];
}

/** The exact, fixed server-side change. Clients can never supply parameters. */
export function buildProposalDiff(expected_period_end: string): ProposalDiff {
  return {
    action: RECOVERY_ACTION,
    parameters: { cancel_at_period_end: true },
    changes: [{ field: "cancel_at_period_end", label: "Cancellation scheduled", before: false, after: true }],
    unchanged: [
      { field: "current_period_end", label: "Authorized period end", value: expected_period_end },
      { field: "status", label: "Subscription status", value: "active" },
      { field: "items", label: "Plan items and prices", value: "unchanged" },
    ],
  };
}
