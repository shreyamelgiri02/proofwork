import { randomUUID } from "node:crypto";
import type { OperationLookup, WriteOutcome } from "@proofwork/adapters";
import {
  AppError,
  LIMITS,
  RECOVERY_ACTION,
  canonicalJson,
  evaluateRecoveryGate,
  now,
  secondsBetween,
  toEpochSeconds,
  type OperationState,
  type SourceRead,
} from "@proofwork/domain";
import { recordAudit, recordIntervention } from "./audit";
import { isUniqueViolation, json, type Sql } from "./client";
import { adapterFor } from "./connections";
import { SYSTEM_ACTOR, WORKER_ACTOR, type Actor, type ServiceContext } from "./context";
import { sha256 } from "./crypto";
import { completeJob, enqueueJob, failJob, type JobRow } from "./jobs";
import {
  beginProcessing,
  loadTaskContext,
  readSource,
  recordEvaluation,
  type ProposalRow,
  type RecordEvaluationResult,
  type TaskContext,
} from "./verification";

export interface OperationRow {
  id: string;
  workspace_id: string;
  task_id: string;
  proposal_id: string;
  approval_decision_id: string;
  connection_id: string;
  connection_config_version: number;
  subscription_id: string;
  action: string;
  parameters: { cancel_at_period_end: true };
  idempotency_key: string;
  state: OperationState;
  outcome_certainty: "CERTAIN" | "UNCERTAIN";
  attribution: "PROOFWORK" | "UNATTRIBUTED" | null;
  dispatch_count: number;
  max_dispatches: number;
  authorized_until: Date;
  dispatch_reserved_at: Date | null;
  first_dispatched_at: Date | null;
  last_provider_request_id: string | null;
  last_error_code: string | null;
  verified_decision_id: string | null;
  resolved_at: Date | null;
  resolution_reason: string | null;
  escalated_at: Date | null;
  created_at: Date;
}


/**
 * Test-only crash injection for durability tests (TEST_PLAN F7/F8). Never active in
 * production builds and only when PROOFWORK_TEST_CRASH_AT names the exact point.
 */
function crashPoint(name: "after_prepare" | "after_dispatch_reserved" | "after_write") {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.PROOFWORK_TEST_CRASH_AT !== name) return;
  console.error(`[test] simulated worker crash at ${name}`);
  process.exit(137);
}

// ---------------------------------------------------------------------------
// Human decision (web)
// ---------------------------------------------------------------------------

export async function decideApproval(
  sql: Sql,
  ctx: ServiceContext,
  proposalId: string,
  input: { decision: "APPROVE" | "REJECT"; proposal_hash: string; reason: string },
): Promise<{ status: "AUTHORIZED" | "REJECTED"; message: string; task_id: string }> {
  return sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [proposal] = await tx<ProposalRow[]>`
      select * from app.recovery_proposals where workspace_id = ${ctx.workspace.id} and id = ${proposalId} for update
    `;
    if (!proposal) throw new AppError("NOT_FOUND", "Proposal not found.");
    if (proposal.proposal_hash !== input.proposal_hash) {
      throw new AppError("APPROVAL_STALE", "The subscription changed. Review the latest evidence before approving again.");
    }
    if (proposal.status === "EXPIRED" || new Date(proposal.expires_at).getTime() <= now().getTime()) {
      throw new AppError("APPROVAL_EXPIRED", "This proposal expired. Check the source again to prepare a current proposal.");
    }
    if (proposal.status !== "AWAITING_APPROVAL") {
      throw new AppError("APPROVAL_STALE", "This proposal is no longer waiting for a decision.");
    }
    const [workspace] = await tx<{ current_policy_version: number; writes_paused: boolean }[]>`
      select current_policy_version, writes_paused from app.workspaces where id = ${ctx.workspace.id} for share
    `;
    const [policy] = await tx<{ mode: string; version: number }[]>`
      select mode, version from app.policy_versions where workspace_id = ${ctx.workspace.id} and version = ${workspace.current_policy_version}
    `;
    const [request] = await tx<{ status: string; version: number }[]>`
      select status, version from app.authorized_requests where workspace_id = ${ctx.workspace.id} and id = ${proposal.request_id}
    `;
    const [connection] = await tx<{ config_version: number }[]>`
      select config_version from app.connections where workspace_id = ${ctx.workspace.id} and id = ${proposal.connection_id}
    `;
    if (request.status !== "ACTIVE") throw new AppError("REQUEST_NOT_ACTIVE", "The authorized request is no longer active.");
    if (policy.version !== proposal.policy_version || policy.mode === "OBSERVE_ONLY") {
      throw new AppError("APPROVAL_STALE", "The recovery policy changed. Check the source again to prepare a current proposal.");
    }
    if (request.version !== proposal.request_version || connection.config_version !== proposal.connection_config_version) {
      throw new AppError("APPROVAL_STALE", "The request or evidence source changed. Review the latest evidence before approving again.");
    }

    let decisionId: string;
    try {
      const [decision] = await tx<{ id: string }[]>`
        insert into app.approval_decisions (workspace_id, proposal_id, proposal_hash, decision, actor_type, actor_id, actor_label, reason, policy_version, correlation_id)
        values (${ctx.workspace.id}, ${proposal.id}, ${proposal.proposal_hash}, ${input.decision}, ${ctx.actor.type === "DEMO_OPERATOR" ? "DEMO_OPERATOR" : "USER"},
                ${ctx.actor.id}, ${ctx.actor.label}, ${input.reason}, ${proposal.policy_version}, ${ctx.correlationId})
        returning id
      `;
      decisionId = decision.id;
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError("CONFLICT", "A decision was already recorded for this proposal.");
      throw err;
    }

    if (input.decision === "APPROVE") {
      await tx`update app.recovery_proposals set status = 'AUTHORIZED' where id = ${proposal.id}`;
      await tx`update app.tasks set recovery_state = 'AUTHORIZED', processing_state = ${workspace.writes_paused ? "IDLE" : "RECOVERING"} where workspace_id = ${ctx.workspace.id} and id = ${proposal.task_id}`;
      await recordIntervention(tx, { workspaceId: ctx.workspace.id, taskId: proposal.task_id, kind: "APPROVAL_APPROVED", actor: ctx.actor, dedupeKey: `approval:${proposal.id}`, correlationId: ctx.correlationId, note: input.reason });
      await recordAudit(tx, {
        workspaceId: ctx.workspace.id,
        actor: ctx.actor,
        eventType: "recovery.approved",
        summary: input.reason || "Recovery approved.",
        correlationId: ctx.correlationId,
        taskId: proposal.task_id,
        proposalId: proposal.id,
        policyVersion: proposal.policy_version,
        after: { decision_id: decisionId, proposal_hash: proposal.proposal_hash },
      });
      await enqueueJob(tx, {
        kind: "RECOVER",
        workspaceId: ctx.workspace.id,
        taskId: proposal.task_id,
        dedupeKey: `recover:${proposal.id}`,
        payload: { proposal_id: proposal.id },
        correlationId: ctx.correlationId,
      });
      return {
        status: "AUTHORIZED" as const,
        task_id: proposal.task_id,
        message: workspace.writes_paused
          ? "Approval recorded. Recovery writes are paused, so the fix will wait until writes resume."
          : "Approval recorded. The fix is queued. The result will come from a new source read.",
      };
    }

    await tx`update app.recovery_proposals set status = 'REJECTED', status_reason = 'REJECTED_BY_OPERATOR' where id = ${proposal.id}`;
    await tx`update app.tasks set recovery_state = 'REJECTED', processing_state = 'ESCALATED' where workspace_id = ${ctx.workspace.id} and id = ${proposal.task_id}`;
    await recordIntervention(tx, { workspaceId: ctx.workspace.id, taskId: proposal.task_id, kind: "APPROVAL_REJECTED", actor: ctx.actor, dedupeKey: `approval:${proposal.id}`, correlationId: ctx.correlationId, note: input.reason });
    await recordAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "recovery.rejected",
      summary: input.reason,
      correlationId: ctx.correlationId,
      taskId: proposal.task_id,
      proposalId: proposal.id,
      policyVersion: proposal.policy_version,
    });
    return { status: "REJECTED" as const, task_id: proposal.task_id, message: "Rejection recorded. The verification result is unchanged and the task needs manual handling." };
  }) as Promise<{ status: "AUTHORIZED" | "REJECTED"; message: string; task_id: string }>;
}

// ---------------------------------------------------------------------------
// Operation helpers
// ---------------------------------------------------------------------------

async function operationEvent(sql: Sql, op: Pick<OperationRow, "id" | "workspace_id">, e: { type: string; from?: string | null; to?: string | null; actor: Actor; details?: Record<string, unknown>; correlationId: string }) {
  await sql`
    insert into app.operation_events (workspace_id, operation_id, event_type, from_state, to_state, actor_type, actor_id, details, correlation_id)
    values (${op.workspace_id}, ${op.id}, ${e.type}, ${e.from ?? null}, ${e.to ?? null}, ${e.actor.type}, ${e.actor.id}, ${json(sql, e.details ?? {})}, ${e.correlationId})
  `;
}

async function setTaskRecovery(sql: Sql, workspaceId: string, taskId: string, recovery: string, processing?: string) {
  if (processing) {
    await sql`update app.tasks set recovery_state = ${recovery}, processing_state = ${processing} where workspace_id = ${workspaceId} and id = ${taskId}`;
  } else {
    await sql`update app.tasks set recovery_state = ${recovery} where workspace_id = ${workspaceId} and id = ${taskId}`;
  }
}

async function loadOperation(sql: Sql, workspaceId: string, operationId: string): Promise<OperationRow | null> {
  const [op] = await sql<OperationRow[]>`select * from app.recovery_operations where workspace_id = ${workspaceId} and id = ${operationId}`;
  return op ?? null;
}

function readAgeSeconds(read: SourceRead): number {
  return secondsBetween(now(), new Date(read.observed_at));
}

// ---------------------------------------------------------------------------
// RECOVER job: precheck → prepare → reserve → dispatch → independent read
// ---------------------------------------------------------------------------

export async function processRecoverJob(sql: Sql, job: JobRow, workerName: string): Promise<Record<string, unknown>> {
  const actor = WORKER_ACTOR(workerName);
  const proposalId = String(job.payload?.proposal_id ?? "");
  if (!job.workspace_id || !proposalId) return { skipped: "missing proposal" };
  const [proposal] = await sql<ProposalRow[]>`select * from app.recovery_proposals where workspace_id = ${job.workspace_id} and id = ${proposalId}`;
  if (!proposal) return { skipped: "proposal not found" };

  // An operation already owns this proposal: never create another; reconcile it instead.
  const [existing] = await sql<OperationRow[]>`select * from app.recovery_operations where workspace_id = ${job.workspace_id} and proposal_id = ${proposal.id}`;
  if (existing) {
    if (existing.resolved_at) return { skipped: "operation already resolved", operation_id: existing.id };
    const ctx = await loadTaskContext(sql, job.workspace_id, proposal.task_id);
    return reconcileOperation(sql, ctx, existing, { actor, correlationId: job.correlation_id, job });
  }
  if (proposal.status !== "AUTHORIZED") return { skipped: `proposal status ${proposal.status}` };

  const ctx = await loadTaskContext(sql, job.workspace_id, proposal.task_id);
  const version = await beginProcessing(sql, ctx.workspace.id, ctx.task.id, "RECOVERING");
  ctx.task.processing_version = version;

  // 1. Fresh precheck, stored as evidence.
  const precheck = await readSource(ctx, "read");
  const evaluated = await recordEvaluation(sql, { ctx, read: precheck, trigger: "PRECHECK", processingVersion: version, actor, correlationId: job.correlation_id, allowProposal: false, job });
  if (!evaluated.committed) throw Object.assign(new Error("PRECHECK_FENCED"), { errorClass: "RETRYABLE" });

  if (evaluated.evaluation.verdict === "SATISFIED_SCHEDULED" || evaluated.evaluation.verdict === "SATISFIED_ENDED") {
    await recordAudit(sql, {
      workspaceId: ctx.workspace.id,
      actor,
      eventType: "recovery.no_op",
      summary: "Fresh precheck already shows the authorized outcome. No write was sent.",
      correlationId: job.correlation_id,
      taskId: ctx.task.id,
      proposalId: proposal.id,
    });
    return { outcome: "NO_OP_ALREADY_SATISFIED" };
  }
  if (!precheck.ok) {
    // Unknown source state: never write. The proposal stays authorized until expiry; retry the job.
    throw Object.assign(new Error("PRECHECK_UNAVAILABLE"), { errorClass: "RETRYABLE" });
  }

  const [freshPolicy] = await sql<{ mode: "OBSERVE_ONLY" | "REQUIRE_APPROVAL" | "AUTO_RECOVER"; version: number; recovery_cutoff_seconds: number }[]>`
    select p.mode, p.version, p.recovery_cutoff_seconds from app.policy_versions p join app.workspaces w on w.id = p.workspace_id and w.current_policy_version = p.version
    where p.workspace_id = ${ctx.workspace.id}
  `;
  const [freshWorkspace] = await sql<{ writes_paused: boolean }[]>`select writes_paused from app.workspaces where id = ${ctx.workspace.id}`;
  const [otherUnresolved] = await sql`
    select 1 from app.recovery_operations where connection_id = ${ctx.connection.id} and subscription_id = ${ctx.request.subscription_id} and resolved_at is null
  `;
  const gate = evaluateRecoveryGate({
    now: now(),
    evaluation: evaluated.evaluation,
    request: { status: ctx.request.status, version: ctx.request.version, expected_period_end: new Date(ctx.request.expected_period_end).toISOString() },
    policy: { mode: freshPolicy.mode, version: freshPolicy.version, recovery_cutoff_seconds: freshPolicy.recovery_cutoff_seconds },
    workspace: { writes_paused: freshWorkspace.writes_paused },
    connection: { config_version: ctx.connection.config_version },
    proposal: {
      status: proposal.status,
      request_version: proposal.request_version,
      policy_version: proposal.policy_version,
      connection_config_version: proposal.connection_config_version,
      source_fingerprint: proposal.source_fingerprint,
      expires_at: new Date(proposal.expires_at).toISOString(),
    },
    current_fingerprint: evaluated.fingerprint,
    evidence_age_seconds: readAgeSeconds(precheck),
    has_unresolved_operation: otherUnresolved !== undefined,
    prior_verified_recovery: false,
    stage: "dispatch",
  });

  if (!gate.allowed) {
    return handleBlockedGate(sql, ctx, proposal, gate.decision, gate.detail, actor, job.correlation_id);
  }

  // 2. Prepare: durable intent + stable key, serialized per resource.
  let op: OperationRow;
  try {
    op = (await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await tx`select pg_advisory_xact_lock(hashtext(${`${ctx.connection.id}:${ctx.request.subscription_id}`}))`;
      const [locked] = await tx<ProposalRow[]>`select * from app.recovery_proposals where id = ${proposal.id} for update`;
      if (locked.status !== "AUTHORIZED") throw new AppError("APPROVAL_STALE", "Proposal is no longer authorized.");
      const [approval] = await tx<{ id: string }[]>`select id from app.approval_decisions where proposal_id = ${proposal.id} and decision in ('APPROVE', 'AUTO_POLICY')`;
      if (!approval) throw new AppError("APPROVAL_STALE", "No approval or policy authorization is recorded.");
      const operationId = randomUUID();
      const T = toEpochSeconds(new Date(ctx.request.expected_period_end));
      const authorizedUntil = new Date(
        Math.min(new Date(proposal.expires_at).getTime(), (T - freshPolicy.recovery_cutoff_seconds) * 1000, now().getTime() + LIMITS.WRITE_RETRY_WINDOW_SECONDS * 1000),
      );
      const parameters = { cancel_at_period_end: true as const };
      const [created] = await tx<OperationRow[]>`
        insert into app.recovery_operations (
          id, workspace_id, task_id, proposal_id, approval_decision_id, connection_id, connection_config_version, subscription_id,
          parameters, parameter_hash, idempotency_key, state, max_dispatches, authorized_until
        ) values (
          ${operationId}, ${ctx.workspace.id}, ${ctx.task.id}, ${proposal.id}, ${approval.id}, ${ctx.connection.id}, ${ctx.connection.config_version},
          ${ctx.request.subscription_id}, ${json(tx, parameters)}, ${sha256(canonicalJson(parameters))}, ${`pw_op_${operationId}`},
          'PREPARED', ${LIMITS.MAX_WRITE_DISPATCHES}, ${authorizedUntil}
        )
        returning *
      `;
      await tx`update app.recovery_proposals set status = 'CONSUMED' where id = ${proposal.id}`;
      await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, "PREPARED", "RECOVERING");
      await operationEvent(tx, created, { type: "PREPARED", to: "PREPARED", actor, correlationId: job.correlation_id, details: { idempotency_key: created.idempotency_key, authorized_until: authorizedUntil.toISOString() } });
      await recordAudit(tx, {
        workspaceId: ctx.workspace.id,
        actor,
        eventType: "recovery.prepared",
        summary: "Durable write intent recorded with a stable operation key.",
        correlationId: job.correlation_id,
        taskId: ctx.task.id,
        proposalId: proposal.id,
        operationId: created.id,
        policyVersion: freshPolicy.version,
      });
      return created;
    })) as OperationRow;
  } catch (err) {
    if (isUniqueViolation(err)) {
      await recordAudit(sql, {
        workspaceId: ctx.workspace.id,
        actor,
        eventType: "recovery.blocked",
        summary: "A competing recovery for the same subscription was blocked: another operation already owns this resource.",
        correlationId: job.correlation_id,
        taskId: ctx.task.id,
        proposalId: proposal.id,
        reasonCode: "OPERATION_UNRESOLVED",
      });
      return { outcome: "BLOCKED_COMPETING_OPERATION" };
    }
    throw err;
  }

  crashPoint("after_prepare");
  return dispatchAndVerify(sql, ctx, op, precheck, { actor, correlationId: job.correlation_id, job });
}

async function handleBlockedGate(sql: Sql, ctx: TaskContext, proposal: ProposalRow, decision: string, detail: string, actor: Actor, correlationId: string) {
  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    switch (decision) {
      case "WRITES_PAUSED":
        // Keep the authorization; resuming writes re-queues it through this same guarded path.
        await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, "AUTHORIZED", "IDLE");
        break;
      case "APPROVAL_EXPIRED":
        await tx`update app.recovery_proposals set status = 'EXPIRED', status_reason = 'EXPIRED_BEFORE_DISPATCH' where id = ${proposal.id} and status in ('AUTHORIZED', 'AWAITING_APPROVAL')`;
        await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, "EXPIRED", "IDLE");
        break;
      case "APPROVAL_STALE":
      case "CONNECTION_CHANGED":
      case "EVIDENCE_TOO_OLD":
        await tx`update app.recovery_proposals set status = 'SUPERSEDED', status_reason = ${decision} where id = ${proposal.id} and status = 'AUTHORIZED'`;
        await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, "NONE", "QUEUED");
        await enqueueJob(tx, { kind: "RECHECK", workspaceId: ctx.workspace.id, taskId: ctx.task.id, dedupeKey: `verify:${ctx.task.id}`, payload: { trigger: "RETRY" }, correlationId });
        break;
      case "OPERATION_UNRESOLVED":
        await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, "BLOCKED", "RECOVERING");
        break;
      default:
        await tx`update app.recovery_proposals set status = 'BLOCKED', status_reason = ${decision} where id = ${proposal.id} and status = 'AUTHORIZED'`;
        await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, "BLOCKED", "ESCALATED");
    }
    await recordAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor,
      eventType: decision === "APPROVAL_EXPIRED" ? "recovery.expired" : "recovery.blocked",
      summary: detail,
      correlationId,
      taskId: ctx.task.id,
      proposalId: proposal.id,
      reasonCode: decision,
    });
  });
  return { outcome: "BLOCKED", gate: decision };
}

interface ExecOpts {
  actor: Actor;
  correlationId: string;
  job?: Pick<JobRow, "id" | "lease_token"> | null;
}

/** Reserve a dispatch under current authority, then send the single allowed write. */
async function dispatchAndVerify(sql: Sql, ctx: TaskContext, op: OperationRow, precheck: SourceRead, opts: ExecOpts): Promise<Record<string, unknown>> {
  // 3. Reserve dispatch (revalidates policy, pause, request, config, deadline and budget).
  const reservation = (await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [locked] = await tx<OperationRow[]>`select * from app.recovery_operations where id = ${op.id} for update`;
    const [ws] = await tx<{ writes_paused: boolean; current_policy_version: number }[]>`select writes_paused, current_policy_version from app.workspaces where id = ${ctx.workspace.id} for share`;
    const [policy] = await tx<{ mode: string; version: number }[]>`select mode, version from app.policy_versions where workspace_id = ${ctx.workspace.id} and version = ${ws.current_policy_version}`;
    const [proposal] = await tx<{ policy_version: number }[]>`select policy_version from app.recovery_proposals where id = ${op.proposal_id}`;
    const [request] = await tx<{ status: string }[]>`select status from app.authorized_requests where workspace_id = ${ctx.workspace.id} and id = ${ctx.request.id}`;
    const [conn] = await tx<{ config_version: number }[]>`select config_version from app.connections where id = ${op.connection_id}`;

    let blocked: string | null = null;
    if (locked.resolved_at) blocked = "OPERATION_RESOLVED";
    else if (!["PREPARED", "DISPATCHED", "OUTCOME_UNKNOWN", "AWAITING_VERIFICATION"].includes(locked.state)) blocked = "INVALID_STATE";
    else if (ws.writes_paused) blocked = "WRITES_PAUSED";
    else if (policy.mode === "OBSERVE_ONLY" || policy.version !== proposal.policy_version) blocked = "POLICY_CHANGED";
    else if (request.status !== "ACTIVE") blocked = "REQUEST_NOT_ACTIVE";
    else if (conn.config_version !== locked.connection_config_version) blocked = "CONNECTION_CHANGED";
    else if (new Date(locked.authorized_until).getTime() <= now().getTime()) blocked = "AUTHORIZATION_WINDOW_ENDED";
    else if (locked.dispatch_count >= locked.max_dispatches) blocked = "DISPATCH_BUDGET_EXHAUSTED";
    else if (readAgeSeconds(precheck) > LIMITS.PRECHECK_MAX_AGE_SECONDS) blocked = "EVIDENCE_TOO_OLD";

    if (blocked) {
      if (locked.dispatch_count === 0 && !locked.resolved_at) {
        // Never dispatched: safe to resolve from the zero-dispatch record.
        await tx`update app.recovery_operations set state = 'BLOCKED', resolved_at = now(), resolution_reason = ${blocked} where id = ${op.id}`;
        await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, "BLOCKED", blocked === "WRITES_PAUSED" ? "IDLE" : "ESCALATED");
        await operationEvent(tx, op, { type: "BLOCKED_BEFORE_DISPATCH", from: locked.state, to: "BLOCKED", actor: opts.actor, correlationId: opts.correlationId, details: { reason: blocked } });
      }
      await recordAudit(tx, {
        workspaceId: ctx.workspace.id,
        actor: opts.actor,
        eventType: "recovery.blocked",
        summary: `Dispatch not reserved: ${blocked.replaceAll("_", " ").toLowerCase()}.`,
        correlationId: opts.correlationId,
        taskId: ctx.task.id,
        operationId: op.id,
        reasonCode: blocked,
      });
      return { reserved: false as const, reason: blocked, dispatchCount: locked.dispatch_count };
    }
    const [reserved] = await tx<OperationRow[]>`
      update app.recovery_operations
      set state = 'DISPATCHED', dispatch_count = dispatch_count + 1, dispatch_reserved_at = now(),
          first_dispatched_at = coalesce(first_dispatched_at, now())
      where id = ${op.id}
      returning *
    `;
    await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, "DISPATCHED", "RECOVERING");
    await operationEvent(tx, op, { type: "DISPATCH_RESERVED", from: locked.state, to: "DISPATCHED", actor: opts.actor, correlationId: opts.correlationId, details: { dispatch_count: reserved.dispatch_count } });
    await recordAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: opts.actor,
      eventType: "recovery.dispatched",
      summary: `Bounded action sent to the billing source (attempt ${reserved.dispatch_count} of ${reserved.max_dispatches}, same operation key).`,
      correlationId: opts.correlationId,
      taskId: ctx.task.id,
      operationId: op.id,
      after: { action: RECOVERY_ACTION, cancel_at_period_end: true, idempotency_key: reserved.idempotency_key },
    });
    return { reserved: true as const, op: reserved };
  })) as { reserved: false; reason: string; dispatchCount: number } | { reserved: true; op: OperationRow };

  if (!reservation.reserved) {
    if (reservation.dispatchCount > 0) {
      // A possibly sent write exists: continue safe reconciliation reads only.
      await enqueueJob(sql, { kind: "RECONCILE", workspaceId: ctx.workspace.id, taskId: ctx.task.id, dedupeKey: `reconcile:${op.id}`, payload: { operation_id: op.id, allow_retry: false }, dueAt: new Date(now().getTime() + 60_000), correlationId: opts.correlationId });
    }
    return { outcome: "DISPATCH_NOT_RESERVED", reason: reservation.reason };
  }

  // Final local deadline check immediately before the external call.
  if (new Date(reservation.op.authorized_until).getTime() <= now().getTime()) {
    await enqueueJob(sql, { kind: "RECONCILE", workspaceId: ctx.workspace.id, taskId: ctx.task.id, dedupeKey: `reconcile:${op.id}`, payload: { operation_id: op.id, allow_retry: false }, correlationId: opts.correlationId });
    return { outcome: "DEADLINE_PASSED_AFTER_RESERVATION" };
  }

  crashPoint("after_dispatch_reserved");

  // 4. Dispatch the exact allowed mutation with the stable key.
  let outcome: WriteOutcome;
  try {
    const writer = adapterFor(ctx.connection, { id: ctx.workspace.id, kind: ctx.workspace.kind }, "write");
    outcome = await writer.schedulePeriodEndCancellation({ subscriptionId: ctx.request.subscription_id, idempotencyKey: reservation.op.idempotency_key });
  } catch (err) {
    outcome = { outcome: "UNCERTAIN", http_status: null, provider_request_id: null, error_code: err instanceof Error ? err.message.slice(0, 60) : "WRITE_EXCEPTION" };
  }

  crashPoint("after_write");

  // 5. Persist the response or the uncertainty. HTTP 200 never verifies the outcome.
  const afterWrite = (await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const nextState: OperationState = outcome.outcome === "UNCERTAIN" ? "OUTCOME_UNKNOWN" : "AWAITING_VERIFICATION";
    const [updated] = await tx<OperationRow[]>`
      update app.recovery_operations set
        state = ${nextState},
        outcome_certainty = ${outcome.outcome === "UNCERTAIN" ? "UNCERTAIN" : "CERTAIN"},
        last_provider_request_id = coalesce(${outcome.provider_request_id}, last_provider_request_id),
        last_error_code = ${outcome.outcome === "ACCEPTED" ? null : outcome.outcome === "REJECTED" ? `REJECTED:${outcome.error_code}` : outcome.error_code}
      where id = ${op.id}
      returning *
    `;
    await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, nextState, "RECOVERING");
    await operationEvent(tx, op, { type: `RESPONSE_${outcome.outcome}`, from: "DISPATCHED", to: nextState, actor: opts.actor, correlationId: opts.correlationId, details: { http_status: outcome.http_status, provider_request_id: outcome.provider_request_id } });
    await recordAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: opts.actor,
      eventType: outcome.outcome === "UNCERTAIN" ? "recovery.outcome_unknown" : "recovery.response_recorded",
      summary:
        outcome.outcome === "ACCEPTED"
          ? "The source accepted the write. Waiting for an independent read to confirm the outcome."
          : outcome.outcome === "REJECTED"
            ? "The source refused the write. Confirming unchanged state with an independent read."
            : "The fix may have been applied. Proofwork is checking the billing record before trying again.",
      correlationId: opts.correlationId,
      taskId: ctx.task.id,
      operationId: op.id,
      reasonCode: outcome.outcome === "ACCEPTED" ? null : outcome.error_code,
    });
    return updated;
  })) as OperationRow;

  // 6–9. Independent read after the write, then resolve the operation from evidence.
  return verifyOperationFromSource(sql, ctx, afterWrite, "POST_RECOVERY", opts);
}

/** Read the source independently and resolve (or keep reconciling) an operation. */
async function verifyOperationFromSource(
  sql: Sql,
  ctx: TaskContext,
  op: OperationRow,
  trigger: "POST_RECOVERY" | "RECONCILE",
  opts: ExecOpts,
  preRead?: { read: SourceRead; result: RecordEvaluationResult },
): Promise<Record<string, unknown>> {
  let read: SourceRead;
  let result: RecordEvaluationResult;
  if (preRead) {
    read = preRead.read;
    result = preRead.result;
  } else {
    const version = await beginProcessing(sql, ctx.workspace.id, ctx.task.id, "RECOVERING");
    read = await readSource(ctx, "read");
    result = await recordEvaluation(sql, { ctx, read, trigger, processingVersion: version, actor: opts.actor, correlationId: opts.correlationId, allowProposal: false, job: opts.job });
  }

  let lookup: OperationLookup = { supported: false };
  const needsAttribution = op.outcome_certainty === "UNCERTAIN" || op.state === "DISPATCHED" || op.last_error_code?.startsWith("REJECTED:");
  if (needsAttribution) {
    try {
      const reader = adapterFor(ctx.connection, { id: ctx.workspace.id, kind: ctx.workspace.kind }, "read");
      lookup = await reader.lookupOperation({ subscriptionId: op.subscription_id, idempotencyKey: op.idempotency_key });
    } catch {
      lookup = { supported: false };
    }
  }
  const sourceApplied = lookup.supported && lookup.ok && lookup.found ? lookup.applied : null;

  const verdict = result.evaluation.verdict;
  const reason = result.evaluation.primary_reason;
  const satisfied = verdict === "SATISFIED_SCHEDULED" || verdict === "SATISFIED_ENDED";
  // Only a recorded, successful response counts as accepted. A DISPATCHED operation with no
  // recorded response (e.g. worker crashed around the call) is possibly sent, i.e. uncertain.
  const responseRecorded = op.state !== "DISPATCHED" && op.state !== "PREPARED";
  const accepted = responseRecorded && op.outcome_certainty === "CERTAIN" && !op.last_error_code;
  const rejected = op.outcome_certainty === "CERTAIN" && Boolean(op.last_error_code?.startsWith("REJECTED:"));

  type Resolution =
    | { kind: "RESOLVE"; state: "VERIFIED" | "FAILED_CONFIRMED" | "RESOLVED_EXTERNALLY"; attribution: "PROOFWORK" | "UNATTRIBUTED" | null; event: string; summary: string; processing: string }
    | { kind: "RETRY"; summary: string }
    | { kind: "WAIT"; summary: string; escalate: boolean };

  let resolution: Resolution;
  const ageSinceDispatch = op.first_dispatched_at ? secondsBetween(now(), new Date(op.first_dispatched_at)) : 0;
  const pastWindow = ageSinceDispatch > LIMITS.WRITE_RETRY_WINDOW_SECONDS;

  if (!result.committed || !read.ok) {
    resolution = { kind: "WAIT", summary: "The source could not be read after the write. The operation stays unresolved while Proofwork keeps checking.", escalate: pastWindow };
  } else if (satisfied) {
    if (accepted || sourceApplied === true) {
      resolution = { kind: "RESOLVE", state: "VERIFIED", attribution: "PROOFWORK", event: "recovery.verified", summary: "Source confirms cancellation scheduled.", processing: verdict === "SATISFIED_ENDED" ? "IDLE" : "MONITORING" };
    } else {
      resolution = {
        kind: "RESOLVE",
        state: "RESOLVED_EXTERNALLY",
        attribution: "UNATTRIBUTED",
        event: "recovery.resolved_externally",
        summary: "The source now shows the authorized outcome, but the evidence does not prove Proofwork's write caused it.",
        processing: verdict === "SATISFIED_ENDED" ? "IDLE" : "MONITORING",
      };
    }
  } else if (reason === "SCHEDULE_MISSING") {
    if (rejected || sourceApplied === false) {
      resolution = { kind: "RESOLVE", state: "FAILED_CONFIRMED", attribution: null, event: "recovery.failed_confirmed", summary: "The source refused the write and still shows no cancellation schedule. Manual handling is needed.", processing: "ESCALATED" };
    } else if (sourceApplied === true) {
      resolution = { kind: "WAIT", summary: "The source recorded the operation but the subscription does not show the schedule. Escalated for review; no new write.", escalate: true };
    } else if (!accepted && op.dispatch_count < op.max_dispatches && !pastWindow && new Date(op.authorized_until).getTime() > now().getTime()) {
      resolution = { kind: "RETRY", summary: "Unchanged state confirmed after an uncertain write. Retrying the same operation with the original key." };
    } else {
      resolution = { kind: "WAIT", summary: "The write outcome is still unresolved and no further dispatch is allowed. Escalated; reconciliation reads continue.", escalate: true };
    }
  } else {
    // Source moved to some other state (period changed, identity, unsupported): stop and escalate.
    if (rejected || sourceApplied === false) {
      resolution = { kind: "RESOLVE", state: "FAILED_CONFIRMED", attribution: null, event: "recovery.failed_confirmed", summary: "The write was not applied and the source now shows a different condition. Manual handling is needed.", processing: "ESCALATED" };
    } else {
      resolution = { kind: "WAIT", summary: `The source now reports ${reason.replaceAll("_", " ").toLowerCase()}. The operation is escalated for review; no new write.`, escalate: true };
    }
  }

  if (resolution.kind === "RESOLVE") {
    const r = resolution;
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await tx`
        update app.recovery_operations set state = ${r.state}, attribution = ${r.attribution}, resolved_at = now(),
          resolution_reason = ${r.event}, resolution_observation_id = ${result.observationId}, verified_decision_id = ${r.state === "VERIFIED" ? result.decisionId : null}
        where id = ${op.id} and resolved_at is null
      `;
      await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, r.state, r.processing);
      await operationEvent(tx, op, { type: "RESOLVED", from: op.state, to: r.state, actor: opts.actor, correlationId: opts.correlationId, details: { observation_id: result.observationId, attribution: r.attribution, source_lookup: lookup.supported ? sourceApplied : "unsupported" } });
      await recordAudit(tx, { workspaceId: ctx.workspace.id, actor: opts.actor, eventType: r.event, summary: r.summary, correlationId: opts.correlationId, taskId: ctx.task.id, operationId: op.id });
    });
    return { outcome: r.state, attribution: r.attribution };
  }

  if (resolution.kind === "RETRY") {
    await recordAudit(sql, { workspaceId: ctx.workspace.id, actor: opts.actor, eventType: "recovery.outcome_unknown", summary: resolution.summary, correlationId: opts.correlationId, taskId: ctx.task.id, operationId: op.id });
    return dispatchAndVerify(sql, ctx, op, read, opts);
  }

  // WAIT: keep the unresolved guard; schedule bounded reconciliation reads.
  const w = resolution;
  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    if (w.escalate) {
      const first = await tx`update app.recovery_operations set escalated_at = coalesce(escalated_at, now()), state = 'OUTCOME_UNKNOWN' where id = ${op.id} and resolved_at is null and escalated_at is null returning id`;
      await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, "OUTCOME_UNKNOWN", "ESCALATED");
      if (first.length) {
        await recordAudit(tx, { workspaceId: ctx.workspace.id, actor: opts.actor, eventType: "recovery.escalated", summary: w.summary, correlationId: opts.correlationId, taskId: ctx.task.id, operationId: op.id });
      }
    } else {
      await setTaskRecovery(tx, ctx.workspace.id, ctx.task.id, op.state === "AWAITING_VERIFICATION" ? "AWAITING_VERIFICATION" : "OUTCOME_UNKNOWN", "RECOVERING");
    }
    const created = new Date(op.created_at).getTime();
    if (now().getTime() - created < 24 * 3600 * 1000) {
      await enqueueJob(tx, {
        kind: "RECONCILE",
        workspaceId: ctx.workspace.id,
        taskId: ctx.task.id,
        dedupeKey: `reconcile:${op.id}`,
        payload: { operation_id: op.id },
        dueAt: new Date(now().getTime() + (w.escalate ? 15 * 60_000 : 60_000)),
        correlationId: opts.correlationId,
      });
    }
  });
  return { outcome: "UNRESOLVED", escalated: w.escalate };
}

async function reconcileOperation(sql: Sql, ctx: TaskContext, op: OperationRow, opts: ExecOpts) {
  if (op.state === "PREPARED" && op.dispatch_count === 0) {
    // Crashed between prepare and reservation: take a fresh precheck and continue the same operation.
    const version = await beginProcessing(sql, ctx.workspace.id, ctx.task.id, "RECOVERING");
    const read = await readSource(ctx, "read");
    const result = await recordEvaluation(sql, { ctx, read, trigger: "PRECHECK", processingVersion: version, actor: opts.actor, correlationId: opts.correlationId, allowProposal: false, job: opts.job });
    if (!read.ok || !result.committed) throw Object.assign(new Error("PRECHECK_UNAVAILABLE"), { errorClass: "RETRYABLE" });
    if (result.evaluation.verdict !== "MISMATCH" || result.evaluation.primary_reason !== "SCHEDULE_MISSING") {
      await sql`update app.recovery_operations set state = 'BLOCKED', resolved_at = now(), resolution_reason = 'STATE_CHANGED_BEFORE_DISPATCH' where id = ${op.id} and dispatch_count = 0`;
      await setTaskRecovery(sql, ctx.workspace.id, ctx.task.id, result.evaluation.verdict.startsWith("SATISFIED") ? "NONE" : "BLOCKED");
      await recordAudit(sql, { workspaceId: ctx.workspace.id, actor: opts.actor, eventType: "recovery.no_op", summary: "Source state changed before dispatch; the prepared operation was closed without a write.", correlationId: opts.correlationId, taskId: ctx.task.id, operationId: op.id });
      return { outcome: "CLOSED_BEFORE_DISPATCH" };
    }
    const [fresh] = await sql<{ source_fingerprint: string }[]>`select source_fingerprint from app.recovery_proposals where id = ${op.proposal_id}`;
    if (fresh && result.fingerprint !== fresh.source_fingerprint) {
      await sql`update app.recovery_operations set state = 'BLOCKED', resolved_at = now(), resolution_reason = 'FINGERPRINT_CHANGED' where id = ${op.id} and dispatch_count = 0`;
      await setTaskRecovery(sql, ctx.workspace.id, ctx.task.id, "BLOCKED", "ESCALATED");
      return { outcome: "CLOSED_FINGERPRINT_CHANGED" };
    }
    return dispatchAndVerify(sql, ctx, op, read, opts);
  }
  return verifyOperationFromSource(sql, ctx, op, "RECONCILE", opts);
}

/** Worker handler for RECONCILE jobs (unknown outcomes, crash recovery, retries). */
export async function processReconcileJob(sql: Sql, job: JobRow, workerName: string): Promise<Record<string, unknown>> {
  const operationId = String(job.payload?.operation_id ?? "");
  if (!job.workspace_id || !operationId) return { skipped: "missing operation" };
  const op = await loadOperation(sql, job.workspace_id, operationId);
  if (!op) return { skipped: "operation not found" };
  if (op.resolved_at) return { skipped: "already resolved" };
  const ctx = await loadTaskContext(sql, job.workspace_id, op.task_id);
  return reconcileOperation(sql, ctx, op, { actor: WORKER_ACTOR(workerName), correlationId: job.correlation_id, job });
}

/** Find unresolved operations whose worker disappeared and make sure reconciliation is queued. */
export async function ensureReconciliationQueued(sql: Sql): Promise<number> {
  const rows = await sql<{ id: string; workspace_id: string; task_id: string }[]>`
    select o.id, o.workspace_id, o.task_id from app.recovery_operations o
    where o.resolved_at is null and o.updated_at < now() - interval '2 minutes'
      and not exists (
        select 1 from app.jobs j where j.status in ('READY', 'LEASED')
          and (j.dedupe_key = 'reconcile:' || o.id::text or (j.kind = 'RECOVER' and j.payload->>'proposal_id' = o.proposal_id::text))
      )
    limit 50
  `;
  for (const r of rows) {
    await enqueueJob(sql, { kind: "RECONCILE", workspaceId: r.workspace_id, taskId: r.task_id, dedupeKey: `reconcile:${r.id}`, payload: { operation_id: r.id } });
  }
  return rows.length;
}

/** Expire proposals whose approval window has ended. */
export async function expireProposals(sql: Sql): Promise<number> {
  const expired = await sql<{ id: string; workspace_id: string; task_id: string; status: string }[]>`
    update app.recovery_proposals set status = 'EXPIRED', status_reason = 'APPROVAL_WINDOW_ENDED'
    where status in ('PROPOSED', 'AWAITING_APPROVAL', 'BLOCKED') and expires_at <= now()
    returning id, workspace_id, task_id, status
  `;
  for (const p of expired) {
    await sql`
      update app.tasks set recovery_state = 'EXPIRED', processing_state = case when processing_state = 'AWAITING_APPROVAL' then 'IDLE' else processing_state end
      where workspace_id = ${p.workspace_id} and id = ${p.task_id} and recovery_state in ('AWAITING_APPROVAL', 'PROPOSED', 'BLOCKED')
    `;
    await recordAudit(sql, {
      workspaceId: p.workspace_id,
      actor: SYSTEM_ACTOR,
      eventType: "recovery.expired",
      summary: "The approval window ended. Check the source again to prepare a current proposal.",
      correlationId: randomUUID(),
      taskId: p.task_id,
      proposalId: p.id,
    });
  }
  // Authorized-but-undispatched proposals past expiry are closed by the RECOVER gate itself.
  return expired.length;
}

/** Complete or fail a recovery-family job consistently. */
export async function settleJob(sql: Sql, job: JobRow, run: () => Promise<Record<string, unknown>>) {
  try {
    const result = await run();
    await completeJob(sql, job, result);
    return result;
  } catch (err) {
    const errorClass = (err as { errorClass?: "RETRYABLE" | "PERMANENT" }).errorClass ?? (err instanceof AppError && err.status < 500 ? "PERMANENT" : "RETRYABLE");
    const code = err instanceof AppError ? err.code : err instanceof Error ? err.message.slice(0, 80) : "UNKNOWN";
    await failJob(sql, job, code, errorClass);
    throw err;
  }
}
