import { getSql, retireTask } from "@proofwork/database";
import { AppError, retireTaskSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

export const POST = route<{ taskId: string }>(async (req, { params, correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  if (!/^[0-9a-f-]{36}$/.test(params.taskId)) throw new AppError("NOT_FOUND", "Task not found.");
  const { reason } = await parseBody(req, retireTaskSchema, 1024);

  if (!isDatabaseReady()) {
    const { retireStandaloneTask } = await import("@/lib/standalone-demo");
    return json(retireStandaloneTask(ctx.workspace.id, params.taskId, reason), correlationId);
  }

  return json(await retireTask(getSql(), ctx, params.taskId, reason), correlationId);
});
