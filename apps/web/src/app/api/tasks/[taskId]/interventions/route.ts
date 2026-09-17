import { getSql, recordManualIntervention } from "@proofwork/database";
import { AppError, interventionSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const POST = route<{ taskId: string }>(async (req, { params, correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  if (!/^[0-9a-f-]{36}$/.test(params.taskId)) throw new AppError("NOT_FOUND", "Task not found.");
  const input = await parseBody(req, interventionSchema, 2048);
  return json(await recordManualIntervention(getSql(), ctx, params.taskId, input), correlationId, { status: 201 });
});
