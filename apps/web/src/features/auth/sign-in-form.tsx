"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { signInSchema, type SignInInput } from "@proofwork/domain";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, PasswordInput } from "@/components/ui/form";
import { ExploreDemoButton } from "@/features/demo/explore-demo-button";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { AuthCard, OrDivider } from "./auth-card";
import { GoogleButton } from "./google-button";

const QUERY_ERRORS: Record<string, string> = {
  oauth_unavailable: "Google sign-in is temporarily unavailable here. Continue with email instead.",
  oauth_failed: "Google sign-in could not start. Try again or use your work email.",
  oauth_cancelled: "Google sign-in was cancelled.",
  session_expired: "Your session ended. Sign in again to continue.",
};

export function SignInForm({ next, queryError, googleEnabled }: { next?: string; queryError?: string; googleEnabled: boolean }) {
  const router = useRouter();
  const [formError, setFormError] = React.useState<{ message: string; ref?: string } | null>(queryError ? { message: QUERY_ERRORS[queryError] ?? "Sign in to continue." } : null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema), defaultValues: { email: "", password: "", next } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await apiFetch<{ redirect: string }>("/api/auth/sign-in", { body: { ...values, next } });
      router.replace(res.redirect);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.fieldErrors?.email) setError("email", { message: err.fieldErrors.email[0] });
        // Entered values are preserved; only the password is cleared by the user if they choose.
        setFormError({ message: err.message, ref: err.code === "INTERNAL_ERROR" ? err.correlationId : undefined });
      } else setFormError({ message: "Sign in failed. Try again." });
    }
  });

  return (
    <AuthCard title="Welcome back." description="Sign in to your Proofwork account.">
      <GoogleButton enabled={googleEnabled} next={next} />
      <OrDivider />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={formError?.message} reference={formError?.ref} />
        <Field id="email" label="Work email" error={errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="email" placeholder="you@company.com" {...register("email")} />}
        </Field>
        <div>
          <Field id="password" label="Password" error={errors.password?.message}>
            {(a) => <PasswordInput {...a} autoComplete="current-password" {...register("password")} />}
          </Field>
          <div className="mt-2 text-right">
            <Link href="/forgot-password" className="text-sm font-medium text-primary-ink hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="mt-6 border-y border-line py-4 text-center text-sm text-muted">
        New to Proofwork?{" "}
        <Link href="/sign-up" className="font-medium text-primary-ink hover:underline">
          Create an account
        </Link>
      </div>
      <div className="mt-5">
        <ExploreDemoButton variant="outline" size="lg" className="w-full bg-primary-soft/50">
          <ExternalLink aria-hidden /> Explore the isolated demo
        </ExploreDemoButton>
      </div>
    </AuthCard>
  );
}
