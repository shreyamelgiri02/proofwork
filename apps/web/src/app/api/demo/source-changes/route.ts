import { applySourceChange, enforceRateLimit, getSql } from "@proofwork/database";
import { LIMITS, sourceChangeSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const input = await parseBody(req, sourceChangeSchema, 512);
  const sql = getSql();
  await enforceRateLimit(sql, `demo:cmd:${ctx.workspace.id}`, LIMITS.DEMO_COMMANDS_PER_MINUTE, 60);
  await applySourceChange(sql, ctx, input.task_id, input.change);
  return json({ applied: true, message: "Synthetic source changed. Proofwork has not read it yet — use Check now." }, correlationId);
});
