import { ArrowLeft, Check, FileSearch, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { Alert } from "@/components/ui/primitives";
import { isSupabaseConfigured } from "@/lib/env";

const evidence = [
  { code: "01 / AUTHORITY", title: "The request is fixed first", body: "Identity, subscription, and the authorized outcome become the baseline." },
  { code: "02 / OBSERVATION", title: "The source is read independently", body: "Evidence comes from the business system, never from the agent claim." },
  { code: "03 / VERDICT", title: "Every decision remains inspectable", body: "Reason codes and source snapshots make the result reproducible." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="mx-auto flex w-full max-w-[1320px] items-center justify-between px-5 py-5 sm:px-8">
        <Logo size="lg" />
        <Link href="/" className="inline-flex items-center gap-2 rounded-control px-2 py-1 text-sm font-medium text-muted hover:bg-neutral-soft hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> <span className="hidden sm:inline">Back to overview</span><span className="sm:hidden">Back</span>
        </Link>
      </header>

      <main id="main" className="mx-auto grid w-full max-w-[1320px] flex-1 items-stretch gap-5 px-5 pb-8 sm:px-8 md:grid-cols-[minmax(0,7fr)_minmax(340px,5fr)] lg:gap-8">
        <section className="relative hidden overflow-hidden rounded-surface bg-evidence p-8 text-white md:flex md:min-h-[640px] md:flex-col lg:p-12" aria-label="How Proofwork establishes evidence">
          <div className="absolute inset-0 opacity-[0.08] ledger-grid" aria-hidden />
          <div className="relative">
            <p className="font-mono text-[11px] uppercase tracking-[0.13em] text-white/60">Independent outcome assurance</p>
            <h1 className="mt-5 max-w-xl text-[42px] font-semibold leading-[0.98] tracking-[-0.045em] lg:text-[58px]">
              Claims are words.
              <br />Evidence is work.
            </h1>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-white/72 lg:text-[19px]">Proofwork keeps the authority, observation, and verdict in one durable chain.</p>
          </div>

          <ol className="relative mt-auto divide-y divide-white/15 border-y border-white/15">
            {evidence.map((item) => (
              <li key={item.code} className="grid grid-cols-[112px_1fr] gap-4 py-5 lg:grid-cols-[138px_1fr]">
                <span className="font-mono text-[10px] tracking-[0.07em] text-white/50">{item.code}</span>
                <span>
                  <span className="block text-[16px] font-semibold">{item.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-white/62">{item.body}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="relative mt-7 flex items-center gap-3 text-sm text-white/70">
            <span className="flex size-8 items-center justify-center rounded-control border border-white/20"><ShieldCheck className="size-4" aria-hidden /></span>
            <span>Bounded recovery · full audit history · no claim-based verdicts</span>
          </div>
        </section>

        <section className="flex min-w-0 flex-col justify-center py-2 md:py-8" aria-label="Account access">
          <div className="mb-5 flex items-center gap-3 border-l-[3px] border-primary bg-primary-soft px-4 py-3 md:hidden">
            <FileSearch className="size-5 text-primary" aria-hidden />
            <p className="text-sm"><strong className="font-semibold">Evidence before confidence.</strong> Independently verify every reported outcome.</p>
          </div>
          {!configured ? (
            <Alert tone="warning" title="Account sign-in is temporarily unavailable" className="mb-4">
              The deployment owner is reconnecting authentication. You can still explore the isolated demo when service is available.
            </Alert>
          ) : null}
          {children}
          <div className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-xs text-muted">
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
            Google and email sign-in use the same private workspace when the verified email matches.
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-[1320px] flex-col gap-3 border-t border-line px-5 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span>© 2026 Proofwork · Evidence before confidence.</span>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/security" className="hover:text-ink">Security</Link>
          <Link href="/help" className="hover:text-ink">Help</Link>
        </nav>
      </footer>
    </div>
  );
}
