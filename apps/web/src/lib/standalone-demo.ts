import { createHash, randomUUID } from "node:crypto";
import {
  AppError,
  LIMITS,
  POLICY_LABELS,
  SCENARIOS,
  type PolicyMode,
  type ProcessingState,
  type ReasonCode,
  type RecoveryState,
  type ScenarioKey,
  type Verdict,
} from "@proofwork/domain";

export type ApprovalFilter = "waiting" | "decided" | "all";

function sha256(val: string): string {
  return createHash("sha256").update(val).digest("hex");
}

export interface StandaloneWorkspace {
  id: string;
  kind: "DEMO" | "PRIVATE";
  organization: string;
  name: string;
  timezone: string;
  onboarding_step: number;
  onboarding_completed_at: string;
  writes_paused: boolean;
  writes_paused_reason: string | null;
  writes_paused_at: string | null;
  current_policy_version: number;
  expires_at: string;
}

export interface StandaloneTask {
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
  created_at: string;
  retired_at: string | null;
  retirement_reason: string | null;
  request_id: string;
  customer_label: string | null;
  customer_id: string;
  subscription_id: string;
  expected_period_end: string;
  awaiting_proposal_id: string | null;
  evidence_stale: boolean;
  has_claim: boolean;
  claim_report: string;
  scenario_key: ScenarioKey;
  proposal?: any;
  decision?: any;
  observation?: any;
  operations?: any[];
  events?: any[];
  interventions?: any[];
  reviews?: any[];
}

interface DemoState {
  workspace: StandaloneWorkspace;
  tasks: StandaloneTask[];
  audit: any[];
}

const globalStore = globalThis as unknown as {
  __proofwork_standalone_demos?: Map<string, DemoState>;
};

if (!globalStore.__proofwork_standalone_demos) {
  globalStore.__proofwork_standalone_demos = new Map();
}

const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000000";

function createInitialState(workspaceId: string, orgName?: string, ownerName?: string): DemoState {
  const baseTime = Date.now();
  const isoNow = new Date(baseTime).toISOString();
  const periodEnd7d = new Date(baseTime + 7 * 86_400_000).toISOString();
  const periodEndPast = new Date(baseTime - 86_400_000).toISOString();

  const workspace: StandaloneWorkspace = {
    id: workspaceId,
    kind: "DEMO",
    organization: orgName ?? "Demo organization",
    name: ownerName ? `${ownerName}'s Operations` : "Customer operations",
    timezone: "UTC",
    onboarding_step: 3,
    onboarding_completed_at: isoNow,
    writes_paused: false,
    writes_paused_reason: null,
    writes_paused_at: null,
    current_policy_version: 1,
    expires_at: new Date(baseTime + 86400 * 1000).toISOString(),
  };

  const tasks: StandaloneTask[] = [];
  const audit: any[] = [];

  // Scenario 1: Rivera Logistics - missing_schedule (Needs action, proposal awaiting approval)
  const task1Id = "10000000-0000-4000-8000-000000001048";
  const req1Id = "20000000-0000-4000-8000-000000001048";
  const prop1Id = "30000000-0000-4000-8000-000000001048";
  const dec1Id = "40000000-0000-4000-8000-000000001048";
  const obs1Id = "50000000-0000-4000-8000-000000001048";
  const hash1 = sha256(`sub_demo_1048:SCHEDULE_PERIOD_END_CANCELLATION:1:${periodEnd7d}`);

  tasks.push({
    id: task1Id,
    verdict: "MISMATCH",
    primary_reason_code: "SCHEDULE_MISSING",
    processing_state: "AWAITING_APPROVAL",
    recovery_state: "AWAITING_APPROVAL",
    gate_decision: "REQUIRE_APPROVAL",
    agent_name: "Ava Chen (Support Agent)",
    last_checked_at: new Date(baseTime - 120_000).toISOString(),
    last_trustworthy_read_at: new Date(baseTime - 120_000).toISOString(),
    next_check_at: null,
    first_verified_at: null,
    human_intervention_count: 0,
    created_at: new Date(baseTime - 300_000).toISOString(),
    retired_at: null,
    retirement_reason: null,
    request_id: req1Id,
    customer_label: "Rivera Logistics",
    customer_id: "cus_demo_1048",
    subscription_id: "sub_demo_1048",
    expected_period_end: periodEnd7d,
    awaiting_proposal_id: prop1Id,
    evidence_stale: false,
    has_claim: true,
    claim_report: "Cancellation scheduled for the end of the current paid period.",
    scenario_key: "missing_schedule",
    proposal: {
      id: prop1Id,
      status: "AWAITING_APPROVAL",
      status_reason: "Customer requested period-end cancellation; billing source is active without schedule.",
      diff: {
        changes: [{ field: "cancel_at_period_end", label: "Cancel at period end", before: false, after: true }],
        unchanged: [{ field: "status", label: "Status", value: "active" }],
      },
      expires_at: new Date(baseTime + 900_000).toISOString(),
      created_at: new Date(baseTime - 120_000).toISOString(),
      policy_version: 1,
      policy_mode: "REQUIRE_APPROVAL",
      proposal_hash: hash1,
      decision: null,
      decided_by: null,
      decision_reason: null,
      decided_at: null,
    },
    decision: {
      id: dec1Id,
      verdict: "MISMATCH",
      reason_codes: ["SCHEDULE_MISSING"],
      comparison: [
        { field: "status", label: "Subscription status", expected: "active", observed: "active", result: "MATCH" },
        { field: "cancel_at_period_end", label: "Cancel at period end", expected: true, observed: false, result: "MISMATCH" },
        { field: "current_period_end", label: "Period end date", expected: periodEnd7d, observed: periodEnd7d, result: "MATCH" },
      ],
      facts: { cancel_at_period_end: false, status: "active", current_period_end: periodEnd7d },
      recovery_candidate: true,
      gate_decision: "REQUIRE_APPROVAL",
      trigger: "CLAIM_ACCEPTED",
      trustworthy: true,
      evaluator_version: "cancel-period-end-evaluator.v1",
      policy_version: 1,
      request_version: 1,
      evaluated_at: new Date(baseTime - 120_000).toISOString(),
      observation_id: obs1Id,
      result_type: "SUCCESS",
      error_code: null,
      http_status: 200,
      snapshot: { cancel_at_period_end: false, status: "active", current_period_end: periodEnd7d },
      material_fingerprint: sha256("sub_demo_1048_obs"),
      snapshot_hash: sha256("sub_demo_1048_snap"),
      provider_request_id: "req_sbx_1048",
      observed_at: new Date(baseTime - 120_000).toISOString(),
      adapter: "LOCAL_SANDBOX",
      environment: "Local sandbox",
    },
    operations: [],
    events: [
      {
        id: randomUUID(),
        event_type: "verification.decided",
        summary: "Evaluated: Mismatch detected (cancellation not scheduled). Recovery proposal prepared.",
        actor_type: "SYSTEM",
        actor_label: "Proofwork Evaluator",
        reason_code: "SCHEDULE_MISSING",
        policy_version: 1,
        evaluator_version: "cancel-period-end-evaluator.v1",
        correlation_id: "corr_1048",
        occurred_at: new Date(baseTime - 120_000).toISOString(),
        proposal_id: prop1Id,
        operation_id: null,
      },
      {
        id: randomUUID(),
        event_type: "claim.accepted",
        summary: "Agent Ava Chen reported: 'Cancellation scheduled for the end of the current paid period.'",
        actor_type: "AGENT",
        actor_label: "Ava Chen (Support Agent)",
        reason_code: null,
        policy_version: 1,
        evaluator_version: null,
        correlation_id: "corr_1048",
        occurred_at: new Date(baseTime - 240_000).toISOString(),
        proposal_id: null,
        operation_id: null,
      },
      {
        id: randomUUID(),
        event_type: "request.registered",
        summary: "Authorized intent registered for Rivera Logistics (sub_demo_1048).",
        actor_type: "OPERATOR",
        actor_label: "Support System",
        reason_code: null,
        policy_version: 1,
        evaluator_version: null,
        correlation_id: "corr_1048",
        occurred_at: new Date(baseTime - 300_000).toISOString(),
        proposal_id: null,
        operation_id: null,
      },
    ],
  });

  // Scenario 2: Northwind Studio - already_scheduled (Healthy / Scheduled)
  const task2Id = "10000000-0000-4000-8000-000000001047";
  const req2Id = "20000000-0000-4000-8000-000000001047";
  tasks.push({
    id: task2Id,
    verdict: "SATISFIED_SCHEDULED",
    primary_reason_code: "CANCELLATION_SCHEDULED",
    processing_state: "MONITORING",
    recovery_state: "NONE",
    gate_decision: null,
    agent_name: "Kai Park (Support Agent)",
    last_checked_at: new Date(baseTime - 360_000).toISOString(),
    last_trustworthy_read_at: new Date(baseTime - 360_000).toISOString(),
    next_check_at: new Date(baseTime + 86_400_000).toISOString(),
    first_verified_at: new Date(baseTime - 360_000).toISOString(),
    human_intervention_count: 0,
    created_at: new Date(baseTime - 600_000).toISOString(),
    retired_at: null,
    retirement_reason: null,
    request_id: req2Id,
    customer_label: "Northwind Studio",
    customer_id: "cus_demo_1047",
    subscription_id: "sub_demo_1047",
    expected_period_end: periodEnd7d,
    awaiting_proposal_id: null,
    evidence_stale: false,
    has_claim: true,
    claim_report: "Cancellation scheduled for the end of the current paid period.",
    scenario_key: "already_scheduled",
    decision: {
      id: "40000000-0000-4000-8000-000000001047",
      verdict: "SATISFIED_SCHEDULED",
      reason_codes: ["CANCELLATION_SCHEDULED"],
      comparison: [
        { field: "status", label: "Subscription status", expected: "active", observed: "active", result: "MATCH" },
        { field: "cancel_at_period_end", label: "Cancel at period end", expected: true, observed: true, result: "MATCH" },
        { field: "current_period_end", label: "Period end date", expected: periodEnd7d, observed: periodEnd7d, result: "MATCH" },
      ],
      facts: { cancel_at_period_end: true, status: "active", current_period_end: periodEnd7d },
      recovery_candidate: false,
      gate_decision: null,
      trigger: "CLAIM_ACCEPTED",
      trustworthy: true,
      evaluator_version: "cancel-period-end-evaluator.v1",
      policy_version: 1,
      request_version: 1,
      evaluated_at: new Date(baseTime - 360_000).toISOString(),
      observation_id: "50000000-0000-4000-8000-000000001047",
      result_type: "SUCCESS",
      error_code: null,
      http_status: 200,
      snapshot: { cancel_at_period_end: true, status: "active", current_period_end: periodEnd7d },
      material_fingerprint: sha256("sub_demo_1047_obs"),
      snapshot_hash: sha256("sub_demo_1047_snap"),
      provider_request_id: "req_sbx_1047",
      observed_at: new Date(baseTime - 360_000).toISOString(),
      adapter: "LOCAL_SANDBOX",
      environment: "Local sandbox",
    },
    operations: [],
    events: [
      {
        id: randomUUID(),
        event_type: "verification.decided",
        summary: "Evaluated: Cancellation confirmed scheduled at period end. Monitoring active.",
        actor_type: "SYSTEM",
        actor_label: "Proofwork Evaluator",
        reason_code: "CANCELLATION_SCHEDULED",
        policy_version: 1,
        evaluator_version: "cancel-period-end-evaluator.v1",
        correlation_id: "corr_1047",
        occurred_at: new Date(baseTime - 360_000).toISOString(),
        proposal_id: null,
        operation_id: null,
      },
    ],
  });

  // Scenario 3: Corvid Health - source_unavailable
  const task3Id = "10000000-0000-4000-8000-000000001046";
  const req3Id = "20000000-0000-4000-8000-000000001046";
  tasks.push({
    id: task3Id,
    verdict: "UNVERIFIABLE",
    primary_reason_code: "SOURCE_UNAVAILABLE",
    processing_state: "WAITING_RECHECK",
    recovery_state: "NONE",
    gate_decision: null,
    agent_name: "Riley Khan (Support Agent)",
    last_checked_at: new Date(baseTime - 500_000).toISOString(),
    last_trustworthy_read_at: null,
    next_check_at: new Date(baseTime + 300_000).toISOString(),
    first_verified_at: null,
    human_intervention_count: 0,
    created_at: new Date(baseTime - 900_000).toISOString(),
    retired_at: null,
    retirement_reason: null,
    request_id: req3Id,
    customer_label: "Corvid Health",
    customer_id: "cus_demo_1046",
    subscription_id: "sub_demo_1046",
    expected_period_end: periodEnd7d,
    awaiting_proposal_id: null,
    evidence_stale: false,
    has_claim: true,
    claim_report: "Cancellation scheduled for the end of the current paid period.",
    scenario_key: "source_unavailable",
    decision: {
      id: "40000000-0000-4000-8000-000000001046",
      verdict: "UNVERIFIABLE",
      reason_codes: ["SOURCE_UNAVAILABLE"],
      comparison: [
        { field: "source_read", label: "Source connection", expected: "reachable", observed: "unavailable (503)", result: "MISMATCH" },
      ],
      facts: {},
      recovery_candidate: false,
      gate_decision: null,
      trigger: "CLAIM_ACCEPTED",
      trustworthy: false,
      evaluator_version: "cancel-period-end-evaluator.v1",
      policy_version: 1,
      request_version: 1,
      evaluated_at: new Date(baseTime - 500_000).toISOString(),
      observation_id: "50000000-0000-4000-8000-000000001046",
      result_type: "ERROR",
      error_code: "SOURCE_UNAVAILABLE",
      http_status: 503,
      snapshot: null,
      material_fingerprint: null,
      snapshot_hash: null,
      provider_request_id: null,
      observed_at: new Date(baseTime - 500_000).toISOString(),
      adapter: "LOCAL_SANDBOX",
      environment: "Local sandbox",
    },
    operations: [],
    events: [],
  });

  // Scenario 4: Brightsea Media - period_changed (Mismatch)
  const task4Id = "10000000-0000-4000-8000-000000001045";
  const req4Id = "20000000-0000-4000-8000-000000001045";
  tasks.push({
    id: task4Id,
    verdict: "MISMATCH",
    primary_reason_code: "PERIOD_CHANGED",
    processing_state: "ESCALATED",
    recovery_state: "NONE",
    gate_decision: null,
    agent_name: "Ava Chen (Support Agent)",
    last_checked_at: new Date(baseTime - 600_000).toISOString(),
    last_trustworthy_read_at: new Date(baseTime - 600_000).toISOString(),
    next_check_at: null,
    first_verified_at: null,
    human_intervention_count: 0,
    created_at: new Date(baseTime - 1200_000).toISOString(),
    retired_at: null,
    retirement_reason: null,
    request_id: req4Id,
    customer_label: "Brightsea Media",
    customer_id: "cus_demo_1045",
    subscription_id: "sub_demo_1045",
    expected_period_end: periodEnd7d,
    awaiting_proposal_id: null,
    evidence_stale: false,
    has_claim: true,
    claim_report: "Cancellation scheduled for the end of the current paid period.",
    scenario_key: "period_changed",
    decision: {
      id: "40000000-0000-4000-8000-000000001045",
      verdict: "MISMATCH",
      reason_codes: ["PERIOD_CHANGED"],
      comparison: [
        { field: "current_period_end", label: "Period end date", expected: periodEnd7d, observed: new Date(baseTime + 37 * 86_400_000).toISOString(), result: "MISMATCH" },
      ],
      facts: {},
      recovery_candidate: false,
      gate_decision: null,
      trigger: "CLAIM_ACCEPTED",
      trustworthy: true,
      evaluator_version: "cancel-period-end-evaluator.v1",
      policy_version: 1,
      request_version: 1,
      evaluated_at: new Date(baseTime - 600_000).toISOString(),
      observation_id: "50000000-0000-4000-8000-000000001045",
      result_type: "SUCCESS",
      error_code: null,
      http_status: 200,
      snapshot: { cancel_at_period_end: false, status: "active" },
      material_fingerprint: sha256("sub_demo_1045_obs"),
      snapshot_hash: sha256("sub_demo_1045_snap"),
      provider_request_id: "req_sbx_1045",
      observed_at: new Date(baseTime - 600_000).toISOString(),
      adapter: "LOCAL_SANDBOX",
      environment: "Local sandbox",
    },
    operations: [],
    events: [],
  });

  // Scenario 5: Halden Press - ended_correctly (Completed)
  const task5Id = "10000000-0000-4000-8000-000000001044";
  const req5Id = "20000000-0000-4000-8000-000000001044";
  tasks.push({
    id: task5Id,
    verdict: "SATISFIED_ENDED",
    primary_reason_code: "ENDED_ON_TIME",
    processing_state: "IDLE",
    recovery_state: "NONE",
    gate_decision: null,
    agent_name: "Kai Park (Support Agent)",
    last_checked_at: new Date(baseTime - 700_000).toISOString(),
    last_trustworthy_read_at: new Date(baseTime - 700_000).toISOString(),
    next_check_at: null,
    first_verified_at: new Date(baseTime - 700_000).toISOString(),
    human_intervention_count: 0,
    created_at: new Date(baseTime - 1800_000).toISOString(),
    retired_at: null,
    retirement_reason: null,
    request_id: req5Id,
    customer_label: "Halden Press",
    customer_id: "cus_demo_1044",
    subscription_id: "sub_demo_1044",
    expected_period_end: periodEndPast,
    awaiting_proposal_id: null,
    evidence_stale: false,
    has_claim: true,
    claim_report: "Subscription canceled and finalized.",
    scenario_key: "ended_correctly",
    decision: {
      id: "40000000-0000-4000-8000-000000001044",
      verdict: "SATISFIED_ENDED",
      reason_codes: ["ENDED_ON_TIME"],
      comparison: [
        { field: "status", label: "Subscription status", expected: "canceled", observed: "canceled", result: "MATCH" },
      ],
      facts: {},
      recovery_candidate: false,
      gate_decision: null,
      trigger: "CLAIM_ACCEPTED",
      trustworthy: true,
      evaluator_version: "cancel-period-end-evaluator.v1",
      policy_version: 1,
      request_version: 1,
      evaluated_at: new Date(baseTime - 700_000).toISOString(),
      observation_id: "50000000-0000-4000-8000-000000001044",
      result_type: "SUCCESS",
      error_code: null,
      http_status: 200,
      snapshot: { status: "canceled" },
      material_fingerprint: sha256("sub_demo_1044_obs"),
      snapshot_hash: sha256("sub_demo_1044_snap"),
      provider_request_id: "req_sbx_1044",
      observed_at: new Date(baseTime - 700_000).toISOString(),
      adapter: "LOCAL_SANDBOX",
      environment: "Local sandbox",
    },
    operations: [],
    events: [],
  });

  // Scenario 6: Atlas Metering - unsupported_structure (Outside scope)
  const task6Id = "10000000-0000-4000-8000-000000001043";
  const req6Id = "20000000-0000-4000-8000-000000001043";
  tasks.push({
    id: task6Id,
    verdict: "OUT_OF_SCOPE",
    primary_reason_code: "UNSUPPORTED_SHAPE",
    processing_state: "IDLE",
    recovery_state: "NONE",
    gate_decision: null,
    agent_name: "Riley Khan (Support Agent)",
    last_checked_at: new Date(baseTime - 800_000).toISOString(),
    last_trustworthy_read_at: new Date(baseTime - 800_000).toISOString(),
    next_check_at: null,
    first_verified_at: null,
    human_intervention_count: 0,
    created_at: new Date(baseTime - 2400_000).toISOString(),
    retired_at: null,
    retirement_reason: null,
    request_id: req6Id,
    customer_label: "Atlas Metering",
    customer_id: "cus_demo_1043",
    subscription_id: "sub_demo_1043",
    expected_period_end: periodEnd7d,
    awaiting_proposal_id: null,
    evidence_stale: false,
    has_claim: true,
    claim_report: "Multi-item subscription cancellation reported.",
    scenario_key: "unsupported_structure",
    decision: {
      id: "40000000-0000-4000-8000-000000001043",
      verdict: "OUT_OF_SCOPE",
      reason_codes: ["UNSUPPORTED_SHAPE"],
      comparison: [
        { field: "item_count", label: "Subscription items", expected: 1, observed: 2, result: "MISMATCH" },
      ],
      facts: {},
      recovery_candidate: false,
      gate_decision: null,
      trigger: "CLAIM_ACCEPTED",
      trustworthy: true,
      evaluator_version: "cancel-period-end-evaluator.v1",
      policy_version: 1,
      request_version: 1,
      evaluated_at: new Date(baseTime - 800_000).toISOString(),
      observation_id: "50000000-0000-4000-8000-000000001043",
      result_type: "SUCCESS",
      error_code: null,
      http_status: 200,
      snapshot: { item_count: 2 },
      material_fingerprint: sha256("sub_demo_1043_obs"),
      snapshot_hash: sha256("sub_demo_1043_snap"),
      provider_request_id: "req_sbx_1043",
      observed_at: new Date(baseTime - 800_000).toISOString(),
      adapter: "LOCAL_SANDBOX",
      environment: "Local sandbox",
    },
    operations: [],
    events: [],
  });

  // Global audit trail
  audit.push(
    {
      id: randomUUID(),
      event_type: "verification.decided",
      summary: "Rivera Logistics: Cancellation not scheduled at period end. Recovery proposal prepared.",
      actor_type: "SYSTEM",
      actor_label: "Proofwork Evaluator",
      reason_code: "SCHEDULE_MISSING",
      policy_version: 1,
      evaluator_version: "cancel-period-end-evaluator.v1",
      correlation_id: "corr_1048",
      occurred_at: new Date(baseTime - 120_000).toISOString(),
      task_id: task1Id,
      request_id: req1Id,
      proposal_id: prop1Id,
      operation_id: null,
      customer_label: "Rivera Logistics",
      subscription_id: "sub_demo_1048",
    },
    {
      id: randomUUID(),
      event_type: "verification.decided",
      summary: "Northwind Studio: Cancellation confirmed scheduled at period end.",
      actor_type: "SYSTEM",
      actor_label: "Proofwork Evaluator",
      reason_code: "CANCELLATION_SCHEDULED",
      policy_version: 1,
      evaluator_version: "cancel-period-end-evaluator.v1",
      correlation_id: "corr_1047",
      occurred_at: new Date(baseTime - 360_000).toISOString(),
      task_id: task2Id,
      request_id: req2Id,
      proposal_id: null,
      operation_id: null,
      customer_label: "Northwind Studio",
      subscription_id: "sub_demo_1047",
    },
    {
      id: randomUUID(),
      event_type: "claim.accepted",
      summary: "Agent report received for Rivera Logistics (sub_demo_1048).",
      actor_type: "AGENT",
      actor_label: "Ava Chen (Support Agent)",
      reason_code: null,
      policy_version: 1,
      evaluator_version: null,
      correlation_id: "corr_1048",
      occurred_at: new Date(baseTime - 240_000).toISOString(),
      task_id: task1Id,
      request_id: req1Id,
      proposal_id: null,
      operation_id: null,
      customer_label: "Rivera Logistics",
      subscription_id: "sub_demo_1048",
    },
    {
      id: randomUUID(),
      event_type: "demo.created",
      summary: "Isolated demo workspace initialized with 6 starter verification scenarios.",
      actor_type: "SYSTEM",
      actor_label: "Demo Initializer",
      reason_code: null,
      policy_version: 1,
      evaluator_version: null,
      correlation_id: "init_demo",
      occurred_at: new Date(baseTime - 600_000).toISOString(),
      task_id: null,
      request_id: null,
      proposal_id: null,
      operation_id: null,
      customer_label: null,
      subscription_id: null,
    },
  );

  return { workspace, tasks, audit };
}

function getStore(workspaceId: string): DemoState {
  let state = globalStore.__proofwork_standalone_demos!.get(workspaceId);
  if (!state) {
    state = createInitialState(workspaceId);
    globalStore.__proofwork_standalone_demos!.set(workspaceId, state);
  }
  return state;
}

export function createStandaloneDemoWorkspace(orgName?: string, ownerName?: string) {
  const workspaceId = randomUUID();
  const sessionToken = sha256(randomUUID() + Date.now().toString());
  const state = createInitialState(workspaceId, orgName, ownerName);
  globalStore.__proofwork_standalone_demos!.set(workspaceId, state);
  const expiresAt = new Date(Date.now() + 86400 * 1000);
  return { workspaceId, sessionToken, expiresAt };
}

export function getStandaloneWorkspace(workspaceId: string): StandaloneWorkspace {
  return getStore(workspaceId).workspace;
}

export function getStandaloneShellSummary(workspaceId: string) {
  const state = getStore(workspaceId);
  const pendingApprovals = state.tasks.filter((t) => t.recovery_state === "AWAITING_APPROVAL" && t.awaiting_proposal_id).length;
  const needsAction = state.tasks.filter((t) => t.verdict === "MISMATCH" && !t.retired_at).length;

  return {
    workspace: {
      id: state.workspace.id,
      kind: state.workspace.kind,
      organization: state.workspace.organization,
      name: state.workspace.name,
      timezone: state.workspace.timezone,
      onboarding_step: state.workspace.onboarding_step,
      onboarded: true,
      writes_paused: state.workspace.writes_paused,
      expires_at: state.workspace.expires_at,
    },
    policy: { version: 1, mode: "REQUIRE_APPROVAL" as PolicyMode, label: "Human approval" },
    connection: {
      id: "conn_demo_sandbox",
      adapter: "LOCAL_SANDBOX",
      health: "CONNECTED",
      display_name: "Simulated Billing Sandbox",
    },
    counts: {
      tasks: state.tasks.length,
      pending_approvals: pendingApprovals,
      needs_action: needsAction,
    },
  };
}

export function listStandaloneTasks(
  workspaceId: string,
  params: { status?: string; q?: string; range?: string; page?: number },
) {
  const state = getStore(workspaceId);
  const status = params.status ?? "all";
  const q = (params.q ?? "").toLowerCase().trim();
  const page = Math.max(1, params.page ?? 1);

  let filtered = state.tasks.filter((t) => {
    if (q) {
      const match =
        t.customer_label?.toLowerCase().includes(q) ||
        t.subscription_id.toLowerCase().includes(q) ||
        t.customer_id.toLowerCase().includes(q) ||
        t.agent_name.toLowerCase().includes(q);
      if (!match) return false;
    }
    if (status === "needs_action") return t.verdict === "MISMATCH";
    if (status === "scheduled") return t.verdict === "SATISFIED_SCHEDULED";
    if (status === "completed") return t.verdict === "SATISFIED_ENDED";
    if (status === "could_not_verify") return t.verdict === "UNVERIFIABLE";
    if (status === "outside_scope") return t.verdict === "OUT_OF_SCOPE";
    if (status === "waiting") return t.verdict === "PENDING";
    return true;
  });

  const counts = {
    total: state.tasks.length,
    pending: state.tasks.filter((t) => t.verdict === "PENDING").length,
    scheduled: state.tasks.filter((t) => t.verdict === "SATISFIED_SCHEDULED").length,
    ended: state.tasks.filter((t) => t.verdict === "SATISFIED_ENDED").length,
    mismatch: state.tasks.filter((t) => t.verdict === "MISMATCH").length,
    unverifiable: state.tasks.filter((t) => t.verdict === "UNVERIFIABLE").length,
    out_of_scope: state.tasks.filter((t) => t.verdict === "OUT_OF_SCOPE").length,
  };

  const priority = state.tasks.find((t) => !t.retired_at && t.verdict === "MISMATCH") ?? null;

  return {
    filters: { status, range: params.range ?? "30d", q, page },
    cohort_definition: "Tasks whose agent report was accepted within the selected range. Counts use the same cohort and search.",
    counts,
    page: { number: page, size: LIMITS.PAGE_SIZE, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / LIMITS.PAGE_SIZE)) },
    priority: priority
      ? {
          id: priority.id,
          verdict: priority.verdict,
          primary_reason_code: priority.primary_reason_code,
          processing_state: priority.processing_state,
          recovery_state: priority.recovery_state,
          gate_decision: priority.gate_decision,
          agent_name: priority.agent_name,
          last_checked_at: priority.last_checked_at,
          customer_label: priority.customer_label,
          subscription_id: priority.subscription_id,
          expected_period_end: priority.expected_period_end,
          has_claim: priority.has_claim,
        }
      : null,
    items: filtered.map((t) => ({
      id: t.id,
      verdict: t.verdict,
      primary_reason_code: t.primary_reason_code,
      processing_state: t.processing_state,
      recovery_state: t.recovery_state,
      gate_decision: t.gate_decision,
      agent_name: t.agent_name,
      last_checked_at: t.last_checked_at,
      last_trustworthy_read_at: t.last_trustworthy_read_at,
      next_check_at: t.next_check_at,
      created_at: t.created_at,
      retired_at: t.retired_at,
      request_id: t.request_id,
      customer_label: t.customer_label,
      customer_id: t.customer_id,
      subscription_id: t.subscription_id,
      expected_period_end: t.expected_period_end,
      awaiting_proposal_id: t.awaiting_proposal_id,
      evidence_stale: t.evidence_stale,
    })),
  };
}

export function getStandaloneTaskDetail(workspaceId: string, taskId: string) {
  const state = getStore(workspaceId);
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");

  const request = {
    id: task.request_id,
    version: 1,
    status: "ACTIVE" as const,
    customer_label: task.customer_label,
    customer_id: task.customer_id,
    subscription_id: task.subscription_id,
    source_account_id: "sbx_demo",
    source_reference: `support-ticket-${task.subscription_id.slice(-4)}`,
    expected_period_end: task.expected_period_end,
    authorized_by_label: "Customer Support Desk",
    authorized_at: task.created_at,
    authorization_kind: "DEMO_FIXTURE" as const,
    contract_id: "subscription.cancel_at_period_end.v1",
  };

  const connection = {
    id: "conn_demo_sandbox",
    adapter: "LOCAL_SANDBOX" as const,
    environment: "Local sandbox",
    source_account_id: "sbx_demo",
    display_name: "Simulated Billing Sandbox",
    health: "CONNECTED",
    last_successful_read_at: task.last_checked_at,
  };

  const receipts = [
    {
      id: randomUUID(),
      agent_name: task.agent_name,
      agent_reference: `claim_${task.subscription_id.slice(-4)}`,
      report_text: task.claim_report,
      source_kind: "AGENT_EVENT",
      producer_identity: "crm-agent",
      payload_hash: sha256(task.claim_report),
      idempotency_key: sha256(`idem_${task.id}`),
      claimed_at: task.created_at,
      received_at: task.created_at,
    },
  ];

  const proposals = task.proposal ? [task.proposal] : [];
  const decisions = task.decision ? [task.decision] : [];
  const operations = task.operations ?? [];
  const events = (task.events ?? []).concat(
    state.audit.filter((a) => a.task_id === taskId),
  );

  return {
    task: {
      id: task.id,
      verdict: task.verdict,
      primary_reason_code: task.primary_reason_code,
      processing_state: task.processing_state,
      recovery_state: task.recovery_state,
      gate_decision: task.gate_decision,
      agent_name: task.agent_name,
      last_checked_at: task.last_checked_at,
      last_trustworthy_read_at: task.last_trustworthy_read_at,
      next_check_at: task.next_check_at,
      first_verified_at: task.first_verified_at,
      human_intervention_count: task.human_intervention_count,
      retired_at: task.retired_at,
      retirement_reason: task.retirement_reason,
      created_at: task.created_at,
      evidence_stale: task.evidence_stale,
    },
    request,
    connection,
    policy: { version: 1, mode: "REQUIRE_APPROVAL" as PolicyMode },
    receipts,
    latest_decision: task.decision ?? null,
    latest_trustworthy_decision: task.decision ?? null,
    decisions,
    proposals,
    live_proposal: task.proposal && ["AWAITING_APPROVAL", "PROPOSED", "AUTHORIZED"].includes(task.proposal.status) ? task.proposal : null,
    operations,
    unresolved_operation: null,
    events,
    interventions: task.interventions ?? [],
    reviews: task.reviews ?? [],
    pending_job: null,
    allowed_actions: {
      check_now: true,
      review_proposal: Boolean(task.awaiting_proposal_id),
      retire: !task.retired_at,
      record_intervention: true,
      add_review: true,
      blocked_reason: null,
    },
    workspace: {
      timezone: state.workspace.timezone,
      writes_paused: state.workspace.writes_paused,
      kind: state.workspace.kind,
    },
    scenario_controls: true,
  };
}

export function listStandaloneApprovals(workspaceId: string, filter: ApprovalFilter = "waiting") {
  const state = getStore(workspaceId);
  const items: any[] = [];

  for (const t of state.tasks) {
    if (t.proposal) {
      const p = t.proposal;
      const isWaiting = p.status === "AWAITING_APPROVAL";
      const isDecided = Boolean(p.decision);
      if (filter === "waiting" && !isWaiting) continue;
      if (filter === "decided" && !isDecided) continue;

      items.push({
        id: p.id,
        task_id: t.id,
        status: p.status,
        status_reason: p.status_reason,
        diff: p.diff,
        expires_at: p.expires_at,
        created_at: p.created_at,
        policy_version: p.policy_version,
        policy_mode: p.policy_mode,
        proposal_hash: p.proposal_hash,
        subscription_id: t.subscription_id,
        customer_id: t.customer_id,
        source_account_id: "sbx_demo",
        expected_period_end: t.expected_period_end,
        customer_label: t.customer_label,
        source_reference: `support-ticket-${t.subscription_id.slice(-4)}`,
        request_version: 1,
        agent_name: t.agent_name,
        verdict: t.verdict,
        primary_reason_code: t.primary_reason_code,
        observed_at: t.last_checked_at,
        provider_request_id: `req_${t.subscription_id}`,
        source_label: "Simulated Billing Sandbox",
        adapter: "LOCAL_SANDBOX",
        decision: p.decision,
        decided_by: p.decided_by,
        decision_reason: p.decision_reason,
        decided_at: p.decided_at,
        operation_state: t.operations?.[0]?.state ?? null,
        operation_attribution: t.operations?.[0]?.attribution ?? null,
      });
    }
  }

  const waitingCount = state.tasks.filter((t) => t.proposal?.status === "AWAITING_APPROVAL").length;
  const decidedCount = state.tasks.filter((t) => Boolean(t.proposal?.decision)).length;

  return {
    filter,
    counts: { waiting: waitingCount, decided: decidedCount, all: waitingCount + decidedCount },
    items,
  };
}

export function decideStandaloneApproval(
  workspaceId: string,
  proposalId: string,
  input: { decision: "APPROVE" | "REJECT"; proposal_hash: string; reason: string },
) {
  const state = getStore(workspaceId);
  const task = state.tasks.find((t) => t.proposal?.id === proposalId);
  if (!task || !task.proposal) throw new AppError("NOT_FOUND", "Proposal not found.");

  const p = task.proposal;
  const isoNow = new Date().toISOString();

  if (input.decision === "APPROVE") {
    p.status = "AUTHORIZED";
    p.decision = "APPROVE";
    p.decided_by = "Demo operator";
    p.decision_reason = input.reason || "Approved in live demo";
    p.decided_at = isoNow;

    task.verdict = "SATISFIED_SCHEDULED";
    task.primary_reason_code = "CANCELLATION_SCHEDULED";
    task.processing_state = "MONITORING";
    task.recovery_state = "VERIFIED";
    task.gate_decision = "AUTO_POLICY";
    task.awaiting_proposal_id = null;

    const opId = randomUUID();
    task.operations = [
      {
        id: opId,
        proposal_id: p.id,
        state: "VERIFIED",
        outcome_certainty: "CERTAIN",
        attribution: "PROOFWORK",
        dispatch_count: 1,
        max_dispatches: 3,
        idempotency_key: `idem_${opId}`,
        authorized_until: new Date(Date.now() + 3600_000).toISOString(),
        first_dispatched_at: isoNow,
        last_provider_request_id: `rec_${opId.slice(0, 8)}`,
        last_error_code: null,
        resolved_at: isoNow,
        resolution_reason: "Cancellation scheduled at period end in billing source; re-read verified.",
        escalated_at: null,
        created_at: isoNow,
        events: [
          { event_type: "operation.dispatched", from_state: "PREPARED", to_state: "DISPATCHED", occurred_at: isoNow },
          { event_type: "operation.verified", from_state: "AWAITING_VERIFICATION", to_state: "VERIFIED", occurred_at: isoNow },
        ],
      },
    ];

    state.audit.unshift({
      id: randomUUID(),
      event_type: "recovery.verified",
      summary: `Recovery applied and verified for ${task.customer_label} (${task.subscription_id}).`,
      actor_type: "DEMO_OPERATOR",
      actor_label: "Demo operator",
      reason_code: "CANCELLATION_SCHEDULED",
      policy_version: 1,
      evaluator_version: "cancel-period-end-evaluator.v1",
      correlation_id: `rec_${opId.slice(0, 8)}`,
      occurred_at: isoNow,
      task_id: task.id,
      request_id: task.request_id,
      proposal_id: p.id,
      operation_id: opId,
      customer_label: task.customer_label,
      subscription_id: task.subscription_id,
    });

    return { status: "AUTHORIZED" as const, message: "Recovery authorized and scheduled at period end.", task_id: task.id };
  } else {
    p.status = "REJECTED";
    p.decision = "REJECT";
    p.decided_by = "Demo operator";
    p.decision_reason = input.reason || "Rejected by operator";
    p.decided_at = isoNow;

    task.recovery_state = "REJECTED";
    task.awaiting_proposal_id = null;

    return { status: "REJECTED" as const, message: "Proposal rejected.", task_id: task.id };
  }
}

export function listStandaloneActivity(workspaceId: string, params: any) {
  const state = getStore(workspaceId);
  const q = (params.q ?? "").toLowerCase().trim();
  const page = Math.max(1, params.page ?? 1);

  let items = state.audit;
  if (q) {
    items = items.filter(
      (a) =>
        a.summary.toLowerCase().includes(q) ||
        a.actor_label.toLowerCase().includes(q) ||
        a.event_type.toLowerCase().includes(q) ||
        a.customer_label?.toLowerCase().includes(q),
    );
  }
  if (params.taskId) {
    items = items.filter((a) => a.task_id === params.taskId);
  }

  return {
    filters: { type: params.type ?? "all", actor: params.actor ?? "all", range: params.range ?? "7d", q, page },
    window: { from: new Date(Date.now() - 7 * 86_400_000).toISOString(), to: null },
    counts: { total: items.length },
    page: { number: page, size: LIMITS.PAGE_SIZE, total: items.length, pages: Math.max(1, Math.ceil(items.length / LIMITS.PAGE_SIZE)) },
    items,
  };
}

export function getStandaloneInsights(workspaceId: string, params: { range?: string }) {
  const state = getStore(workspaceId);
  const total = state.tasks.length;
  const scheduled = state.tasks.filter((t) => t.verdict === "SATISFIED_SCHEDULED").length;
  const ended = state.tasks.filter((t) => t.verdict === "SATISFIED_ENDED").length;
  const mismatch = state.tasks.filter((t) => t.verdict === "MISMATCH").length;
  const unverifiable = state.tasks.filter((t) => t.verdict === "UNVERIFIABLE").length;
  const out_of_scope = state.tasks.filter((t) => t.verdict === "OUT_OF_SCOPE").length;
  const pendingApprovals = state.tasks.filter((t) => t.recovery_state === "AWAITING_APPROVAL").length;
  const verifiedRecoveries = state.tasks.filter((t) => t.recovery_state === "VERIFIED").length;

  return {
    range: params.range ?? "30d",
    cohort_definition: "Aggregated results for all tasks in this isolated workspace cohort.",
    outcomes: {
      total,
      pending: 0,
      scheduled,
      ended,
      mismatch,
      unverifiable,
      out_of_scope,
      autonomous_verified: scheduled + ended,
      with_intervention: 0,
      intervention_events: 0,
      evidence_available: total - unverifiable,
      retired: 0,
      stale: 0,
    },
    recovery: {
      attempted_tasks: verifiedRecoveries,
      verified_by_proofwork: verifiedRecoveries,
      verified_human_approved: verifiedRecoveries,
      verified_auto_policy: 0,
      resolved_externally: 0,
      failed_confirmed: 0,
      unresolved: pendingApprovals,
      blocked_before_dispatch: 0,
    },
    pending_work: {
      awaiting_approval: pendingApprovals,
      queued_jobs: 0,
      dead_jobs: 0,
    },
    correctness: {
      eligible_decisions: scheduled + ended,
      reviewed: 0,
      correct: 0,
      incorrect: 0,
      insufficient: 0,
      first_review_at: null,
      last_review_at: null,
      reviewers: [],
    },
    unverifiable_reasons: [
      { code: "SOURCE_UNAVAILABLE", count: unverifiable, label: "Billing source temporarily unavailable" },
    ],
  };
}

export function getStandaloneSettings(workspaceId: string) {
  const state = getStore(workspaceId);
  return {
    workspace: {
      id: state.workspace.id,
      kind: state.workspace.kind,
      organization: state.workspace.organization,
      name: state.workspace.name,
      timezone: state.workspace.timezone,
      writes_paused: state.workspace.writes_paused,
      writes_paused_reason: state.workspace.writes_paused_reason,
      writes_paused_at: state.workspace.writes_paused_at,
      current_policy_version: state.workspace.current_policy_version,
      expires_at: state.workspace.expires_at,
    },
    policies: [
      {
        version: 1,
        mode: "REQUIRE_APPROVAL",
        changed_by_label: "Demo initialization",
        change_reason: "Default demo configuration: Human approval required before recovery writes.",
        created_at: state.workspace.onboarding_completed_at,
      },
    ],
    connections: [
      {
        id: "conn_demo_sandbox",
        adapter: "LOCAL_SANDBOX",
        environment: "Local sandbox",
        source_account_id: "sbx_demo",
        display_name: "Simulated Billing Sandbox",
        health: "CONNECTED",
        last_successful_read_at: new Date().toISOString(),
        config_version: 1,
        is_active: true,
      },
    ],
    tokens: [],
    health: {
      health: "CONNECTED",
      database: "STANDALONE_DEMO",
      billing_source: "SIMULATED",
      active_connections: 1,
    },
    account: {
      kind: "demo",
      display_name: "Demo operator",
      email: null,
      role: "DEMO_OPERATOR",
      expires_at: state.workspace.expires_at,
    },
    ingestion: { endpoint: "https://proofwork-beta.vercel.app/api/v1/claims" },
  };
}

export function resetStandaloneDemo(workspaceId: string) {
  const state = createInitialState(workspaceId);
  globalStore.__proofwork_standalone_demos!.set(workspaceId, state);
  return { reset: true };
}

export function createStandaloneScenario(workspaceId: string, key: ScenarioKey) {
  const state = getStore(workspaceId);
  const def = SCENARIOS.find((s) => s.key === key);
  if (!def) throw new AppError("INVALID_PAYLOAD", "Unknown scenario.");

  const n = 1050 + Math.floor(Math.random() * 8000);
  const taskId = randomUUID();
  const reqId = randomUUID();
  const periodEnd = new Date(Date.now() + def.seed.period_end_offset_days * 86_400_000).toISOString();

  let verdict: Verdict = "MISMATCH";
  let reason: ReasonCode = "SCHEDULE_MISSING";
  let stateKind: ProcessingState = "AWAITING_APPROVAL";
  let recovery: RecoveryState = "AWAITING_APPROVAL";
  let propId: string | null = randomUUID();

  if (key === "already_scheduled") {
    verdict = "SATISFIED_SCHEDULED";
    reason = "CANCELLATION_SCHEDULED";
    stateKind = "MONITORING";
    recovery = "NONE";
    propId = null;
  } else if (key === "ended_correctly") {
    verdict = "SATISFIED_ENDED";
    reason = "ENDED_ON_TIME";
    stateKind = "IDLE";
    recovery = "NONE";
    propId = null;
  } else if (key === "source_unavailable") {
    verdict = "UNVERIFIABLE";
    reason = "SOURCE_UNAVAILABLE";
    stateKind = "WAITING_RECHECK";
    recovery = "NONE";
    propId = null;
  } else if (key === "unsupported_structure") {
    verdict = "OUT_OF_SCOPE";
    reason = "UNSUPPORTED_SHAPE";
    stateKind = "IDLE";
    recovery = "NONE";
    propId = null;
  }

  const newTask: StandaloneTask = {
    id: taskId,
    verdict,
    primary_reason_code: reason,
    processing_state: stateKind,
    recovery_state: recovery,
    gate_decision: propId ? "REQUIRE_APPROVAL" : null,
    agent_name: def.seed.agent_name,
    last_checked_at: new Date().toISOString(),
    last_trustworthy_read_at: new Date().toISOString(),
    next_check_at: null,
    first_verified_at: null,
    human_intervention_count: 0,
    created_at: new Date().toISOString(),
    retired_at: null,
    retirement_reason: null,
    request_id: reqId,
    customer_label: def.seed.customer_label,
    customer_id: `cus_demo_${n}`,
    subscription_id: `sub_demo_${n}`,
    expected_period_end: periodEnd,
    awaiting_proposal_id: propId,
    evidence_stale: false,
    has_claim: true,
    claim_report: def.seed.report_text,
    scenario_key: key,
  };

  if (propId) {
    newTask.proposal = {
      id: propId,
      status: "AWAITING_APPROVAL",
      status_reason: "Customer requested period-end cancellation; billing source active without schedule.",
      diff: {
        changes: [{ field: "cancel_at_period_end", label: "Cancel at period end", before: false, after: true }],
        unchanged: [{ field: "status", label: "Status", value: "active" }],
      },
      expires_at: new Date(Date.now() + 900_000).toISOString(),
      created_at: new Date().toISOString(),
      policy_version: 1,
      policy_mode: "REQUIRE_APPROVAL",
      proposal_hash: sha256(`sub_demo_${n}:SCHEDULE_PERIOD_END_CANCELLATION:1`),
      decision: null,
      decided_by: null,
      decision_reason: null,
      decided_at: null,
    };
  }

  state.tasks.unshift(newTask);
  return { task_id: taskId, scenario: key, title: def.title };
}

export function explainStandaloneDecision(workspaceId: string, taskId: string, decisionId: string) {
  const state = getStore(workspaceId);
  const task = state.tasks.find((t) => t.id === taskId);
  return {
    decision_id: decisionId,
    verdict: task?.verdict ?? "MISMATCH",
    summary:
      task?.verdict === "SATISFIED_SCHEDULED"
        ? "The billing system confirms that cancellation at the end of the period is scheduled."
        : "The AI employee claimed the cancellation was scheduled, but our independent check of the billing source shows it is still active without cancellation.",
    rationale:
      "Proofwork read the authoritative billing subscription record directly. The cancel_at_period_end property does not match what was authorized and claimed.",
    factors: [
      { name: "Authorized boundary", value: task?.expected_period_end ?? "7 days" },
      { name: "Observed status", value: task?.verdict === "SATISFIED_SCHEDULED" ? "Cancellation scheduled" : "Active, renews" },
      { name: "Recovery safety", value: "Bounded correction allowed by policy (Human approval required)" },
    ],
  };
}

export function retireStandaloneTask(workspaceId: string, taskId: string, reason: string) {
  const state = getStore(workspaceId);
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  task.retired_at = new Date().toISOString();
  task.retirement_reason = reason;
  return { retired: true, task_id: taskId };
}

export function recheckStandaloneTask(workspaceId: string, taskId: string) {
  const state = getStore(workspaceId);
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  task.last_checked_at = new Date().toISOString();
  return { recheck: true, message: "Re-check completed against synthetic billing source." };
}

export function recordStandaloneIntervention(workspaceId: string, taskId: string, input: any) {
  const state = getStore(workspaceId);
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  task.human_intervention_count += 1;
  const intervention = {
    id: randomUUID(),
    kind: input.kind,
    notes: input.notes,
    external_reference: input.external_reference ?? null,
    actor_label: "Demo operator",
    created_at: new Date().toISOString(),
  };
  (task.interventions ??= []).unshift(intervention);
  return intervention;
}

export function addStandaloneReview(workspaceId: string, taskId: string, input: any) {
  const state = getStore(workspaceId);
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  const review = {
    id: randomUUID(),
    label: input.label,
    notes: input.notes ?? null,
    reviewer_label: "Demo operator",
    created_at: new Date().toISOString(),
  };
  (task.reviews ??= []).unshift(review);
  return review;
}

