import { activateConnection, configureLocalSandbox, configureStripeTest, getSql, getWorkspace, markOnboardingComplete } from "@proofwork/database";
import { AppError, sourceSelectionSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

/** Completes onboarding only when the selected source validates for its mode. */
export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId, { allowIncompleteOnboarding: true });
  const input = await parseBody(req, sourceSelectionSchema, 512);
  const sql = getSql();
  const workspace = await getWorkspace(sql, ctx.workspace.id);
  if (workspace.onboarding_step < 2 || !workspace.current_policy_version) {
    throw new AppError("ONBOARDING_INCOMPLETE", "Choose a recovery policy first.");
  }
  const connection = input.adapter === "LOCAL_SANDBOX" ? await configureLocalSandbox(sql, ctx, { seedStarter: true }) : await configureStripeTest(sql, ctx);
  if (connection.health !== "CONNECTED") {
    throw new AppError(
      connection.health === "DISCONNECTED" ? "SOURCE_UNAVAILABLE" : "SOURCE_NOT_CONFIGURED",
      input.adapter === "LOCAL_SANDBOX"
        ? "The local billing sandbox did not validate. Start it with `npm run dev:sandbox` and try again."
        : `Stripe test mode did not validate (${connection.last_error_code ?? "not checked"}). See Settings for configuration instructions.`,
    );
  }
  await activateConnection(sql, ctx, input.adapter);
  await markOnboardingComplete(sql, ctx);
  return json({ completed: true, redirect: "/app/tasks", connection: { adapter: connection.adapter, health: connection.health, account: connection.source_account_id } }, correlationId);
});
