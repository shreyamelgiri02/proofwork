import {
  AdapterConfigurationError,
  resolveAdapter,
  SandboxAdminClient,
  sandboxConfigured,
  stripeStatus,
  type BillingAdapter,
} from "@proofwork/adapters";
import { AppError, now, STARTER_SCENARIOS, getScenario, type AdapterKind } from "@proofwork/domain";
import { recordAudit } from "./audit";
import type { Sql } from "./client";
import type { ServiceContext } from "./context";
import type { ConnectionRow } from "./workspaces";

export function adapterFor(connection: ConnectionRow, ws: { id: string; kind: "PRIVATE" | "DEMO" }, purpose: "read" | "write"): BillingAdapter {
  try {
    return resolveAdapter({ adapter: connection.adapter, source_account_id: connection.source_account_id }, { workspaceId: ws.id, workspaceKind: ws.kind, purpose });
  } catch (err) {
    if (err instanceof AdapterConfigurationError) {
      if (err.code === "DEMO_EXTERNAL_ACCESS_BLOCKED") throw new AppError("DEMO_EXTERNAL_ACCESS_BLOCKED", err.message);
      if (err.code === "LIVE_MODE_BLOCKED") throw new AppError("LIVE_MODE_BLOCKED", err.message);
      throw new AppError("SOURCE_NOT_CONFIGURED", err.message);
    }
    throw err;
  }
}

/** Starter synthetic subscriptions for a private local sandbox account (no requests, no verdicts). */
export const STARTER_SUBSCRIPTION_NUMBERS: Record<string, number> = {
  unsupported_structure: 1043,
  ended_correctly: 1044,
  period_changed: 1045,
  source_unavailable: 1046,
  already_scheduled: 1047,
  missing_schedule: 1048,
};

export async function seedStarterSubscriptions(admin: SandboxAdminClient, accountId: string, idPrefix: "demo" | "sbx") {
  const base = now();
  for (const key of STARTER_SCENARIOS) {
    const scenario = getScenario(key)!;
    const n = STARTER_SUBSCRIPTION_NUMBERS[key];
    const seed = scenario.seed;
    const periodEnd = new Date(base.getTime() + seed.period_end_offset_days * 86_400_000);
    periodEnd.setUTCMilliseconds(0);
    const ended = seed.status === "canceled" ? new Date(periodEnd.getTime() + (seed.ended_offset_seconds ?? 0) * 1000) : null;
    try {
      await admin.seedSubscription(accountId, {
        subscription_id: `sub_${idPrefix}_${n}`,
        customer_id: `cus_${idPrefix}_${n}`,
        customer_label: seed.customer_label,
        scenario_key: key,
        period_end: periodEnd.toISOString(),
        status: seed.status ?? "active",
        cancel_at_period_end: seed.cancel_at_period_end ?? false,
        ended_at: ended ? ended.toISOString() : null,
        canceled_at: seed.status === "canceled" ? new Date(periodEnd.getTime() - 5 * 86_400_000).toISOString() : null,
        item_count: seed.item_count ?? 1,
        // Period changes are applied after registration by fixtures; starter records stay consistent.
        read_fault: seed.read_fault ?? "NONE",
        write_fault: seed.write_fault ?? "NONE",
      });
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("subscription_exists"))) throw err;
    }
  }
}

/** Create/refresh the workspace's local sandbox connection and validate it through the read API. */
export async function configureLocalSandbox(sql: Sql, ctx: ServiceContext, opts: { seedStarter: boolean }): Promise<ConnectionRow> {
  if (!sandboxConfigured()) throw new AppError("SOURCE_NOT_CONFIGURED", "The local billing sandbox is not configured on this server (SANDBOX_API_URL / SANDBOX_READ_TOKEN).");
  const admin = SandboxAdminClient.fromEnv();
  if (!admin) throw new AppError("SOURCE_NOT_CONFIGURED", "The local billing sandbox admin credential is not configured.");
  let accountId: string;
  try {
    const account = await admin.ensureAccount({
      owner_reference: `workspace:${ctx.workspace.id}`,
      label: ctx.workspace.kind === "DEMO" ? "Demo synthetic billing" : "Local synthetic billing",
      kind: ctx.workspace.kind,
    });
    accountId = account.id;
    if (opts.seedStarter) await seedStarterSubscriptions(admin, accountId, ctx.workspace.kind === "DEMO" ? "demo" : "sbx");
  } catch {
    throw new AppError("SOURCE_UNAVAILABLE", "The local billing sandbox is not reachable. Start it with `npm run dev:sandbox`.");
  }

  const [connection] = await sql<ConnectionRow[]>`
    insert into app.connections (workspace_id, adapter, environment, source_account_id, display_name, binding_method, health)
    values (${ctx.workspace.id}, 'LOCAL_SANDBOX', 'SYNTHETIC_SANDBOX', ${accountId}, 'Local billing sandbox', 'SANDBOX_ACCOUNT_PROVISIONED', 'NOT_CHECKED')
    on conflict (workspace_id, adapter) do update set
      source_account_id = excluded.source_account_id,
      config_version = case when app.connections.source_account_id is distinct from excluded.source_account_id then app.connections.config_version + 1 else app.connections.config_version end
    returning *
  `;
  return checkConnection(sql, ctx, connection.id);
}

/** Validate a connection by actually reading account identity from the source. */
export async function checkConnection(sql: Sql, ctx: ServiceContext, connectionId: string): Promise<ConnectionRow> {
  const [connection] = await sql<ConnectionRow[]>`select * from app.connections where workspace_id = ${ctx.workspace.id} and id = ${connectionId}`;
  if (!connection) throw new AppError("NOT_FOUND", "Connection not found.");
  let adapter: BillingAdapter;
  try {
    adapter = adapterFor(connection, ctx.workspace, "read");
  } catch (err) {
    const code = err instanceof AppError ? err.code : "SOURCE_NOT_CONFIGURED";
    const [updated] = await sql<ConnectionRow[]>`
      update app.connections set health = 'NOT_CHECKED', last_error_code = ${code}, last_checked_at = now()
      where id = ${connection.id} returning *
    `;
    return updated;
  }
  const result = await adapter.validateConnection();
  const [updated] = await sql<ConnectionRow[]>`
    update app.connections set
      health = ${result.ok ? "CONNECTED" : result.error_code === "SOURCE_UNAVAILABLE" ? "DISCONNECTED" : "ERROR"},
      source_account_id = ${result.ok ? result.source_account_id : connection.source_account_id},
      display_name = ${result.ok && connection.adapter === "STRIPE_TEST" ? `Stripe test mode · ${result.display_name}` : connection.display_name},
      last_error_code = ${result.ok ? null : result.error_code},
      last_checked_at = now(),
      last_successful_read_at = ${result.ok ? new Date(result.checked_at) : connection.last_successful_read_at},
      api_version = ${connection.adapter === "STRIPE_TEST" ? process.env.STRIPE_API_VERSION || "2026-08-26.dahlia" : null}
    where id = ${connection.id}
    returning *
  `;
  await recordAudit(sql, {
    workspaceId: ctx.workspace.id,
    actor: ctx.actor,
    eventType: "connection.checked",
    summary: result.ok ? `${updated.display_name}: connected (account ${result.source_account_id}).` : `${updated.display_name}: ${result.error_code}.`,
    correlationId: ctx.correlationId,
    after: { health: updated.health, error: result.ok ? null : result.error_code },
  });
  return updated;
}

/** Stripe test mode connection: only after server-side configuration AND account validation. */
export async function configureStripeTest(sql: Sql, ctx: ServiceContext): Promise<ConnectionRow> {
  if (ctx.workspace.kind === "DEMO") throw new AppError("DEMO_EXTERNAL_ACCESS_BLOCKED", "Demo workspaces cannot use Stripe.");
  const status = stripeStatus();
  if (!status.configured) throw new AppError("SOURCE_NOT_CONFIGURED", status.reason ?? "Stripe test mode is not configured.");
  if (status.boundWorkspaceId !== ctx.workspace.id) {
    throw new AppError("PERMISSION_DENIED", "This deployment's Stripe test credential is bound to a different workspace.");
  }
  const [connection] = await sql<ConnectionRow[]>`
    insert into app.connections (workspace_id, adapter, environment, source_account_id, display_name, binding_method, health)
    values (${ctx.workspace.id}, 'STRIPE_TEST', 'STRIPE_TEST_MODE', null, 'Stripe test mode', 'ACCOUNT_READ_VALIDATION', 'NOT_CHECKED')
    on conflict (workspace_id, adapter) do update set config_version = app.connections.config_version
    returning *
  `;
  return checkConnection(sql, ctx, connection.id);
}

export async function activateConnection(sql: Sql, ctx: ServiceContext, adapter: AdapterKind): Promise<ConnectionRow> {
  return sql.begin(async (tx) => {
    const [target] = await tx<ConnectionRow[]>`select * from app.connections where workspace_id = ${ctx.workspace.id} and adapter = ${adapter} for update`;
    if (!target) throw new AppError("NOT_FOUND", "Configure this evidence source first.");
    if (target.health !== "CONNECTED") {
      throw new AppError("SOURCE_UNAVAILABLE", "The evidence source must be validated as connected before it can be selected.");
    }
    const [previous] = await tx<ConnectionRow[]>`select * from app.connections where workspace_id = ${ctx.workspace.id} and is_active`;
    if (previous?.id === target.id) return target;
    await tx`update app.connections set is_active = false where workspace_id = ${ctx.workspace.id} and is_active`;
    const [activated] = await tx<ConnectionRow[]>`update app.connections set is_active = true where id = ${target.id} returning *`;
    await recordAudit(tx as unknown as Sql, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "connection.configured",
      summary: `Evidence source set to ${activated.display_name}.`,
      correlationId: ctx.correlationId,
      before: previous ? { adapter: previous.adapter } : null,
      after: { adapter: activated.adapter, account: activated.source_account_id },
    });
    return activated;
  }) as Promise<ConnectionRow>;
}

export async function listConnections(sql: Sql, ctx: ServiceContext) {
  const rows = await sql<ConnectionRow[]>`select * from app.connections where workspace_id = ${ctx.workspace.id} order by adapter`;
  const stripe = stripeStatus();
  return {
    connections: rows,
    local_sandbox: { configured: sandboxConfigured() },
    stripe: {
      configured: stripe.configured && ctx.workspace.kind === "PRIVATE" && stripe.boundWorkspaceId === ctx.workspace.id,
      reason:
        ctx.workspace.kind === "DEMO"
          ? "Demo workspaces cannot use external billing sources."
          : stripe.configured && stripe.boundWorkspaceId !== ctx.workspace.id
            ? "The Stripe test credential on this deployment is bound to a different workspace."
            : stripe.reason,
      api_version: process.env.STRIPE_API_VERSION || "2026-08-26.dahlia",
    },
  };
}
