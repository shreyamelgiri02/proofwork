import { getSql, recordManualIntervention } from "@proofwork/database";
import { AppError, interventionSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

export const POST = route<{ taskId: string }>(async (req, { params, correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  if (!/^[0-9a-f-]{36}$/.test(params.taskId)) throw new AppError("NOT_FOUND", "Task not found.");
  const input = await parseBody(req, interventionSchema, 2048);

  if (!isDatabaseReady()) {
    const { recordStandaloneIntervention } = await import("@/lib/standalone-demo");
    return json(recordStandaloneIntervention(ctx.workspace.id, params.taskId, input), correlationId, { status: 201 });
  }

  return json(await recordManualIntervention(getSql(), ctx, params.taskId, input), correlationId, { status: 201 });
});
