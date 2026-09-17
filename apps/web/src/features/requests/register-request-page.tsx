"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { formatDate, formatDateTime, previewRequestSchema } from "@proofwork/domain";
import { Breadcrumbs, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/form";
import { Alert, Card, Mono, Skeleton, StepNumber } from "@/components/ui/primitives";
import { useTimezone } from "@/features/shared/hooks";
import { ApiClientError, apiFetch } from "@/lib/api-client";

interface SubscriptionsResponse {
  connection: { id: string; adapter: string; display_name: string };
  observed_at: string;
  items: { subscription_id: string; customer_id: string; customer_label: string | null; status: string; current_period_end: string | null; cancel_at_period_end: boolean; active_request_id: string | null }[];
}

interface Preview {
  preview_token: string;
  expires_at: string;
  expected_period_end: string;
  customer_id: string;
  customer_label: string | null;
  subscription_id: string;
  source_account_id: string;
  source_label: string;
  adapter: string;
  observed_at: string;
  provider_request_id: string | null;
  cancel_at_period_end: boolean;
  supported_shape: boolean;
}

export function RegisterRequestPage() {
  const tz = useTimezone();
  const queryClient = useQueryClient();
  const subs = useQuery({ queryKey: ["subscriptions"], queryFn: () => apiFetch<SubscriptionsResponse>("/api/subscriptions"), staleTime: 30_000 });
  const [subscriptionId, setSubscriptionId] = React.useState("");
  const [sourceReference, setSourceReference] = React.useState("");
  const [supersede, setSupersede] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; ref?: string } | null>(null);
  const [created, setCreated] = React.useState<{ id: string; customer_label: string | null; subscription_id: string; expected_period_end: string } | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!preview) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [preview]);

  const selected = subs.data?.items.find((s) => s.subscription_id === subscriptionId);
  const previewExpired = preview ? new Date(preview.expires_at).getTime() <= now : false;

  const resetPreview = () => {
    setPreview(null);
    setConfirmed(false);
  };

  const runPreview = async () => {
    if (previewing) return;
    setError(null);
    const parsed = previewRequestSchema.safeParse({
      subscription_id: subscriptionId,
      source_reference: sourceReference,
      supersedes_request_id: supersede && selected?.active_request_id ? selected.active_request_id : undefined,
    });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const issue of parsed.error.issues) fe[String(issue.path[0])] ??= issue.message;
      setFieldErrors(fe);
      return;
    }
    setFieldErrors({});
    setPreviewing(true);
    resetPreview();
    try {
      setPreview(await apiFetch<Preview>("/api/requests/preview", { body: parsed.data }));
    } catch (err) {
      setError({ message: err instanceof ApiClientError ? err.message : "The source could not be read.", ref: err instanceof ApiClientError ? err.correlationId : undefined });
    } finally {
      setPreviewing(false);
    }
  };

  const confirm = async () => {
    if (!preview || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await apiFetch<{ id: string; customer_label: string | null; subscription_id: string; expected_period_end: string }>("/api/requests", {
        body: { preview_token: preview.preview_token, confirm: true },
      });
      setCreated(res);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["subscriptions"] }), queryClient.invalidateQueries({ queryKey: ["requests"] })]);
    } catch (err) {
      const e = err instanceof ApiClientError ? err : null;
      setError({ message: e?.message ?? "The request could not be registered.", ref: e?.code === "INTERNAL_ERROR" ? e.correlationId : undefined });
      if (e && (e.code === "PREVIEW_STALE" || e.code === "PREVIEW_EXPIRED")) resetPreview();
    } finally {
      setConfirming(false);
    }
  };

  if (created) {
    return (
      <div>
        <Breadcrumbs items={[{ label: "Tasks", href: "/app/tasks" }, { label: "Register request" }]} />
        <Card className="mx-auto mt-6 max-w-2xl p-8 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft">
            <CircleCheck className="size-7 text-success" aria-hidden />
          </span>
          <h1 className="mt-5 text-[26px] font-semibold tracking-tight" tabIndex={-1} ref={(el) => el?.focus()}>
            Customer request registered
          </h1>
          <p className="mt-2 text-muted">
            {created.customer_label ?? created.subscription_id} is authorized to cancel at the end of the paid period on {formatDate(created.expected_period_end, tz)}. This date is now fixed for this request version.
          </p>
          <p className="mt-2 text-sm text-muted">Registering a request does not start monitoring on its own. Submit the agent’s report to begin verification.</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={`/app/claims/new?request=${created.id}`}>Submit agent report</Link>
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => {
                setCreated(null);
                setSubscriptionId("");
                setSourceReference("");
                setSupersede(false);
                resetPreview();
              }}
            >
              Register another
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Tasks", href: "/app/tasks" }, { label: "Register request" }]} />
      <PageHeader title="Register a customer request" description="Record authority before accepting an agent report." />
      <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
        <Card className="p-6 sm:p-8">
          {subs.isError ? (
            <Alert tone="danger" title="Subscriptions could not be loaded" className="mb-5" action={<Button size="sm" variant="secondary" onClick={() => subs.refetch()}>Retry</Button>}>
              {subs.error instanceof ApiClientError ? subs.error.message : "The evidence source is unavailable."}
            </Alert>
          ) : null}
          <form
            noValidate
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (preview && !previewExpired) void confirm();
              else void runPreview();
            }}
          >
            <Field id="subscription" label="Subscription" hint={subs.data ? `From ${subs.data.connection.display_name}. Select the customer and subscription to cancel.` : "Select the customer and subscription to cancel."} error={fieldErrors.subscription_id}>
              {(a) =>
                subs.isPending ? (
                  <Skeleton className="h-11" />
                ) : (
                  <Select
                    {...a}
                    className="h-11"
                    value={subscriptionId}
                    onChange={(e) => {
                      setSubscriptionId(e.target.value);
                      setSupersede(false);
                      resetPreview();
                    }}
                  >
                    <option value="">Select a subscription…</option>
                    {subs.data?.items.map((s) => (
                      <option key={s.subscription_id} value={s.subscription_id}>
                        {s.customer_label ?? s.customer_id} · {s.subscription_id}
                        {s.status !== "active" ? ` (${s.status})` : ""}
                        {s.active_request_id ? " · has active request" : ""}
                      </option>
                    ))}
                  </Select>
                )
              }
            </Field>

            {selected?.active_request_id ? (
              <Alert tone="warning" title="This subscription already has an active authorized request">
                <label className="mt-2 flex gap-2">
                  <Checkbox
                    checked={supersede}
                    onChange={(e) => {
                      setSupersede(e.target.checked);
                      resetPreview();
                    }}
                  />
                  Register a corrected version. The earlier version and its history are preserved and marked superseded.
                </label>
              </Alert>
            ) : null}

            <Field id="source-reference" label="Source reference" hint="The support ticket or conversation where the customer requested cancellation. Stored as plain text." error={fieldErrors.source_reference}>
              {(a) => (
                <Input
                  {...a}
                  className="h-11"
                  value={sourceReference}
                  maxLength={120}
                  placeholder="support-ticket-1042"
                  onChange={(e) => {
                    setSourceReference(e.target.value);
                    resetPreview();
                  }}
                />
              )}
            </Field>

            <div>
              <Button type="button" variant="outline" size="lg" onClick={runPreview} loading={previewing} disabled={subs.isPending || (selected?.active_request_id != null && !supersede)}>
                <CalendarClock aria-hidden /> Preview end date
              </Button>
              <p className="mt-2 text-[13px] text-muted">Proofwork reads the subscription from the source to find the current paid-period end. You cannot type a date.</p>
            </div>

            <div aria-live="polite">
              {preview ? (
                previewExpired ? (
                  <Alert tone="warning" title="Preview expired">
                    Previews are valid for 5 minutes. Preview the end date again to continue.
                  </Alert>
                ) : (
                  <div className="rounded-surface border border-success/25 bg-success-soft/70 p-5">
                    <div className="flex items-center gap-4">
                      <span className="flex size-12 items-center justify-center rounded-full bg-success text-white">
                        <CircleCheck className="size-6" aria-hidden />
                      </span>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-success-ink">Authorized end date</p>
                        <p className="text-[26px] font-semibold text-success-ink">{formatDate(preview.expected_period_end, tz)}</p>
                        <p className="text-[13px] text-success-ink/80">{formatDateTime(preview.expected_period_end, "UTC", { withZone: true })}</p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 border-t border-success/20 pt-4 sm:grid-cols-2 sm:divide-x sm:divide-success/20">
                      <div>
                        <p className="text-sm text-muted">Customer</p>
                        <Mono className="text-[15px]">{preview.customer_id}</Mono>
                        {preview.customer_label ? <p className="text-sm">{preview.customer_label}</p> : null}
                      </div>
                      <div className="sm:pl-4">
                        <p className="text-sm text-muted">{preview.source_label}</p>
                        <Mono className="text-[15px]">{preview.subscription_id}</Mono>
                        <p className="text-sm text-muted">Read {formatDateTime(preview.observed_at, tz)}</p>
                      </div>
                    </div>
                    {preview.cancel_at_period_end ? <p className="mt-3 text-[13px] text-success-ink">The source already shows a period-end cancellation. Verification will record that as evidence.</p> : null}
                    {!preview.supported_shape ? (
                      <p className="mt-3 flex items-center gap-1.5 text-[13px] text-warning-ink">
                        <TriangleAlert className="size-3.5" aria-hidden /> This subscription’s structure may be outside the supported scope. It can be registered, but automatic recovery will not apply.
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-muted">Preview valid for {Math.max(0, Math.round((new Date(preview.expires_at).getTime() - now) / 1000))}s.</p>
                  </div>
                )
              ) : null}
            </div>

            {preview && !previewExpired ? (
              <label className="flex gap-3">
                <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>
                  <span className="block text-[15px] font-medium">I confirm the customer asked to cancel at the end of this paid period.</span>
                  <span className="block text-[13px] text-muted">By confirming, you attest that you verified the customer’s request in the source reference. Proofwork records your identity and the time.</span>
                </span>
              </label>
            ) : null}

            <FormError message={error?.message} reference={error?.ref} />

            <div className="flex items-center gap-4 border-t border-line pt-6">
              <Button type="button" size="lg" onClick={confirm} loading={confirming} disabled={!preview || previewExpired || !confirmed}>
                Confirm request
              </Button>
              <Button asChild variant="link">
                <Link href="/app/tasks">Cancel</Link>
              </Button>
            </div>
          </form>
        </Card>

        <Card className="h-fit p-6 sm:p-7">
          <h2 className="text-[22px] font-semibold tracking-tight">What happens next</h2>
          <ol className="mt-5 divide-y divide-line">
            {[
              ["Read the source", "Proofwork reads the subscription through the connected evidence source and shows its current paid-period end."],
              ["Confirm authority", "You confirm the customer's request. Proofwork re-reads the source; if anything material changed, you preview again."],
              ["Wait for a claim", "When the agent's report arrives, the worker checks the billing record independently and records the result."],
            ].map(([t, b], i) => (
              <li key={t} className="flex gap-4 py-4 first:pt-0">
                <StepNumber n={i + 1} tone={i === 0 ? "primary" : "muted"} />
                <div>
                  <p className="font-medium">{t}</p>
                  <p className="mt-1 text-sm text-muted">{b}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
