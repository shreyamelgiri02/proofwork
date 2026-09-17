import { acceptClaim, enforceRateLimit, getSql } from "@proofwork/database";
import { AppError, claimSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

/** Human submission of an agent's report. Uses the same service as the ingestion API. */
export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[A-Za-z0-9_:\-]{8,200}$/.test(idempotencyKey)) {
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required.");
  }
  const input = await parseBody(req, claimSchema);
  const sql = getSql();
  await enforceRateLimit(sql, `claims-ui:${ctx.workspace.id}`, 60, 60);
  const result = await acceptClaim(
    sql,
    ctx,
    { authorized_request_id: input.authorized_request_id, agent_name: input.agent_name, report_text: input.report_text },
    { sourceKind: ctx.workspace.kind === "DEMO" ? "DEMO" : "HUMAN", idempotencyKey },
  );
  return json({ ...result, status_url: `/app/tasks/${result.task_id}` }, correlationId, { status: result.duplicate ? 200 : 202 });
});
