"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, CreditCard, Database, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { POLICY_LABELS, workspaceProfileSchema, type PolicyMode, type WorkspaceProfileInput } from "@proofwork/domain";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/primitives";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const STEPS = [
  { n: 1, title: "Workspace", sub: "Name your workspace and set basic details." },
  { n: 2, title: "Recovery policy", sub: "Choose how mismatches are handled." },
  { n: 3, title: "Evidence source", sub: "Select where outcomes are verified." },
];

export function useTimezones() {
  return React.useMemo(() => {
    try {
      const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
      const list = fn ? fn("timeZone") : [];
      return list.length ? (list.includes("UTC") ? list : ["UTC", ...list]) : ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles"];
    } catch {
      return ["UTC"];
    }
  }, []);
}

export function OnboardingWizard({
  initialStep,
  profile,
  policyMode,
  sources,
}: {
  initialStep: number;
  profile: { organization: string; name: string; timezone: string };
  policyMode: PolicyMode;
  sources: { localSandboxConfigured: boolean; stripeConfigured: boolean; stripeReason: string | null };
}) {
  const [step, setStep] = React.useState(Math.max(1, initialStep));
  const [maxReached, setMaxReached] = React.useState(Math.max(1, initialStep));
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const goTo = (n: number) => {
    setStep(n);
    setMaxReached((m) => Math.max(m, n));
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[260px_1fr] lg:gap-14">
      <aside aria-label="Setup progress">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Workspace setup</p>
        <p className="mt-3 text-[32px] font-bold leading-[1.1] tracking-[-0.03em]">Make the control explicit.</p>
        <p className="mt-3 text-[16px] leading-relaxed text-muted">Set up your workspace to verify subscription cancellations at period end, with evidence you can inspect.</p>
        <ol className="mt-8 space-y-1">
          {STEPS.map((s) => {
            const done = s.n < step || (s.n < maxReached && s.n !== step);
            const current = s.n === step;
            return (
              <li key={s.n}>
                <button
                  type="button"
                  disabled={s.n > maxReached}
                  onClick={() => setStep(s.n)}
                  aria-current={current ? "step" : undefined}
                  className={cn("flex w-full items-start gap-3 rounded-surface px-3 py-3 text-left transition-ui disabled:cursor-default", current ? "bg-primary-soft" : "hover:bg-neutral-soft disabled:hover:bg-transparent")}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                      done ? "bg-success-soft text-success" : current ? "bg-primary text-white" : "bg-neutral-soft text-neutral-ink",
                    )}
                  >
                    {done ? <Check className="size-4" aria-label="Completed" /> : s.n}
                  </span>
                  <span>
                    <span className={cn("block text-[15px] font-medium", current ? "text-primary-ink" : "text-ink")}>{s.title}</span>
                    <span className="block text-[13px] text-muted">{s.sub}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      <section className="rounded-[12px] border border-line bg-surface p-6 shadow-card sm:p-10" aria-labelledby="onboarding-heading">
        <p className="text-sm font-medium text-muted">Step {step} of 3</p>
        {step === 1 ? <WorkspaceStep headingRef={headingRef} profile={profile} onDone={() => goTo(2)} /> : null}
        {step === 2 ? <PolicyStep headingRef={headingRef} initialMode={policyMode} onBack={() => setStep(1)} onDone={() => goTo(3)} /> : null}
        {step === 3 ? <SourceStep headingRef={headingRef} sources={sources} onBack={() => setStep(2)} /> : null}
      </section>
    </div>
  );
}

function Heading({ headingRef, children }: { headingRef: React.RefObject<HTMLHeadingElement | null>; children: React.ReactNode }) {
  return (
    <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1} className="mt-2 text-[30px] font-bold tracking-[-0.03em] outline-none sm:text-[36px]">
      {children}
    </h1>
  );
}

function WorkspaceStep({ headingRef, profile, onDone }: { headingRef: React.RefObject<HTMLHeadingElement | null>; profile: { organization: string; name: string; timezone: string }; onDone: () => void }) {
  const timezones = useTimezones();
  const [formError, setFormError] = React.useState<string | null>(null);
  const browserTz = React.useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<WorkspaceProfileInput>({
    resolver: zodResolver(workspaceProfileSchema),
    defaultValues: { organization: profile.organization, name: profile.name || "Customer operations", timezone: profile.timezone || browserTz },
  });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiFetch("/api/onboarding/workspace", { body: values });
      onDone();
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : "Could not save. Try again.");
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate>
      <Heading headingRef={headingRef}>Name the workspace</Heading>
      <p className="mt-2 text-[17px] text-muted">Use a name your team will recognize.</p>
      <div className="mt-8 space-y-6">
        <FormError message={formError} />
        <Field id="organization" label="Organization" error={errors.organization?.message}>
          {(a) => <Input {...a} className="h-12" autoComplete="organization" {...register("organization")} />}
        </Field>
        <Field id="name" label="Workspace name" hint="You can change this later in Settings." error={errors.name?.message}>
          {(a) => <Input {...a} className="h-12" {...register("name")} />}
        </Field>
        <Field id="timezone" label="Timezone" hint="Used to display timestamps. Evidence is stored in UTC." error={errors.timezone?.message}>
          {(a) => (
            <Select {...a} className="h-12" {...register("timezone")}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="mt-10 flex items-center justify-end border-t border-line pt-6">
        <Button type="submit" size="lg" className="min-w-40" loading={isSubmitting}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function PolicyStep({ headingRef, initialMode, onBack, onDone }: { headingRef: React.RefObject<HTMLHeadingElement | null>; initialMode: PolicyMode; onBack: () => void; onDone: () => void }) {
  const [mode, setMode] = React.useState<PolicyMode>(initialMode);
  const [confirmAuto, setConfirmAuto] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setFormError(null);
    try {
      await apiFetch("/api/onboarding/policy", { body: { mode, confirmAutoRecover: confirmAuto } });
      onDone();
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : "Could not save the policy.");
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <Heading headingRef={headingRef}>Choose the recovery posture.</Heading>
      <p className="mt-2 text-[17px] text-muted">This controls what Proofwork does when it finds a subscription whose period-end cancellation is missing.</p>
      <FormError message={formError} />
      <PolicyOptions value={mode} onChange={setMode} className="mt-8" />
      {mode === "AUTO_RECOVER" ? (
        <label className="mt-4 flex gap-3 rounded-control border border-warning/30 bg-warning-soft p-4 text-sm text-warning-ink">
          <Checkbox checked={confirmAuto} onChange={(e) => setConfirmAuto(e.target.checked)} />
          <span>
            I allow Proofwork to automatically <strong>schedule cancellation at the authorized paid-period end</strong> for verified mismatches — the only supported action. It still re-checks the source before writing and reads it again afterwards.
          </span>
        </label>
      ) : null}
      <div className="mt-10 flex items-center justify-between border-t border-line pt-6">
        <Button type="button" variant="secondary" size="lg" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" size="lg" className="min-w-40" loading={pending} disabled={mode === "AUTO_RECOVER" && !confirmAuto}>
          Continue
        </Button>
      </div>
    </form>
  );
}

export function PolicyOptions({ value, onChange, className, compact }: { value: PolicyMode; onChange: (m: PolicyMode) => void; className?: string; compact?: boolean }) {
  const modes: PolicyMode[] = ["OBSERVE_ONLY", "REQUIRE_APPROVAL", "AUTO_RECOVER"];
  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="sr-only">Recovery policy</legend>
      {modes.map((m) => {
        const selected = value === m;
        return (
          <label
            key={m}
            className={cn(
              "flex cursor-pointer items-start gap-4 rounded-surface border transition-ui focus-within:ring-3 focus-within:ring-primary/20",
              compact ? "p-3.5" : "p-5",
              selected ? "border-primary bg-primary-soft/60" : "border-line bg-surface hover:border-line-strong",
            )}
          >
            <input type="radio" name="policy-mode" value={m} checked={selected} onChange={() => onChange(m)} className="mt-1 size-5 accent-primary" />
            <span className="flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className={cn("font-semibold text-ink", compact ? "text-[15px]" : "text-lg")}>{POLICY_LABELS[m].label}</span>
                {m === "REQUIRE_APPROVAL" ? <Badge tone="info">Recommended</Badge> : null}
              </span>
              <span className={cn("mt-1 block text-muted", compact ? "text-[13px]" : "text-[15px]")}>{POLICY_LABELS[m].description}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function SourceStep({ headingRef, sources, onBack }: { headingRef: React.RefObject<HTMLHeadingElement | null>; sources: { localSandboxConfigured: boolean; stripeConfigured: boolean; stripeReason: string | null }; onBack: () => void }) {
  const router = useRouter();
  const [adapter, setAdapter] = React.useState<"LOCAL_SANDBOX" | "STRIPE_TEST">("LOCAL_SANDBOX");
  const [pending, setPending] = React.useState(false);
  const [formError, setFormError] = React.useState<{ message: string; ref?: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setFormError(null);
    try {
      const res = await apiFetch<{ redirect: string }>("/api/onboarding/source", { body: { adapter } });
      router.replace(res.redirect);
      router.refresh();
    } catch (err) {
      setFormError({ message: err instanceof ApiClientError ? err.message : "The evidence source could not be validated.", ref: err instanceof ApiClientError ? err.correlationId : undefined });
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Heading headingRef={headingRef}>Start with a safe evidence source.</Heading>
      <p className="mt-2 text-[17px] text-muted">
        The local billing sandbox runs isolated synthetic subscriptions. No live systems are connected and no real subscriptions are affected.
      </p>
      <fieldset className="mt-8 grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Evidence source</legend>
        <SourceTile
          selected={adapter === "LOCAL_SANDBOX"}
          disabled={!sources.localSandboxConfigured}
          onSelect={() => setAdapter("LOCAL_SANDBOX")}
          icon={<Database aria-hidden />}
          title="Local billing sandbox"
          badge={sources.localSandboxConfigured ? <Badge tone="success">Ready to validate</Badge> : <Badge tone="warning">Requires setup</Badge>}
          description="An independent synthetic billing service with its own records, read and write credentials."
          points={["Isolated, non-production records", "Realistic subscription states", "Safe for the full workflow"]}
        />
        <SourceTile
          selected={adapter === "STRIPE_TEST"}
          disabled={!sources.stripeConfigured}
          onSelect={() => setAdapter("STRIPE_TEST")}
          icon={sources.stripeConfigured ? <CreditCard aria-hidden /> : <Lock aria-hidden />}
          title="Stripe test mode"
          badge={sources.stripeConfigured ? <Badge tone="info">Configured · not checked</Badge> : <Badge tone="warning">Not configured</Badge>}
          description={
            sources.stripeConfigured
              ? "Reads and the single allowed update run against your Stripe test account. Live-mode keys and resources are rejected."
              : `Available after server-side configuration. ${sources.stripeReason ?? ""}`
          }
          points={sources.stripeConfigured ? ["Test mode only", "Account identity validated before use", "No credentials entered in the browser"] : ["No credentials requested here", "Configured by the deployment owner", "See LOCAL-SETUP.md"]}
          dashed={!sources.stripeConfigured}
        />
      </fieldset>
      <div className="mt-6" aria-live="polite">
        <FormError message={formError?.message} reference={formError?.ref} />
        {pending ? <p className="text-sm text-muted">Validating the source account through its read API…</p> : null}
      </div>
      <div className="mt-8 flex items-center justify-between border-t border-line pt-6">
        <Button type="button" variant="link" onClick={onBack} className="text-[15px]">
          <ArrowLeft aria-hidden /> Back
        </Button>
        <Button type="submit" size="lg" className="min-w-44" loading={pending} disabled={(adapter === "LOCAL_SANDBOX" && !sources.localSandboxConfigured) || (adapter === "STRIPE_TEST" && !sources.stripeConfigured)}>
          Open workspace {pending ? null : <ArrowRight aria-hidden />}
        </Button>
      </div>
    </form>
  );
}

function SourceTile({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  badge,
  description,
  points,
  dashed,
}: {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  badge: React.ReactNode;
  description: string;
  points: string[];
  dashed?: boolean;
}) {
  return (
    <label
      className={cn(
        "relative flex flex-col rounded-surface border p-6 transition-ui focus-within:ring-3 focus-within:ring-primary/20",
        selected && !disabled ? "border-primary bg-primary-soft/40" : "border-line",
        dashed && "border-dashed",
        disabled ? "cursor-not-allowed opacity-75" : "cursor-pointer hover:border-line-strong",
      )}
    >
      <input type="radio" name="source" checked={selected} disabled={disabled} onChange={onSelect} className="absolute right-5 top-5 size-5 accent-primary" />
      <span className={cn("flex size-12 items-center justify-center rounded-control [&_svg]:size-6", selected && !disabled ? "bg-primary-soft text-primary-ink" : "bg-neutral-soft text-neutral-ink")}>{icon}</span>
      <span className="mt-5 text-lg font-semibold">{title}</span>
      <span className="mt-2">{badge}</span>
      <span className="mt-4 text-[15px] text-muted">{description}</span>
      <span className="mt-5 space-y-2 border-t border-line pt-4">
        {points.map((p) => (
          <span key={p} className="flex items-center gap-2 text-sm text-muted">
            <Check className={cn("size-4", dashed ? "text-subtle" : "text-success")} aria-hidden /> {p}
          </span>
        ))}
      </span>
    </label>
  );
}
