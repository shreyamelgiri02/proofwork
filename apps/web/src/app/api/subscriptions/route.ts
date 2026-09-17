import { getSql, listSourceSubscriptions } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

/** Limited listing for authorized selection. The selection is never trusted as authority by itself. */
export const GET = route(async (_req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  return json(await listSourceSubscriptions(getSql(), ctx), correlationId);
});
