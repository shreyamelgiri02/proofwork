import { getSql, setWritesPaused } from "@proofwork/database";
import { pauseSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const input = await parseBody(req, pauseSchema, 1024);
  const workspace = await setWritesPaused(getSql(), ctx, input);
  return json(
    {
      writes_paused: workspace.writes_paused,
      message: workspace.writes_paused
        ? "Recovery writes paused. Verification and reconciliation continue; an operation already dispatched may still take effect."
        : "Recovery writes resumed. Authorized recoveries continue through fresh checks.",
    },
    correlationId,
  );
});
