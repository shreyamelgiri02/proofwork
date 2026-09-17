import { createScenario, enforceRateLimit, getActiveConnection, getSql, scenarioControlsEnabled } from "@proofwork/database";
import { AppError, LIMITS, SCENARIOS, scenarioSchema, type ScenarioKey } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { isDatabaseReady } from "@/lib/env";
import { requireContext } from "@/lib/session";

export const GET = route(async (_req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);

  if (!isDatabaseReady()) {
    return json(
      {
        enabled: true,
        scenarios: SCENARIOS.map((s) => ({ key: s.key, title: s.title, description: s.description, try_next: s.try_next, control: s.control ?? null })),
      },
      correlationId,
    );
  }

  const connection = await getActiveConnection(getSql(), ctx.workspace.id);
  const enabled = scenarioControlsEnabled(ctx.workspace.kind, connection?.adapter);
  return json(
    {
      enabled,
      scenarios: SCENARIOS.map((s) => ({ key: s.key, title: s.title, description: s.description, try_next: s.try_next, control: s.control ?? null })),
    },
    correlationId,
  );
});

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const { key } = await parseBody(req, scenarioSchema, 512);
  if (!SCENARIOS.some((s) => s.key === key)) throw new AppError("INVALID_PAYLOAD", "Unknown scenario.");

  if (!isDatabaseReady()) {
    const { createStandaloneScenario } = await import("@/lib/standalone-demo");
    const result = createStandaloneScenario(ctx.workspace.id, key as ScenarioKey);
    return json({ ...result, message: "Scenario created. The synthetic source and verification outcome are ready." }, correlationId, { status: 201 });
  }

  const sql = getSql();
  await enforceRateLimit(sql, `demo:cmd:${ctx.workspace.id}`, LIMITS.DEMO_COMMANDS_PER_MINUTE, 60);
  const result = await createScenario(sql, ctx, key as ScenarioKey);
  return json({ ...result, message: "Scenario created. The worker will read the synthetic source and decide the outcome." }, correlationId, { status: 201 });
});
