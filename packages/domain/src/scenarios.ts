/**
 * Synthetic scenario catalog. Scenarios configure SOURCE conditions and request
 * fixtures only. They never contain expected verdicts: every task decision is
 * produced by the real worker + evaluator reading the independent sandbox.
 */

export type ScenarioKey =
  | "missing_schedule"
  | "already_scheduled"
  | "ended_correctly"
  | "source_unavailable"
  | "period_changed"
  | "unsupported_structure"
  | "mutation_rejected"
  | "response_lost"
  | "material_change"
  | "wrong_identity"
  | "expired_approval"
  | "write_pause"
  | "competing_recovery";

export interface SubscriptionSeed {
  customer_label: string;
  /** Days from fixture creation to the authorized boundary (negative = historical). */
  period_end_offset_days: number;
  cancel_at_period_end?: boolean;
  status?: "active" | "canceled";
  /** For canceled seeds: seconds after the boundary that service ended. */
  ended_offset_seconds?: number;
  item_count?: number;
  /** Source period end differs from the authorized boundary by this many days. */
  source_period_shift_days?: number;
  read_fault?: "NONE" | "UNAVAILABLE" | "NOT_FOUND" | "DENIED" | "MALFORMED";
  write_fault?: "NONE" | "REJECT" | "RESPONSE_LOST";
  /** Applied to the source after the request is registered. */
  customer_changed_after_registration?: boolean;
  agent_name: string;
  report_text: string;
}

export interface ScenarioDefinition {
  key: ScenarioKey;
  title: string;
  description: string;
  /** Operator hint describing what to try, never the answer. */
  try_next: string;
  seed: SubscriptionSeed;
  /** Workspace-level control applied with the scenario, recorded in audit. */
  workspace_effect?: "PAUSE_WRITES";
  /** Optional follow-up control exposed in the scenario library. */
  control?: "SHIFT_PERIOD" | "EXPIRE_PROPOSAL" | "QUEUE_COMPETING_RECOVERY";
}

const REPORT = "Cancellation scheduled for the end of the current paid period.";

export const SCENARIOS: ScenarioDefinition[] = [
  {
    key: "missing_schedule",
    title: "Missing cancellation schedule",
    description: "The agent reports completion, but the source subscription still renews.",
    try_next: "Open the task, review the recovery proposal and approve it.",
    seed: { customer_label: "Rivera Logistics", period_end_offset_days: 7, agent_name: "Ava Chen (Support Agent)", report_text: REPORT },
  },
  {
    key: "already_scheduled",
    title: "Cancellation already scheduled",
    description: "The source already contains the requested period-end cancellation.",
    try_next: "Inspect the evidence and the next monitoring time.",
    seed: { customer_label: "Northwind Studio", period_end_offset_days: 7, cancel_at_period_end: true, agent_name: "Kai Park (Support Agent)", report_text: REPORT },
  },
  {
    key: "source_unavailable",
    title: "Source temporarily unavailable",
    description: "The billing source does not respond to reads.",
    try_next: "Observe that the task stays unverified and retries are scheduled.",
    seed: { customer_label: "Corvid Health", period_end_offset_days: 7, read_fault: "UNAVAILABLE", agent_name: "Riley Khan (Support Agent)", report_text: REPORT },
  },
  {
    key: "period_changed",
    title: "Billing period changed",
    description: "The source period end no longer matches the authorized boundary.",
    try_next: "Review the mismatch. No automatic correction is offered.",
    seed: { customer_label: "Brightsea Media", period_end_offset_days: 7, source_period_shift_days: 30, agent_name: "Ava Chen (Support Agent)", report_text: REPORT },
  },
  {
    key: "ended_correctly",
    title: "Subscription correctly ended",
    description: "A historical request whose boundary has passed; the source reports the subscription ended.",
    try_next: "Inspect the end-time evidence.",
    seed: { customer_label: "Halden Press", period_end_offset_days: -1, status: "canceled", cancel_at_period_end: true, ended_offset_seconds: 0, agent_name: "Kai Park (Support Agent)", report_text: REPORT },
  },
  {
    key: "unsupported_structure",
    title: "Unsupported subscription structure",
    description: "The subscription has two plan items, which this workflow does not support.",
    try_next: "Read why the task is outside supported scope.",
    seed: { customer_label: "Atlas Metering", period_end_offset_days: 7, item_count: 2, agent_name: "Riley Khan (Support Agent)", report_text: REPORT },
  },
  {
    key: "mutation_rejected",
    title: "Source rejects the write",
    description: "The schedule is missing and the source will reject the recovery mutation.",
    try_next: "Approve the proposal and watch the operation record a confirmed failure.",
    seed: { customer_label: "Juniper Freight", period_end_offset_days: 10, write_fault: "REJECT", agent_name: "Ava Chen (Support Agent)", report_text: REPORT },
  },
  {
    key: "response_lost",
    title: "Write applied, response lost",
    description: "The source applies the change but the response never arrives.",
    try_next: "Approve the proposal and watch reconciliation resolve the uncertain operation.",
    seed: { customer_label: "Marlow Analytics", period_end_offset_days: 10, write_fault: "RESPONSE_LOST", agent_name: "Kai Park (Support Agent)", report_text: REPORT },
  },
  {
    key: "material_change",
    title: "Source changes before approval",
    description: "The schedule is missing. Use the control to change the source period before approving.",
    try_next: "Shift the source period, then try approving the old proposal.",
    seed: { customer_label: "Oakridge Clinics", period_end_offset_days: 12, agent_name: "Riley Khan (Support Agent)", report_text: REPORT },
    control: "SHIFT_PERIOD",
  },
  {
    key: "wrong_identity",
    title: "Wrong customer identity",
    description: "After registration, the source subscription reports a different customer.",
    try_next: "Review the identity mismatch; recovery stays blocked.",
    seed: { customer_label: "Pinecrest Legal", period_end_offset_days: 9, customer_changed_after_registration: true, agent_name: "Ava Chen (Support Agent)", report_text: REPORT },
  },
  {
    key: "expired_approval",
    title: "Expired approval window",
    description: "The schedule is missing. Use the control to end the proposal's validity window.",
    try_next: "Expire the proposal, then confirm that approval is refused.",
    seed: { customer_label: "Quayside Books", period_end_offset_days: 11, agent_name: "Kai Park (Support Agent)", report_text: REPORT },
    control: "EXPIRE_PROPOSAL",
  },
  {
    key: "write_pause",
    title: "Recovery writes paused",
    description: "The schedule is missing and workspace writes are paused.",
    try_next: "Approve the proposal and see dispatch held until writes resume in Settings.",
    seed: { customer_label: "Summit Robotics", period_end_offset_days: 8, agent_name: "Riley Khan (Support Agent)", report_text: REPORT },
    workspace_effect: "PAUSE_WRITES",
  },
  {
    key: "competing_recovery",
    title: "Two competing recovery requests",
    description: "The schedule is missing. After approval, a second recovery job is queued for the same subscription.",
    try_next: "Approve, queue a competing recovery and confirm only one write is dispatched.",
    seed: { customer_label: "Tidewater Energy", period_end_offset_days: 13, agent_name: "Ava Chen (Support Agent)", report_text: REPORT },
    control: "QUEUE_COMPETING_RECOVERY",
  },
];

/** The six scenarios populated in every new demo workspace and local seed. */
export const STARTER_SCENARIOS: ScenarioKey[] = [
  "missing_schedule",
  "already_scheduled",
  "source_unavailable",
  "period_changed",
  "ended_correctly",
  "unsupported_structure",
];

export function getScenario(key: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.key === key);
}
