import { AppError, canonicalJson, now, type ProcessingState, type Verdict } from "@proofwork/domain";
import { recordAudit } from "./audit";
import { isUniqueViolation, type Sql } from "./client";
import type { ServiceContext } from "./context";
import { sha256 } from "./crypto";
import { enqueueJob } from "./jobs";
import type { AuthorizedRequestRow } from "./requests";

export interface ClaimSubmission {
  authorized_request_id: string;
  agent_name: string;
  agent_reference?: string | null;
  report_text: string;
  claimed_at?: string | null;
}

export interface ClaimAcceptance {
  accepted: true;
  duplicate: boolean;
  receipt_id: string;
  task_id: string;
  verdict: Verdict;
  processing_state: ProcessingState;
  status_url: string;
}

interface ReceiptLookup {
  id: string;
  task_id: string;
  payload_hash: string;
  verdict: Verdict;
  processing_state: ProcessingState;
}

const statusUrl = (taskId: string) => `/api/v1/tasks/${taskId}`;

async function findReceipt(sql: Sql, workspaceId: string, producerIdentity: string, idempotencyKey: string) {
  const [row] = await sql<ReceiptLookup[]>`
    select r.id, r.task_id, r.payload_hash, t.verdict, t.processing_state
    from app.claim_receipts r join app.tasks t on t.workspace_id = r.workspace_id and t.id = r.task_id
    where r.workspace_id = ${workspaceId} and r.producer_identity = ${producerIdentity} and r.idempotency_key = ${idempotencyKey}
  `;
  return row ?? null;
}

async function recordRejection(sql: Sql, ctx: ServiceContext, reason: string, submissionHash: string) {
  await sql`
    insert into app.ingestion_rejections (workspace_id, producer_identity, reason_code, submission_hash, correlation_id)
    values (${ctx.workspace.id}, ${ctx.actor.id}, ${reason}, ${submissionHash}, ${ctx.correlationId})
  `.catch(() => undefined);
}

/**
 * Accept an agent's completion claim (UI or ingestion API share this service).
 * One transaction: validate authority → receipt → task → verification job → audit.
 * The response never says "verified": verification happens later in the worker.
 */
export async function acceptClaim(
  sql: Sql,
  ctx: ServiceContext,
  submission: ClaimSubmission,
  opts: { sourceKind: "API" | "HUMAN" | "DEMO"; idempotencyKey: string; credentialId?: string | null },
): Promise<ClaimAcceptance> {
  const producerIdentity = ctx.actor.id;
  const canonical = canonicalJson({
    authorized_request_id: submission.authorized_request_id,
    agent_name: submission.agent_name,
    agent_reference: submission.agent_reference ?? null,
    report_text: submission.report_text,
    claimed_at: submission.claimed_at ?? null,
  });
  const payloadHash = sha256(canonical);

  // Identical duplicates resolve first — even outside the timestamp window.
  const existing = await findReceipt(sql, ctx.workspace.id, producerIdentity, opts.idempotencyKey);
  if (existing) {
    if (existing.payload_hash !== payloadHash) {
      await recordRejection(sql, ctx, "DUPLICATE_PAYLOAD_CONFLICT", payloadHash);
      throw new AppError("DUPLICATE_PAYLOAD_CONFLICT", "This Idempotency-Key was already used with a different payload.");
    }
    await recordAudit(sql, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "claim.duplicate_returned",
      summary: "Identical claim resubmitted; the original receipt was returned.",
      correlationId: ctx.correlationId,
      taskId: existing.task_id,
    });
    return { accepted: true, duplicate: true, receipt_id: existing.id, task_id: existing.task_id, verdict: existing.verdict, processing_state: existing.processing_state, status_url: statusUrl(existing.task_id) };
  }

  if (opts.sourceKind === "API" && submission.claimed_at) {
    const claimed = new Date(submission.claimed_at).getTime();
    const current = now().getTime();
    if (Number.isNaN(claimed) || claimed < current - 24 * 3600 * 1000 || claimed > current + 5 * 60 * 1000) {
      await recordRejection(sql, ctx, "CLAIM_TIMESTAMP_OUT_OF_WINDOW", payloadHash);
      throw new AppError("INVALID_PAYLOAD", "claimed_at must be within the last 24 hours and no more than 5 minutes in the future.", {
        fieldErrors: { claimed_at: ["Out of accepted window."] },
      });
    }
  }

  try {
    return (await sql.begin(async (tx) => {
      const [request] = await tx<AuthorizedRequestRow[]>`
        select * from app.authorized_requests
        where workspace_id = ${ctx.workspace.id} and id = ${submission.authorized_request_id}
        for share
      `;
      if (!request) {
        throw new AppError("NOT_FOUND", "The authorized request was not found in this workspace.");
      }
      if (request.status !== "ACTIVE") {
        throw new AppError("REQUEST_NOT_ACTIVE", "This authorized request is no longer active. Submit reports against the current request version.");
      }

      let created = true;
      let [task] = await tx<{ id: string; verdict: Verdict; processing_state: ProcessingState; retired_at: Date | null }[]>`
        insert into app.tasks (workspace_id, request_id, agent_name)
        values (${ctx.workspace.id}, ${request.id}, ${submission.agent_name})
        on conflict (workspace_id, request_id) do nothing
        returning id, verdict, processing_state, retired_at
      `;
      if (!task) {
        created = false;
        [task] = await tx<{ id: string; verdict: Verdict; processing_state: ProcessingState; retired_at: Date | null }[]>`
          select id, verdict, processing_state, retired_at from app.tasks
          where workspace_id = ${ctx.workspace.id} and request_id = ${request.id} for update
        `;
      }

      const [receipt] = await tx<{ id: string }[]>`
        insert into app.claim_receipts (
          workspace_id, task_id, request_id, producer_identity, credential_id, idempotency_key, agent_name, agent_reference,
          report_text, payload_hash, source_kind, claimed_at, correlation_id
        ) values (
          ${ctx.workspace.id}, ${task.id}, ${request.id}, ${producerIdentity}, ${opts.credentialId ?? null}, ${opts.idempotencyKey},
          ${submission.agent_name}, ${submission.agent_reference ?? null}, ${submission.report_text}, ${payloadHash}, ${opts.sourceKind},
          ${submission.claimed_at ? new Date(submission.claimed_at) : null}, ${ctx.correlationId}
        )
        returning id
      `;

      // Documented rule: additional receipts for the same request version attach to the
      // same logical task and request one deduplicated re-read; they never add a task.
      if (!task.retired_at) {
        await enqueueJob(tx as unknown as Sql, {
          kind: created ? "VERIFY" : "RECHECK",
          workspaceId: ctx.workspace.id,
          taskId: task.id,
          dedupeKey: `verify:${task.id}`,
          payload: { trigger: "CLAIM", receipt_id: receipt.id },
          correlationId: ctx.correlationId,
        });
        if (created) {
          await tx`update app.tasks set processing_state = 'QUEUED' where id = ${task.id}`;
        }
      }

      await recordAudit(tx as unknown as Sql, {
        workspaceId: ctx.workspace.id,
        actor: ctx.actor,
        eventType: created ? "claim.accepted" : "claim.additional_receipt",
        summary: created
          ? `Report received from ${submission.agent_name}. Verification queued.`
          : `Additional report from ${submission.agent_name} attached to the existing task.`,
        correlationId: ctx.correlationId,
        taskId: task.id,
        requestId: request.id,
        after: { receipt_id: receipt.id, source_kind: opts.sourceKind, payload_hash: payloadHash },
      });

      return {
        accepted: true as const,
        duplicate: false,
        receipt_id: receipt.id,
        task_id: task.id,
        verdict: created ? ("PENDING" as Verdict) : task.verdict,
        processing_state: created ? ("QUEUED" as ProcessingState) : task.processing_state,
        status_url: statusUrl(task.id),
      };
    })) as ClaimAcceptance;
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Concurrent duplicate: the database guaranteed one accepted receipt. Resolve it.
      const winner = await findReceipt(sql, ctx.workspace.id, producerIdentity, opts.idempotencyKey);
      if (winner) {
        if (winner.payload_hash !== payloadHash) throw new AppError("DUPLICATE_PAYLOAD_CONFLICT", "This Idempotency-Key was already used with a different payload.");
        return { accepted: true, duplicate: true, receipt_id: winner.id, task_id: winner.task_id, verdict: winner.verdict, processing_state: winner.processing_state, status_url: statusUrl(winner.task_id) };
      }
    }
    if (err instanceof AppError && (err.code === "REQUEST_NOT_ACTIVE" || err.code === "NOT_FOUND")) {
      await recordRejection(sql, ctx, err.code, payloadHash);
    }
    throw err;
  }
}
