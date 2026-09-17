import { getSql, listTasks } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const GET = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const p = req.nextUrl.searchParams;
  const data = await listTasks(getSql(), ctx, {
    status: p.get("status") ?? undefined,
    q: p.get("q") ?? undefined,
    range: p.get("range") ?? undefined,
    page: Number(p.get("page") ?? 1) || 1,
  });
  return json(data, correlationId);
});
