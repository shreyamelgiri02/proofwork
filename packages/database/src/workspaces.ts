import {
  AppError,
  LIMITS,
  POLICY_LABELS,
  type AdapterKind,
  type ConnectionHealth,
  type PolicyMode,
  type WorkspaceKind,
} from "@proofwork/domain";
import { recordAudit } from "./audit";
import type { Sql } from "./client";
import type { Actor, ServiceContext } from "./context";
import { enqueueJob } from "./jobs";

export interface WorkspaceRow {
  id: string;
  kind: WorkspaceKind;
  owner_user_id: string | null;
  organization: string;
  name: string;
  timezone: string;
  onboarding_step: number;
  onboarding_completed_at: Date | null;
  writes_paused: boolean;
  writes_paused_reason: string | null;
  writes_paused_at: Date | null;
  current_policy_version: number | null;
  expires_at: Date | null;
  purge_after: Date | null;
  created_at: Date;
}

export interface PolicyRow {
  workspace_id: string;
  version: number;
  mode: PolicyMode;
  approval_ttl_seconds: number;
  recovery_cutoff_seconds: number;
  freshness_budget_seconds: number;
  changed_by_label: string;
  change_reason: string;
  created_at: Date;
}

export interface ConnectionRow {
  id: string;
  workspace_id: string;
  adapter: AdapterKind;
  environment: "SYNTHETIC_SANDBOX" | "STRIPE_TEST_MODE";
  source_account_id: string | null;
  display_name: string;
  is_active: boolean;
  health: ConnectionHealth;
  config_version: number;
  api_version: string | null;
  binding_method: string | null;
  last_checked_at: Date | null;
  last_successful_read_at: Date | null;
  last_error_code: string | null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export async function ensurePrivateWorkspace(
  sql: Sql,
  user: { id: string; email: string; fullName: string | null; organization: string | null },
  correlationId: string,
): Promise<WorkspaceRow> {
  return sql.begin(async (tx) => {
    const displayName = (user.fullName || user.email.split("@")[0] || "Owner").slice(0, 120);
    await tx`
      insert into app.profiles (user_id, display_name, email) values (${user.id}, ${displayName}, ${user.email})
      on conflict (user_id) do update set email = excluded.email
    `;
    const [existing] = await tx<WorkspaceRow[]>`
      select w.* from app.workspaces w
      join app.memberships m on m.workspace_id = w.id and m.user_id = ${user.id}
      where w.kind = 'PRIVATE' limit 1
    `;
    if (existing) return existing;
    const [ws] = await tx<WorkspaceRow[]>`
      insert into app.workspaces (kind, owner_user_id, organization, name, timezone, onboarding_step)
      values ('PRIVATE', ${user.id}, ${(user.organization ?? "").slice(0, 120)}, '', 'UTC', 0)
      on conflict (owner_user_id) where kind = 'PRIVATE' do nothing
      returning *
    `;
    const workspace = ws ?? (await tx<WorkspaceRow[]>`select * from app.workspaces where owner_user_id = ${user.id} and kind = 'PRIVATE'`)[0];
    await tx`
      insert into app.memberships (workspace_id, user_id, role) values (${workspace.id}, ${user.id}, 'OWNER')
      on conflict do nothing
    `;
    if (ws) {
      await recordAudit(tx as unknown as Sql, {
        workspaceId: workspace.id,
        actor: { type: "USER", id: `user:${user.id}`, label: displayName },
        eventType: "workspace.created",
        summary: "Private workspace created for the owner account.",
        correlationId,
      });
    }
    return workspace;
  }) as Promise<WorkspaceRow>;
}

export async function findPrivateWorkspaceForUser(sql: Sql, userId: string): Promise<WorkspaceRow | null> {
  const [row] = await sql<WorkspaceRow[]>`
    select w.* from app.workspaces w
    join app.memberships m on m.workspace_id = w.id and m.user_id = ${userId}
    where w.kind = 'PRIVATE' limit 1
  `;
  return row ?? null;
}

export async function findDemoWorkspace(sql: Sql, workspaceId: string, sessionHash: string): Promise<WorkspaceRow | null> {
  const [row] = await sql<WorkspaceRow[]>`
    select * from app.workspaces
    where id = ${workspaceId} and kind = 'DEMO' and demo_session_hash = ${sessionHash}
  `;
  return row ?? null;
}

export async function getProfile(sql: Sql, userId: string) {
  const [row] = await sql<{ display_name: string; email: string }[]>`select display_name, email from app.profiles where user_id = ${userId}`;
  return row ?? null;
}

export async function getCurrentPolicy(sql: Sql, workspaceId: string): Promise<PolicyRow | null> {
  const [row] = await sql<PolicyRow[]>`
    select p.* from app.policy_versions p
    join app.workspaces w on w.id = p.workspace_id and w.current_policy_version = p.version
    where p.workspace_id = ${workspaceId}
  `;
  return row ?? null;
}

export async function getActiveConnection(sql: Sql, workspaceId: string): Promise<ConnectionRow | null> {
  const [row] = await sql<ConnectionRow[]>`select * from app.connections where workspace_id = ${workspaceId} and is_active limit 1`;
  return row ?? null;
}

export async function getWorkspace(sql: Sql, workspaceId: string): Promise<WorkspaceRow> {
  const [row] = await sql<WorkspaceRow[]>`select * from app.workspaces where id = ${workspaceId}`;
  if (!row) throw new AppError("NOT_FOUND", "Workspace not found.");
  return row;
}

/** Everything the application shell needs, computed from persisted records. */
export async function getShellSummary(sql: Sql, workspaceId: string) {
  const [workspace, policy, connection, counts] = await Promise.all([
    getWorkspace(sql, workspaceId),
    getCurrentPolicy(sql, workspaceId),
    getActiveConnection(sql, workspaceId),
    sql<{ tasks: number; pending_approvals: number; needs_action: number }[]>`
      select
        (select count(*)::int from app.tasks where workspace_id = ${workspaceId}) as tasks,
        (select count(*)::int from app.recovery_proposals where workspace_id = ${workspaceId} and status = 'AWAITING_APPROVAL' and expires_at > now()) as pending_approvals,
        (select count(*)::int from app.tasks where workspace_id = ${workspaceId} and verdict = 'MISMATCH' and retired_at is null) as needs_action
    `,
  ]);
  return {
    workspace: {
      id: workspace.id,
      kind: workspace.kind,
      organization: workspace.organization,
      name: workspace.name,
      timezone: workspace.timezone,
      onboarding_step: workspace.onboarding_step,
      onboarded: workspace.onboarding_completed_at != null,
      writes_paused: workspace.writes_paused,
      expires_at: workspace.expires_at,
    },
    policy: policy ? { version: policy.version, mode: policy.mode, label: POLICY_LABELS[policy.mode].short } : null,
    connection: connection
      ? { id: connection.id, adapter: connection.adapter, health: connection.health, display_name: connection.display_name }
      : null,
    counts: counts[0],
  };
}

// ---------------------------------------------------------------------------
// Onboarding and settings
// ---------------------------------------------------------------------------

function requirePrivateOwner(ctx: ServiceContext) {
  if (ctx.workspace.kind !== "PRIVATE" || ctx.actor.type !== "USER") {
    throw new AppError("PERMISSION_DENIED", "Only the workspace owner can change this setting.");
  }
}

export async function saveWorkspaceProfile(
  sql: Sql,
  ctx: ServiceContext,
  input: { organization: string; name: string; timezone: string },
  opts: { onboarding?: boolean } = {},
) {
  if (ctx.workspace.kind === "DEMO") throw new AppError("PERMISSION_DENIED", "Demo workspace identity cannot be changed.");
  requirePrivateOwner(ctx);
  return sql.begin(async (tx) => {
    const [before] = await tx<WorkspaceRow[]>`select * from app.workspaces where id = ${ctx.workspace.id} for update`;
    const [after] = await tx<WorkspaceRow[]>`
      update app.workspaces
      set organization = ${input.organization}, name = ${input.name}, timezone = ${input.timezone},
          onboarding_step = case when ${opts.onboarding ?? false} then greatest(onboarding_step, 1) else onboarding_step end
      where id = ${ctx.workspace.id}
      returning *
    `;
    await recordAudit(tx as unknown as Sql, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "workspace.profile_updated",
      summary: "Workspace identity updated.",
      correlationId: ctx.correlationId,
      before: { organization: before.organization, name: before.name, timezone: before.timezone },
      after: { organization: after.organization, name: after.name, timezone: after.timezone },
    });
    return after;
  });
}

/**
 * Create an immutable policy version. Changing policy invalidates incompatible
 * active proposals and re-evaluates open mismatches under the new version.
 */
export async function createPolicyVersion(
  sql: Sql,
  ctx: ServiceContext,
  input: { mode: PolicyMode; reason?: string },
  opts: { onboarding?: boolean; allowDemo?: boolean } = {},
): Promise<PolicyRow> {
  if (ctx.workspace.kind === "DEMO" && !opts.allowDemo) {
    // Demo operators may change their own isolated demo policy; it never affects other workspaces.
  } else if (ctx.workspace.kind !== "DEMO") {
    requirePrivateOwner(ctx);
  }
  return sql.begin(async (tx) => {
    const [ws] = await tx<WorkspaceRow[]>`select * from app.workspaces where id = ${ctx.workspace.id} for update`;
    const [current] = ws.current_policy_version
      ? await tx<PolicyRow[]>`select * from app.policy_versions where workspace_id = ${ws.id} and version = ${ws.current_policy_version}`
      : [];
    if (current && current.mode === input.mode) {
      if (opts.onboarding) await tx`update app.workspaces set onboarding_step = greatest(onboarding_step, 2) where id = ${ws.id}`;
      return current;
    }
    const version = (current?.version ?? 0) + 1;
    const [policy] = await tx<PolicyRow[]>`
      insert into app.policy_versions (workspace_id, version, mode, approval_ttl_seconds, recovery_cutoff_seconds, freshness_budget_seconds, changed_by, changed_by_label, change_reason)
      values (${ws.id}, ${version}, ${input.mode}, ${LIMITS.APPROVAL_TTL_SECONDS}, ${LIMITS.RECOVERY_CUTOFF_SECONDS}, ${LIMITS.PRECHECK_MAX_AGE_SECONDS},
              ${ctx.actor.id}, ${ctx.actor.label}, ${(input.reason ?? "").slice(0, 200)})
      returning *
    `;
    await tx`
      update app.workspaces set current_policy_version = ${version},
        onboarding_step = case when ${opts.onboarding ?? false} then greatest(onboarding_step, 2) else onboarding_step end
      where id = ${ws.id}
    `;
    await recordAudit(tx as unknown as Sql, {
      workspaceId: ws.id,
      actor: ctx.actor,
      eventType: "policy.version_created",
      summary: `Recovery policy set to ${POLICY_LABELS[input.mode].label} (version ${version}).`,
      correlationId: ctx.correlationId,
      before: current ? { mode: current.mode, version: current.version } : null,
      after: { mode: input.mode, version },
      policyVersion: version,
    });
    if (current) {
      // Invalidate live proposals bound to the previous policy version.
      const superseded = await tx<{ id: string; task_id: string }[]>`
        update app.recovery_proposals set status = 'SUPERSEDED', status_reason = 'POLICY_CHANGED'
        where workspace_id = ${ws.id} and status in ('PROPOSED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'BLOCKED') and policy_version <> ${version}
        returning id, task_id
      `;
      for (const p of superseded) {
        await recordAudit(tx as unknown as Sql, {
          workspaceId: ws.id,
          actor: ctx.actor,
          eventType: "recovery.superseded",
          summary: "Proposal invalidated because the recovery policy changed.",
          correlationId: ctx.correlationId,
          taskId: p.task_id,
          proposalId: p.id,
          reasonCode: "POLICY_CHANGED",
          policyVersion: version,
        });
        await tx`update app.tasks set recovery_state = 'NONE', processing_state = 'QUEUED' where workspace_id = ${ws.id} and id = ${p.task_id}`;
        await enqueueJob(tx as unknown as Sql, {
          kind: "RECHECK",
          workspaceId: ws.id,
          taskId: p.task_id,
          dedupeKey: `verify:${p.task_id}`,
          payload: { trigger: "POLICY_CHANGE" },
          correlationId: ctx.correlationId,
        });
      }
    }
    return policy;
  }) as Promise<PolicyRow>;
}

export async function setWritesPaused(sql: Sql, ctx: ServiceContext, input: { paused: boolean; reason?: string }) {
  if (ctx.workspace.kind !== "DEMO") requirePrivateOwner(ctx);
  return sql.begin(async (tx) => {
    const [before] = await tx<WorkspaceRow[]>`select * from app.workspaces where id = ${ctx.workspace.id} for update`;
    if (before.writes_paused === input.paused) return before;
    const [after] = await tx<WorkspaceRow[]>`
      update app.workspaces
      set writes_paused = ${input.paused},
          writes_paused_reason = ${input.paused ? (input.reason ?? "").slice(0, 200) || null : null},
          writes_paused_at = ${input.paused ? new Date() : null}
      where id = ${ctx.workspace.id}
      returning *
    `;
    await recordAudit(tx as unknown as Sql, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: input.paused ? "workspace.writes_paused" : "workspace.writes_resumed",
      summary: input.paused
        ? "Recovery writes paused. Verification and reconciliation continue; already dispatched operations may still take effect."
        : "Recovery writes resumed.",
      correlationId: ctx.correlationId,
      before: { writes_paused: before.writes_paused },
      after: { writes_paused: after.writes_paused, reason: after.writes_paused_reason },
    });
    if (!input.paused) {
      // Authorized proposals held by the pause can proceed through the normal guarded path.
      const held = await tx<{ id: string; task_id: string }[]>`
        select id, task_id from app.recovery_proposals
        where workspace_id = ${ctx.workspace.id} and status = 'AUTHORIZED' and expires_at > now()
      `;
      for (const p of held) {
        await enqueueJob(tx as unknown as Sql, {
          kind: "RECOVER",
          workspaceId: ctx.workspace.id,
          taskId: p.task_id,
          dedupeKey: `recover:${p.id}`,
          payload: { proposal_id: p.id },
          correlationId: ctx.correlationId,
        });
      }
      // Proposals created as BLOCKED while paused are re-derived from a fresh read.
      const blocked = await tx<{ id: string; task_id: string }[]>`
        update app.recovery_proposals set status = 'SUPERSEDED', status_reason = 'WRITES_RESUMED'
        where workspace_id = ${ctx.workspace.id} and status = 'BLOCKED' and status_reason = 'WRITES_PAUSED'
        returning id, task_id
      `;
      for (const p of blocked) {
        await enqueueJob(tx as unknown as Sql, {
          kind: "RECHECK",
          workspaceId: ctx.workspace.id,
          taskId: p.task_id,
          dedupeKey: `verify:${p.task_id}`,
          payload: { trigger: "POLICY_CHANGE" },
          correlationId: ctx.correlationId,
        });
      }
    }
    return after;
  });
}

export async function markOnboardingComplete(sql: Sql, ctx: ServiceContext) {
  await sql.begin(async (tx) => {
    await tx`
      update app.workspaces set onboarding_step = 3, onboarding_completed_at = coalesce(onboarding_completed_at, now())
      where id = ${ctx.workspace.id}
    `;
    await recordAudit(tx as unknown as Sql, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "onboarding.completed",
      summary: "Workspace setup completed.",
      correlationId: ctx.correlationId,
    });
  });
}

export function actorForUser(user: { id: string; email?: string | null }, displayName: string): Actor {
  return { type: "USER", id: `user:${user.id}`, label: displayName, userId: user.id, email: user.email ?? undefined };
}

export const DEMO_ACTOR = (workspaceId: string): Actor => ({ type: "DEMO_OPERATOR", id: `demo:${workspaceId}`, label: "Demo operator" });
