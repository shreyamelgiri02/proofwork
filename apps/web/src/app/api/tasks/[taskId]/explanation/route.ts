import { enforceRateLimit, explainDecision, getSql } from "@proofwork/database";
import { AppError } from "@proofwork/domain";
import { json, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

export const GET = route<{ taskId: string }>(async (req, { params, correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const decisionId = req.nextUrl.searchParams.get("decision_id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(params.taskId) || !/^[0-9a-f-]{36}$/.test(decisionId)) throw new AppError("NOT_FOUND", "Decision not found.");

  if (!isDatabaseReady()) {
    const { explainStandaloneDecision } = await import("@/lib/standalone-demo");
    return json(explainStandaloneDecision(ctx.workspace.id, params.taskId, decisionId), correlationId);
  }

  const sql = getSql();
  await enforceRateLimit(sql, `explain:${ctx.actor.id}`, 10, 60);
  return json(await explainDecision(sql, ctx, params.taskId, decisionId), correlationId);
});
