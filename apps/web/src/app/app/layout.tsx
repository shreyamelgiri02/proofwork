import { redirect } from "next/navigation";
import { getShellSummary, getSql } from "@proofwork/database";
import { LogoMark } from "@/components/brand";
import { AppShell, type ShellData } from "@/components/shell/app-shell";
import { Alert } from "@/components/ui/primitives";
import { ExploreDemoButton } from "@/features/demo/explore-demo-button";
import { isDatabaseReady, setupGaps } from "@/lib/env";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isDatabaseReady()) {
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5">
        <LogoMark className="size-10" />
        <h1 className="mt-6 text-2xl font-semibold">Requires setup</h1>
        <Alert tone="warning" className="mt-4" title="Proofwork cannot reach its services">
          <ul className="list-disc pl-4">
            {setupGaps().map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="mt-2">Follow LOCAL-SETUP.md, then reload this page.</p>
        </Alert>
      </main>
    );
  }

  const session = await getSession();
  if (session.kind === "anonymous") {
    if (session.demoExpired) {
      return (
        <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 text-center">
          <LogoMark className="size-12" />
          <h1 className="mt-6 text-[28px] font-bold tracking-tight">This demo session expired.</h1>
          <p className="mt-2 text-muted">Start a new session to continue. Demo data is isolated and purged after its retention window.</p>
          <div className="mt-6">
            <ExploreDemoButton size="lg">Start a new demo</ExploreDemoButton>
          </div>
        </main>
      );
    }
    redirect("/sign-in?next=/app/tasks");
  }
  if (session.kind === "user" && !session.workspace.onboarding_completed_at) redirect("/onboarding");

  const summary = await getShellSummary(getSql(), session.workspace.id);
  const initial = JSON.parse(
    JSON.stringify({
      identity:
        session.kind === "user"
          ? { kind: "user", display_name: session.user.displayName, email: session.user.email }
          : { kind: "demo", display_name: "Demo operator", email: null, expires_at: session.expiresAt },
      ...summary,
    }),
  ) as ShellData;

  return <AppShell initial={initial}>{children}</AppShell>;
}
