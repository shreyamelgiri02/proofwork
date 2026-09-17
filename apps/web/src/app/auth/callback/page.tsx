import { Suspense } from "react";
import { Logo, LogoMark } from "@/components/brand";
import { Spinner } from "@/components/ui/primitives";
import { AuthCallback } from "@/features/auth/auth-callback";

export const metadata = { title: "Securing your workspace" };

export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-5 py-6 sm:px-12 sm:py-9">
        <Logo />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-5 pb-24">
        <Suspense
          fallback={
            <div className="flex flex-col items-center text-center">
              <LogoMark className="size-16" />
              <h1 className="mt-6 text-[32px] font-bold tracking-[-0.03em]">Securing your workspace…</h1>
              <div className="mt-8">
                <Spinner className="size-8" />
              </div>
            </div>
          }
        >
          <AuthCallback />
        </Suspense>
      </main>
    </div>
  );
}
