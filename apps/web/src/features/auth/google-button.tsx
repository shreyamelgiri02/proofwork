import { Button } from "@/components/ui/button";
import { GoogleIcon } from "./auth-card";

/** Google OAuth entry. Shown enabled only when configured; otherwise an explained unavailable state. */
export function GoogleButton({ enabled, next, label = "Continue with Google" }: { enabled: boolean; next?: string; label?: string }) {
  if (!enabled) {
    return (
      <div>
        <Button type="button" variant="secondary" size="lg" className="w-full" disabled aria-describedby="google-unavailable">
          <GoogleIcon className="opacity-60" /> {label}
        </Button>
        <p id="google-unavailable" className="mt-1.5 text-[13px] text-muted">
          Google sign-in is unavailable here. Continue with email instead.
        </p>
      </div>
    );
  }

  const href = `/api/auth/oauth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <Button asChild variant="secondary" size="lg" className="w-full">
      <a href={href} rel="nofollow">
        <GoogleIcon /> {label}
      </a>
    </Button>
  );
}
