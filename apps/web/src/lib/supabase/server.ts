import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "@proofwork/domain";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

/**
 * Supabase client bound to the request cookies (Server Components, Route Handlers).
 * Identity is validated with auth.getUser(), which calls the Auth server.
 */
export async function createSupabaseServerClient() {
  if (!isSupabaseConfigured()) {
    throw new AppError("SETUP_REQUIRED", "Account sign-in is temporarily unavailable. Try again later.");
  }
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: options?.httpOnly ?? true,
              sameSite: options?.sameSite ?? "lax",
              secure: process.env.NODE_ENV === "production",
            });
          }
        } catch {
          // Called from a Server Component render; the proxy refreshes cookies instead.
        }
      },
    },
  });
}
