import { getSql, getWorkspace, listActivity } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

export const GET = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const p = req.nextUrl.searchParams;

  if (!isDatabaseReady()) {
    const { listStandaloneActivity, getStandaloneWorkspace } = await import("@/lib/standalone-demo");
    const data = listStandaloneActivity(ctx.workspace.id, {
      type: p.get("type") ?? undefined,
      actor: p.get("actor") ?? undefined,
      q: p.get("q") ?? undefined,
      range: p.get("range") ?? undefined,
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      taskId: /^[0-9a-f-]{36}$/.test(p.get("task") ?? "") ? p.get("task")! : undefined,
      page: Number(p.get("page") ?? 1) || 1,
    });
    const workspace = getStandaloneWorkspace(ctx.workspace.id);
    return json({ ...data, workspace: { timezone: workspace.timezone, kind: workspace.kind } }, correlationId);
  }

  const sql = getSql();
  const [data, workspace] = await Promise.all([
    listActivity(sql, ctx, {
      type: p.get("type") ?? undefined,
      actor: p.get("actor") ?? undefined,
      q: p.get("q") ?? undefined,
      range: p.get("range") ?? undefined,
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      taskId: /^[0-9a-f-]{36}$/.test(p.get("task") ?? "") ? p.get("task")! : undefined,
      page: Number(p.get("page") ?? 1) || 1,
    }),
    getWorkspace(sql, ctx.workspace.id),
  ]);
  return json({ ...data, workspace: { timezone: workspace.timezone, kind: workspace.kind } }, correlationId);
});
