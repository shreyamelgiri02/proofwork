import { AppError } from "@proofwork/domain";

/** Map Supabase Auth provider errors to safe, human-readable copy. Never echoes raw provider text. */
export function mapAuthError(error: { code?: string; message?: string; status?: number } | null | undefined, context: "sign-in" | "sign-up" | "reset" | "update" | "callback"): AppError {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return new AppError("INVALID_CREDENTIALS", "That email and password combination is not correct.");
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return new AppError("EMAIL_NOT_CONFIRMED", "Confirm your email address first. Check your inbox for the confirmation link.");
  }
  if (code === "user_already_exists" || code === "email_exists" || message.includes("already registered")) {
    return new AppError("CONFLICT", "An account with this email already exists. Sign in instead.");
  }
  if (code === "weak_password" || message.includes("password should")) {
    return new AppError("INVALID_PAYLOAD", "Choose a stronger password with at least 8 characters.", { fieldErrors: { password: ["Choose a stronger password."] } });
  }
  if (code === "same_password") {
    return new AppError("INVALID_PAYLOAD", "Choose a password different from your previous one.", { fieldErrors: { password: ["Use a different password."] } });
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error?.status === 429) {
    return new AppError("RATE_LIMITED", "Too many attempts. Wait a minute and try again.", { retryAfterSeconds: 60 });
  }
  if (code === "otp_expired" || code === "flow_state_expired" || message.includes("expired")) {
    return new AppError("PREVIEW_EXPIRED", "This link has expired or was already used. Request a new one.");
  }
  if (code === "bad_code_verifier" || code === "flow_state_not_found" || code === "bad_oauth_state") {
    return new AppError("AUTH_REQUIRED", "The sign-in link could not be completed in this browser. Start again from the same browser.");
  }
  if (code === "signup_disabled") return new AppError("PERMISSION_DENIED", "New account creation is disabled for this deployment.");
  if (context === "reset") return new AppError("INTERNAL_ERROR", "We could not start the reset right now. Try again shortly.");
  return new AppError("INTERNAL_ERROR", "Authentication is temporarily unavailable. Try again shortly.");
}
