import { getSql, retireRequest } from "@proofwork/database";
import { AppError, retireTaskSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const POST = route<{ requestId: string }>(async (req, { params, correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  if (!/^[0-9a-f-]{36}$/.test(params.requestId)) throw new AppError("NOT_FOUND", "Request not found.");
  const { reason } = await parseBody(req, retireTaskSchema, 1024);
  const request = await retireRequest(getSql(), ctx, params.requestId, reason);
  return json({ id: request.id, status: request.status }, correlationId);
});
