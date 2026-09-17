import {
  EVALUATOR_VERSION,
  LIMITS,
  REASON_COPY,
  RECOVERY_ACTION,
  VERDICT_LABELS,
  buildProposalDiff,
  canonicalJson,
  evaluate,
  evaluateRecoveryGate,
  isTrustworthyVerdict,
  now,
  type CheckTrigger,
  type EvaluationResult,
  type GateResult,
  type PolicyMode,
  type ProcessingState,
  type RecoveryState,
  type SourceRead,
} from "@proofwork/domain";
import { AppError } from "@proofwork/domain";
import { recordAudit } from "./audit";
import { json, type Sql } from "./client";
import { adapterFor } from "./connections";
import { SYSTEM_ACTOR, WORKER_ACTOR, type Actor } from "./context";
import { materialFingerprint, sha256, snapshotHash } from "./crypto";
import { enqueueJob, type JobRow } from "./jobs";
import type { AuthorizedRequestRow } from "./requests";
import type { ConnectionRow, PolicyRow, WorkspaceRow } from "./workspaces";

export interface TaskRow {
  id: string;
  workspace_id: string;
  request_id: string;
  agent_name: string;
  verdict: string;
  primary_reason_code: string | null;
  processing_state: ProcessingState;
  recovery_state: RecoveryState;
  latest_decision_id: string | null;
  latest_trustworthy_decision_id: string | null;
  last_checked_at: Date | null;
  last_trustworthy_read_at: Date | null;
  next_check_at: Date | null;
  first_verified_at: Date | null;
  human_intervention_count: number;
  processing_version: string;
  read_retry_count: number;
  retired_at: Date | null;
  created_at: Date;
}

export interface ProposalRow {
  id: string;
  workspace_id: string;
  task_id: string;
  request_id: string;
  request_version: number;
  connection_id: string;
  connection_config_version: number;
  source_account_id: string;
  customer_id: string;
  subscription_id: string;
  expected_period_end: Date;
  action: string;
  diff: ReturnType<typeof buildProposalDiff>;
  observation_id: string;
  decision_id: string;
  source_fingerprint: string;
  policy_version: number;
  policy_mode: PolicyMode;
  proposal_hash: string;
  status: "PROPOSED" | "AWAITING_APPROVAL" | "AUTHORIZED" | "CONSUMED" | "REJECTED" | "EXPIRED" | "SUPERSEDED" | "BLOCKED";
  status_reason: string | null;
  expires_at: Date;
  created_at: Date;
}

export interface TaskContext {
  task: TaskRow;
  request: AuthorizedRequestRow;
  workspace: WorkspaceRow;
  policy: PolicyRow;
  connection: ConnectionRow;
}

export async function loadTaskContext(sql: Sql, workspaceId: string, taskId: string): Promise<TaskContext> {
  const [task] = await sql<TaskRow[]>`select * from app.tasks where workspace_id = ${workspaceId} and id = ${taskId}`;
  if (!task) throw new AppError("NOT_FOUND", "Task not found.");
  const [request] = await sql<AuthorizedRequestRow[]>`select * from app.authorized_requests where workspace_id = ${workspaceId} and id = ${task.request_id}`;
  const [workspace] = await sql<WorkspaceRow[]>`select * from app.workspaces where id = ${workspaceId}`;
  const [policy] = await sql<PolicyRow[]>`select * from app.policy_versions where workspace_id = ${workspaceId} and version = ${workspace.current_policy_version ?? 0}`;
  // Reads use the connection bound to the request, not whatever is active now.
  const [connection] = await sql<ConnectionRow[]>`select * from app.connections where workspace_id = ${workspaceId} and id = ${request.connection_id}`;
  if (!request || !workspace || !policy || !connection) throw new AppError("INTERNAL_ERROR", "Task context is incomplete.");
  return { task, request, workspace, policy, connection };
}

/** Independent read through the bound adapter. Configuration problems become typed source errors. */
export async function readSource(ctx: TaskContext, purpose: "read" | "write" = "read"): Promise<SourceRead> {
  try {
    const adapter = adapterFor(ctx.connection, { id: ctx.workspace.id, kind: ctx.workspace.kind }, purpose);
    return await adapter.getSubscription(ctx.request.subscription_id);
  } catch (err) {
    const code = err instanceof AppError && err.code === "LIVE_MODE_BLOCKED" ? "LIVE_MODE_BLOCKED" : "NOT_CONFIGURED";
    return { ok: false, error_code: code, http_status: null, observed_at: now().toISOString(), provider_request_id: null, message: err instanceof Error ? err.message : undefined };
  }
}

export function evaluationRequest(request: AuthorizedRequestRow) {
  return {
    status: request.status,
    adapter: request.adapter,
    source_account_id: request.source_account_id,
    customer_id: request.customer_id,
    subscription_id: request.subscription_id,
    expected_period_end: new Date(request.expected_period_end).toISOString(),
  };
}

/** Increment the task's processing version (fencing token for projection commits). */
export async function beginProcessing(sql: Sql, workspaceId: string, taskId: string, state: ProcessingState = "VERIFYING"): Promise<string> {
  const [row] = await sql<{ processing_version: string }[]>`
    update app.tasks set processing_version = processing_version + 1, processing_state = ${state}
    where workspace_id = ${workspaceId} and id = ${taskId}
    returning processing_version::text
  `;
  if (!row) throw new AppError("NOT_FOUND", "Task not found.");
  return row.processing_version;
}

export function computeProposalHash(p: {
  task_id: string;
  request_id: string;
  request_version: number;
  connection_id: string;
  connection_config_version: number;
  source_account_id: string;
  customer_id: string;
  subscription_id: string;
  expected_period_end: string;
  source_fingerprint: string;
  policy_version: number;
  expires_at: string;
}): string {
  return sha256(canonicalJson({ ...p, action: RECOVERY_ACTION, parameters: { cancel_at_period_end: true } }));
}

export interface RecordEvaluationInput {
  ctx: TaskContext;
  read: SourceRead;
  trigger: CheckTrigger;
  processingVersion: string;
  actor: Actor;
  correlationId: string;
  /** Whether this evaluation may create/refresh a recovery proposal. */
  allowProposal: boolean;
  /** Job whose lease must still be valid for the commit (fencing). */
  job?: Pick<JobRow, "id" | "lease_token"> | null;
}

export interface RecordEvaluationResult {
  committed: boolean;
  observationId: string;
  decisionId: string | null;
  fingerprint: string | null;
  evaluation: EvaluationResult;
  gate: GateResult;
}

/**
 * Append observation + decision and update the task projection transactionally.
 * Late workers (stale processing version or lost lease) cannot overwrite newer state.
 */
export async function recordEvaluation(sql: Sql, input: RecordEvaluationInput): Promise<RecordEvaluationResult> {
  const { ctx, read, trigger } = input;
  const current = now();
  const evaluation = evaluate({ request: evaluationRequest(ctx.request), read, now: current });
  const fingerprint = read.ok ? materialFingerprint(read.snapshot) : null;

  return sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [task] = await tx<{ pv: string }[]>`
      select processing_version::text as pv from app.tasks
      where workspace_id = ${ctx.workspace.id} and id = ${ctx.task.id} for update
    `;
    let fenced = task.pv !== String(input.processingVersion);
    if (!fenced && input.job) {
      const valid = await tx`select 1 from app.jobs where id = ${input.job.id} and lease_token = ${input.job.lease_token} and status = 'LEASED' and leased_until > now()`;
      fenced = valid.length === 0;
    }

    const [observation] = await tx<{ id: string }[]>`
      insert into app.observations (
        workspace_id, task_id, connection_id, adapter, environment, subscription_id, result_type, error_code, http_status,
        snapshot, material_fingerprint, snapshot_hash, source_version, provider_request_id, observed_at, trigger, discarded
      ) values (
        ${ctx.workspace.id}, ${ctx.task.id}, ${ctx.connection.id}, ${ctx.connection.adapter}, ${ctx.connection.environment},
        ${ctx.request.subscription_id}, ${read.ok ? "SUCCESS" : "ERROR"}, ${read.ok ? null : read.error_code}, ${read.ok ? null : read.http_status},
        ${read.ok ? json(tx, read.snapshot) : null}, ${fingerprint}, ${read.ok ? snapshotHash(read.snapshot) : null},
        ${read.ok ? read.snapshot.source_version : null}, ${read.provider_request_id}, ${new Date(read.observed_at)}, ${trigger}, ${fenced}
      )
      returning id
    `;

    if (read.ok) {
      await tx`update app.connections set last_successful_read_at = ${new Date(read.observed_at)}, health = 'CONNECTED', last_error_code = null where id = ${ctx.connection.id}`;
    } else if (read.error_code === "SOURCE_ACCESS_DENIED" || read.error_code === "NOT_CONFIGURED") {
      await tx`update app.connections set health = 'ERROR', last_error_code = ${read.error_code}, last_checked_at = now() where id = ${ctx.connection.id}`;
    }

    if (fenced) {
      await recordAudit(tx, {
        workspaceId: ctx.workspace.id,
        actor: input.actor,
        eventType: "verification.stale_commit_rejected",
        summary: "A late source read was kept for diagnostics but not used, because newer processing owns this task.",
        correlationId: input.correlationId,
        taskId: ctx.task.id,
      });
      const blocked: GateResult = { decision: "NOT_CANDIDATE", allowed: false, detail: "Stale commit" };
      return { committed: false, observationId: observation.id, decisionId: null, fingerprint, evaluation, gate: blocked };
    }

    const [unresolved] = await tx<{ id: string; state: string }[]>`
      select id, state from app.recovery_operations
      where workspace_id = ${ctx.workspace.id} and connection_id = ${ctx.connection.id} and subscription_id = ${ctx.request.subscription_id} and resolved_at is null
      limit 1
    `;
    const [priorVerified] = await tx<{ id: string }[]>`
      select id from app.recovery_operations where workspace_id = ${ctx.workspace.id} and task_id = ${ctx.task.id} and state = 'VERIFIED' limit 1
    `;
    const [liveProposal] = await tx<ProposalRow[]>`
      select * from app.recovery_proposals
      where workspace_id = ${ctx.workspace.id} and task_id = ${ctx.task.id} and status in ('PROPOSED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'BLOCKED')
      for update
    `;

    const gate = evaluateRecoveryGate({
      now: current,
      evaluation,
      request: { status: ctx.request.status, version: ctx.request.version, expected_period_end: new Date(ctx.request.expected_period_end).toISOString() },
      policy: { mode: ctx.policy.mode, version: ctx.policy.version, recovery_cutoff_seconds: ctx.policy.recovery_cutoff_seconds },
      workspace: { writes_paused: ctx.workspace.writes_paused },
      connection: { config_version: ctx.connection.config_version },
      proposal: null,
      has_unresolved_operation: Boolean(unresolved),
      prior_verified_recovery: Boolean(priorVerified) && evaluation.primary_reason === "SCHEDULE_MISSING",
      stage: "proposal",
    });

    const trustworthy = isTrustworthyVerdict(evaluation.primary_reason);
    const [decision] = await tx<{ id: string }[]>`
      insert into app.decisions (
        workspace_id, task_id, observation_id, request_id, request_version, evaluator_version, policy_version, verdict,
        reason_codes, comparison, facts, recovery_candidate, gate_decision, trigger, processing_version, trustworthy, evaluated_at
      ) values (
        ${ctx.workspace.id}, ${ctx.task.id}, ${observation.id}, ${ctx.request.id}, ${ctx.request.version}, ${EVALUATOR_VERSION},
        ${ctx.policy.version}, ${evaluation.verdict}, ${tx.array(evaluation.reason_codes)}, ${json(tx, evaluation.comparison)},
        ${json(tx, evaluation.facts)}, ${evaluation.recovery_candidate}, ${gate.decision}, ${trigger}, ${input.processingVersion},
        ${trustworthy}, ${current}
      )
      returning id
    `;

    // ---- Next state derivation (verdict stays separate from recovery/operation state) ----
    let processing: ProcessingState = "IDLE";
    let recovery: RecoveryState = unresolved ? (unresolved.state as RecoveryState) : ctx.task.recovery_state;
    let nextCheckAt: Date | null = null;
    let readRetryCount = read.ok ? 0 : ctx.task.read_retry_count;
    let monitoringEnded = false;

    const supersede = async (reason: string) => {
      if (!liveProposal) return;
      await tx`update app.recovery_proposals set status = 'SUPERSEDED', status_reason = ${reason} where id = ${liveProposal.id}`;
      await recordAudit(tx, {
        workspaceId: ctx.workspace.id,
        actor: input.actor,
        eventType: "recovery.superseded",
        summary: `Proposal superseded: ${reason.replaceAll("_", " ").toLowerCase()}.`,
        correlationId: input.correlationId,
        taskId: ctx.task.id,
        proposalId: liveProposal.id,
        reasonCode: reason,
      });
      if (!unresolved) recovery = "NONE";
    };

    switch (evaluation.verdict) {
      case "SATISFIED_SCHEDULED": {
        await supersede("ALREADY_SATISFIED");
        processing = "MONITORING";
        nextCheckAt = evaluation.next_check_at ? new Date(evaluation.next_check_at) : null;
        break;
      }
      case "SATISFIED_ENDED": {
        await supersede("ALREADY_SATISFIED");
        processing = unresolved ? "RECOVERING" : "IDLE";
        monitoringEnded = true;
        break;
      }
      case "UNVERIFIABLE": {
        if (evaluation.primary_reason === "FINALIZATION_PENDING") {
          processing = "WAITING_RECHECK";
          nextCheckAt = evaluation.next_check_at ? new Date(evaluation.next_check_at) : null;
        } else if (evaluation.transient) {
          if (readRetryCount < LIMITS.READ_RETRY_DELAYS_SECONDS.length) {
            const delay = LIMITS.READ_RETRY_DELAYS_SECONDS[readRetryCount];
            const jitter = Math.round(Math.random() * Math.min(15, delay * 0.1));
            nextCheckAt = new Date(current.getTime() + (delay + jitter) * 1000);
            readRetryCount += 1;
            processing = "WAITING_RECHECK";
          } else {
            processing = "ESCALATED";
            await recordAudit(tx, {
              workspaceId: ctx.workspace.id,
              actor: input.actor,
              eventType: "job.exhausted",
              summary: "Source read retries exhausted. The latest result stays Could not verify and needs attention.",
              correlationId: input.correlationId,
              taskId: ctx.task.id,
              reasonCode: evaluation.primary_reason,
            });
          }
        } else {
          processing = "ESCALATED";
        }
        if (unresolved) processing = "RECOVERING";
        break;
      }
      case "MISMATCH": {
        if (!input.allowProposal) {
          processing = unresolved || liveProposal?.status === "AUTHORIZED" ? "RECOVERING" : liveProposal?.status === "AWAITING_APPROVAL" ? "AWAITING_APPROVAL" : "ESCALATED";
          if (!evaluation.recovery_candidate) await supersede("NO_LONGER_ELIGIBLE");
          break;
        }
        const reusable =
          liveProposal &&
          (liveProposal.status === "AWAITING_APPROVAL" || liveProposal.status === "AUTHORIZED") &&
          liveProposal.source_fingerprint === fingerprint &&
          liveProposal.request_version === ctx.request.version &&
          liveProposal.policy_version === ctx.policy.version &&
          liveProposal.connection_config_version === ctx.connection.config_version &&
          new Date(liveProposal.expires_at).getTime() > current.getTime();
        if (reusable && gate.decision !== "NOT_CANDIDATE") {
          processing = liveProposal!.status === "AUTHORIZED" ? "RECOVERING" : "AWAITING_APPROVAL";
          recovery = liveProposal!.status as RecoveryState;
          break;
        }
        await supersede(evaluation.recovery_candidate ? "SOURCE_CHANGED" : "NO_LONGER_ELIGIBLE");
        switch (gate.decision) {
          case "APPROVAL_REQUIRED":
          case "EXECUTION_ALLOWED":
          case "WRITES_PAUSED": {
            if (!read.ok || !fingerprint) break;
            const expiresAt = new Date(current.getTime() + ctx.policy.approval_ttl_seconds * 1000);
            const diff = buildProposalDiff(new Date(ctx.request.expected_period_end).toISOString());
            const hash = computeProposalHash({
              task_id: ctx.task.id,
              request_id: ctx.request.id,
              request_version: ctx.request.version,
              connection_id: ctx.connection.id,
              connection_config_version: ctx.connection.config_version,
              source_account_id: ctx.request.source_account_id,
              customer_id: ctx.request.customer_id,
              subscription_id: ctx.request.subscription_id,
              expected_period_end: new Date(ctx.request.expected_period_end).toISOString(),
              source_fingerprint: fingerprint,
              policy_version: ctx.policy.version,
              expires_at: expiresAt.toISOString(),
            });
            const status =
              gate.decision === "APPROVAL_REQUIRED" ? "AWAITING_APPROVAL" : gate.decision === "EXECUTION_ALLOWED" ? "AUTHORIZED" : "BLOCKED";
            const [proposal] = await tx<{ id: string }[]>`
              insert into app.recovery_proposals (
                workspace_id, task_id, request_id, request_version, connection_id, connection_config_version, source_account_id,
                customer_id, subscription_id, expected_period_end, diff, observation_id, decision_id, source_fingerprint,
                policy_version, policy_mode, proposal_hash, status, status_reason, expires_at
              ) values (
                ${ctx.workspace.id}, ${ctx.task.id}, ${ctx.request.id}, ${ctx.request.version}, ${ctx.connection.id},
                ${ctx.connection.config_version}, ${ctx.request.source_account_id}, ${ctx.request.customer_id},
                ${ctx.request.subscription_id}, ${ctx.request.expected_period_end}, ${json(tx, diff)}, ${observation.id},
                ${decision.id}, ${fingerprint}, ${ctx.policy.version}, ${ctx.policy.mode}, ${hash}, ${status},
                ${gate.decision === "WRITES_PAUSED" ? "WRITES_PAUSED" : null}, ${expiresAt}
              )
              returning id
            `;
            await recordAudit(tx, {
              workspaceId: ctx.workspace.id,
              actor: SYSTEM_ACTOR,
              eventType: "recovery.proposed",
              summary:
                status === "AWAITING_APPROVAL"
                  ? "Schedule period-end cancellation proposed. Awaiting owner approval."
                  : status === "AUTHORIZED"
                    ? "Schedule period-end cancellation proposed under the auto-recover policy."
                    : "Schedule period-end cancellation proposed, but recovery writes are paused.",
              correlationId: input.correlationId,
              taskId: ctx.task.id,
              proposalId: proposal.id,
              policyVersion: ctx.policy.version,
              after: { action: RECOVERY_ACTION, cancel_at_period_end: { before: false, after: true }, expires_at: expiresAt.toISOString() },
            });
            if (status === "AUTHORIZED") {
              await tx`
                insert into app.approval_decisions (workspace_id, proposal_id, proposal_hash, decision, actor_type, actor_id, actor_label, reason, policy_version, correlation_id)
                values (${ctx.workspace.id}, ${proposal.id}, ${hash}, 'AUTO_POLICY', 'SYSTEM', ${SYSTEM_ACTOR.id}, 'Auto-recover policy', ${`Policy version ${ctx.policy.version} permits this bounded recovery.`}, ${ctx.policy.version}, ${input.correlationId})
              `;
              await recordAudit(tx, {
                workspaceId: ctx.workspace.id,
                actor: SYSTEM_ACTOR,
                eventType: "recovery.auto_authorized",
                summary: `Recovery authorized by policy version ${ctx.policy.version}. Proofwork will re-check the source before writing.`,
                correlationId: input.correlationId,
                taskId: ctx.task.id,
                proposalId: proposal.id,
                policyVersion: ctx.policy.version,
              });
              await enqueueJob(tx, {
                kind: "RECOVER",
                workspaceId: ctx.workspace.id,
                taskId: ctx.task.id,
                dedupeKey: `recover:${proposal.id}`,
                payload: { proposal_id: proposal.id },
                correlationId: input.correlationId,
              });
              processing = "RECOVERING";
              recovery = "AUTHORIZED";
            } else if (status === "AWAITING_APPROVAL") {
              processing = "AWAITING_APPROVAL";
              recovery = "AWAITING_APPROVAL";
            } else {
              processing = "IDLE";
              recovery = "BLOCKED";
            }
            break;
          }
          case "OBSERVE_ONLY":
            processing = "IDLE";
            if (!unresolved) recovery = "NONE";
            break;
          case "OPERATION_UNRESOLVED":
            processing = "RECOVERING";
            break;
          case "NOT_CANDIDATE":
            processing = "ESCALATED";
            break;
          default:
            // CUTOFF_REACHED, PRIOR_REVERSAL, REQUEST_NOT_ACTIVE: needs a person.
            processing = "ESCALATED";
            if (!unresolved) recovery = "BLOCKED";
        }
        break;
      }
      case "OUT_OF_SCOPE": {
        await supersede("NO_LONGER_ELIGIBLE");
        processing = unresolved ? "RECOVERING" : "IDLE";
        break;
      }
    }

    if (ctx.task.retired_at && !unresolved) {
      processing = "IDLE";
      nextCheckAt = null;
    }

    await tx`
      update app.tasks set
        verdict = ${evaluation.verdict},
        primary_reason_code = ${evaluation.primary_reason},
        processing_state = ${processing},
        recovery_state = ${recovery},
        gate_decision = ${gate.decision},
        latest_decision_id = ${decision.id},
        latest_trustworthy_decision_id = ${trustworthy ? decision.id : ctx.task.latest_trustworthy_decision_id},
        last_checked_at = ${current},
        last_trustworthy_read_at = ${trustworthy && read.ok ? new Date(read.observed_at) : ctx.task.last_trustworthy_read_at},
        next_check_at = ${nextCheckAt},
        read_retry_count = ${readRetryCount},
        first_verified_at = case when ${evaluation.verdict.startsWith("SATISFIED")} and first_verified_at is null then ${current} else first_verified_at end,
        monitoring_ended_at = case when ${monitoringEnded} then coalesce(monitoring_ended_at, ${current}) else monitoring_ended_at end
      where workspace_id = ${ctx.workspace.id} and id = ${ctx.task.id}
    `;

    if (nextCheckAt && !ctx.task.retired_at) {
      const retry = evaluation.transient && evaluation.primary_reason !== "FINALIZATION_PENDING";
      await enqueueJob(tx, {
        kind: retry ? "RECHECK" : "MONITOR",
        workspaceId: ctx.workspace.id,
        taskId: ctx.task.id,
        dedupeKey: retry ? `verify:${ctx.task.id}` : `monitor:${ctx.task.id}`,
        payload: { trigger: retry ? "RETRY" : "MONITOR" },
        dueAt: nextCheckAt,
        correlationId: input.correlationId,
      });
    }

    await recordAudit(tx, {
      workspaceId: ctx.workspace.id,
      actor: input.actor,
      eventType: "verification.recorded",
      summary: `${VERDICT_LABELS[evaluation.verdict].label}: ${REASON_COPY[evaluation.primary_reason].title}.`,
      correlationId: input.correlationId,
      taskId: ctx.task.id,
      requestId: ctx.request.id,
      evaluatorVersion: EVALUATOR_VERSION,
      policyVersion: ctx.policy.version,
      reasonCode: evaluation.primary_reason,
      after: { verdict: evaluation.verdict, trigger, observation_id: observation.id, provider_request_id: read.provider_request_id },
    });

    return { committed: true, observationId: observation.id, decisionId: decision.id, fingerprint, evaluation, gate };
  }) as Promise<RecordEvaluationResult>;
}

/** Worker handler for VERIFY / RECHECK / MONITOR jobs. */
export async function processVerificationJob(sql: Sql, job: JobRow, workerName: string): Promise<Record<string, unknown>> {
  if (!job.workspace_id || !job.task_id) return { skipped: "missing task" };
  const ctx = await loadTaskContext(sql, job.workspace_id, job.task_id);
  const trigger = ((job.payload?.trigger as CheckTrigger | undefined) ?? (job.kind === "MONITOR" ? "MONITOR" : "CLAIM")) as CheckTrigger;
  if (ctx.task.retired_at && trigger !== "MANUAL") return { skipped: "task retired" };
  const version = await beginProcessing(sql, ctx.workspace.id, ctx.task.id, "VERIFYING");
  ctx.task.processing_version = version;
  const read = await readSource(ctx, "read");
  const result = await recordEvaluation(sql, {
    ctx,
    read,
    trigger,
    processingVersion: version,
    actor: WORKER_ACTOR(workerName),
    correlationId: job.correlation_id,
    allowProposal: true,
    job,
  });
  return { committed: result.committed, verdict: result.evaluation.verdict, reason: result.evaluation.primary_reason, gate: result.gate.decision };
}
