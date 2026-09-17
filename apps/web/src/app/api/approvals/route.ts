import { getSql, getWorkspace, listApprovals, type ApprovalFilter } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const GET = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const raw = req.nextUrl.searchParams.get("filter");
  const filter: ApprovalFilter = raw === "decided" || raw === "all" ? raw : "waiting";
  const sql = getSql();
  const [data, workspace] = await Promise.all([listApprovals(sql, ctx, filter), getWorkspace(sql, ctx.workspace.id)]);
  return json({ ...data, workspace: { timezone: workspace.timezone, writes_paused: workspace.writes_paused } }, correlationId);
});
