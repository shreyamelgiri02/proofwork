import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Network-boundary proxy (Next.js 16 replacement for middleware, Node.js runtime).
 *  - Refreshes Supabase auth cookies.
 *  - Redirects unauthenticated visits to protected pages to /sign-in with a safe `next`.
 * Authorization is still enforced by every page and API route on the server.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let hasUser = false;

  if (url && key && !key.startsWith("replace-")) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, { ...options, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
          }
        },
      },
    });
    try {
      const { data } = await supabase.auth.getClaims();
      hasUser = Boolean(data?.claims?.sub);
    } catch {
      hasUser = false;
    }
  }

  const { pathname, search } = request.nextUrl;
  const protectedPath = pathname === "/app" || pathname.startsWith("/app/") || pathname === "/onboarding";
  // The demo cookie's signature and expiry are verified server-side; presence is enough to route here.
  const hasDemo = Boolean(request.cookies.get("pw_demo")?.value);
  if (protectedPath && !hasUser && !hasDemo) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(signIn);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/v1/).*)"],
};
