import { createToken, getSql, listTokens } from "@proofwork/database";
import { tokenCreateSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const GET = route(async (_req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  return json({ tokens: ctx.workspace.kind === "PRIVATE" ? await listTokens(getSql(), ctx) : [] }, correlationId);
});

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const input = await parseBody(req, tokenCreateSchema, 1024);
  const { token, summary } = await createToken(getSql(), ctx, input.name);
  // The full token is returned exactly once and never stored in plain text.
  return json({ token, summary, notice: "Copy this token now. It will not be shown again." }, correlationId, { status: 201 });
});
