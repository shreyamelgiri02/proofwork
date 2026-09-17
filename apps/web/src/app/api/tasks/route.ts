import { getSql, listTasks } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

export const GET = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const p = req.nextUrl.searchParams;

  if (!isDatabaseReady()) {
    const { listStandaloneTasks } = await import("@/lib/standalone-demo");
    const data = listStandaloneTasks(ctx.workspace.id, {
      status: p.get("status") ?? undefined,
      q: p.get("q") ?? undefined,
      range: p.get("range") ?? undefined,
      page: Number(p.get("page") ?? 1) || 1,
    });
    return json(data, correlationId);
  }

  const data = await listTasks(getSql(), ctx, {
    status: p.get("status") ?? undefined,
    q: p.get("q") ?? undefined,
    range: p.get("range") ?? undefined,
    page: Number(p.get("page") ?? 1) || 1,
  });
  return json(data, correlationId);
});
