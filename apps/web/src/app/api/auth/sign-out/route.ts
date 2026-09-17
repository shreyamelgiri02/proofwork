import { cookies } from "next/headers";
import { json, route } from "@/lib/api";
import { DEMO_COOKIE } from "@/lib/demo-cookie";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const POST = route(async (_req, { correlationId }) => {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Clearing local cookies below still ends this browser's session.
    }
  }
  const store = await cookies();
  store.delete(DEMO_COOKIE);
  for (const c of store.getAll()) {
    if (c.name.startsWith("sb-")) store.delete(c.name);
  }
  return json({ redirect: "/" }, correlationId, { headers: { "clear-site-data": '"cache"' } });
});
