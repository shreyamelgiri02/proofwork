/** Shared enumerations. Database CHECK constraints mirror these values. */

export const VERDICTS = [
  "PENDING",
  "SATISFIED_SCHEDULED",
  "SATISFIED_ENDED",
  "MISMATCH",
  "UNVERIFIABLE",
  "OUT_OF_SCOPE",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const PROCESSING_STATES = [
  "QUEUED",
  "VERIFYING",
  "WAITING_RECHECK",
  "AWAITING_APPROVAL",
  "RECOVERING",
  "MONITORING",
  "IDLE",
  "ESCALATED",
] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

export const POLICY_MODES = ["OBSERVE_ONLY", "REQUIRE_APPROVAL", "AUTO_RECOVER"] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

export const WORKSPACE_KINDS = ["PRIVATE", "DEMO"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const ADAPTERS = ["LOCAL_SANDBOX", "STRIPE_TEST"] as const;
export type AdapterKind = (typeof ADAPTERS)[number];

export const CONNECTION_HEALTH = ["CONNECTED", "DISCONNECTED", "NOT_CHECKED", "ERROR"] as const;
export type ConnectionHealth = (typeof CONNECTION_HEALTH)[number];

export const REQUEST_STATUSES = ["ACTIVE", "SUPERSEDED", "RETIRED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const PROPOSAL_STATUSES = [
  "PROPOSED",
  "AWAITING_APPROVAL",
  "AUTHORIZED",
  "CONSUMED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
  "BLOCKED",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const OPERATION_STATES = [
  "PREPARED",
  "DISPATCHED",
  "AWAITING_VERIFICATION",
  "VERIFIED",
  "FAILED_CONFIRMED",
  "OUTCOME_UNKNOWN",
  "RESOLVED_EXTERNALLY",
  "BLOCKED",
] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

/** Task-level recovery projection following the documented chain. */
export const RECOVERY_STATES = [
  "NONE",
  "PROPOSED",
  "AWAITING_APPROVAL",
  "AUTHORIZED",
  "PREPARED",
  "DISPATCHED",
  "AWAITING_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "EXPIRED",
  "BLOCKED",
  "FAILED_CONFIRMED",
  "OUTCOME_UNKNOWN",
  "RESOLVED_EXTERNALLY",
] as const;
export type RecoveryState = (typeof RECOVERY_STATES)[number];

export const JOB_KINDS = [
  "VERIFY",
  "RECHECK",
  "MONITOR",
  "RECOVER",
  "RECONCILE",
  "PROPOSAL_EXPIRY",
  "DEMO_PURGE",
  "CONNECTION_HEALTH",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ["READY", "LEASED", "SUCCEEDED", "FAILED", "DEAD", "CANCELED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CHECK_TRIGGERS = [
  "CLAIM",
  "MANUAL",
  "RETRY",
  "MONITOR",
  "PRECHECK",
  "POST_RECOVERY",
  "RECONCILE",
  "POLICY_CHANGE",
] as const;
export type CheckTrigger = (typeof CHECK_TRIGGERS)[number];

export const ACTOR_TYPES = ["USER", "DEMO_OPERATOR", "AGENT", "WORKER", "SYSTEM"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const INTERVENTION_KINDS = [
  "MANUAL_VERIFY",
  "PROPOSAL_REQUESTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  "REQUEST_SUPERSEDED",
  "REQUEST_RETIRED",
  "EXTERNAL_REPAIR_RECORDED",
  "MANUAL_ESCALATION",
  "MANUAL_RESOLUTION",
  "TASK_RETIRED",
] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const REVIEW_LABELS = ["CORRECT", "INCORRECT", "INSUFFICIENT_EVIDENCE"] as const;
export type ReviewLabel = (typeof REVIEW_LABELS)[number];

export const ERROR_CLASSES = ["RETRYABLE", "PERMANENT", "UNCERTAIN_MUTATION"] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export type SourceEnvironment = "SYNTHETIC_SANDBOX" | "STRIPE_TEST_MODE";

/** Recovery gate decisions (internal, never task verdicts). */
export const GATE_DECISIONS = [
  "NOT_CANDIDATE",
  "OBSERVE_ONLY",
  "APPROVAL_REQUIRED",
  "WRITES_PAUSED",
  "APPROVAL_STALE",
  "APPROVAL_EXPIRED",
  "CUTOFF_REACHED",
  "PRIOR_REVERSAL",
  "OPERATION_UNRESOLVED",
  "REQUEST_NOT_ACTIVE",
  "CONNECTION_CHANGED",
  "EVIDENCE_TOO_OLD",
  "ALREADY_SATISFIED",
  "EXECUTION_ALLOWED",
] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];
