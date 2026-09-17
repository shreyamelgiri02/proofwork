import { getSql, revokeToken } from "@proofwork/database";
import { AppError } from "@proofwork/domain";
import { json, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const POST = route<{ tokenId: string }>(async (_req, { params, correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  if (!/^[0-9a-f-]{36}$/.test(params.tokenId)) throw new AppError("NOT_FOUND", "Token not found.");
  await revokeToken(getSql(), ctx, params.tokenId);
  return json({ revoked: true }, correlationId);
});
