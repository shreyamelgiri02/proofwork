import { randomUUID } from "node:crypto";
import { AppError, LIMITS, now, toEpochSeconds, type NormalizedSubscription, type SourceRead } from "@proofwork/domain";
import { recordAudit, recordIntervention } from "./audit";
import { json, type Sql } from "./client";
import { adapterFor } from "./connections";
import type { ServiceContext } from "./context";
import { materialFingerprint, randomToken, sha256 } from "./crypto";
import { getActiveConnection, type ConnectionRow } from "./workspaces";

export interface AuthorizedRequestRow {
  id: string;
  workspace_id: string;
  request_group_id: string;
  version: number;
  contract_id: string;
  connection_id: string;
  adapter: "LOCAL_SANDBOX" | "STRIPE_TEST";
  connection_config_version: number;
  source_account_id: string;
  customer_id: string;
  subscription_id: string;
  customer_label: string | null;
  source_reference: string;
  authorization_kind: "OPERATOR_CONFIRMED" | "DEMO_FIXTURE";
  authorized_by: string;
  authorized_by_label: string;
  authorized_at: Date;
  expected_period_end: Date;
  boundary_observation: Record<string, unknown>;
  status: "ACTIVE" | "SUPERSEDED" | "RETIRED";
  status_changed_at: Date | null;
  status_reason: string | null;
  created_at: Date;
}

export async function requireActiveConnection(sql: Sql, ctx: ServiceContext): Promise<ConnectionRow> {
  const connection = await getActiveConnection(sql, ctx.workspace.id);
  if (!connection) throw new AppError("ONBOARDING_INCOMPLETE", "Select an evidence source before registering requests.");
  return connection;
}

/** Limited subscription listing for authorized UI selection. */
export async function listSourceSubscriptions(sql: Sql, ctx: ServiceContext) {
  const connection = await requireActiveConnection(sql, ctx);
  const adapter = adapterFor(connection, ctx.workspace, "read");
  const result = await adapter.listSubscriptions(100);
  if (!result.ok) {
    throw new AppError(result.error_code === "SOURCE_ACCESS_DENIED" ? "SOURCE_NOT_CONFIGURED" : "SOURCE_UNAVAILABLE", result.message);
  }
  const existing = await sql<{ subscription_id: string; id: string }[]>`
    select subscription_id, id from app.authorized_requests
    where workspace_id = ${ctx.workspace.id} and connection_id = ${connection.id} and status = 'ACTIVE'
  `;
  const active = new Map(existing.map((r) => [r.subscription_id, r.id]));
  return {
    connection: { id: connection.id, adapter: connection.adapter, display_name: connection.display_name },
    observed_at: result.observed_at,
    items: result.items.map((i) => ({ ...i, active_request_id: active.get(i.subscription_id) ?? null })),
  };
}

function assertRegistrable(read: SourceRead): asserts read is Extract<SourceRead, { ok: true }> {
  if (!read.ok) {
    const map: Record<string, string> = {
      SOURCE_NOT_FOUND: "The subscription was not found at the evidence source.",
      SOURCE_ACCESS_DENIED: "The evidence source denied access.",
      LIVE_MODE_BLOCKED: "Live-mode billing resources are rejected.",
    };
    throw new AppError(read.error_code === "LIVE_MODE_BLOCKED" ? "LIVE_MODE_BLOCKED" : "SOURCE_UNAVAILABLE", map[read.error_code] ?? "The evidence source could not be read. Try again shortly.");
  }
  const s = read.snapshot;
  if (s.status !== "active") {
    throw new AppError("UNSUPPORTED_WORKFLOW", "Only an active subscription can be registered. A new request cannot authorize a cancellation retroactively.");
  }
  if (!s.current_period_end) throw new AppError("UNSUPPORTED_WORKFLOW", "The source did not report a single current paid-period end for this subscription.");
  if (toEpochSeconds(s.current_period_end) <= toEpochSeconds(now()) + LIMITS.RECOVERY_CUTOFF_SECONDS) {
    throw new AppError("UNSUPPORTED_WORKFLOW", "The current paid period ends too soon to register a period-end cancellation.");
  }
}

/** Step 1: read the source and bind a short-lived, one-use preview token to it. */
export async function previewRequest(
  sql: Sql,
  ctx: ServiceContext,
  input: { subscription_id: string; source_reference: string; supersedes_request_id?: string },
) {
  const connection = await requireActiveConnection(sql, ctx);
  if (input.supersedes_request_id) {
    const [prior] = await sql<AuthorizedRequestRow[]>`
      select * from app.authorized_requests where workspace_id = ${ctx.workspace.id} and id = ${input.supersedes_request_id}
    `;
    if (!prior || prior.status !== "ACTIVE") throw new AppError("REQUEST_NOT_ACTIVE", "Only an active request can be corrected with a new version.");
    if (prior.subscription_id !== input.subscription_id) throw new AppError("INVALID_PAYLOAD", "A new version must reference the same subscription.");
  }
  const adapter = adapterFor(connection, ctx.workspace, "read");
  const read = await adapter.getSubscription(input.subscription_id);
  assertRegistrable(read);
  const snapshot = read.snapshot;
  if (snapshot.source_account_id !== connection.source_account_id) {
    throw new AppError("PERMISSION_DENIED", "The source returned a record outside the connected account.");
  }
  const token = randomToken(32);
  const expiresAt = new Date(now().getTime() + LIMITS.REGISTRATION_PREVIEW_TTL_SECONDS * 1000);
  const fingerprint = materialFingerprint(snapshot);
  await sql`
    insert into app.registration_previews (
      workspace_id, actor_id, connection_id, connection_config_version, source_account_id, customer_id, subscription_id,
      customer_label, source_reference, supersedes_request_id, expected_period_end, material_fingerprint, snapshot,
      observed_at, provider_request_id, token_hash, expires_at
    ) values (
      ${ctx.workspace.id}, ${ctx.actor.id}, ${connection.id}, ${connection.config_version}, ${snapshot.source_account_id},
      ${snapshot.customer_id}, ${snapshot.subscription_id}, ${snapshot.customer_label}, ${input.source_reference},
      ${input.supersedes_request_id ?? null}, ${new Date(snapshot.current_period_end!)}, ${fingerprint}, ${json(sql, snapshot)},
      ${new Date(read.observed_at)}, ${read.provider_request_id}, ${sha256(token)}, ${expiresAt}
    )
  `;
  await sql`update app.connections set last_successful_read_at = ${new Date(read.observed_at)}, health = 'CONNECTED' where id = ${connection.id}`;
  return {
    preview_token: token,
    expires_at: expiresAt.toISOString(),
    expected_period_end: snapshot.current_period_end,
    customer_id: snapshot.customer_id,
    customer_label: snapshot.customer_label,
    subscription_id: snapshot.subscription_id,
    source_account_id: snapshot.source_account_id,
    source_label: connection.display_name,
    adapter: connection.adapter,
    observed_at: read.observed_at,
    provider_request_id: read.provider_request_id,
    cancel_at_period_end: snapshot.cancel_at_period_end,
    supported_shape: snapshot.item_count === 1 && snapshot.items_complete,
  };
}

interface PreviewRow {
  id: string;
  actor_id: string;
  connection_id: string;
  connection_config_version: number;
  source_account_id: string;
  customer_id: string;
  subscription_id: string;
  customer_label: string | null;
  source_reference: string;
  supersedes_request_id: string | null;
  expected_period_end: Date;
  material_fingerprint: string;
  snapshot: NormalizedSubscription;
  observed_at: Date;
  provider_request_id: string | null;
  expires_at: Date;
  consumed_at: Date | null;
}

/**
 * Step 2: confirm. The server re-reads the source; a material change requires a
 * fresh preview. The client cannot supply the date, customer or subscription.
 */
export async function confirmRequest(sql: Sql, ctx: ServiceContext, input: { preview_token: string }): Promise<AuthorizedRequestRow> {
  const tokenHash = sha256(input.preview_token);
  const [preview] = await sql<PreviewRow[]>`
    select * from app.registration_previews where workspace_id = ${ctx.workspace.id} and token_hash = ${tokenHash}
  `;
  if (!preview || preview.actor_id !== ctx.actor.id) throw new AppError("NOT_FOUND", "This preview is not available. Preview the end date again.");
  if (preview.consumed_at) throw new AppError("PREVIEW_EXPIRED", "This preview was already used.");
  if (preview.expires_at.getTime() <= now().getTime()) throw new AppError("PREVIEW_EXPIRED", "This preview expired. Preview the end date again.");

  const connection = await requireActiveConnection(sql, ctx);
  if (connection.id !== preview.connection_id || connection.config_version !== preview.connection_config_version) {
    throw new AppError("PREVIEW_STALE", "The evidence source changed. Preview the end date again.");
  }
  const adapter = adapterFor(connection, ctx.workspace, "read");
  const fresh = await adapter.getSubscription(preview.subscription_id);
  assertRegistrable(fresh);
  if (materialFingerprint(fresh.snapshot) !== preview.material_fingerprint) {
    throw new AppError("PREVIEW_STALE", "The subscription changed since the preview. Review the new end date before confirming.");
  }

  return sql.begin(async (tx) => {
    const consumed = await tx`
      update app.registration_previews set consumed_at = now()
      where id = ${preview.id} and consumed_at is null and expires_at > now()
      returning id
    `;
    if (!consumed.length) throw new AppError("PREVIEW_EXPIRED", "This preview was already used or expired.");
    return insertAuthorizedRequest(tx as unknown as Sql, ctx, {
      connection,
      snapshot: fresh.snapshot,
      observedAt: fresh.observed_at,
      providerRequestId: fresh.provider_request_id,
      sourceReference: preview.source_reference,
      supersedesRequestId: preview.supersedes_request_id,
      authorizationKind: "OPERATOR_CONFIRMED",
      authorizedAt: now(),
    });
  }) as Promise<AuthorizedRequestRow>;
}

/** Shared insert used by operator confirmation and server-owned demo fixtures. */
export async function insertAuthorizedRequest(
  sql: Sql,
  ctx: ServiceContext,
  input: {
    connection: ConnectionRow;
    snapshot: NormalizedSubscription;
    observedAt: string;
    providerRequestId: string | null;
    sourceReference: string;
    supersedesRequestId: string | null;
    authorizationKind: "OPERATOR_CONFIRMED" | "DEMO_FIXTURE";
    authorizedAt: Date;
  },
): Promise<AuthorizedRequestRow> {
  const s = input.snapshot;
  let groupId: string = randomUUID();
  let version = 1;
  if (input.supersedesRequestId) {
    const [prior] = await sql<AuthorizedRequestRow[]>`
      select * from app.authorized_requests where workspace_id = ${ctx.workspace.id} and id = ${input.supersedesRequestId} for update
    `;
    if (!prior || prior.status !== "ACTIVE") throw new AppError("REQUEST_NOT_ACTIVE", "The request being corrected is no longer active.");
    groupId = prior.request_group_id;
    version = prior.version + 1;
    await sql`
      update app.authorized_requests set status = 'SUPERSEDED', status_changed_at = now(), status_reason = 'Corrected by a new version'
      where id = ${prior.id}
    `;
    const [priorTask] = await sql<{ id: string }[]>`select id from app.tasks where workspace_id = ${ctx.workspace.id} and request_id = ${prior.id}`;
    if (priorTask) {
      // Stop new writes against the superseded version; unresolved operations still reconcile.
      await sql`
        update app.recovery_proposals set status = 'SUPERSEDED', status_reason = 'REQUEST_SUPERSEDED'
        where workspace_id = ${ctx.workspace.id} and task_id = ${priorTask.id} and status in ('PROPOSED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'BLOCKED')
      `;
      await recordIntervention(sql, {
        workspaceId: ctx.workspace.id,
        taskId: priorTask.id,
        kind: "REQUEST_SUPERSEDED",
        actor: ctx.actor,
        dedupeKey: `supersede:${prior.id}`,
        correlationId: ctx.correlationId,
      });
    }
    await recordAudit(sql, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "request.superseded",
      summary: `Request version ${prior.version} superseded by version ${version}.`,
      correlationId: ctx.correlationId,
      requestId: prior.id,
      taskId: priorTask?.id ?? null,
    });
  }
  const [row] = await sql<AuthorizedRequestRow[]>`
    insert into app.authorized_requests (
      workspace_id, request_group_id, version, connection_id, adapter, connection_config_version, source_account_id,
      customer_id, subscription_id, customer_label, source_reference, authorization_kind, authorized_by, authorized_by_label,
      authorized_at, expected_period_end, boundary_observation
    ) values (
      ${ctx.workspace.id}, ${groupId}, ${version}, ${input.connection.id}, ${input.connection.adapter}, ${input.connection.config_version},
      ${s.source_account_id}, ${s.customer_id}, ${s.subscription_id}, ${s.customer_label}, ${input.sourceReference},
      ${input.authorizationKind}, ${ctx.actor.id}, ${ctx.actor.label}, ${input.authorizedAt}, ${new Date(s.current_period_end!)},
      ${json(sql, { snapshot: s, material_fingerprint: materialFingerprint(s), observed_at: input.observedAt, provider_request_id: input.providerRequestId })}
    )
    returning *
  `;
  if (input.supersedesRequestId) {
    await sql`update app.authorized_requests set superseded_by = ${row.id} where id = ${input.supersedesRequestId}`;
  }
  await recordAudit(sql, {
    workspaceId: ctx.workspace.id,
    actor: ctx.actor,
    eventType: "request.registered",
    summary: `${s.customer_label ?? s.customer_id}: cancel at period end ${new Date(s.current_period_end!).toISOString()} authorized (${input.authorizationKind === "DEMO_FIXTURE" ? "demo fixture" : "operator confirmed"}).`,
    correlationId: ctx.correlationId,
    requestId: row.id,
    after: {
      subscription_id: s.subscription_id,
      customer_id: s.customer_id,
      expected_period_end: s.current_period_end,
      source_reference: input.sourceReference,
      version,
    },
  });
  return row;
}

export async function listAuthorizedRequests(sql: Sql, ctx: ServiceContext, opts: { status?: "ACTIVE" | "ALL" } = {}) {
  return sql<(AuthorizedRequestRow & { task_id: string | null; task_verdict: string | null })[]>`
    select r.*, t.id as task_id, t.verdict as task_verdict
    from app.authorized_requests r
    left join app.tasks t on t.workspace_id = r.workspace_id and t.request_id = r.id
    where r.workspace_id = ${ctx.workspace.id}
      ${opts.status === "ALL" ? sql`` : sql`and r.status = 'ACTIVE'`}
    order by r.created_at desc
    limit 200
  `;
}

export async function retireRequest(sql: Sql, ctx: ServiceContext, requestId: string, reason: string) {
  return sql.begin(async (tx) => {
    const [req] = await tx<AuthorizedRequestRow[]>`
      update app.authorized_requests set status = 'RETIRED', status_changed_at = now(), status_reason = ${reason}
      where workspace_id = ${ctx.workspace.id} and id = ${requestId} and status = 'ACTIVE'
      returning *
    `;
    if (!req) throw new AppError("REQUEST_NOT_ACTIVE", "The request is not active.");
    const [task] = await tx<{ id: string }[]>`select id from app.tasks where workspace_id = ${ctx.workspace.id} and request_id = ${req.id}`;
    if (task) {
      await tx`
        update app.recovery_proposals set status = 'SUPERSEDED', status_reason = 'REQUEST_RETIRED'
        where workspace_id = ${ctx.workspace.id} and task_id = ${task.id} and status in ('PROPOSED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'BLOCKED')
      `;
      await recordIntervention(tx as unknown as Sql, {
        workspaceId: ctx.workspace.id,
        taskId: task.id,
        kind: "REQUEST_RETIRED",
        actor: ctx.actor,
        dedupeKey: `retire-request:${req.id}`,
        correlationId: ctx.correlationId,
        note: reason,
      });
    }
    await recordAudit(tx as unknown as Sql, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "request.retired",
      summary: `Request retired: ${reason}`,
      correlationId: ctx.correlationId,
      requestId: req.id,
      taskId: task?.id ?? null,
    });
    return req;
  });
}
