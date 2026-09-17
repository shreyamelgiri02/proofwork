import { redirect } from "next/navigation";
import { SignUpForm } from "@/features/auth/sign-up-form";
import { publicEnv } from "@/lib/env";
import { getSession } from "@/lib/session";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const session = await getSession().catch(() => null);
  if (session?.kind === "user") redirect(session.workspace.onboarding_completed_at ? "/app/tasks" : "/onboarding");
  return <SignUpForm googleEnabled={publicEnv.googleOAuthEnabled} />;
}
