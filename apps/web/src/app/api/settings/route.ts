import { getOperationsHealth, getSql, getWorkspace, listConnections, listTokens } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const GET = route(async (_req, { correlationId }) => {
  const { session, ctx } = await requireContext(correlationId);
  const sql = getSql();
  const [workspace, policies, connections, tokens, health] = await Promise.all([
    getWorkspace(sql, ctx.workspace.id),
    sql`
      select version, mode, changed_by_label, change_reason, created_at from app.policy_versions
      where workspace_id = ${ctx.workspace.id} order by version desc limit 20
    `,
    listConnections(sql, ctx),
    ctx.workspace.kind === "PRIVATE" ? listTokens(sql, ctx) : Promise.resolve([]),
    getOperationsHealth(sql, ctx),
  ]);
  return json(
    {
      workspace: {
        id: workspace.id,
        kind: workspace.kind,
        organization: workspace.organization,
        name: workspace.name,
        timezone: workspace.timezone,
        writes_paused: workspace.writes_paused,
        writes_paused_reason: workspace.writes_paused_reason,
        writes_paused_at: workspace.writes_paused_at,
        current_policy_version: workspace.current_policy_version,
        expires_at: workspace.expires_at,
      },
      policies,
      connections,
      tokens,
      health,
      account:
        session.kind === "user"
          ? { kind: "user", display_name: session.user.displayName, email: session.user.email, role: "OWNER" }
          : { kind: "demo", display_name: "Demo operator", email: null, role: "DEMO_OPERATOR", expires_at: session.expiresAt },
      ingestion: { endpoint: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/v1/claims` },
    },
    correlationId,
  );
});
