import { getActiveConnection, getInsights, getSql, getWorkspace } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const GET = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const sql = getSql();
  const [data, workspace, connection] = await Promise.all([
    getInsights(sql, ctx, { range: req.nextUrl.searchParams.get("range") ?? undefined }),
    getWorkspace(sql, ctx.workspace.id),
    getActiveConnection(sql, ctx.workspace.id),
  ]);
  return json({ ...data, workspace: { timezone: workspace.timezone, kind: workspace.kind, organization: workspace.organization }, source: connection ? { adapter: connection.adapter, display_name: connection.display_name } : null }, correlationId);
});
