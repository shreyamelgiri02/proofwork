import { ArrowRight, Check, CircleAlert, CircleCheck, Database, FileText, Lock, RefreshCw, Scale, ShieldCheck, UserCheck } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { ExploreDemoButton } from "@/features/demo/explore-demo-button";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function signedInDestination(): Promise<string | null> {
  try {
    const session = await getSession();
    if (session.kind === "user") return session.workspace.onboarding_completed_at ? "/app/tasks" : "/onboarding";
    if (session.kind === "demo") return "/app/tasks";
  } catch {
    return null;
  }
  return null;
}

export default async function HomePage() {
  const destination = await signedInDestination();
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Logo size="lg" />
        <nav aria-label="Primary" className="hidden items-center gap-10 text-[15px] text-ink md:flex">
          <a href="#product" className="hover:text-primary-ink">
            Product
          </a>
          <a href="#workflow" className="hover:text-primary-ink">
            Workflow
          </a>
          <a href="#safety" className="hover:text-primary-ink">
            Safety
          </a>
        </nav>
        <div className="flex items-center gap-2 sm:gap-4">
          {destination ? (
            <Button asChild variant="dark">
              <Link href={destination}>Open workspace</Link>
            </Button>
          ) : (
            <>
              <Link href="/sign-in" className="px-2 text-[15px] font-medium text-primary-ink hover:underline">
                Sign in
              </Link>
              <Button asChild variant="dark" className="hidden sm:inline-flex">
                <Link href="/sign-up">Start workspace</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-14">
          <div>
            <p className="inline-flex rounded-full bg-primary-soft px-3.5 py-1.5 text-sm font-medium text-primary-ink">Outcome assurance for AI employees</p>
            <h1 className="mt-6 text-[44px] font-bold leading-[1.02] tracking-[-0.035em] text-ink sm:text-[64px]">
              Trust the outcome.
              <br />
              Not the claim.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted sm:text-[21px]">
              Independently check your business systems to verify AI employee work and recover unfinished tasks before they impact your business.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-start">
              <Button asChild size="lg" className="h-13 px-8 text-base">
                <Link href={destination ?? "/sign-up"}>{destination ? "Open your workspace" : "Build your workspace"}</Link>
              </Button>
              {destination ? null : <ExploreDemoButton variant="secondary" size="lg" className="h-13 px-8 text-base" />}
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-[15px] text-muted">
              {["No card required", "Isolated simulated data", "Complete audit history"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-success-soft">
                    <Check className="size-3.5 text-success" aria-hidden />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Illustrative evidence preview — explicitly labeled, not live data */}
          <figure className="rounded-[14px] border border-line bg-surface shadow-float">
            <figcaption className="sr-only">Illustrative example of a Proofwork evidence comparison using simulated data.</figcaption>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-5">
              <div>
                <p className="text-2xl font-semibold tracking-tight">Rivera Logistics</p>
                <p className="mt-1 text-sm text-muted">
                  Subscription <span className="font-mono text-[13px]">sub_demo_1048</span>
                </p>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center gap-2 rounded-md bg-danger-soft px-3 py-1.5 text-[15px] font-medium text-danger-ink">
                  <CircleAlert className="size-4 text-danger" aria-hidden /> Needs action
                </span>
                <p className="mt-2 text-xs text-subtle">Illustrative example · simulated data</p>
              </div>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-3">
              {[
                { icon: <CircleCheck className="size-5 text-success" aria-hidden />, title: "Authorized", sub: "What the customer asked", heading: "Cancel at period end", body: "Standard monthly plan. Cancel at the end of the current paid period.", tone: "bg-surface-muted" },
                { icon: <CircleCheck className="size-5 text-success" aria-hidden />, title: "Agent reported", sub: "What the AI employee said", heading: "Cancellation scheduled", body: "“I've scheduled the cancellation for the end of the billing period.”", tone: "bg-success-soft/60" },
                { icon: <CircleAlert className="size-5 text-danger" aria-hidden />, title: "Source observed", sub: "What the billing record shows", heading: "Cancellation: No", body: "The subscription is active and no cancellation is scheduled.", tone: "bg-danger-soft/70" },
              ].map((col) => (
                <div key={col.title} className="flex flex-col">
                  <div className="mb-3 flex items-start gap-2">
                    {col.icon}
                    <div>
                      <p className="text-sm font-semibold">{col.title}</p>
                      <p className="text-xs text-muted">{col.sub}</p>
                    </div>
                  </div>
                  <div className={`flex-1 rounded-control p-3.5 ${col.tone}`}>
                    <p className={`text-sm font-semibold ${col.title === "Source observed" ? "text-danger-ink" : ""}`}>{col.heading}</p>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted">{col.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mx-5 mb-5 flex flex-col gap-3 rounded-control border border-primary/15 bg-primary-soft/70 p-4 sm:flex-row sm:items-center">
              <ShieldCheck className="size-6 shrink-0 text-primary" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-semibold">Bounded recovery available</p>
                <p className="text-[13px] text-muted">Schedule the cancellation at the authorized period end — after human approval, with a fresh read before and after.</p>
              </div>
            </div>
          </figure>
        </section>

        {/* Product */}
        <section id="product" className="scroll-mt-8 border-t border-line bg-surface py-20">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
            <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-muted">Why it matters</p>
            <h2 className="mx-auto mt-4 max-w-2xl text-center text-[34px] font-bold leading-tight tracking-[-0.03em] sm:text-[46px]">An agent response is not a business outcome.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-center text-lg leading-relaxed text-muted">
              AI employees can be confident and wrong. Proofwork independently verifies results in your business systems and helps you recover unfinished work before it creates real costs.
            </p>
            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {[
                { icon: <FileText aria-hidden />, title: "The request is recorded first", body: "An operator confirms what the customer authorized — the exact subscription and paid-period end — before any agent report is accepted." },
                { icon: <Database aria-hidden />, title: "The source is read independently", body: "Proofwork reads the billing record itself. The agent's report never changes a verdict, and unreachable sources stay “Could not verify”." },
                { icon: <Scale aria-hidden />, title: "Every decision is explainable", body: "Field-by-field evidence, reason codes, evaluator versions and a complete activity history show exactly why a task passed or needs action." },
              ].map((card) => (
                <div key={card.title} className="rounded-surface border border-line bg-canvas p-6">
                  <div className="flex size-10 items-center justify-center rounded-control bg-primary-soft text-primary [&_svg]:size-5">{card.icon}</div>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight">{card.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{card.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section id="workflow" className="scroll-mt-8 py-20">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Workflow</p>
              <h2 className="mt-3 text-[32px] font-bold tracking-[-0.03em] sm:text-[40px]">One workflow, verified end to end.</h2>
              <p className="mt-3 text-lg text-muted">
                The first supported outcome is <span className="font-medium text-ink">cancelling a subscription at the end of its current paid period</span>. No refunds, immediate cancellations or invoice changes.
              </p>
            </div>
            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Register the customer request", "Preview the paid-period end from the source and confirm the customer's authority."],
                ["Accept the agent's report", "From the form or the authenticated ingestion API, with idempotency keys."],
                ["Read the billing source", "A background worker reads the subscription independently, even after you close the tab."],
                ["Decide deterministically", "A versioned evaluator compares identity, boundary and cancellation state."],
                ["Approve a bounded fix", "Review the exact change: cancel_at_period_end = true. Nothing else."],
                ["Verify the result again", "After the write, a separate read decides the outcome — never the write response."],
              ].map(([title, body], i) => (
                <li key={title} className="rounded-surface border border-line bg-surface p-5">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-ink">{i + 1}</span>
                  <p className="mt-3 font-semibold">{title}</p>
                  <p className="mt-1 text-[15px] text-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Safety */}
        <section id="safety" className="scroll-mt-8 border-y border-line bg-surface py-20">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-5 sm:px-8 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Safety</p>
              <h2 className="mt-3 text-[32px] font-bold tracking-[-0.03em] sm:text-[40px]">Recovery within the authority you grant.</h2>
              <p className="mt-4 text-lg text-muted">Choose Observe only, Require human approval, or Auto-recover the single supported correction. Pause writes at any time — verification continues.</p>
            </div>
            <ul className="grid gap-4">
              {[
                { icon: <UserCheck aria-hidden />, title: "Human approval by default", body: "Proposals expire after 15 minutes and are bound to the request, policy and source fingerprint." },
                { icon: <RefreshCw aria-hidden />, title: "Fresh check before, independent read after", body: "A stale, changed or near-boundary proposal cannot be applied." },
                { icon: <Lock aria-hidden />, title: "Durable, uncertainty-aware writes", body: "Stable operation keys, one unresolved write per subscription, and reconciliation when a response is lost." },
              ].map((item) => (
                <li key={item.title} className="flex gap-4 rounded-surface border border-line bg-canvas p-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary [&_svg]:size-5">{item.icon}</span>
                  <div>
                    <p className="font-semibold">{item.title}</p>
                    <p className="mt-1 text-[15px] text-muted">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto flex max-w-[1200px] flex-col items-center px-5 text-center sm:px-8">
            <h2 className="text-[30px] font-bold tracking-[-0.03em] sm:text-[38px]">See the full chain in a few minutes.</h2>
            <p className="mt-3 max-w-xl text-lg text-muted">The demo runs against an isolated simulated billing source that belongs only to your session.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {destination ? (
                <Button asChild size="lg">
                  <Link href={destination}>
                    Open workspace <ArrowRight aria-hidden />
                  </Link>
                </Button>
              ) : (
                <>
                  <ExploreDemoButton size="lg" icon>
                    Explore live demo
                  </ExploreDemoButton>
                  <Button asChild size="lg" variant="secondary">
                    <Link href="/sign-up">Build your workspace</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© 2026 Proofwork. A project by Shreya Melgiri.</p>
          <p>Supported workflow: subscription.cancel_at_period_end.v1</p>
        </div>
      </footer>
    </div>
  );
}
