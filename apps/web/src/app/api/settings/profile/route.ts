import { getSql, saveWorkspaceProfile } from "@proofwork/database";
import { workspaceProfileSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const PATCH = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const input = await parseBody(req, workspaceProfileSchema, 2048);
  const workspace = await saveWorkspaceProfile(getSql(), ctx, input);
  return json({ organization: workspace.organization, name: workspace.name, timezone: workspace.timezone }, correlationId);
});
