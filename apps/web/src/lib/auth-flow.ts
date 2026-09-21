import { safeNextPath } from "./redirect";

type SearchParams = Pick<URLSearchParams, "get">;

/** Start OAuth only on the canonical app origin so its PKCE verifier cookie returns with the callback. */
export function canonicalOAuthStart(requestOrigin: string, next: string | null, appUrl: string): URL | null {
  const canonicalOrigin = new URL(appUrl).origin;
  if (requestOrigin === canonicalOrigin) return null;
  const target = new URL("/api/auth/oauth/google", canonicalOrigin);
  target.searchParams.set("next", safeNextPath(next, "/app/tasks"));
  return target;
}

export interface AuthCallbackError {
  kind: "error";
  title: string;
  message: string;
  recovery: boolean;
}

export function authCallbackIntent(params: SearchParams, hash: SearchParams = new URLSearchParams()) {
  const next = params.get("next") ?? undefined;
  const recovery = params.get("type") === "recovery" || (next ?? "").startsWith("/reset-password");
  const specific = params.get("error_code") ?? hash.get("error_code") ?? null;
  const generic = params.get("error") ?? hash.get("error") ?? null;
  const errorCode = specific ?? generic;
  const code = params.get("code") ?? undefined;
  const token_hash = params.get("token_hash") ?? undefined;
  const type = params.get("type") ?? undefined;
  const oauthCancelled = !specific && generic === "access_denied";
  let error: AuthCallbackError | null = null;

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
}

export function authDestination({ onboardingCompletedAt, next, type }: { onboardingCompletedAt: Date | string | null; next?: string; type?: string }) {
  const safeNext = safeNextPath(next, "");
  if (type === "recovery" || safeNext.startsWith("/reset-password")) return "/reset-password";
  if (!onboardingCompletedAt) return "/onboarding";
  return safeNext && !safeNext.startsWith("/onboarding") ? safeNext : "/app/tasks";
}
