import { getShellSummary, getSql } from "@proofwork/database";
import { json, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const GET = route(async (_req, { correlationId }) => {
  const { session, ctx } = await requireContext(correlationId, { allowIncompleteOnboarding: true });
  const summary = await getShellSummary(getSql(), ctx.workspace.id);
  return json(
    {
      identity:
        session.kind === "user"
          ? { kind: "user", display_name: session.user.displayName, email: session.user.email }
          : { kind: "demo", display_name: "Demo operator", email: null, expires_at: session.expiresAt },
      ...summary,
    },
    correlationId,
  );
});
