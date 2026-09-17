"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "./auth-card";

/** Google OAuth entry. Shown enabled only when configured; otherwise an explained unavailable state. */
export function GoogleButton({ enabled, next, label = "Continue with Google" }: { enabled: boolean; next?: string; label?: string }) {
  const [pending, setPending] = React.useState(false);
  if (!enabled) {
    return (
      <div>
        <Button type="button" variant="secondary" size="lg" className="w-full" disabled aria-describedby="google-unavailable">
          <GoogleIcon className="opacity-60" /> {label}
        </Button>
        <p id="google-unavailable" className="mt-1.5 text-[13px] text-muted">
          Google sign-in is not configured for this deployment. Use your work email instead.
        </p>
      </div>
    );
  }
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full"
      loading={pending}
      onClick={() => {
        setPending(true);
        window.location.assign(`/api/auth/oauth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      }}
    >
      {pending ? null : <GoogleIcon />} {pending ? "Redirecting to Google…" : label}
    </Button>
  );
}
