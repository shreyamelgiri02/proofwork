import { getSql, requestRecheck } from "@proofwork/database";
import { AppError } from "@proofwork/domain";
import { json, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

export const POST = route<{ taskId: string }>(async (_req, { params, correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  if (!/^[0-9a-f-]{36}$/.test(params.taskId)) throw new AppError("NOT_FOUND", "Task not found.");

  if (!isDatabaseReady()) {
    const { recheckStandaloneTask } = await import("@/lib/standalone-demo");
    return json(recheckStandaloneTask(ctx.workspace.id, params.taskId), correlationId, { status: 202 });
  }

  return json(await requestRecheck(getSql(), ctx, params.taskId), correlationId, { status: 202 });
});
