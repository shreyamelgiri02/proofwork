import type { InterventionKind } from "@proofwork/domain";
import { json, type Sql } from "./client";
import type { Actor } from "./context";

export interface AuditInput {
  workspaceId: string;
  actor: Actor;
  eventType: string;
  summary: string;
  correlationId: string;
  taskId?: string | null;
  requestId?: string | null;
  proposalId?: string | null;
  operationId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  policyVersion?: number | null;
  evaluatorVersion?: string | null;
  reasonCode?: string | null;
}

const SECRET_KEYS = /token|secret|password|authorization|api_key|key_hash/i;

/** Strip secrets from before/after values before they are stored or exported. */
export function redact(values: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!values) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (SECRET_KEYS.test(k)) out[k] = "[redacted]";
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

export async function recordAudit(sql: Sql, e: AuditInput): Promise<void> {
  await sql`
    insert into app.audit_events (
      workspace_id, task_id, request_id, proposal_id, operation_id, actor_type, actor_id, actor_label,
      event_type, summary, before_values, after_values, policy_version, evaluator_version, reason_code, correlation_id
    ) values (
      ${e.workspaceId}, ${e.taskId ?? null}, ${e.requestId ?? null}, ${e.proposalId ?? null}, ${e.operationId ?? null},
      ${e.actor.type}, ${e.actor.id}, ${e.actor.label}, ${e.eventType}, ${e.summary.slice(0, 500)},
      ${e.before ? json(sql, redact(e.before)) : null}, ${e.after ? json(sql, redact(e.after)) : null},
      ${e.policyVersion ?? null}, ${e.evaluatorVersion ?? null}, ${e.reasonCode ?? null}, ${e.correlationId}
    )
  `;
}

/**
 * Record a human intervention in the canonical ledger. The dedupe key prevents a
 * retried command from counting twice. Returns true when a new row was written.
 */
export async function recordIntervention(
  sql: Sql,
  input: { workspaceId: string; taskId: string; kind: InterventionKind; actor: Actor; dedupeKey: string; correlationId: string; note?: string | null },
): Promise<boolean> {
  const rows = await sql`
    insert into app.interventions (workspace_id, task_id, kind, actor_id, actor_label, note, dedupe_key, correlation_id)
    values (${input.workspaceId}, ${input.taskId}, ${input.kind}, ${input.actor.id}, ${input.actor.label}, ${input.note ?? null}, ${input.dedupeKey}, ${input.correlationId})
    on conflict (workspace_id, dedupe_key) do nothing
    returning id
  `;
  if (rows.length) {
    await sql`
      update app.tasks set human_intervention_count = human_intervention_count + 1
      where workspace_id = ${input.workspaceId} and id = ${input.taskId}
    `;
    return true;
  }
  return false;
}
