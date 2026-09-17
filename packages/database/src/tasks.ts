import { AppError, GATE_COPY, LIMITS, type GateDecision, type InterventionKind, type ReviewLabel, type Verdict } from "@proofwork/domain";
import { recordAudit, recordIntervention } from "./audit";
import type { Sql } from "./client";
import type { ServiceContext } from "./context";
import { cancelPendingTaskJobs, enqueueJob } from "./jobs";

export const TASK_STATUS_FILTERS = {
  all: null,
  needs_action: "MISMATCH",
  scheduled: "SATISFIED_SCHEDULED",
  completed: "SATISFIED_ENDED",
  could_not_verify: "UNVERIFIABLE",
  outside_scope: "OUT_OF_SCOPE",
  waiting: "PENDING",
} as const satisfies Record<string, Verdict | null>;
export type TaskStatusFilter = keyof typeof TASK_STATUS_FILTERS;

export const COHORT_RANGES = { "7d": 7, "30d": 30, "90d": 90, all: null } as const;
export type CohortRange = keyof typeof COHORT_RANGES;

export interface TaskListParams {
  status?: string;
  q?: string;
  range?: string;
  page?: number;
}

/** Cohort meaning: tasks whose claim was ACCEPTED (task created) within the range. */
function cohortStart(range: CohortRange): Date | null {
  const days = COHORT_RANGES[range];
  return days ? new Date(Date.now() - days * 86_400_000) : null;
}

export async function listTasks(sql: Sql, ctx: ServiceContext, params: TaskListParams) {
  const status = (params.status && params.status in TASK_STATUS_FILTERS ? params.status : "all") as TaskStatusFilter;
  const range = (params.range && params.range in COHORT_RANGES ? params.range : "30d") as CohortRange;
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const q = (params.q ?? "").trim().slice(0, 100);
  const since = cohortStart(range);
  const verdict = TASK_STATUS_FILTERS[status];
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

  const cohort = sql`
    t.workspace_id = ${ctx.workspace.id}
    ${since ? sql`and t.created_at >= ${since}` : sql``}
    ${q ? sql`and (r.customer_label ilike ${like} or r.subscription_id ilike ${like} or r.customer_id ilike ${like} or t.agent_name ilike ${like} or r.id::text = ${q} or t.id::text = ${q} or r.source_reference ilike ${like})` : sql``}
  `;

  const [counts] = await sql<{ total: number; pending: number; scheduled: number; ended: number; mismatch: number; unverifiable: number; out_of_scope: number }[]>`
    select count(*)::int as total,
      count(*) filter (where t.verdict = 'PENDING')::int as pending,
      count(*) filter (where t.verdict = 'SATISFIED_SCHEDULED')::int as scheduled,
      count(*) filter (where t.verdict = 'SATISFIED_ENDED')::int as ended,
      count(*) filter (where t.verdict = 'MISMATCH')::int as mismatch,
      count(*) filter (where t.verdict = 'UNVERIFIABLE')::int as unverifiable,
      count(*) filter (where t.verdict = 'OUT_OF_SCOPE')::int as out_of_scope
    from app.tasks t join app.authorized_requests r on r.workspace_id = t.workspace_id and r.id = t.request_id
    where ${cohort}
  `;

  const offset = (page - 1) * LIMITS.PAGE_SIZE;
  const rows = await sql`
    select t.id, t.verdict, t.primary_reason_code, t.processing_state, t.recovery_state, t.gate_decision, t.agent_name,
      t.last_checked_at, t.last_trustworthy_read_at, t.next_check_at, t.created_at, t.retired_at,
      r.id as request_id, r.customer_label, r.customer_id, r.subscription_id, r.expected_period_end, r.status as request_status,
      (select p.id from app.recovery_proposals p where p.workspace_id = t.workspace_id and p.task_id = t.id and p.status = 'AWAITING_APPROVAL' and p.expires_at > now() limit 1) as awaiting_proposal_id,
      (t.last_trustworthy_read_at is null or t.last_trustworthy_read_at < now() - make_interval(secs => ${LIMITS.STALE_EVIDENCE_SECONDS})) as evidence_stale
    from app.tasks t join app.authorized_requests r on r.workspace_id = t.workspace_id and r.id = t.request_id
    where ${cohort} ${verdict ? sql`and t.verdict = ${verdict}` : sql``}
    order by t.created_at desc, t.id desc
    limit ${LIMITS.PAGE_SIZE} offset ${offset}
  `;

  const [priority] = await sql`
    select t.id, t.verdict, t.primary_reason_code, t.processing_state, t.recovery_state, t.gate_decision, t.agent_name, t.last_checked_at,
      r.customer_label, r.subscription_id, r.expected_period_end,
      exists (select 1 from app.claim_receipts c where c.workspace_id = t.workspace_id and c.task_id = t.id) as has_claim
    from app.tasks t join app.authorized_requests r on r.workspace_id = t.workspace_id and r.id = t.request_id
    where ${cohort} and t.retired_at is null and t.verdict in ('MISMATCH', 'UNVERIFIABLE')
    order by case when t.recovery_state = 'AWAITING_APPROVAL' then 0 when t.verdict = 'MISMATCH' then 1 else 2 end, t.created_at desc
    limit 1
  `;

  const filteredTotal = verdict
    ? { PENDING: counts.pending, SATISFIED_SCHEDULED: counts.scheduled, SATISFIED_ENDED: counts.ended, MISMATCH: counts.mismatch, UNVERIFIABLE: counts.unverifiable, OUT_OF_SCOPE: counts.out_of_scope }[verdict]
    : counts.total;

  return {
    filters: { status, range, q, page },
    cohort_definition: "Tasks whose agent report was accepted within the selected range. Counts use the same cohort and search.",
    counts,
    page: { number: page, size: LIMITS.PAGE_SIZE, total: filteredTotal, pages: Math.max(1, Math.ceil(filteredTotal / LIMITS.PAGE_SIZE)) },
    priority: priority ?? null,
    items: rows,
  };
}

export async function getTaskDetail(sql: Sql, ctx: ServiceContext, taskId: string) {
  const [task] = await sql`
    select t.*, t.processing_version::text as processing_version,
      (t.last_trustworthy_read_at is null or t.last_trustworthy_read_at < now() - make_interval(secs => ${LIMITS.STALE_EVIDENCE_SECONDS})) as evidence_stale
    from app.tasks t where t.workspace_id = ${ctx.workspace.id} and t.id = ${taskId}
  `;
  // Same response for missing and inaccessible resources.
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");

  const [request] = await sql`select * from app.authorized_requests where workspace_id = ${ctx.workspace.id} and id = ${task.request_id}`;
  const [connection] = await sql`
    select id, adapter, environment, source_account_id, display_name, health, last_successful_read_at, config_version
    from app.connections where workspace_id = ${ctx.workspace.id} and id = ${request.connection_id}
  `;
  const [receipts, decisions, proposals, operations, events, interventions, reviews, policy, pendingJob] = await Promise.all([
    sql`
      select id, agent_name, agent_reference, report_text, source_kind, producer_identity, payload_hash, idempotency_key, claimed_at, received_at
      from app.claim_receipts where workspace_id = ${ctx.workspace.id} and task_id = ${taskId} order by received_at asc
    `,
    sql`
      select d.id, d.verdict, d.reason_codes, d.comparison, d.facts, d.recovery_candidate, d.gate_decision, d.trigger, d.trustworthy,
        d.evaluator_version, d.policy_version, d.request_version, d.evaluated_at,
        o.id as observation_id, o.result_type, o.error_code, o.http_status, o.snapshot, o.material_fingerprint, o.snapshot_hash,
        o.provider_request_id, o.observed_at, o.adapter, o.environment
      from app.decisions d join app.observations o on o.workspace_id = d.workspace_id and o.id = d.observation_id
      where d.workspace_id = ${ctx.workspace.id} and d.task_id = ${taskId}
      order by d.evaluated_at desc limit 25
    `,
    sql`
      select p.id, p.status, p.status_reason, p.diff, p.expires_at, p.created_at, p.policy_version, p.policy_mode, p.proposal_hash, p.source_fingerprint,
        a.decision, a.actor_label as decided_by, a.reason as decision_reason, a.created_at as decided_at
      from app.recovery_proposals p left join app.approval_decisions a on a.proposal_id = p.id
      where p.workspace_id = ${ctx.workspace.id} and p.task_id = ${taskId}
      order by p.created_at desc limit 10
    `,
    sql`
      select id, proposal_id, state, outcome_certainty, attribution, dispatch_count, max_dispatches, idempotency_key, authorized_until,
        first_dispatched_at, last_provider_request_id, last_error_code, resolved_at, resolution_reason, escalated_at, created_at,
        (select coalesce(json_agg(json_build_object('event_type', e.event_type, 'from_state', e.from_state, 'to_state', e.to_state, 'occurred_at', e.occurred_at) order by e.occurred_at), '[]'::json)
           from app.operation_events e where e.workspace_id = o.workspace_id and e.operation_id = o.id) as events
      from app.recovery_operations o where o.workspace_id = ${ctx.workspace.id} and o.task_id = ${taskId}
      order by created_at desc
    `,
    sql`
      select id, event_type, summary, actor_type, actor_label, reason_code, policy_version, evaluator_version, correlation_id, occurred_at, proposal_id, operation_id
      from app.audit_events where workspace_id = ${ctx.workspace.id} and (task_id = ${taskId} or request_id = ${task.request_id})
      order by occurred_at desc, id desc limit 100
    `,
    sql`select id, kind, actor_label, note, occurred_at from app.interventions where workspace_id = ${ctx.workspace.id} and task_id = ${taskId} order by occurred_at desc`,
    sql`
      select cr.id, cr.decision_id, cr.label, cr.evidence_basis, cr.reviewer_label, cr.created_at
      from app.correctness_reviews cr join app.decisions d on d.workspace_id = cr.workspace_id and d.id = cr.decision_id
      where cr.workspace_id = ${ctx.workspace.id} and d.task_id = ${taskId} order by cr.created_at desc
    `,
    sql`
      select p.version, p.mode from app.policy_versions p join app.workspaces w on w.id = p.workspace_id and w.current_policy_version = p.version
      where p.workspace_id = ${ctx.workspace.id}
    `,
    sql`
      select id, kind, status, due_at from app.jobs
      where workspace_id = ${ctx.workspace.id} and task_id = ${taskId} and status in ('READY', 'LEASED')
      order by due_at asc limit 1
    `,
  ]);

  const latest = decisions[0] ?? null;
  const latestTrustworthy = decisions.find((d) => d.trustworthy) ?? null;
  const liveProposal = proposals.find((p) => ["AWAITING_APPROVAL", "AUTHORIZED", "BLOCKED", "PROPOSED"].includes(p.status)) ?? null;
  const unresolvedOperation = operations.find((o) => !o.resolved_at) ?? null;
  const gate = task.gate_decision as GateDecision | null;

  let blockedReason: string | null = null;
  if (task.retired_at) blockedReason = "Monitoring stopped for this task. Its verdict and history are preserved.";
  else if (unresolvedOperation) blockedReason = "An earlier recovery operation is still being reconciled. No new write will be issued until it is resolved.";
  else if (gate && !["EXECUTION_ALLOWED", "APPROVAL_REQUIRED", "ALREADY_SATISFIED"].includes(gate) && task.verdict === "MISMATCH") blockedReason = GATE_COPY[gate];

  return {
    task,
    request,
    connection,
    policy: policy[0] ?? null,
    receipts,
    latest_decision: latest,
    latest_trustworthy_decision: latestTrustworthy,
    decisions,
    proposals,
    live_proposal: liveProposal,
    operations,
    unresolved_operation: unresolvedOperation,
    events,
    interventions,
    reviews,
    pending_job: pendingJob[0] ?? null,
    allowed_actions: {
      check_now: !task.retired_at,
      review_proposal: liveProposal?.status === "AWAITING_APPROVAL" && new Date(liveProposal.expires_at).getTime() > Date.now(),
      retire: !task.retired_at,
      record_intervention: true,
      add_review: Boolean(latest),
      blocked_reason: blockedReason,
    },
  };
}

export async function requestRecheck(sql: Sql, ctx: ServiceContext, taskId: string) {
  return sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [task] = await tx<{ id: string; retired_at: Date | null }[]>`select id, retired_at from app.tasks where workspace_id = ${ctx.workspace.id} and id = ${taskId} for update`;
    if (!task) throw new AppError("NOT_FOUND", "Task not found.");
    if (task.retired_at) throw new AppError("CONFLICT", "Monitoring stopped for this task.");
    const job = await enqueueJob(tx, {
      kind: "RECHECK",
      workspaceId: ctx.workspace.id,
      taskId,
      dedupeKey: `verify:${taskId}`,
      payload: { trigger: "MANUAL" },
      correlationId: ctx.correlationId,
      priority: 35,
    });
    if (job.deduplicated) {
      // One outstanding equivalent read per task: move it forward instead of adding another.
      await tx`update app.jobs set due_at = least(due_at, now()), payload = payload || '{"trigger":"MANUAL"}'::jsonb where id = ${job.id} and status = 'READY'`;
      return { job_id: job.id, deduplicated: true, message: "A check is already queued for this task." };
    }
    await tx`update app.tasks set processing_state = 'QUEUED', read_retry_count = 0 where id = ${taskId}`;
    await recordIntervention(tx, { workspaceId: ctx.workspace.id, taskId, kind: "MANUAL_VERIFY", actor: ctx.actor, dedupeKey: `manual-verify:${job.id}`, correlationId: ctx.correlationId });
    await recordAudit(tx, { workspaceId: ctx.workspace.id, actor: ctx.actor, eventType: "verification.requested", summary: "Operator requested a fresh source check.", correlationId: ctx.correlationId, taskId });
    return { job_id: job.id, deduplicated: false, message: "Check queued. The result will come from a new source read." };
  });
}

export async function retireTask(sql: Sql, ctx: ServiceContext, taskId: string, reason: string) {
  return sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [task] = await tx<{ id: string }[]>`
      update app.tasks set retired_at = now(), retired_by = ${ctx.actor.id}, retirement_reason = ${reason},
        monitoring_ended_at = coalesce(monitoring_ended_at, now()), next_check_at = null,
        processing_state = case when exists (select 1 from app.recovery_operations o where o.task_id = app.tasks.id and o.resolved_at is null) then 'RECOVERING' else 'IDLE' end
      where workspace_id = ${ctx.workspace.id} and id = ${taskId} and retired_at is null
      returning id
    `;
    if (!task) throw new AppError("CONFLICT", "The task was not found or monitoring already stopped.");
    // Stop routine monitoring and new writes. Reconciliation of possibly dispatched operations continues.
    await cancelPendingTaskJobs(tx, ctx.workspace.id, taskId, ["VERIFY", "RECHECK", "MONITOR", "RECOVER"]);
    await tx`
      update app.recovery_proposals set status = 'SUPERSEDED', status_reason = 'TASK_RETIRED'
      where workspace_id = ${ctx.workspace.id} and task_id = ${taskId} and status in ('PROPOSED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'BLOCKED')
    `;
    await recordIntervention(tx, { workspaceId: ctx.workspace.id, taskId, kind: "TASK_RETIRED", actor: ctx.actor, dedupeKey: `retire:${taskId}`, correlationId: ctx.correlationId, note: reason });
    await recordAudit(tx, { workspaceId: ctx.workspace.id, actor: ctx.actor, eventType: "task.retired", summary: `Monitoring stopped: ${reason}`, correlationId: ctx.correlationId, taskId });
    return { retired: true };
  });
}

export async function recordManualIntervention(sql: Sql, ctx: ServiceContext, taskId: string, input: { kind: InterventionKind; note: string }) {
  const [task] = await sql`select id from app.tasks where workspace_id = ${ctx.workspace.id} and id = ${taskId}`;
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    await recordIntervention(tx, { workspaceId: ctx.workspace.id, taskId, kind: input.kind, actor: ctx.actor, dedupeKey: `${input.kind.toLowerCase()}:${ctx.correlationId}`, correlationId: ctx.correlationId, note: input.note });
    await recordAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "task.intervention_recorded",
      summary: `${input.kind.replaceAll("_", " ").toLowerCase()}: ${input.note}`,
      correlationId: ctx.correlationId,
      taskId,
    });
  });
  return { recorded: true };
}

export async function addCorrectnessReview(sql: Sql, ctx: ServiceContext, taskId: string, input: { decision_id: string; label: ReviewLabel; evidence_basis: string }) {
  const [decision] = await sql`select id from app.decisions where workspace_id = ${ctx.workspace.id} and task_id = ${taskId} and id = ${input.decision_id}`;
  if (!decision) throw new AppError("NOT_FOUND", "Decision not found for this task.");
  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    await tx`
      insert into app.correctness_reviews (workspace_id, decision_id, reviewer_id, reviewer_label, label, evidence_basis)
      values (${ctx.workspace.id}, ${input.decision_id}, ${ctx.actor.id}, ${ctx.actor.label}, ${input.label}, ${input.evidence_basis})
    `;
    await recordAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "review.label_added",
      summary: `Correctness review: ${input.label.replaceAll("_", " ").toLowerCase()}.`,
      correlationId: ctx.correlationId,
      taskId,
    });
  });
  return { recorded: true };
}

/** Status for the external agent (ingestion token scope): never claims more than persisted state. */
export async function getTaskStatusForAgent(sql: Sql, workspaceId: string, taskId: string) {
  const [row] = await sql`
    select t.id as task_id, t.verdict, t.primary_reason_code, t.processing_state, t.recovery_state, t.last_checked_at, t.created_at
    from app.tasks t where t.workspace_id = ${workspaceId} and t.id = ${taskId}
  `;
  if (!row) throw new AppError("NOT_FOUND", "Task not found.");
  return row;
}
