import type { Sql } from "./client";
import type { ServiceContext } from "./context";
import { COHORT_RANGES, type CohortRange } from "./tasks";

/**
 * Honest outcome metrics. All values are server-side aggregates over persisted
 * records for ONE workspace (demo and private cohorts never mix), with explicit
 * denominators. See METRICS.md for definitions.
 */
export async function getInsights(sql: Sql, ctx: ServiceContext, params: { range?: string }) {
  const range = (params.range && params.range in COHORT_RANGES ? params.range : "30d") as CohortRange;
  const days = COHORT_RANGES[range];
  const since = days ? new Date(Date.now() - days * 86_400_000) : null;
  const cohort = sql`t.workspace_id = ${ctx.workspace.id} ${since ? sql`and t.created_at >= ${since}` : sql``}`;

  const [outcomes] = await sql<{
    total: number;
    pending: number;
    scheduled: number;
    ended: number;
    mismatch: number;
    unverifiable: number;
    out_of_scope: number;
    autonomous_verified: number;
    with_intervention: number;
    intervention_events: number;
    evidence_available: number;
    retired: number;
    stale: number;
  }[]>`
    with cohort as (
      select t.id, t.verdict, t.created_at, t.retired_at, t.last_trustworthy_read_at, r.status as request_status,
        exists (select 1 from app.interventions h where h.workspace_id = t.workspace_id and h.task_id = t.id and h.occurred_at >= t.created_at) as had_intervention,
        (select count(*) from app.interventions h where h.workspace_id = t.workspace_id and h.task_id = t.id and h.occurred_at >= t.created_at) as intervention_count
      from app.tasks t join app.authorized_requests r on r.workspace_id = t.workspace_id and r.id = t.request_id
      where ${cohort}
    )
    select count(*)::int as total,
      count(*) filter (where verdict = 'PENDING')::int as pending,
      count(*) filter (where verdict = 'SATISFIED_SCHEDULED')::int as scheduled,
      count(*) filter (where verdict = 'SATISFIED_ENDED')::int as ended,
      count(*) filter (where verdict = 'MISMATCH')::int as mismatch,
      count(*) filter (where verdict = 'UNVERIFIABLE')::int as unverifiable,
      count(*) filter (where verdict = 'OUT_OF_SCOPE')::int as out_of_scope,
      count(*) filter (where verdict in ('SATISFIED_SCHEDULED', 'SATISFIED_ENDED') and request_status = 'ACTIVE' and not had_intervention)::int as autonomous_verified,
      count(*) filter (where had_intervention)::int as with_intervention,
      coalesce(sum(intervention_count), 0)::int as intervention_events,
      count(*) filter (where last_trustworthy_read_at is not null)::int as evidence_available,
      count(*) filter (where retired_at is not null)::int as retired,
      count(*) filter (where last_trustworthy_read_at is not null and last_trustworthy_read_at < now() - interval '24 hours' and verdict = 'SATISFIED_SCHEDULED')::int as stale
    from cohort
  `;

  const [recovery] = await sql<{
    attempted_tasks: number;
    verified_by_proofwork: number;
    verified_human_approved: number;
    verified_auto_policy: number;
    resolved_externally: number;
    failed_confirmed: number;
    unresolved: number;
    blocked_before_dispatch: number;
  }[]>`
    select
      count(distinct o.task_id) filter (where o.dispatch_count > 0)::int as attempted_tasks,
      count(distinct o.task_id) filter (where o.state = 'VERIFIED' and o.attribution = 'PROOFWORK')::int as verified_by_proofwork,
      count(distinct o.task_id) filter (where o.state = 'VERIFIED' and o.attribution = 'PROOFWORK' and a.decision = 'APPROVE')::int as verified_human_approved,
      count(distinct o.task_id) filter (where o.state = 'VERIFIED' and o.attribution = 'PROOFWORK' and a.decision = 'AUTO_POLICY')::int as verified_auto_policy,
      count(distinct o.task_id) filter (where o.state = 'RESOLVED_EXTERNALLY')::int as resolved_externally,
      count(distinct o.task_id) filter (where o.state = 'FAILED_CONFIRMED')::int as failed_confirmed,
      count(*) filter (where o.resolved_at is null)::int as unresolved,
      count(*) filter (where o.state = 'BLOCKED')::int as blocked_before_dispatch
    from app.recovery_operations o
    join app.tasks t on t.workspace_id = o.workspace_id and t.id = o.task_id
    left join app.approval_decisions a on a.id = o.approval_decision_id
    where ${cohort}
  `;

  const [pendingWork] = await sql<{ awaiting_approval: number; queued_jobs: number; dead_jobs: number }[]>`
    select
      (select count(*)::int from app.recovery_proposals p join app.tasks t on t.workspace_id = p.workspace_id and t.id = p.task_id
        where ${cohort} and p.status = 'AWAITING_APPROVAL' and p.expires_at > now()) as awaiting_approval,
      (select count(*)::int from app.jobs j join app.tasks t on t.workspace_id = j.workspace_id and t.id = j.task_id
        where ${cohort} and j.status in ('READY', 'LEASED')) as queued_jobs,
      (select count(*)::int from app.jobs j join app.tasks t on t.workspace_id = j.workspace_id and t.id = j.task_id
        where ${cohort} and j.status = 'DEAD') as dead_jobs
  `;

  // Adjudicated correctness: latest review label per satisfied decision in the cohort.
  const [correctness] = await sql<{
    eligible_decisions: number;
    reviewed: number;
    correct: number;
    incorrect: number;
    insufficient: number;
    first_review_at: Date | null;
    last_review_at: Date | null;
    reviewers: string[] | null;
  }[]>`
    with satisfied as (
      select d.id, d.workspace_id from app.decisions d
      join app.tasks t on t.workspace_id = d.workspace_id and t.id = d.task_id
      where ${cohort} and d.verdict in ('SATISFIED_SCHEDULED', 'SATISFIED_ENDED')
    ), labeled as (
      select s.id, latest.label, latest.created_at, latest.reviewer_label
      from satisfied s
      left join lateral (
        select cr.label, cr.created_at, cr.reviewer_label from app.correctness_reviews cr
        where cr.workspace_id = s.workspace_id and cr.decision_id = s.id
        order by cr.created_at desc, cr.id desc limit 1
      ) latest on true
    )
    select count(*)::int as eligible_decisions,
      count(*) filter (where label is not null)::int as reviewed,
      count(*) filter (where label = 'CORRECT')::int as correct,
      count(*) filter (where label = 'INCORRECT')::int as incorrect,
      count(*) filter (where label = 'INSUFFICIENT_EVIDENCE')::int as insufficient,
      min(created_at) as first_review_at, max(created_at) as last_review_at,
      array_remove(array_agg(distinct reviewer_label), null) as reviewers
    from labeled
  `;

  const conclusive = correctness.correct + correctness.incorrect;
  const satisfied = outcomes.scheduled + outcomes.ended;
  const eligibleDenominator = outcomes.total - outcomes.out_of_scope;

  return {
    calculated_at: new Date().toISOString(),
    workspace_kind: ctx.workspace.kind,
    cohort: {
      range,
      since: since?.toISOString() ?? null,
      definition: "Tasks whose agent report was accepted in the selected range; status as of the calculation time; one task per authorized request version.",
    },
    outcomes: { ...outcomes, satisfied },
    main_metric: {
      label: "Verified intended outcome without human intervention",
      numerator: outcomes.autonomous_verified,
      denominator: outcomes.total,
      definition:
        "Tasks whose latest verdict is Cancellation scheduled or Cancellation completed, with an active request and no recorded human intervention after the report was accepted, divided by all accepted tasks in the cohort. Unverifiable, unresolved and outside-scope tasks stay in the denominator.",
      exclusions:
        "Registering the customer request and submitting the initial report happen before acceptance and are excluded from the intervention window. Approvals, rejections, manual checks, retirement and recorded manual repairs disqualify a task. Source changes by unknown actors cannot be attributed.",
    },
    resolved_with_evidence: { numerator: satisfied, denominator: outcomes.total },
    eligible_rate: { numerator: satisfied, denominator: eligibleDenominator, definition: "Same numerator over tasks excluding Outside supported scope." },
    evidence_availability: { numerator: outcomes.evidence_available, denominator: outcomes.total },
    recovery,
    human_effort: { tasks_with_intervention: outcomes.with_intervention, intervention_events: outcomes.intervention_events },
    pending: { waiting: outcomes.pending, ...pendingWork, unresolved_operations: recovery.unresolved, retired: outcomes.retired, stale_monitoring: outcomes.stale },
    correctness: {
      measured: conclusive > 0,
      label: "Incorrectly accepted completions",
      numerator: correctness.incorrect,
      denominator: conclusive,
      eligible_decisions: correctness.eligible_decisions,
      reviewed: correctness.reviewed,
      insufficient_evidence: correctness.insufficient,
      coverage: { numerator: correctness.reviewed, denominator: correctness.eligible_decisions },
      review_period: { from: correctness.first_review_at, to: correctness.last_review_at },
      reviewers: correctness.reviewers ?? [],
      definition: "Latest adjudicated label per satisfied decision: incorrect / (correct + incorrect). Shown as Not measured until conclusive labels exist.",
    },
  };
}
