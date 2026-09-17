import Link from "next/link";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-5 py-6 sm:px-12 sm:py-10">
        <Logo size="lg" />
      </header>
      <main id="main" className="flex flex-1 flex-col items-center justify-center px-5 pb-24 text-center">
        <p className="text-[96px] font-bold leading-none tracking-[-0.04em] text-subtle sm:text-[140px]" aria-hidden>
          404
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-[40px]">Page not found</h1>
        <p className="mt-3 max-w-md text-[17px] text-muted">The page you’re looking for doesn’t exist or has been moved.</p>
        <Button asChild size="lg" className="mt-8 min-w-44">
          <Link href="/">Go home</Link>
        </Button>
      </main>
    </div>
  );
}
