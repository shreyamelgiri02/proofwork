import { enforceRateLimit, getSql, resetDemo } from "@proofwork/database";
import { AppError, LIMITS } from "@proofwork/domain";
import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

const bodySchema = z.object({ confirm: z.literal(true) });

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  if (ctx.workspace.kind !== "DEMO") throw new AppError("PERMISSION_DENIED", "Reset is available only in the demo.");
  await parseBody(req, bodySchema, 512);

  if (!isDatabaseReady()) {
    const { resetStandaloneDemo } = await import("@/lib/standalone-demo");
    resetStandaloneDemo(ctx.workspace.id);
    return json({ reset: true, message: "Demo reset. Only this demo's synthetic records were replaced; verification is running again." }, correlationId);
  }

  const sql = getSql();
  await enforceRateLimit(sql, `demo:cmd:${ctx.workspace.id}`, LIMITS.DEMO_COMMANDS_PER_MINUTE, 60);
  await resetDemo(sql, ctx);
  return json({ reset: true, message: "Demo reset. Only this demo's synthetic records were replaced; verification is running again." }, correlationId);
});
