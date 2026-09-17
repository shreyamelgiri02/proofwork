import { z } from "zod";
import { enforceRateLimit, expireProposalNow, getSql, queueCompetingRecovery } from "@proofwork/database";
import { LIMITS } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

const bodySchema = z.object({
  task_id: z.string().uuid(),
  control: z.enum(["EXPIRE_PROPOSAL", "QUEUE_COMPETING_RECOVERY"]),
});

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const input = await parseBody(req, bodySchema, 512);
  const sql = getSql();
  await enforceRateLimit(sql, `demo:cmd:${ctx.workspace.id}`, LIMITS.DEMO_COMMANDS_PER_MINUTE, 60);
  const result = input.control === "EXPIRE_PROPOSAL" ? await expireProposalNow(sql, ctx, input.task_id) : await queueCompetingRecovery(sql, ctx, input.task_id);
  return json({ ...result, control: input.control }, correlationId);
});
