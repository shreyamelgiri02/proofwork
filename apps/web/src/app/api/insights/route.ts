import { getActiveConnection, getInsights, getSql, getWorkspace } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

export const GET = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);

  if (!isDatabaseReady()) {
    const { getStandaloneInsights, getStandaloneWorkspace } = await import("@/lib/standalone-demo");
    const data = getStandaloneInsights(ctx.workspace.id, { range: req.nextUrl.searchParams.get("range") ?? undefined });
    const workspace = getStandaloneWorkspace(ctx.workspace.id);
    return json(
      {
        ...data,
        workspace: { timezone: workspace.timezone, kind: workspace.kind, organization: workspace.organization },
        source: { adapter: "LOCAL_SANDBOX", display_name: "Simulated Billing Sandbox" },
      },
      correlationId,
    );
  }

  const sql = getSql();
  const [data, workspace, connection] = await Promise.all([
    getInsights(sql, ctx, { range: req.nextUrl.searchParams.get("range") ?? undefined }),
    getWorkspace(sql, ctx.workspace.id),
    getActiveConnection(sql, ctx.workspace.id),
  ]);
  return json({ ...data, workspace: { timezone: workspace.timezone, kind: workspace.kind, organization: workspace.organization }, source: connection ? { adapter: connection.adapter, display_name: connection.display_name } : null }, correlationId);
});
