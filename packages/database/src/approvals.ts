import type { Sql } from "./client";
import type { ServiceContext } from "./context";

export type ApprovalFilter = "waiting" | "decided" | "all";

export async function listApprovals(sql: Sql, ctx: ServiceContext, filter: ApprovalFilter = "waiting") {
  const waitingCond = sql`p.status = 'AWAITING_APPROVAL' and p.expires_at > now()`;
  const decidedCond = sql`a.id is not null`;
  const [counts] = await sql<{ waiting: number; decided: number; all: number }[]>`
    select
      count(*) filter (where p.status = 'AWAITING_APPROVAL' and p.expires_at > now())::int as waiting,
      count(*) filter (where a.id is not null and a.decision <> 'AUTO_POLICY')::int as decided,
      count(*) filter (where (p.status = 'AWAITING_APPROVAL' and p.expires_at > now()) or (a.id is not null and a.decision <> 'AUTO_POLICY'))::int as "all"
    from app.recovery_proposals p left join app.approval_decisions a on a.proposal_id = p.id
    where p.workspace_id = ${ctx.workspace.id}
  `;
  const rows = await sql`
    select p.id, p.task_id, p.status, p.status_reason, p.diff, p.expires_at, p.created_at, p.policy_version, p.policy_mode,
      p.proposal_hash, p.subscription_id, p.customer_id, p.source_account_id, p.expected_period_end,
      r.customer_label, r.source_reference, r.version as request_version, t.agent_name, t.verdict, t.primary_reason_code,
      o.observed_at, o.provider_request_id, c.display_name as source_label, c.adapter,
      a.decision, a.actor_label as decided_by, a.reason as decision_reason, a.created_at as decided_at,
      op.state as operation_state, op.attribution as operation_attribution
    from app.recovery_proposals p
    join app.tasks t on t.workspace_id = p.workspace_id and t.id = p.task_id
    join app.authorized_requests r on r.workspace_id = p.workspace_id and r.id = p.request_id
    join app.observations o on o.workspace_id = p.workspace_id and o.id = p.observation_id
    join app.connections c on c.workspace_id = p.workspace_id and c.id = p.connection_id
    left join app.approval_decisions a on a.proposal_id = p.id
    left join app.recovery_operations op on op.proposal_id = p.id
    where p.workspace_id = ${ctx.workspace.id}
      and ${
        filter === "waiting"
          ? waitingCond
          : filter === "decided"
            ? sql`${decidedCond} and a.decision <> 'AUTO_POLICY'`
            : sql`((p.status = 'AWAITING_APPROVAL' and p.expires_at > now()) or (a.id is not null and a.decision <> 'AUTO_POLICY'))`
      }
    order by case when p.status = 'AWAITING_APPROVAL' then 0 else 1 end, p.created_at desc
    limit 50
  `;
  return { filter, counts, items: rows };
}
