import { enforceRateLimit, getSql, previewRequest } from "@proofwork/database";
import { previewRequestSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const input = await parseBody(req, previewRequestSchema, 2048);
  const sql = getSql();
  await enforceRateLimit(sql, `preview:${ctx.workspace.id}`, 30, 60);
  return json(await previewRequest(sql, ctx, input), correlationId);
});
