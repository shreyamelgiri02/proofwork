import { createPolicyVersion, getSql, getWorkspace } from "@proofwork/database";
import { AppError, policySchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId, { allowIncompleteOnboarding: true });
  const input = await parseBody(req, policySchema, 2048);
  const sql = getSql();
  const workspace = await getWorkspace(sql, ctx.workspace.id);
  if (workspace.onboarding_step < 1) throw new AppError("ONBOARDING_INCOMPLETE", "Name the workspace first.");
  if (input.mode === "AUTO_RECOVER" && !input.confirmAutoRecover) {
    throw new AppError("INVALID_PAYLOAD", "Confirm that Proofwork may automatically schedule period-end cancellations.", {
      fieldErrors: { confirmAutoRecover: ["Confirmation is required for automatic recovery."] },
    });
  }
  const policy = await createPolicyVersion(sql, ctx, { mode: input.mode, reason: "Chosen during onboarding" }, { onboarding: true });
  return json({ version: policy.version, mode: policy.mode }, correlationId);
});
