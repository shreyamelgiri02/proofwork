import { acceptClaim, authenticateIngestionToken, enforceRateLimit, getSql } from "@proofwork/database";
import { AppError, ingestionClaimSchema, LIMITS } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";

/**
 * POST /api/v1/claims — authenticated ingestion for external AI employees.
 * Auth: `Authorization: Bearer pwk_…` (scoped, revocable, hashed at rest).
 * The workspace is derived from the token. The agent cannot define the target outcome.
 * Returns 202 Accepted with receipt/task ids — never "verified".
 */
export const POST = route(
  async (req, { correlationId }) => {
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
    const sql = getSql();
    const credential = await authenticateIngestionToken(sql, token);
    if (!credential) throw new AppError("INVALID_INGESTION_TOKEN", "A valid, non-revoked ingestion token is required.");
    await enforceRateLimit(sql, `ingest:${credential.credentialId}`, LIMITS.INGESTION_RATE_PER_MINUTE, 60);

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey || !/^[A-Za-z0-9_:\-.]{8,200}$/.test(idempotencyKey)) {
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header (8–200 URL-safe characters) is required.");
    }
    const body = await parseBody(req, ingestionClaimSchema, LIMITS.INGESTION_BODY_MAX_BYTES);
    const result = await acceptClaim(
      sql,
      { workspace: { id: credential.workspaceId, kind: "PRIVATE" }, actor: credential.actor, correlationId },
      {
        authorized_request_id: body.authorized_request_id,
        agent_name: body.agent.name,
        agent_reference: body.agent.reference ?? null,
        report_text: body.report_text,
        claimed_at: body.claimed_at ?? null,
      },
      { sourceKind: "API", idempotencyKey, credentialId: credential.credentialId },
    );
    return json(
      {
        accepted: true,
        duplicate: result.duplicate,
        receipt_id: result.receipt_id,
        task_id: result.task_id,
        verification: { verdict: result.verdict, processing_state: result.processing_state },
        status_url: result.status_url,
        correlation_id: correlationId,
      },
      correlationId,
      { status: result.duplicate ? 200 : 202 },
    );
  },
  { csrf: false },
);
