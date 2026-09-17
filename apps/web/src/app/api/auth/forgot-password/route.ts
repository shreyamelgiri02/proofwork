import { enforceRateLimit, getSql } from "@proofwork/database";
import { forgotPasswordSchema, LIMITS } from "@proofwork/domain";
import { clientIp, json, parseBody, route } from "@/lib/api";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const POST = route(async (req, { correlationId }) => {
  const input = await parseBody(req, forgotPasswordSchema, 2048);
  await enforceRateLimit(getSql(), `auth:forgot:${clientIp(req)}`, LIMITS.AUTH_RATE_PER_WINDOW, LIMITS.AUTH_RATE_WINDOW_SECONDS);
  const supabase = await createSupabaseServerClient();
  // Errors are intentionally not surfaced: the response never reveals whether the email exists.
  await supabase.auth.resetPasswordForEmail(input.email, { redirectTo: `${publicEnv.appUrl}/auth/callback?next=/reset-password` }).catch(() => undefined);
  return json({ status: "sent", message: "If an account exists for that email, a secure reset link is on its way." }, correlationId);
});
