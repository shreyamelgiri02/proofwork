import { cookies } from "next/headers";
import { z } from "zod";
import { ensurePrivateWorkspace, getSql } from "@proofwork/database";
import { AppError } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { authDestination } from "@/lib/auth-flow";
import { mapAuthError } from "@/lib/auth-errors";
import { DEMO_COOKIE } from "@/lib/demo-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  code: z.string().max(500).optional(),
  token_hash: z.string().max(500).optional(),
  type: z.enum(["signup", "email", "recovery", "invite", "magiclink", "email_change"]).optional(),
  next: z.string().max(400).optional(),
});

/**
 * Completes an auth return (PKCE code or email token hash) and decides the
 * correct destination: recovery → reset password, unfinished setup → onboarding,
 * otherwise the safe requested path or Tasks.
 */
export const POST = route(async (req, { correlationId }) => {
  const input = await parseBody(req, bodySchema, 4096);
  const supabase = await createSupabaseServerClient();

  if (input.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(input.code);
    if (error) throw mapAuthError(error, "callback");
  } else if (input.token_hash && input.type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: input.token_hash, type: input.type });
    if (error) throw mapAuthError(error, "callback");
  }

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user || !user.email) throw new AppError("AUTH_REQUIRED", "This link is invalid or has expired. Request a new one.");

  (await cookies()).delete(DEMO_COOKIE);
  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string; organization?: string };
  const workspace = await ensurePrivateWorkspace(getSql(), { id: user.id, email: user.email, fullName: meta.full_name ?? meta.name ?? null, organization: meta.organization ?? null }, correlationId);

  const redirect = authDestination({ onboardingCompletedAt: workspace.onboarding_completed_at, next: input.next, type: input.type });
  return json({ redirect }, correlationId);
});
