"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { LIMITS, signUpSchema, type SignUpInput } from "@proofwork/domain";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, PasswordInput } from "@/components/ui/form";
import { ExploreDemoButton } from "@/features/demo/explore-demo-button";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { AuthCard, OrDivider } from "./auth-card";
import { GoogleButton } from "./google-button";

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<{ message: string; ref?: string } | null>(null);
  const form = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema), defaultValues: { fullName: "", organization: "", email: "", password: "" } });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await apiFetch<{ status: string; redirect?: string; email?: string }>("/api/auth/sign-up", { body: values });
      if (res.status === "signed_in" && res.redirect) {
        router.replace(res.redirect);
        return;
      }
      setSentTo(values.email);
    } catch (err) {
      if (err instanceof ApiClientError) {
        for (const [field, messages] of Object.entries(err.fieldErrors ?? {})) {
          if (field in values) setError(field as keyof SignUpInput, { message: messages[0] });
        }
        setFormError({ message: err.message, ref: err.code === "INTERNAL_ERROR" ? err.correlationId : undefined });
      } else setFormError({ message: "Account creation failed. Try again." });
    }
  });

  if (sentTo) {
    return <ConfirmEmailState email={sentTo} onChangeEmail={() => setSentTo(null)} />;
  }

  return (
    <AuthCard title="Start your workspace" description="Create the owner account.">
      <GoogleButton enabled={googleEnabled} next="/onboarding" />
      <OrDivider />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={formError?.message} reference={formError?.ref} />
        <Field id="fullName" label="Your name" error={errors.fullName?.message}>
          {(a) => <Input {...a} autoComplete="name" placeholder="Your full name" {...register("fullName")} />}
        </Field>
        <Field id="organization" label="Organization" error={errors.organization?.message}>
          {(a) => <Input {...a} autoComplete="organization" placeholder="Company name" {...register("organization")} />}
        </Field>
        <Field id="email" label="Work email" error={errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="email" placeholder="you@company.com" {...register("email")} />}
        </Field>
        <Field id="password" label="Password" hint="At least 8 characters." error={errors.password?.message}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" {...register("password")} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <div className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-primary-ink hover:underline">
          Sign in
        </Link>
      </div>
      <div className="mt-5">
        <ExploreDemoButton variant="outline" size="lg" className="w-full bg-primary-soft/50">
          <ExternalLink aria-hidden /> Explore the isolated demo
        </ExploreDemoButton>
      </div>
      <p className="mt-4 text-center text-[13px] leading-relaxed text-subtle">
        By creating an account you become the owner of a private workspace. Proofwork only reads or changes connected systems within the policy you set.
      </p>
    </AuthCard>
  );
}

/** Screen 04: confirmation instructions with resend cooldown and a path to correct the address. */
export function ConfirmEmailState({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  const [cooldown, setCooldown] = React.useState<number>(LIMITS.RESEND_COOLDOWN_SECONDS);
  const [status, setStatus] = React.useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [pending, setPending] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    setPending(true);
    setStatus(null);
    try {
      await apiFetch("/api/auth/resend", { body: { email } });
      setStatus({ tone: "ok", message: "A new confirmation link was sent." });
      setCooldown(LIMITS.RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      const e = err instanceof ApiClientError ? err : null;
      setStatus({ tone: "error", message: e?.message ?? "We could not resend right now." });
      if (e?.retryAfterSeconds) setCooldown(e.retryAfterSeconds);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-[12px] border border-line bg-surface p-6 text-center shadow-float sm:p-12">
      <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-primary-soft">
        <Mail className="size-10 text-primary" aria-hidden />
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-8 text-[32px] font-bold tracking-[-0.03em] text-ink outline-none">
        Check your email
      </h1>
      <p className="mt-4 text-[17px] text-muted">
        We sent a secure confirmation link to
        <br />
        <span className="font-medium text-ink">{email}</span>.
      </p>
      <p className="mt-3 text-[17px] text-muted">Open it to finish creating your workspace.</p>
      <div className="mt-8 border-t border-line pt-6 text-sm text-muted">
        Check spam, or{" "}
        <button type="button" onClick={onChangeEmail} className="font-medium text-primary-ink hover:underline">
          try again with the correct email
        </button>
        .
      </div>
      <div aria-live="polite" className="min-h-6 pt-3 text-sm">
        {status ? <span className={status.tone === "ok" ? "text-success-ink" : "text-danger-ink"}>{status.message}</span> : null}
      </div>
      <div className="mt-3 flex flex-col gap-3">
        <Button type="button" variant="secondary" size="lg" onClick={resend} disabled={cooldown > 0} loading={pending}>
          {cooldown > 0 ? `Resend link in ${cooldown}s` : "Resend confirmation link"}
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/sign-in">Return to sign in</Link>
        </Button>
      </div>
    </div>
  );
}
