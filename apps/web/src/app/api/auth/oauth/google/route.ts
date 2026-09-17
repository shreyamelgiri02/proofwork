import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Starts Google OAuth only when configured. Missing credentials never block email/password access. */
export async function GET(req: NextRequest) {
  const next = safeNextPath(req.nextUrl.searchParams.get("next"), "/app/tasks");
  const back = new URL("/sign-in", publicEnv.appUrl);
  if (!publicEnv.googleOAuthEnabled || !isSupabaseConfigured()) {
    back.searchParams.set("error", "oauth_unavailable");
    return NextResponse.redirect(back);
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent(next)}`, skipBrowserRedirect: true },
    });
    if (error || !data.url) throw error ?? new Error("no url");
    const target = new URL(data.url);
    const supabaseOrigin = new URL(publicEnv.supabaseUrl).origin;
    // Only follow the provider URL issued by our own Supabase Auth server.
    if (target.origin !== supabaseOrigin) throw new Error("unexpected oauth origin");
    return NextResponse.redirect(target);
  } catch {
    back.searchParams.set("error", "oauth_failed");
    return NextResponse.redirect(back);
  }
}
