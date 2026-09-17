import { getActiveConnection, getSql, getTaskDetail, getWorkspace, scenarioControlsEnabled } from "@proofwork/database";
import { AppError } from "@proofwork/domain";
import { json, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const GET = route<{ taskId: string }>(async (_req, { params, correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  if (!/^[0-9a-f-]{36}$/.test(params.taskId)) throw new AppError("NOT_FOUND", "Task not found.");
  const sql = getSql();
  const [detail, workspace, connection] = await Promise.all([
    getTaskDetail(sql, ctx, params.taskId),
    getWorkspace(sql, ctx.workspace.id),
    getActiveConnection(sql, ctx.workspace.id),
  ]);
  return json(
    {
      ...detail,
      workspace: { timezone: workspace.timezone, writes_paused: workspace.writes_paused, kind: workspace.kind },
      scenario_controls: scenarioControlsEnabled(workspace.kind, connection?.adapter),
    },
    correlationId,
  );
});
