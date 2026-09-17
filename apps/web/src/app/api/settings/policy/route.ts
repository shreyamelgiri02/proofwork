import { createPolicyVersion, getSql } from "@proofwork/database";
import { AppError, policySchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const input = await parseBody(req, policySchema, 2048);
  if (input.mode === "AUTO_RECOVER" && !input.confirmAutoRecover) {
    throw new AppError("INVALID_PAYLOAD", "Confirm that Proofwork may automatically schedule period-end cancellations.", {
      fieldErrors: { confirmAutoRecover: ["Confirmation is required for automatic recovery."] },
    });
  }
  const policy = await createPolicyVersion(getSql(), ctx, { mode: input.mode, reason: input.reason }, { allowDemo: true });
  return json({ version: policy.version, mode: policy.mode, message: `Recovery policy saved as version ${policy.version}. Incompatible proposals were invalidated.` }, correlationId);
});
