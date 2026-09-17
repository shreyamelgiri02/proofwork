import { redirect } from "next/navigation";
import { SignInForm } from "@/features/auth/sign-in-form";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/redirect";
import { getSession } from "@/lib/session";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const nextRaw = typeof params.next === "string" ? params.next : undefined;
  const next = nextRaw ? safeNextPath(nextRaw) : undefined;
  const session = await getSession().catch(() => null);
  if (session?.kind === "user") redirect(session.workspace.onboarding_completed_at ? (next ?? "/app/tasks") : "/onboarding");
  const error = typeof params.error === "string" ? params.error : undefined;
  return <SignInForm next={next} queryError={error} googleEnabled={publicEnv.googleOAuthEnabled} />;
}
