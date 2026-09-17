import type { OperationState, PolicyMode, ProcessingState, ProposalStatus, ReasonCode, RecoveryState, Verdict } from "@proofwork/domain";

export interface ComparisonRow {
  field: string;
  label: string;
  expected: string | boolean | null;
  observed: string | boolean | null;
  result: "MATCH" | "MISMATCH" | "UNKNOWN" | "NOT_APPLICABLE";
}

export interface DecisionRow {
  id: string;
  verdict: Exclude<Verdict, "PENDING">;
  reason_codes: ReasonCode[];
  comparison: ComparisonRow[];
  facts: Record<string, unknown>;
  recovery_candidate: boolean;
  gate_decision: string | null;
  trigger: string;
  trustworthy: boolean;
  evaluator_version: string;
  policy_version: number | null;
  request_version: number;
  evaluated_at: string;
  observation_id: string;
  result_type: "SUCCESS" | "ERROR";
  error_code: string | null;
  http_status: number | null;
  snapshot: Record<string, unknown> | null;
  material_fingerprint: string | null;
  snapshot_hash: string | null;
  provider_request_id: string | null;
  observed_at: string;
  adapter: string;
  environment: string;
}

export interface ProposalSummary {
  id: string;
  status: ProposalStatus;
  status_reason: string | null;
  diff: { changes: { field: string; label: string; before: unknown; after: unknown }[]; unchanged: { field: string; label: string; value: unknown }[] };
  expires_at: string;
  created_at: string;
  policy_version: number;
  policy_mode: PolicyMode;
  proposal_hash: string;
  decision: "APPROVE" | "REJECT" | "AUTO_POLICY" | null;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
}

export interface OperationSummary {
  id: string;
  proposal_id: string;
  state: OperationState;
  outcome_certainty: "CERTAIN" | "UNCERTAIN";
  attribution: "PROOFWORK" | "UNATTRIBUTED" | null;
  dispatch_count: number;
  max_dispatches: number;
  idempotency_key: string;
  authorized_until: string;
  first_dispatched_at: string | null;
  last_provider_request_id: string | null;
  last_error_code: string | null;
  resolved_at: string | null;
  resolution_reason: string | null;
  escalated_at: string | null;
  created_at: string;
  events: { event_type: string; from_state: string | null; to_state: string | null; occurred_at: string }[];
}

export interface AuditRow {
  id: string;
  event_type: string;
  summary: string;
  actor_type: string;
  actor_label: string;
  reason_code: string | null;
  policy_version: number | null;
  evaluator_version: string | null;
  correlation_id: string;
  occurred_at: string;
  proposal_id: string | null;
  operation_id: string | null;
}

export interface TaskDetail {
  task: {
    id: string;
    verdict: Verdict;
    primary_reason_code: ReasonCode | null;
    processing_state: ProcessingState;
    recovery_state: RecoveryState;
    gate_decision: string | null;
    agent_name: string;
    last_checked_at: string | null;
    last_trustworthy_read_at: string | null;
    next_check_at: string | null;
    first_verified_at: string | null;
    human_intervention_count: number;
    retired_at: string | null;
    retirement_reason: string | null;
    created_at: string;
    evidence_stale: boolean;
  };
  request: {
    id: string;
    version: number;
    status: "ACTIVE" | "SUPERSEDED" | "RETIRED";
    customer_label: string | null;
    customer_id: string;
    subscription_id: string;
    source_account_id: string;
    source_reference: string;
    expected_period_end: string;
    authorized_by_label: string;
    authorized_at: string;
    authorization_kind: "OPERATOR_CONFIRMED" | "DEMO_FIXTURE";
    contract_id: string;
  };
  connection: { id: string; adapter: "LOCAL_SANDBOX" | "STRIPE_TEST"; environment: string; source_account_id: string | null; display_name: string; health: string; last_successful_read_at: string | null };
  policy: { version: number; mode: PolicyMode } | null;
  receipts: { id: string; agent_name: string; agent_reference: string | null; report_text: string; source_kind: string; producer_identity: string; payload_hash: string; idempotency_key: string; claimed_at: string | null; received_at: string }[];
  latest_decision: DecisionRow | null;
  latest_trustworthy_decision: DecisionRow | null;
  decisions: DecisionRow[];
  proposals: ProposalSummary[];
  live_proposal: ProposalSummary | null;
  operations: OperationSummary[];
  unresolved_operation: OperationSummary | null;
  events: AuditRow[];
  interventions: { id: string; kind: string; actor_label: string; note: string | null; occurred_at: string }[];
  reviews: { id: string; decision_id: string; label: string; evidence_basis: string; reviewer_label: string; created_at: string }[];
  pending_job: { id: string; kind: string; status: string; due_at: string } | null;
  allowed_actions: { check_now: boolean; review_proposal: boolean; retire: boolean; record_intervention: boolean; add_review: boolean; blocked_reason: string | null };
  workspace: { timezone: string; writes_paused: boolean; kind: "PRIVATE" | "DEMO" };
  scenario_controls: boolean;
}
