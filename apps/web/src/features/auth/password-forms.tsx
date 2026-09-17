"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { forgotPasswordSchema, resetPasswordSchema, type ResetPasswordInput } from "@proofwork/domain";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, PasswordInput } from "@/components/ui/form";
import { Alert } from "@/components/ui/primitives";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { AuthCard } from "./auth-card";

export function ForgotPasswordForm({ expired }: { expired?: boolean }) {
  const [sent, setSent] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await apiFetch("/api/auth/forgot-password", { body: { email } });
      setSent(email);
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : "We could not send the link right now.");
    }
  });

  return (
    <AuthCard title="Reset your password." description="Enter your work email and we will send a secure reset link.">
      {expired ? (
        <Alert tone="warning" className="mb-5" title="That link has expired or was already used">
          Request a new reset link below.
        </Alert>
      ) : null}
      {sent ? (
        <div role="status" className="rounded-control border border-success/25 bg-success-soft p-4 text-sm text-success-ink">
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck className="size-4" aria-hidden /> Check your inbox
          </p>
          <p className="mt-1">If an account exists for {sent}, a secure reset link is on its way. The link can be used once.</p>
          <button type="button" className="mt-3 font-medium underline" onClick={() => setSent(null)}>
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormError message={formError} />
          <Field id="email" label="Work email" error={errors.email?.message}>
            {(a) => <Input {...a} type="email" autoComplete="email" placeholder="you@company.com" {...register("email")} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            {isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <div className="mt-7 border-t border-line pt-5 text-center text-sm text-muted">
        Back to{" "}
        <Link href="/sign-in" className="font-medium text-primary-ink hover:underline">
          sign in
        </Link>
      </div>
    </AuthCard>
  );
}

export function NewPasswordForm() {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [expired, setExpired] = React.useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: "", confirmPassword: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await apiFetch<{ redirect: string }>("/api/auth/update-password", { body: values });
      router.replace(`${res.redirect}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "AUTH_REQUIRED") setExpired(true);
        if (err.fieldErrors?.password) setError("password", { message: err.fieldErrors.password[0] });
        setFormError(err.message);
      } else setFormError("The password could not be saved.");
    }
  });

  if (expired) {
    return (
      <AuthCard title="This reset link has expired." description="Reset links can be used once and expire after a short time.">
        <Button asChild size="lg" className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password." description="Your new password will replace the previous one on this account.">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={formError} />
        <Field id="password" label="New password" hint="At least 8 characters." error={errors.password?.message}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" {...register("password")} />}
        </Field>
        <Field id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" {...register("confirmPassword")} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </AuthCard>
  );
}
