import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";

export interface LegalSection {
  title: string;
  body: React.ReactNode;
}

export function PublicLegalPage({ label, title, intro, sections }: { label: string; title: string; intro: string; sections: LegalSection[] }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between px-5 sm:px-8">
          <Logo size="lg" subtitle="Public record" />
          <Button asChild variant="secondary" size="sm"><Link href="/"><ArrowLeft aria-hidden />Overview</Link></Button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[280px_1fr] lg:gap-16">
          <aside>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">{label}</p>
            <p className="mt-3 text-sm text-muted">Last updated 20 September 2026</p>
            <nav aria-label={`${title} sections`} className="mt-7 hidden border-l border-line lg:block">
              {sections.map((section, i) => <a key={section.title} href={`#section-${i + 1}`} className="block border-l-2 border-transparent px-4 py-2 text-sm text-muted hover:border-primary hover:text-ink">{section.title}</a>)}
            </nav>
          </aside>
          <article className="min-w-0 rounded-surface border border-line border-t-[3px] border-t-evidence bg-surface shadow-card">
            <header className="border-b border-line px-6 py-8 sm:px-10 sm:py-10">
              <h1 className="text-[40px] font-semibold leading-none tracking-[-0.045em] sm:text-[54px]">{title}</h1>
              <p className="mt-5 max-w-3xl text-[17px] leading-relaxed text-muted">{intro}</p>
            </header>
            <div className="divide-y divide-line px-6 sm:px-10">
              {sections.map((section, i) => (
                <section key={section.title} id={`section-${i + 1}`} className="scroll-mt-24 py-7 sm:grid sm:grid-cols-[48px_1fr] sm:gap-5">
                  <span className="font-mono text-[10px] text-primary">{String(i + 1).padStart(2, "0")}</span>
                  <div><h2 className="text-xl font-semibold tracking-[-0.02em]">{section.title}</h2><div className="mt-3 space-y-3 text-[15px] leading-relaxed text-muted">{section.body}</div></div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-5 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© 2026 Proofwork</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-5"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/security">Security</Link><Link href="/help">Help</Link></nav>
        </div>
      </footer>
    </div>
  );
}
