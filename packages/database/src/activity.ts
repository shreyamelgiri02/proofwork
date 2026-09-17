import { auditLabel, LIMITS } from "@proofwork/domain";
import type { Sql } from "./client";
import type { ServiceContext } from "./context";

export interface ActivityParams {
  type?: string;
  actor?: string;
  q?: string;
  from?: string;
  to?: string;
  range?: string;
  page?: number;
  taskId?: string;
}

export const ACTIVITY_TYPE_GROUPS: Record<string, { label: string; prefixes: string[] }> = {
  all: { label: "All events", prefixes: [] },
  claims: { label: "Claims", prefixes: ["claim."] },
  verification: { label: "Verification", prefixes: ["verification.", "job."] },
  recovery: { label: "Recovery", prefixes: ["recovery."] },
  requests: { label: "Requests", prefixes: ["request."] },
  settings: { label: "Settings & access", prefixes: ["policy.", "workspace.", "connection.", "token.", "onboarding."] },
  reviews: { label: "Human reviews", prefixes: ["review.", "task."] },
  demo: { label: "Demo controls", prefixes: ["demo."] },
};

function resolveWindow(params: ActivityParams): { from: Date | null; to: Date | null } {
  const to = params.to && !Number.isNaN(Date.parse(params.to)) ? new Date(params.to) : null;
  if (params.from && !Number.isNaN(Date.parse(params.from))) return { from: new Date(params.from), to };
  const days = params.range === "24h" ? 1 : params.range === "30d" ? 30 : params.range === "90d" ? 90 : params.range === "all" ? null : 7;
  return { from: days ? new Date(Date.now() - days * 86_400_000) : null, to };
}

function filters(sql: Sql, ctx: ServiceContext, params: ActivityParams) {
  const { from, to } = resolveWindow(params);
  const group = ACTIVITY_TYPE_GROUPS[params.type ?? "all"] ?? ACTIVITY_TYPE_GROUPS.all;
  const q = (params.q ?? "").trim().slice(0, 100);
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const actor = (params.actor ?? "").trim();
  return sql`
    e.workspace_id = ${ctx.workspace.id}
    ${from ? sql`and e.occurred_at >= ${from}` : sql``}
    ${to ? sql`and e.occurred_at < ${to}` : sql``}
    ${group.prefixes.length ? sql`and (${group.prefixes.slice(1).reduce((acc, p) => sql`${acc} or e.event_type like ${`${p}%`}`, sql`e.event_type like ${`${group.prefixes[0]}%`}`)})` : sql``}
    ${actor === "people" ? sql`and e.actor_type in ('USER', 'DEMO_OPERATOR')` : actor === "automation" ? sql`and e.actor_type in ('WORKER', 'SYSTEM')` : actor === "agents" ? sql`and e.actor_type = 'AGENT'` : sql``}
    ${params.taskId ? sql`and e.task_id = ${params.taskId}` : sql``}
    ${q ? sql`and (e.summary ilike ${like} or e.event_type ilike ${like} or e.actor_label ilike ${like} or r.customer_label ilike ${like} or r.subscription_id ilike ${like} or e.task_id::text = ${q} or e.correlation_id = ${q})` : sql``}
  `;
}

export async function listActivity(sql: Sql, ctx: ServiceContext, params: ActivityParams) {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const where = filters(sql, ctx, params);
  const [count] = await sql<{ total: number }[]>`
    select count(*)::int as total from app.audit_events e
    left join app.tasks t on t.workspace_id = e.workspace_id and t.id = e.task_id
    left join app.authorized_requests r on r.workspace_id = e.workspace_id and r.id = coalesce(e.request_id, t.request_id)
    where ${where}
  `;
  const rows = await sql`
    select e.id, e.event_type, e.summary, e.actor_type, e.actor_label, e.task_id, e.proposal_id, e.operation_id, e.request_id,
      e.reason_code, e.policy_version, e.evaluator_version, e.correlation_id, e.occurred_at,
      r.customer_label, r.subscription_id
    from app.audit_events e
    left join app.tasks t on t.workspace_id = e.workspace_id and t.id = e.task_id
    left join app.authorized_requests r on r.workspace_id = e.workspace_id and r.id = coalesce(e.request_id, t.request_id)
    where ${where}
    order by e.occurred_at desc, e.id desc
    limit ${LIMITS.PAGE_SIZE * 2} offset ${(page - 1) * LIMITS.PAGE_SIZE * 2}
  `;
  return {
    page: { number: page, size: LIMITS.PAGE_SIZE * 2, total: count.total, pages: Math.max(1, Math.ceil(count.total / (LIMITS.PAGE_SIZE * 2))) },
    items: rows.map((r) => ({ ...r, label: auditLabel(r.event_type as string).label, tone: auditLabel(r.event_type as string).tone })),
    groups: Object.entries(ACTIVITY_TYPE_GROUPS).map(([key, g]) => ({ key, label: g.label })),
  };
}

/** Neutralize spreadsheet formula injection and quote every CSV cell. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function* exportActivityCsv(sql: Sql, ctx: ServiceContext, params: ActivityParams): AsyncGenerator<string> {
  const where = filters(sql, ctx, params);
  yield ["occurred_at_utc", "event_type", "event", "actor_type", "actor", "summary", "customer", "subscription_id", "task_id", "proposal_id", "operation_id", "reason_code", "policy_version", "evaluator_version", "correlation_id"].map(csvCell).join(",") + "\r\n";
  const cursor = sql`
    select e.occurred_at, e.event_type, e.actor_type, e.actor_label, e.summary, r.customer_label, r.subscription_id, e.task_id, e.proposal_id,
      e.operation_id, e.reason_code, e.policy_version, e.evaluator_version, e.correlation_id
    from app.audit_events e
    left join app.tasks t on t.workspace_id = e.workspace_id and t.id = e.task_id
    left join app.authorized_requests r on r.workspace_id = e.workspace_id and r.id = coalesce(e.request_id, t.request_id)
    where ${where}
    order by e.occurred_at desc, e.id desc
    limit 50000
  `.cursor(500);
  for await (const batch of cursor) {
    let chunk = "";
    for (const r of batch) {
      chunk +=
        [r.occurred_at, r.event_type, auditLabel(r.event_type as string).label, r.actor_type, r.actor_label, r.summary, r.customer_label, r.subscription_id, r.task_id, r.proposal_id, r.operation_id, r.reason_code, r.policy_version, r.evaluator_version, r.correlation_id]
          .map(csvCell)
          .join(",") + "\r\n";
    }
    yield chunk;
  }
}
