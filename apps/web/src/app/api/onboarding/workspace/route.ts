import { getSql, saveWorkspaceProfile } from "@proofwork/database";
import { workspaceProfileSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId, { allowIncompleteOnboarding: true });
  const input = await parseBody(req, workspaceProfileSchema, 2048);
  const workspace = await saveWorkspaceProfile(getSql(), ctx, input, { onboarding: true });
  return json({ step: workspace.onboarding_step }, correlationId);
});
