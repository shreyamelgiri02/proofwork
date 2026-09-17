"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { LogoMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { ApiClientError, apiFetch } from "@/lib/api-client";

type State = { kind: "working" } | { kind: "error"; title: string; message: string; recovery: boolean };

/**
 * Screen 07. Transient return state: completes the PKCE/token exchange server-side,
 * then routes to reset password, onboarding, or the requested page.
 */
export function AuthCallback() {
  const router = useRouter();
  const params = useSearchParams();
  const started = React.useRef(false);

  // Errors that are fully determined by the URL are derived, not stored.
  const urlInfo = React.useMemo(() => {
    const next = params.get("next") ?? undefined;
    const recovery = params.get("type") === "recovery" || (next ?? "").startsWith("/reset-password");
    // Supabase can return errors in the query or the URL fragment. A specific error_code
    // (e.g. otp_expired for a used/expired email link) takes precedence over the generic
    // `error` value, which is also "access_denied" for expired links.
    const hash = typeof window !== "undefined" ? new URLSearchParams(window.location.hash.replace(/^#/, "")) : null;
    const specific = params.get("error_code") ?? hash?.get("error_code") ?? null;
    const generic = params.get("error") ?? hash?.get("error") ?? null;
    const errorCode = specific ?? generic;
    const code = params.get("code") ?? undefined;
    const token_hash = params.get("token_hash") ?? undefined;
    const type = params.get("type") ?? undefined;
    let error: State | null = null;
    const oauthCancelled = !specific && generic === "access_denied";
    if (errorCode && !oauthCancelled) {
      error = {
        kind: "error",
        title: recovery ? "This reset link can't be used" : "This link can't be used",
        message: /expired|otp|invalid/.test(errorCode) ? "The link has expired or was already used." : "We couldn't complete sign-in from this link.",
        recovery,
      };
    } else if (!errorCode && !code && !token_hash) {
      error = { kind: "error", title: "Missing sign-in details", message: "Open the most recent link from your email, or sign in again.", recovery };
    }
    return { next, recovery, errorCode, oauthCancelled, code, token_hash, type, error };
  }, [params]);

  const [exchangeError, setExchangeError] = React.useState<State | null>(null);
  const state: State = urlInfo.error ?? exchangeError ?? { kind: "working" };

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (urlInfo.oauthCancelled) {
      router.replace("/sign-in?error=oauth_cancelled");
      return;
    }
    if (urlInfo.error) return;
    const { code, token_hash, type, next, recovery } = urlInfo;
    apiFetch<{ redirect: string }>("/api/auth/exchange", { body: { code, token_hash, type, next } })
      .then((res) => {
        router.replace(res.redirect);
        router.refresh();
      })
      .catch((err) => {
        setExchangeError({
          kind: "error",
          title: recovery ? "This reset link can't be used" : "We couldn't verify this link",
          message: err instanceof ApiClientError ? err.message : "Try signing in again.",
          recovery,
        });
      });
  }, [urlInfo, router]);

  if (state.kind === "error") {
    return (
      <div className="flex max-w-md flex-col items-center text-center" role="alert">
        <span className="flex size-16 items-center justify-center rounded-full bg-danger-soft">
          <CircleAlert className="size-8 text-danger" aria-hidden />
        </span>
        <h1 className="mt-6 text-[28px] font-bold tracking-[-0.03em]">{state.title}</h1>
        <p className="mt-3 text-[17px] text-muted">{state.message}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {state.recovery ? (
            <Button asChild size="lg">
              <Link href="/forgot-password">Request a new link</Link>
            </Button>
          ) : (
            <Button asChild size="lg">
              <Link href="/sign-in">Return to sign in</Link>
            </Button>
          )}
          <Button asChild size="lg" variant="secondary">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center" aria-busy="true">
      <LogoMark className="size-16" />
      <h1 className="mt-6 text-[32px] font-bold tracking-[-0.03em] sm:text-[40px]">Securing your workspace…</h1>
      <p className="mt-3 text-[17px] text-muted">We are verifying your account and preparing the correct workspace.</p>
      <div className="mt-8">
        <Spinner className="size-9" label="Verifying your account" />
      </div>
    </div>
  );
}
