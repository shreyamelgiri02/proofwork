import { ArrowRight, Check, CircleAlert, FileCheck2, Fingerprint, LockKeyhole, Menu, RefreshCw, ScanSearch, ShieldCheck } from "lucide-react";
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

const publicLinks = [
  ["Product", "#product"],
  ["Method", "#method"],
  ["Controls", "#controls"],
] as const;

export default async function HomePage() {
  const destination = await signedInDestination();
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1320px] items-center justify-between gap-4 px-5 sm:px-8">
          <Logo size="lg" subtitle="Outcome assurance" />
          <nav aria-label="Primary" className="hidden items-center gap-8 text-sm font-medium text-muted md:flex">
            {publicLinks.map(([label, href]) => <a key={href} href={href} className="hover:text-ink">{label}</a>)}
          </nav>
          <div className="flex items-center gap-2">
            {destination ? (
              <Button asChild variant="dark"><Link href={destination}>Open workspace</Link></Button>
            ) : (
              <>
                <Link href="/sign-in" className="hidden px-2 text-sm font-semibold text-primary-ink hover:underline sm:block">Sign in</Link>
                <Button asChild variant="dark" className="hidden sm:inline-flex"><Link href="/sign-up">Start workspace</Link></Button>
              </>
            )}
            <details className="group relative md:hidden">
              <summary className="flex size-10 list-none items-center justify-center rounded-control border border-line-strong bg-surface [&::-webkit-details-marker]:hidden" aria-label="Open menu"><Menu className="size-5" aria-hidden /></summary>
              <div className="absolute right-0 top-12 z-40 w-52 rounded-surface border border-line bg-surface p-2 shadow-float">
                {publicLinks.map(([label, href]) => <a key={href} href={href} className="block rounded-control px-3 py-2.5 text-sm font-medium hover:bg-neutral-soft">{label}</a>)}
                <div className="my-2 border-t border-line" />
                <Link href={destination ?? "/sign-in"} className="block rounded-control px-3 py-2.5 text-sm font-semibold text-primary-ink hover:bg-primary-soft">{destination ? "Open workspace" : "Sign in"}</Link>
                {!destination ? <Link href="/sign-up" className="block rounded-control px-3 py-2.5 text-sm font-semibold hover:bg-neutral-soft">Start workspace</Link> : null}
              </div>
            </details>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-[1320px] gap-10 px-5 pb-16 pt-10 sm:px-8 sm:pt-14 lg:grid-cols-12 lg:items-center lg:gap-12 lg:pb-24 lg:pt-20">
          <div className="lg:col-span-5">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-primary">Outcome assurance for AI employees</p>
            <h1 className="mt-5 text-[48px] font-semibold leading-[0.94] tracking-[-0.055em] text-ink sm:text-[68px] lg:text-[72px]">
              Trust the outcome.<br /><span className="text-muted">Not the claim.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-muted sm:text-[20px]">Independently verify AI employee work against the systems that hold the truth—then recover only what was explicitly authorized.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-start">
              <Button asChild size="lg" className="h-12 px-7"><Link href={destination ?? "/sign-up"}>{destination ? "Open your workspace" : "Build your workspace"}<ArrowRight aria-hidden /></Link></Button>
              {destination ? null : <ExploreDemoButton variant="secondary" size="lg" className="h-12 px-7" />}
            </div>
            <ul className="mt-8 grid gap-2 border-t border-line pt-5 text-sm text-muted sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {["No card required", "Isolated simulation", "Durable audit trail"].map((item) => <li key={item} className="flex items-center gap-2"><Check className="size-4 text-success" aria-hidden />{item}</li>)}
            </ul>
          </div>

          <figure className="relative overflow-hidden rounded-surface bg-evidence text-white shadow-float lg:col-span-7">
            <figcaption className="flex items-center justify-between gap-4 border-b border-white/15 px-5 py-4 sm:px-7">
              <span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">Illustrative evidence ledger</span>
                <span className="mt-1 block text-lg font-semibold">Case PW-2026-1048</span>
              </span>
              <span className="verdict-stamp text-danger-soft"><CircleAlert className="size-3.5" aria-hidden /> Mismatch</span>
            </figcaption>
            <div className="relative px-5 py-4 sm:px-7 sm:py-6">
              <svg className="absolute bottom-9 left-[35px] top-9 w-4 overflow-visible sm:left-[43px]" viewBox="0 0 16 320" preserveAspectRatio="none" aria-hidden>
                <path d="M8 0V320" stroke="rgba(255,255,255,.16)" strokeWidth="1" />
                <path d="M8 0V320" stroke="#5d85ea" strokeWidth="2" strokeDasharray="10 38" className="animate-pw-trace" />
              </svg>
              <ol className="relative space-y-2">
                {[
                  { n: "01", code: "AUTHORIZED REQUEST", title: "Cancel at paid-period end", detail: "sub_demo_1048 · 30 Sep 2026", tone: "text-white" },
                  { n: "02", code: "AGENT CLAIM", title: "Cancellation scheduled", detail: "Receipt received 10:42:08 UTC", tone: "text-white" },
                  { n: "03", code: "OBSERVED SOURCE", title: "Cancellation: no", detail: "Independent billing read · 10:42:14 UTC", tone: "text-danger-soft" },
                  { n: "04", code: "VERDICT", title: "Authorized outcome not observed", detail: "SCHEDULE_MISSING · evaluator v1", tone: "text-danger-soft" },
                ].map((row) => (
                  <li key={row.code} className="grid grid-cols-[36px_1fr] gap-4 rounded-control border border-white/10 bg-white/[0.055] p-3 sm:grid-cols-[44px_1fr] sm:p-4">
                    <span className="relative z-10 flex size-7 items-center justify-center rounded-[3px] border border-white/20 bg-evidence font-mono text-[10px] text-white/65">{row.n}</span>
                    <span className="min-w-0">
                      <span className="block font-mono text-[9px] tracking-[0.1em] text-white/45">{row.code}</span>
                      <span className={`mt-1 block text-[16px] font-semibold ${row.tone}`}>{row.title}</span>
                      <span className="mt-1 block truncate font-mono text-[11px] text-white/52">{row.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 grid gap-3 border-t border-white/15 pt-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <p className="text-sm text-white/65"><strong className="font-semibold text-white">Bounded correction available.</strong> One approved field change, with a fresh read before and after.</p>
                <span className="verdict-stamp text-success-soft"><ShieldCheck className="size-3.5" aria-hidden /> Recoverable</span>
              </div>
            </div>
          </figure>
        </section>

        <section id="product" className="scroll-mt-24 border-y border-line bg-surface">
          <div className="mx-auto grid max-w-[1320px] px-5 sm:px-8 lg:grid-cols-[4fr_8fr]">
            <div className="border-b border-line py-12 lg:border-b-0 lg:border-r lg:py-16 lg:pr-12">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">The product</p>
              <h2 className="mt-4 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[44px]">One record from request to result.</h2>
              <p className="mt-4 text-[17px] leading-relaxed text-muted">An agent response is only one line in the ledger. The source observation decides the outcome.</p>
            </div>
            <div className="divide-y divide-line lg:pl-12">
              {[
                { icon: Fingerprint, code: "AUTHORITY", title: "Record the boundary before the claim", body: "Fix the customer, subscription, and paid-period end before any report is accepted." },
                { icon: ScanSearch, code: "EVIDENCE", title: "Read the source independently", body: "The agent cannot mark its own work complete. Unreachable evidence stays unverified." },
                { icon: FileCheck2, code: "DECISION", title: "Explain every verdict", body: "Field comparisons, reason codes, evaluator versions, and timestamps make each decision inspectable." },
              ].map((item) => (
                <article key={item.code} className="grid gap-4 py-7 sm:grid-cols-[120px_1fr]">
                  <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.09em] text-muted"><item.icon className="size-4 text-primary" aria-hidden />{item.code}</span>
                  <span><h3 className="text-xl font-semibold tracking-[-0.02em]">{item.title}</h3><p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{item.body}</p></span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="method" className="scroll-mt-24 mx-auto max-w-[1320px] px-5 py-16 sm:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[4fr_8fr]">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">Method / 01–06</p>
              <h2 className="mt-4 text-[34px] font-semibold tracking-[-0.04em] sm:text-[44px]">Verification that survives a closed tab.</h2>
            </div>
            <ol className="border-t-[3px] border-evidence bg-surface shadow-card">
              {[
                ["01", "Register authority", "Confirm the exact outcome and boundary from the source."],
                ["02", "Accept the report", "Preserve the claim and its receipt without trusting it."],
                ["03", "Observe independently", "A durable worker reads the source of truth."],
                ["04", "Decide deterministically", "Compare identity, boundary, and state under a versioned evaluator."],
                ["05", "Approve one bounded fix", "Preview the only supported change before dispatch."],
                ["06", "Read again", "A separate observation—not the write response—closes the case."],
              ].map(([n, title, body]) => (
                <li key={n} className="grid grid-cols-[44px_1fr] gap-4 border-x border-b border-line px-4 py-5 sm:grid-cols-[64px_180px_1fr] sm:items-baseline sm:px-6">
                  <span className="font-mono text-[11px] text-primary">{n}</span><strong className="font-semibold">{title}</strong><span className="text-sm text-muted">{body}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="controls" className="scroll-mt-24 bg-evidence py-16 text-white lg:py-20">
          <div className="mx-auto grid max-w-[1320px] gap-10 px-5 sm:px-8 lg:grid-cols-[5fr_7fr]">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">Recovery controls</p><h2 className="mt-4 text-[36px] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-[48px]">Correction without overreach.</h2><p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/65">Choose observation only, human approval, or automatic recovery for the single authorized action. Pause writes without pausing verification.</p></div>
            <div className="divide-y divide-white/15 border-y border-white/15">
              {[
                { icon: ShieldCheck, title: "Human approval by default", body: "Proposals expire and remain bound to the exact request, policy, and evidence fingerprint." },
                { icon: RefreshCw, title: "Fresh read before and after", body: "Stale, changed, or near-boundary evidence blocks dispatch." },
                { icon: LockKeyhole, title: "Durable uncertainty handling", body: "Stable operation keys and reconciliation protect against lost responses and duplicate writes." },
              ].map((item) => <div key={item.title} className="grid grid-cols-[40px_1fr] gap-4 py-5"><item.icon className="size-5 text-[#87a8ff]" aria-hidden /><span><h3 className="font-semibold">{item.title}</h3><p className="mt-1 text-sm leading-relaxed text-white/60">{item.body}</p></span></div>)}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1320px] px-5 py-16 sm:px-8 lg:py-20">
          <div className="grid gap-6 border-l-[3px] border-primary bg-surface px-6 py-8 shadow-card sm:grid-cols-[1fr_auto] sm:items-center sm:px-8">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.1em] text-primary">Inspect the full chain</p><h2 className="mt-2 text-[30px] font-semibold tracking-[-0.035em]">Run an isolated case in a few minutes.</h2><p className="mt-2 text-muted">Simulated billing data, every decision visible, no production system connected.</p></div>
            <div className="flex flex-col gap-3 sm:items-end">{destination ? <Button asChild size="lg"><Link href={destination}>Open workspace <ArrowRight aria-hidden /></Link></Button> : <><ExploreDemoButton size="lg" icon /><Button asChild variant="secondary"><Link href="/sign-up">Build your workspace</Link></Button></>}</div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-[1320px] gap-5 px-5 py-8 text-sm text-muted sm:px-8 md:grid-cols-[1fr_auto] md:items-end">
          <div><Logo size="sm" href="/" /><p className="mt-3 max-w-md">Independent evidence for the business actions AI employees report as complete.</p></div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">{[["Privacy","/privacy"],["Terms","/terms"],["Security","/security"],["Help","/help"]].map(([label,href]) => <Link key={href} href={href} className="hover:text-ink">{label}</Link>)}</nav>
          <p className="border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.05em] md:col-span-2">© 2026 Proofwork · Supported workflow: subscription.cancel_at_period_end.v1</p>
        </div>
      </footer>
    </div>
  );
}
