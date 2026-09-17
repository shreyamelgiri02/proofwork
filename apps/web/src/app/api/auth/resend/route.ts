import { enforceRateLimit, getSql } from "@proofwork/database";
import { LIMITS, resendSchema } from "@proofwork/domain";
import { clientIp, json, parseBody, route } from "@/lib/api";
import { mapAuthError } from "@/lib/auth-errors";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const POST = route(async (req, { correlationId }) => {
  const input = await parseBody(req, resendSchema, 2048);
  await enforceRateLimit(getSql(), `auth:resend:${input.email}`, 1, LIMITS.RESEND_COOLDOWN_SECONDS);
  await enforceRateLimit(getSql(), `auth:resend-ip:${clientIp(req)}`, 10, LIMITS.AUTH_RATE_WINDOW_SECONDS);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: input.email,
    options: { emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=/onboarding` },
  });
  if (error && error.status === 429) throw mapAuthError(error, "sign-up");
  return json({ status: "sent", cooldown_seconds: LIMITS.RESEND_COOLDOWN_SECONDS }, correlationId);
});
