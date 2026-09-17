import { redirect } from "next/navigation";
import { getCurrentPolicy, getSql, listConnections } from "@proofwork/database";
import { Logo } from "@/components/brand";
import { AccountMenu } from "@/components/shell/account-menu";
import { Alert } from "@/components/ui/primitives";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";
import { ExploreDemoButton } from "@/features/demo/explore-demo-button";
import { isDatabaseReady, setupGaps } from "@/lib/env";
import { contextFor, getSession } from "@/lib/session";

export const metadata = { title: "Workspace setup" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (session.kind === "demo") redirect("/app/tasks");

  if (!isDatabaseReady()) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-5 py-16 text-center">
        <Logo href="/" />
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Proofwork Preview</h1>
        <p className="mt-2 text-muted">A production database is not connected on this server. Explore the fully functional live demo with 6 pre-configured verification scenarios.</p>
        <div className="mt-6">
          <ExploreDemoButton size="lg" icon>
            Explore live demo
          </ExploreDemoButton>
        </div>
      </div>
    );
  }
  if (session.kind === "anonymous") redirect("/sign-in?next=/onboarding");
  if (session.workspace.onboarding_completed_at) redirect("/app/tasks");

  const sql = getSql();
  const ctx = contextFor(session);
  const [policy, sources] = await Promise.all([getCurrentPolicy(sql, ctx.workspace.id), listConnections(sql, ctx)]);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-line bg-surface/60">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 sm:px-8">
          <Logo href={null} />
          <AccountMenu displayName={session.user.displayName} email={session.user.email} kind="user" prefix="Signed in as" />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[1180px] flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <OnboardingWizard
          initialStep={Math.min(session.workspace.onboarding_step + 1, 3)}
          profile={{
            organization: session.workspace.organization || session.user.organization || "",
            name: session.workspace.name,
            timezone: session.workspace.timezone === "UTC" && session.workspace.onboarding_step === 0 ? "" : session.workspace.timezone,
          }}
          policyMode={policy?.mode ?? "REQUIRE_APPROVAL"}
          sources={{
            localSandboxConfigured: sources.local_sandbox.configured,
            stripeConfigured: sources.stripe.configured,
            stripeReason: sources.stripe.reason,
          }}
        />
      </main>
      <footer className="mx-auto w-full max-w-[1180px] border-t border-line px-5 py-6 text-sm text-muted sm:px-8">© 2026 Proofwork</footer>
    </div>
  );
}
