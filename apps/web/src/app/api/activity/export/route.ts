import { exportActivityCsv, getSql } from "@proofwork/database";
import { route } from "@/lib/api";
import { requireContext } from "@/lib/session";

/** CSV export of exactly the selected filter scope, re-authorized server-side, formula-safe. */
export const GET = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const p = req.nextUrl.searchParams;
  const generator = exportActivityCsv(getSql(), ctx, {
    type: p.get("type") ?? undefined,
    actor: p.get("actor") ?? undefined,
    q: p.get("q") ?? undefined,
    range: p.get("range") ?? undefined,
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    taskId: /^[0-9a-f-]{36}$/.test(p.get("task") ?? "") ? p.get("task")! : undefined,
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await generator.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch {
        controller.error(new Error("export failed"));
      }
    },
  });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const label = ctx.workspace.kind === "DEMO" ? "demo" : "workspace";
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="proofwork-activity-${label}-${stamp}.csv"`,
      "cache-control": "no-store",
      "x-correlation-id": correlationId,
    },
  });
});
