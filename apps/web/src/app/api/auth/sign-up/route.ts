import { enforceRateLimit, getSql } from "@proofwork/database";
import { LIMITS, signUpSchema } from "@proofwork/domain";
import { clientIp, json, parseBody, route } from "@/lib/api";
import { mapAuthError } from "@/lib/auth-errors";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const POST = route(async (req, { correlationId }) => {
  const input = await parseBody(req, signUpSchema, 4096);
  await enforceRateLimit(getSql(), `auth:sign-up:${clientIp(req)}`, 10, LIMITS.AUTH_RATE_WINDOW_SECONDS);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=/onboarding`,
      data: { full_name: input.fullName, organization: input.organization },
    },
  });
  if (error && error.code !== "user_already_exists") throw mapAuthError(error, "sign-up");
  // If confirmations are disabled locally a session exists immediately.
  if (data?.session) return json({ status: "signed_in", redirect: "/onboarding" }, correlationId);
  // Same response whether or not the address already has an account (no enumeration).
  return json({ status: "confirmation_sent", email: input.email }, correlationId);
});
