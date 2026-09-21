import type { ReasonCode } from "./evaluator";
import type {
  AdapterKind,
  ConnectionHealth,
  GateDecision,
  OperationState,
  PolicyMode,
  ProcessingState,
  ProposalStatus,
  RecoveryState,
  Verdict,
} from "./types";

export type Tone = "success" | "info" | "danger" | "warning" | "neutral";

export const VERDICT_LABELS: Record<Verdict, { label: string; tone: Tone; short: string }> = {
  PENDING: { label: "Waiting for verification", short: "Waiting", tone: "neutral" },
  SATISFIED_SCHEDULED: { label: "Cancellation scheduled", short: "Scheduled", tone: "success" },
  SATISFIED_ENDED: { label: "Cancellation completed", short: "Completed", tone: "info" },
  MISMATCH: { label: "Needs action", short: "Needs action", tone: "danger" },
  UNVERIFIABLE: { label: "Could not verify", short: "Could not verify", tone: "warning" },
  OUT_OF_SCOPE: { label: "Outside supported scope", short: "Outside scope", tone: "neutral" },
};

export const PROCESSING_LABELS: Record<ProcessingState, string> = {
  QUEUED: "Queued for verification",
  VERIFYING: "Reading the source",
  WAITING_RECHECK: "Another check scheduled",
  AWAITING_APPROVAL: "Approval needed",
  RECOVERING: "Recovery in progress",
  MONITORING: "Monitoring scheduled",
  IDLE: "No work pending",
  ESCALATED: "Needs manual review",
};

export const POLICY_LABELS: Record<PolicyMode, { label: string; short: string; description: string }> = {
  OBSERVE_ONLY: {
    label: "Observe only",
    short: "Observe only",
    description: "Verify but never write. You'll see what would be corrected, but no changes are made.",
  },
  REQUIRE_APPROVAL: {
    label: "Require human approval",
    short: "Human approval",
    description: "Prepare the exact fix and wait for an owner.",
  },
  AUTO_RECOVER: {
    label: "Auto-recover allowed actions",
    short: "Auto-recover",
    description: "Apply the supported correction, then verify again.",
  },
};

export const ADAPTER_LABELS: Record<AdapterKind, { label: string; environment: string }> = {
  LOCAL_SANDBOX: { label: "Proofwork Sandbox", environment: "Simulated billing" },
  STRIPE_TEST: { label: "Stripe test mode", environment: "Stripe test mode" },
};

export const HEALTH_LABELS: Record<ConnectionHealth, { label: string; tone: Tone }> = {
  CONNECTED: { label: "Connected", tone: "success" },
  DISCONNECTED: { label: "Disconnected", tone: "neutral" },
  NOT_CHECKED: { label: "Not checked", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
};

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, { label: string; tone: Tone }> = {
  PROPOSED: { label: "Proposed", tone: "neutral" },
  AWAITING_APPROVAL: { label: "Waiting for decision", tone: "warning" },
  AUTHORIZED: { label: "Approved — queued", tone: "info" },
  CONSUMED: { label: "Applied — see operation", tone: "info" },
  REJECTED: { label: "Rejected", tone: "danger" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
  BLOCKED: { label: "Blocked", tone: "warning" },
};

export const OPERATION_STATE_LABELS: Record<OperationState, { label: string; tone: Tone }> = {
  PREPARED: { label: "Prepared", tone: "neutral" },
  DISPATCHED: { label: "Dispatched", tone: "info" },
  AWAITING_VERIFICATION: { label: "Awaiting independent read", tone: "info" },
  VERIFIED: { label: "Recovery verified", tone: "success" },
  FAILED_CONFIRMED: { label: "Write rejected by source", tone: "danger" },
  OUTCOME_UNKNOWN: { label: "Outcome uncertain — reconciling", tone: "warning" },
  RESOLVED_EXTERNALLY: { label: "Resolved — attribution unclear", tone: "neutral" },
  BLOCKED: { label: "Blocked before dispatch", tone: "warning" },
};

export const RECOVERY_STATE_LABELS: Record<RecoveryState, string> = {
  NONE: "No recovery",
  PROPOSED: "Proposed",
  AWAITING_APPROVAL: "Awaiting approval",
  AUTHORIZED: "Authorized",
  PREPARED: "Prepared",
  DISPATCHED: "Dispatched",
  AWAITING_VERIFICATION: "Awaiting verification",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  BLOCKED: "Blocked",
  FAILED_CONFIRMED: "Failed (confirmed)",
  OUTCOME_UNKNOWN: "Outcome unknown",
  RESOLVED_EXTERNALLY: "Resolved externally",
};

/** Deterministic reason-to-copy mapping ("Why this result?"). */
export const REASON_COPY: Record<ReasonCode, { title: string; explanation: string }> = {
  REQUEST_NOT_ACTIVE: {
    title: "The authorized request is no longer active",
    explanation: "This request was superseded or retired. Proofwork keeps the history but will not recover against it.",
  },
  MISSING_CONTEXT: {
    title: "Required request context is unavailable",
    explanation: "Proofwork could not load the authorized request needed to evaluate this task. No decision about the outcome was made.",
  },
  SOURCE_UNAVAILABLE: {
    title: "The billing source did not respond",
    explanation: "Could not verify. The billing service did not respond. No fix has been attempted.",
  },
  SOURCE_NOT_FOUND: {
    title: "The subscription was not found at the source",
    explanation: "A missing record is not evidence that cancellation happened. Investigate the customer and subscription binding.",
  },
  SOURCE_ACCESS_DENIED: {
    title: "The source rejected Proofwork's credentials",
    explanation: "The evidence source denied access or is not configured. The workspace owner needs to correct the connection.",
  },
  SOURCE_DATA_INVALID: {
    title: "The source response was incomplete",
    explanation: "Required fields were missing or malformed, so the outcome is unverified.",
  },
  EVIDENCE_STALE: {
    title: "The source read was too old to trust",
    explanation: "A newer read is required before Proofwork can decide.",
  },
  IDENTITY_MISMATCH: {
    title: "The source record belongs to a different identity",
    explanation: "The account, customer or subscription returned by the source does not match the authorized request. Recovery is blocked.",
  },
  END_TIME_MISSING: {
    title: "The subscription ended, but no end time was reported",
    explanation: "Without end-time evidence Proofwork cannot confirm the cancellation happened at the authorized boundary.",
  },
  END_TIME_INVALID: {
    title: "The reported end time is not valid",
    explanation: "The source reports an end time later than the read itself.",
  },
  ENDED_ON_TIME: {
    title: "Cancellation completed",
    explanation: "Cancellation completed. The billing record confirms the end date.",
  },
  ENDED_EARLY: {
    title: "The subscription ended before the authorized date",
    explanation: "Service ended earlier than the customer requested. Proofwork does not restore subscriptions; a person must handle this.",
  },
  ENDED_LATE: {
    title: "The subscription ended after the accepted window",
    explanation: "Service ended materially later than the authorized boundary.",
  },
  UNSUPPORTED_SHAPE: {
    title: "This subscription is outside the supported structure",
    explanation: "This subscription needs manual review. Automatic recovery is outside the supported scope.",
  },
  PERIOD_CHANGED: {
    title: "The billing period changed since authorization",
    explanation: "The source period end differs from the recorded request. The original target remains unchanged and needs review.",
  },
  CONFLICTING_CANCEL_DATE: {
    title: "A different cancellation date is set",
    explanation: "The source has a custom cancellation date that differs from the authorized boundary. Proofwork will not overwrite it.",
  },
  CANCELLATION_SCHEDULED: {
    title: "Cancellation scheduled",
    explanation: "Scheduled correctly. The subscription remains active until the requested end date.",
  },
  SCHEDULE_MISSING: {
    title: "The cancellation schedule is missing",
    explanation: "The cancellation schedule is missing from the billing record.",
  },
  CANCELLATION_MODE_MISMATCH: {
    title: "Cancellation is set with a different mechanism",
    explanation: "A custom date equal to the boundary is set, but period-end cancellation is not. This needs manual review.",
  },
  FINALIZATION_PENDING: {
    title: "Waiting for the source to finalize",
    explanation: "The authorized end time has arrived, but the source has not yet confirmed that the subscription ended.",
  },
  NOT_ENDED: {
    title: "The subscription is still active after its authorized end",
    explanation: "The source still shows the subscription active after the grace window. Proofwork will not move the target date.",
  },
};

export const GATE_COPY: Record<GateDecision, string> = {
  NOT_CANDIDATE: "No supported automatic correction applies to this result.",
  OBSERVE_ONLY: "Observe only policy: Proofwork will not write.",
  APPROVAL_REQUIRED: "Human approval required",
  WRITES_PAUSED: "Recovery writes are paused",
  APPROVAL_STALE: "Proposal is stale",
  APPROVAL_EXPIRED: "Proposal expired",
  CUTOFF_REACHED: "Too close to the period end",
  PRIOR_REVERSAL: "Previous recovery was reversed — manual review",
  OPERATION_UNRESOLVED: "Earlier operation still reconciling",
  REQUEST_NOT_ACTIVE: "Request no longer active",
  CONNECTION_CHANGED: "Source configuration changed",
  EVIDENCE_TOO_OLD: "Fresh read required",
  ALREADY_SATISFIED: "Already satisfied — no write needed",
  EXECUTION_ALLOWED: "Recovery allowed",
};

export const AUDIT_EVENT_LABELS: Record<string, { label: string; tone: Tone }> = {
  "workspace.created": { label: "Workspace created", tone: "neutral" },
  "workspace.profile_updated": { label: "Workspace updated", tone: "neutral" },
  "onboarding.completed": { label: "Onboarding completed", tone: "success" },
  "policy.version_created": { label: "Recovery policy changed", tone: "warning" },
  "workspace.writes_paused": { label: "Recovery writes paused", tone: "warning" },
  "workspace.writes_resumed": { label: "Recovery writes resumed", tone: "neutral" },
  "connection.configured": { label: "Evidence source configured", tone: "neutral" },
  "connection.checked": { label: "Connection checked", tone: "neutral" },
  "token.created": { label: "Ingestion token created", tone: "neutral" },
  "token.revoked": { label: "Ingestion token revoked", tone: "warning" },
  "request.registered": { label: "Customer request registered", tone: "neutral" },
  "request.superseded": { label: "Request superseded", tone: "warning" },
  "request.retired": { label: "Request retired", tone: "warning" },
  "claim.accepted": { label: "Completion claim accepted", tone: "success" },
  "claim.duplicate_returned": { label: "Duplicate claim returned", tone: "neutral" },
  "claim.additional_receipt": { label: "Additional claim received", tone: "neutral" },
  "claim.rejected": { label: "Claim rejected", tone: "danger" },
  "verification.recorded": { label: "Verification recorded", tone: "warning" },
  "verification.requested": { label: "Recheck requested", tone: "neutral" },
  "verification.stale_commit_rejected": { label: "Late read discarded", tone: "neutral" },
  "recovery.proposed": { label: "Recovery proposed", tone: "warning" },
  "recovery.approved": { label: "Recovery approved", tone: "success" },
  "recovery.auto_authorized": { label: "Recovery authorized by policy", tone: "success" },
  "recovery.rejected": { label: "Recovery rejected", tone: "danger" },
  "recovery.expired": { label: "Proposal expired", tone: "neutral" },
  "recovery.superseded": { label: "Proposal superseded", tone: "neutral" },
  "recovery.blocked": { label: "Recovery blocked", tone: "warning" },
  "recovery.prepared": { label: "Recovery prepared", tone: "neutral" },
  "recovery.dispatched": { label: "Recovery dispatched", tone: "success" },
  "recovery.response_recorded": { label: "Source response recorded", tone: "neutral" },
  "recovery.outcome_unknown": { label: "Recovery outcome uncertain", tone: "warning" },
  "recovery.verified": { label: "Recovery verified", tone: "success" },
  "recovery.failed_confirmed": { label: "Recovery rejected by source", tone: "danger" },
  "recovery.resolved_externally": { label: "Resolved — attribution unclear", tone: "neutral" },
  "recovery.escalated": { label: "Recovery escalated", tone: "danger" },
  "recovery.no_op": { label: "No write needed", tone: "success" },
  "task.retired": { label: "Monitoring stopped", tone: "neutral" },
  "task.intervention_recorded": { label: "Human intervention recorded", tone: "warning" },
  "review.label_added": { label: "Correctness review added", tone: "neutral" },
  "demo.created": { label: "Demo created", tone: "neutral" },
  "demo.reset": { label: "Demo reset", tone: "warning" },
  "demo.scenario_created": { label: "Scenario created", tone: "neutral" },
  "demo.source_changed": { label: "Synthetic source changed", tone: "warning" },
  "job.exhausted": { label: "Retries exhausted", tone: "danger" },
};

export function auditLabel(eventType: string) {
  return AUDIT_EVENT_LABELS[eventType] ?? { label: eventType, tone: "neutral" as Tone };
}
