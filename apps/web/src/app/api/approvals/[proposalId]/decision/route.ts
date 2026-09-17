import { decideApproval, getSql } from "@proofwork/database";
import { AppError, approvalDecisionSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

/** Records an approval or rejection. Never reports the billing change as done. */
export const POST = route<{ proposalId: string }>(async (req, { params, correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  if (!/^[0-9a-f-]{36}$/.test(params.proposalId)) throw new AppError("NOT_FOUND", "Proposal not found.");
  const input = await parseBody(req, approvalDecisionSchema, 2048);

  if (!isDatabaseReady()) {
    const { decideStandaloneApproval } = await import("@/lib/standalone-demo");
    const result = decideStandaloneApproval(ctx.workspace.id, params.proposalId, input);
    return json(result, correlationId);
  }

  const result = await decideApproval(getSql(), ctx, params.proposalId, input);
  return json(result, correlationId);
});
