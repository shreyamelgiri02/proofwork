import { cookies } from "next/headers";
import { enforceRateLimit, ensurePrivateWorkspace, getSql } from "@proofwork/database";
import { AppError, LIMITS, signInSchema } from "@proofwork/domain";
import { clientIp, json, parseBody, route } from "@/lib/api";
import { mapAuthError } from "@/lib/auth-errors";
import { DEMO_COOKIE, demoCookieOptions, encodeDemoCookie } from "@/lib/demo-cookie";
import { isDatabaseReady, isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const POST = route(async (req, { correlationId }) => {
  const input = await parseBody(req, signInSchema, 4096);

  if (!isDatabaseReady() || !isSupabaseConfigured()) {
    const { createStandaloneDemoWorkspace } = await import("@/lib/standalone-demo");
    const ttl = Number(process.env.DEMO_SESSION_TTL_SECONDS ?? 86400);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const { workspaceId, sessionToken } = createStandaloneDemoWorkspace("Preview Workspace", "Demo Operator");
    (await cookies()).set(DEMO_COOKIE, encodeDemoCookie(workspaceId, sessionToken, expiresAt), demoCookieOptions(expiresAt));
    return json({ redirect: safeNextPath(input.next) }, correlationId);
  }

  const sql = getSql();
  await enforceRateLimit(sql, `auth:sign-in:${clientIp(req)}`, LIMITS.AUTH_RATE_PER_WINDOW, LIMITS.AUTH_RATE_WINDOW_SECONDS);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  if (error || !data.user) throw mapAuthError(error, "sign-in");
  if (!data.user.email) throw new AppError("INVALID_CREDENTIALS", "This account has no email address.");

  // A real account starts its private workspace; demo data is never merged.
  (await cookies()).delete(DEMO_COOKIE);
  const meta = (data.user.user_metadata ?? {}) as { full_name?: string; organization?: string };
  const workspace = await ensurePrivateWorkspace(sql, { id: data.user.id, email: data.user.email, fullName: meta.full_name ?? null, organization: meta.organization ?? null }, correlationId);
  const redirect = workspace.onboarding_completed_at ? safeNextPath(input.next) : "/onboarding";
  return json({ redirect }, correlationId);
});
