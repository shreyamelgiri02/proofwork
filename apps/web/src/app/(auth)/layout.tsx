import { ArrowLeft, ArrowLeftRight, FileText, Shield } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { Alert } from "@/components/ui/primitives";
import { isSupabaseConfigured } from "@/lib/env";

const benefits = [
  { icon: FileText, title: "Read the source", body: "See the original records, identifiers, and context behind what was reported." },
  { icon: ArrowLeftRight, title: "Compare intent", body: "Check that the outcome matches what was requested, with side-by-side details." },
  { icon: Shield, title: "Recover safely", body: "If something doesn't match, apply only the correction you authorized." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-5 py-6 sm:px-8 sm:py-8">
        <Logo size="lg" />
        <Link href="/" className="inline-flex items-center gap-2 rounded-control px-2 py-1 text-[15px] text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Back to overview
        </Link>
      </header>
      <main id="main" className="mx-auto grid w-full max-w-[1200px] flex-1 items-start gap-10 px-5 pb-12 sm:px-8 lg:grid-cols-[1fr_440px] lg:gap-20 lg:pt-6">
        <section className="order-2 hidden lg:order-1 lg:block" aria-label="About Proofwork">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted">Outcome assurance for AI work</p>
          <p className="mt-5 text-[56px] font-bold leading-[1.02] tracking-[-0.035em] text-ink">
            Trust the outcome,
            <br />
            not the claim.
          </p>
          <p className="mt-5 max-w-lg text-[22px] leading-snug text-muted">Independent evidence for the business actions your AI employees report as complete.</p>
          <ol className="mt-10 max-w-lg divide-y divide-line">
            {benefits.map((b, i) => (
              <li key={b.title} className="flex items-start gap-5 py-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-ink">{i + 1}</span>
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-soft text-ink">
                  <b.icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-lg font-semibold tracking-tight">{b.title}</span>
                  <span className="mt-1 block text-[15px] text-muted">{b.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <div className="order-1 w-full lg:order-2">
          {!configured ? (
            <Alert tone="warning" title="Authentication requires setup" className="mb-4">
              Start local Supabase and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. See LOCAL-SETUP.md. The isolated demo remains available once the database and sandbox are running.
            </Alert>
          ) : null}
          {children}
        </div>
      </main>
      <footer className="mx-auto w-full max-w-[1200px] border-t border-line px-5 py-6 text-sm text-muted sm:px-8">A more verifiable workforce for what comes next.</footer>
    </div>
  );
}
