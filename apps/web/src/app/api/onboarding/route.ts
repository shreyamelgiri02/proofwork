import { getCurrentPolicy, getSql, getWorkspace, listConnections } from "@proofwork/database";
import { AppError } from "@proofwork/domain";
import { json, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const GET = route(async (_req, { correlationId }) => {
  const { session, ctx } = await requireContext(correlationId, { allowIncompleteOnboarding: true });
  if (session.kind !== "user") throw new AppError("PERMISSION_DENIED", "Onboarding applies to private workspaces.");
  const sql = getSql();
  const [workspace, policy, connections] = await Promise.all([getWorkspace(sql, ctx.workspace.id), getCurrentPolicy(sql, ctx.workspace.id), listConnections(sql, ctx)]);
  return json(
    {
      step: workspace.onboarding_step,
      completed: Boolean(workspace.onboarding_completed_at),
      profile: {
        organization: workspace.organization || session.user.organization || "",
        name: workspace.name,
        timezone: workspace.timezone,
      },
      policy: policy ? { mode: policy.mode, version: policy.version } : null,
      sources: connections,
      identity: { display_name: session.user.displayName, email: session.user.email },
    },
    correlationId,
  );
});
