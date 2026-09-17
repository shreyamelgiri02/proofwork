import { randomUUID } from "node:crypto";
import { SandboxAdminClient, type SourceChange } from "@proofwork/adapters";
import { AppError, LIMITS, RETENTION, getScenario, now, STARTER_SCENARIOS, type ScenarioKey } from "@proofwork/domain";
import { recordAudit } from "./audit";
import { acceptClaim } from "./claims";
import type { Sql } from "./client";
import { adapterFor, configureLocalSandbox, STARTER_SUBSCRIPTION_NUMBERS } from "./connections";
import type { ServiceContext } from "./context";
import { randomToken, sha256 } from "./crypto";
import { enqueueJob } from "./jobs";
import { expireProposals } from "./recovery";
import { insertAuthorizedRequest } from "./requests";
import { createPolicyVersion, DEMO_ACTOR, getActiveConnection, setWritesPaused, type ConnectionRow } from "./workspaces";

function admin(): SandboxAdminClient {
  const client = SandboxAdminClient.fromEnv();
  if (!client) throw new AppError("SOURCE_NOT_CONFIGURED", "The local billing sandbox is not configured on this server.");
  return client;
}

/** Scenario controls exist only for demo workspaces, or private LOCAL_SANDBOX workspaces in development. */
export async function assertScenarioAccess(sql: Sql, ctx: ServiceContext): Promise<ConnectionRow> {
  const connection = await getActiveConnection(sql, ctx.workspace.id);
  if (!connection) throw new AppError("ONBOARDING_INCOMPLETE", "Select an evidence source first.");
  if (connection.adapter !== "LOCAL_SANDBOX") throw new AppError("PERMISSION_DENIED", "Scenario controls are never available for Stripe connections.");
  if (ctx.workspace.kind === "DEMO") return connection;
  if (process.env.PROOFWORK_ENABLE_DEV_SCENARIOS === "true" && process.env.NODE_ENV !== "production") return connection;
  throw new AppError("PERMISSION_DENIED", "Scenario controls are available only in the demo or in development.");
}

export function scenarioControlsEnabled(kind: "PRIVATE" | "DEMO", adapter: string | null | undefined): boolean {
  if (adapter !== "LOCAL_SANDBOX") return false;
  return kind === "DEMO" || (process.env.PROOFWORK_ENABLE_DEV_SCENARIOS === "true" && process.env.NODE_ENV !== "production");
}

/**
 * Create one synthetic scenario through the real path:
 * seed independent source → read it → register authorized request (DEMO_FIXTURE) →
 * apply post-registration source conditions → accept the agent's claim → worker decides.
 * No verdict, proposal or metric is ever inserted here.
 */
export async function createScenario(sql: Sql, ctx: ServiceContext, key: ScenarioKey, opts: { number?: number } = {}) {
  const scenario = getScenario(key);
  if (!scenario) throw new AppError("INVALID_PAYLOAD", "Unknown scenario.");
  const connection = await assertScenarioAccess(sql, ctx);
  const client = admin();
  const prefix = ctx.workspace.kind === "DEMO" ? "demo" : "sbx";

  const seed = scenario.seed;
  const base = now();
  base.setUTCMilliseconds(0);
  const periodEnd = new Date(base.getTime() + seed.period_end_offset_days * 86_400_000);
  const historical = seed.status === "canceled";

  let number = opts.number ?? STARTER_SUBSCRIPTION_NUMBERS[key];
  let subscriptionId = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!number || attempt > 0) number = 1049 + Math.floor(Math.random() * 8950);
    subscriptionId = `sub_${prefix}_${number}`;
    try {
      await client.seedSubscription(connection.source_account_id!, {
        subscription_id: subscriptionId,
        customer_id: `cus_${prefix}_${number}`,
        customer_label: seed.customer_label,
        scenario_key: key,
        period_end: periodEnd.toISOString(),
        status: seed.status ?? "active",
        cancel_at_period_end: seed.cancel_at_period_end ?? false,
        ended_at: historical ? new Date(periodEnd.getTime() + (seed.ended_offset_seconds ?? 0) * 1000).toISOString() : null,
        canceled_at: historical ? new Date(periodEnd.getTime() - 5 * 86_400_000).toISOString() : null,
        item_count: seed.item_count ?? 1,
        read_fault: "NONE",
        write_fault: seed.write_fault ?? "NONE",
      });
      break;
    } catch (err) {
      if (err instanceof Error && err.message.includes("subscription_exists") && attempt < 3) continue;
      if (err instanceof Error && err.message.startsWith("SANDBOX_UNREACHABLE")) {
        throw new AppError("SOURCE_UNAVAILABLE", "The local billing sandbox is not reachable. Start it with `npm run dev:sandbox`.");
      }
      throw err;
    }
  }

  // Establish the authorized boundary from an independent read of the source.
  const reader = adapterFor(connection, ctx.workspace, "read");
  const read = await reader.getSubscription(subscriptionId);
  if (!read.ok || !read.snapshot.current_period_end) {
    throw new AppError("SOURCE_UNAVAILABLE", "The synthetic source could not be read while creating the scenario.");
  }
  const request = await sql.begin(async (tx) =>
    insertAuthorizedRequest(tx as unknown as Sql, ctx, {
      connection,
      snapshot: read.snapshot,
      observedAt: read.observed_at,
      providerRequestId: read.provider_request_id,
      sourceReference: `support-ticket-${number}`,
      supersedesRequestId: null,
      authorizationKind: "DEMO_FIXTURE",
      // A historical fixture was authorized before its boundary; the ordinary form cannot do this.
      authorizedAt: historical ? new Date(periodEnd.getTime() - 5 * 86_400_000) : now(),
    }),
  );

  // Conditions that arise AFTER authorization.
  const postChanges: SourceChange[] = [];
  if (seed.source_period_shift_days) postChanges.push("SHIFT_PERIOD");
  if (seed.customer_changed_after_registration) postChanges.push("CHANGE_CUSTOMER");
  if (seed.read_fault === "UNAVAILABLE") postChanges.push("SOURCE_OUTAGE");
  for (const change of postChanges) await client.applyChange(connection.source_account_id!, subscriptionId, change);

  if (scenario.workspace_effect === "PAUSE_WRITES") {
    await setWritesPaused(sql, ctx, { paused: true, reason: `Scenario: ${scenario.title}` });
  }

  await recordAudit(sql, {
    workspaceId: ctx.workspace.id,
    actor: ctx.actor,
    eventType: "demo.scenario_created",
    summary: `Synthetic scenario created: ${scenario.title}.`,
    correlationId: ctx.correlationId,
    requestId: request.id,
  });

  const claim = await acceptClaim(
    sql,
    ctx,
    { authorized_request_id: request.id, agent_name: seed.agent_name, report_text: seed.report_text },
    { sourceKind: "DEMO", idempotencyKey: `fixture:${key}:${randomUUID()}` },
  );
  return { scenario: key, request_id: request.id, task_id: claim.task_id, subscription_id: subscriptionId };
}

/** Active subscriptions WITHOUT a registered request, so demo users can try Register request. */
async function seedUnregisteredSubscriptions(accountId: string) {
  const client = admin();
  const base = now();
  base.setUTCMilliseconds(0);
  for (const [n, label, days] of [[1050, "Linden Supply", 14], [1051, "Maple & Finch", 21]] as const) {
    await client
      .seedSubscription(accountId, {
        subscription_id: `sub_demo_${n}`,
        customer_id: `cus_demo_${n}`,
        customer_label: label,
        scenario_key: "unregistered",
        period_end: new Date(base.getTime() + days * 86_400_000).toISOString(),
        status: "active",
        cancel_at_period_end: false,
        ended_at: null,
        canceled_at: null,
        item_count: 1,
        read_fault: "NONE",
        write_fault: "NONE",
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error && err.message.includes("subscription_exists"))) throw err;
      });
  }
}

/** Create an isolated demo workspace and return the opaque session token for the signed cookie. */
export async function createDemoWorkspace(sql: Sql, correlationId: string) {
  const sessionToken = randomToken(32);
  const sessionHash = sha256(sessionToken);
  const ttl = Number(process.env.DEMO_SESSION_TTL_SECONDS ?? RETENTION.DEMO_SESSION_SECONDS);
  const purgeAfter = Number(process.env.DEMO_PURGE_AFTER_SECONDS ?? RETENTION.DEMO_PURGE_AFTER_SECONDS);
  const current = now();
  const [ws] = await sql<{ id: string }[]>`
    insert into app.workspaces (kind, organization, name, timezone, onboarding_step, onboarding_completed_at, demo_session_hash, expires_at, purge_after, retention_days)
    values ('DEMO', 'Demo organization', 'Customer operations', 'UTC', 3, now(), ${sessionHash},
            ${new Date(current.getTime() + ttl * 1000)}, ${new Date(current.getTime() + purgeAfter * 1000)}, 1)
    returning id
  `;
  const ctx: ServiceContext = { workspace: { id: ws.id, kind: "DEMO" }, actor: DEMO_ACTOR(ws.id), correlationId };
  try {
    await createPolicyVersion(sql, ctx, { mode: "REQUIRE_APPROVAL", reason: "Demo default" }, { allowDemo: true });
    await recordAudit(sql, { workspaceId: ws.id, actor: ctx.actor, eventType: "demo.created", summary: "Isolated demo workspace created with simulated billing data.", correlationId });
    const connection = await configureLocalSandbox(sql, ctx, { seedStarter: false });
    if (connection.health !== "CONNECTED") throw new AppError("SOURCE_UNAVAILABLE", "The local billing sandbox did not validate.");
    await sql`update app.connections set is_active = true where id = ${connection.id}`;
    for (const key of STARTER_SCENARIOS) await createScenario(sql, ctx, key);
    await seedUnregisteredSubscriptions(connection.source_account_id!);
  } catch (err) {
    await purgeWorkspace(sql, ws.id).catch(() => undefined);
    throw err;
  }
  return { workspaceId: ws.id, sessionToken };
}

/** Reset only this demo workspace's synthetic records, then recreate the starter scenarios. */
export async function resetDemo(sql: Sql, ctx: ServiceContext) {
  if (ctx.workspace.kind !== "DEMO") throw new AppError("PERMISSION_DENIED", "Reset is available only in the demo.");
  const connection = await assertScenarioAccess(sql, ctx);
  const [unresolved] = await sql`
    select 1 from app.recovery_operations where workspace_id = ${ctx.workspace.id} and resolved_at is null and dispatch_count > 0 limit 1
  `;
  if (unresolved) throw new AppError("OPERATION_ALREADY_PENDING", "A recovery write is still being reconciled. Try the reset again in a minute.");

  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    // Serialize against this workspace's worker commits and fence late workers.
    await tx`select id from app.workspaces where id = ${ctx.workspace.id} for update`;
    await tx`update app.jobs set status = 'CANCELED', last_error_code = 'DEMO_RESET', finished_at = now() where workspace_id = ${ctx.workspace.id} and status in ('READY', 'LEASED')`;
    await tx`select set_config('proofwork.purge', 'on', true)`;
    await tx`update app.tasks set latest_decision_id = null, latest_trustworthy_decision_id = null, processing_version = processing_version + 1000 where workspace_id = ${ctx.workspace.id}`;
    for (const table of ["interventions", "correctness_reviews", "operation_events", "recovery_operations", "approval_decisions", "recovery_proposals", "decisions", "observations", "claim_receipts", "jobs", "tasks", "registration_previews", "authorized_requests", "ingestion_rejections", "audit_events"]) {
      // Identifier comes from the fixed allowlist above; search_path is app,public.
      await tx`delete from ${tx(table)} where workspace_id = ${ctx.workspace.id}`;
    }
    await tx`update app.workspaces set writes_paused = false, writes_paused_reason = null, writes_paused_at = null where id = ${ctx.workspace.id}`;
  });
  await admin().resetAccount(connection.source_account_id!);
  await createPolicyVersion(sql, ctx, { mode: "REQUIRE_APPROVAL", reason: "Demo reset" }, { allowDemo: true });
  await recordAudit(sql, { workspaceId: ctx.workspace.id, actor: ctx.actor, eventType: "demo.reset", summary: "Demo reset. Only this demo workspace's synthetic records were replaced.", correlationId: ctx.correlationId });
  for (const key of STARTER_SCENARIOS) await createScenario(sql, ctx, key);
  await seedUnregisteredSubscriptions(connection.source_account_id!);
  return { reset: true };
}

/** Restricted synthetic source change (demo/development only). Proofwork is NOT told; it must re-read. */
export async function applySourceChange(sql: Sql, ctx: ServiceContext, taskId: string, change: SourceChange) {
  const connection = await assertScenarioAccess(sql, ctx);
  const [row] = await sql<{ subscription_id: string; connection_id: string; customer_label: string | null }[]>`
    select r.subscription_id, r.connection_id, r.customer_label from app.tasks t
    join app.authorized_requests r on r.workspace_id = t.workspace_id and r.id = t.request_id
    where t.workspace_id = ${ctx.workspace.id} and t.id = ${taskId}
  `;
  if (!row || row.connection_id !== connection.id) throw new AppError("NOT_FOUND", "Task not found.");
  try {
    await admin().applyChange(connection.source_account_id!, row.subscription_id, change);
  } catch {
    throw new AppError("SOURCE_UNAVAILABLE", "The synthetic source could not apply the change.");
  }
  await recordAudit(sql, {
    workspaceId: ctx.workspace.id,
    actor: ctx.actor,
    eventType: "demo.source_changed",
    summary: `Synthetic source changed outside Proofwork (${change.replaceAll("_", " ").toLowerCase()}) for ${row.customer_label ?? row.subscription_id}. Use Check now to read it.`,
    correlationId: ctx.correlationId,
    taskId,
  });
  return { applied: true };
}

/** Scenario control: end a live proposal's validity window now (demo/development only). */
export async function expireProposalNow(sql: Sql, ctx: ServiceContext, taskId: string) {
  await assertScenarioAccess(sql, ctx);
  const rows = await sql`
    update app.recovery_proposals set expires_at = now()
    where workspace_id = ${ctx.workspace.id} and task_id = ${taskId} and status in ('AWAITING_APPROVAL', 'AUTHORIZED', 'BLOCKED')
    returning id
  `;
  if (!rows.length) throw new AppError("NOT_FOUND", "No live proposal for this task.");
  await recordAudit(sql, { workspaceId: ctx.workspace.id, actor: ctx.actor, eventType: "demo.source_changed", summary: "Scenario control: approval window ended early.", correlationId: ctx.correlationId, taskId });
  await expireProposals(sql);
  return { expired: rows.length };
}

/** Scenario control: queue a second recovery job for the same subscription (competing recovery). */
export async function queueCompetingRecovery(sql: Sql, ctx: ServiceContext, taskId: string) {
  await assertScenarioAccess(sql, ctx);
  const [proposal] = await sql<{ id: string }[]>`
    select id from app.recovery_proposals where workspace_id = ${ctx.workspace.id} and task_id = ${taskId} and status in ('AUTHORIZED', 'CONSUMED')
    order by created_at desc limit 1
  `;
  if (!proposal) throw new AppError("CONFLICT", "Approve the recovery proposal first.");
  const job = await enqueueJob(sql, {
    kind: "RECOVER",
    workspaceId: ctx.workspace.id,
    taskId,
    dedupeKey: `recover-competing:${proposal.id}:${randomUUID()}`,
    payload: { proposal_id: proposal.id, competing: true },
    correlationId: ctx.correlationId,
  });
  await recordAudit(sql, { workspaceId: ctx.workspace.id, actor: ctx.actor, eventType: "demo.source_changed", summary: "Scenario control: a competing recovery job was queued for the same subscription.", correlationId: ctx.correlationId, taskId, proposalId: proposal.id });
  return { job_id: job.id };
}

/** Delete one workspace and its synthetic source account. Refuses while a possibly sent write is unresolved. */
export async function purgeWorkspace(sql: Sql, workspaceId: string) {
  const [connection] = await sql<{ source_account_id: string | null }[]>`select source_account_id from app.connections where workspace_id = ${workspaceId} and adapter = 'LOCAL_SANDBOX'`;
  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    await tx`select set_config('proofwork.purge', 'on', true)`;
    await tx`update app.tasks set latest_decision_id = null, latest_trustworthy_decision_id = null where workspace_id = ${workspaceId}`;
    await tx`delete from app.workspaces where id = ${workspaceId} and kind = 'DEMO'`;
  });
  if (connection?.source_account_id) {
    const client = SandboxAdminClient.fromEnv();
    await client?.deleteAccount(connection.source_account_id).catch(() => undefined);
  }
}

/** Documented retention job: purge demo data after its retention window; clean short-lived rows. */
export async function purgeExpiredDemos(sql: Sql): Promise<{ purged: number; skipped: number }> {
  const candidates = await sql<{ id: string; blocked: boolean }[]>`
    select w.id, exists (
      select 1 from app.recovery_operations o where o.workspace_id = w.id and o.resolved_at is null and o.dispatch_count > 0
    ) as blocked
    from app.workspaces w where w.kind = 'DEMO' and w.purge_after < now()
    limit 50
  `;
  let purged = 0;
  let skipped = 0;
  for (const c of candidates) {
    if (c.blocked) {
      skipped++;
      continue;
    }
    await purgeWorkspace(sql, c.id);
    purged++;
  }
  await sql`delete from app.registration_previews where expires_at < now() - interval '1 day'`;
  await sql`delete from app.rate_limits where window_start < now() - interval '1 day'`;
  return { purged, skipped };
}

export const DEMO_LIMITS = { commandsPerMinute: LIMITS.DEMO_COMMANDS_PER_MINUTE };
