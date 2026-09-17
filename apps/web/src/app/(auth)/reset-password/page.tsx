import { redirect } from "next/navigation";
import { NewPasswordForm } from "@/features/auth/password-forms";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

/** Requires the valid recovery session established by /auth/callback. */
export default async function ResetPasswordPage() {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) redirect("/forgot-password?expired=1");
  }
  return <NewPasswordForm />;
}
