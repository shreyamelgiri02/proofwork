"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Info } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { claimSchema, formatDate, LIMITS, type ClaimInput } from "@proofwork/domain";
import { Breadcrumbs, PageHeader } from "@/components/page";
import { VerdictBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { Card, EmptyState, Mono, Skeleton, StepNumber } from "@/components/ui/primitives";
import { useTimezone } from "@/features/shared/hooks";
import { ApiClientError, apiFetch, newIdempotencyKey } from "@/lib/api-client";

interface RequestsResponse {
  items: { id: string; version: number; customer_label: string | null; customer_id: string; subscription_id: string; expected_period_end: string; task_id: string | null; task_verdict: string | null }[];
}

interface ClaimResponse {
  accepted: true;
  duplicate: boolean;
  receipt_id: string;
  task_id: string;
  verdict: "PENDING" | "SATISFIED_SCHEDULED" | "SATISFIED_ENDED" | "MISMATCH" | "UNVERIFIABLE" | "OUT_OF_SCOPE";
  processing_state: string;
}

export function SubmitReportPage() {
  const tz = useTimezone();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const requests = useQuery({ queryKey: ["requests"], queryFn: () => apiFetch<RequestsResponse>("/api/requests") });
  const [result, setResult] = React.useState<ClaimResponse | null>(null);
  const [formError, setFormError] = React.useState<{ message: string; ref?: string } | null>(null);
  // One idempotency key per distinct submission: retries of the same payload reuse it.
  const keyRef = React.useRef<{ payload: string; key: string } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ClaimInput>({
    resolver: zodResolver(claimSchema),
    defaultValues: { authorized_request_id: params.get("request") ?? "", agent_name: "Support Agent", report_text: "Cancellation scheduled for the end of the current paid period." },
  });

  React.useEffect(() => {
    const requested = params.get("request");
    if (requested && requests.data?.items.some((r) => r.id === requested)) setValue("authorized_request_id", requested);
  }, [params, requests.data, setValue]);

  const text = watch("report_text") ?? "";

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const payload = JSON.stringify(values);
    if (!keyRef.current || keyRef.current.payload !== payload) keyRef.current = { payload, key: newIdempotencyKey() };
    try {
      const res = await apiFetch<ClaimResponse>("/api/claims", { body: values, headers: { "idempotency-key": keyRef.current.key } });
      setResult(res);
      keyRef.current = null;
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["tasks"] }), queryClient.invalidateQueries({ queryKey: ["session"] }), queryClient.invalidateQueries({ queryKey: ["requests"] })]);
    } catch (err) {
      const e = err instanceof ApiClientError ? err : null;
      setFormError({ message: e?.message ?? "The report was not accepted.", ref: e?.code === "INTERNAL_ERROR" ? e.correlationId : undefined });
    }
  });

  if (result) {
    return (
      <div>
        <Breadcrumbs items={[{ label: "Tasks", href: "/app/tasks" }, { label: "Submit report" }]} />
        <Card className="mx-auto mt-6 max-w-2xl p-8 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary-soft">
            <Clock className="size-7 text-primary" aria-hidden />
          </span>
          <h1 className="mt-5 text-[26px] font-semibold tracking-tight" tabIndex={-1} ref={(el) => el?.focus()}>
            {result.duplicate ? "This report was already received" : "Report received — verification queued"}
          </h1>
          <p className="mt-2 text-muted">The claim is preserved. It does not change the verdict by itself; the worker will read the billing source independently.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-muted">Current state:</span>
            <VerdictBadge verdict={result.verdict} size="sm" />
          </div>
          <p className="mt-3 text-xs text-muted">
            Receipt <Mono className="text-xs">{result.receipt_id}</Mono>
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={`/app/tasks/${result.task_id}`}>Open task evidence</Link>
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => {
                setResult(null);
                reset({ authorized_request_id: "", agent_name: "Support Agent", report_text: "" });
              }}
            >
              Submit another report
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Tasks", href: "/app/tasks" }, { label: "Submit report" }]} />
      <PageHeader title="Submit the agent’s report" description="A report is accepted only against a separately authorized request." />
      <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
        <Card className="p-6 sm:p-8">
          {requests.isPending ? (
            <div className="space-y-4">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-40" />
            </div>
          ) : requests.data && requests.data.items.length === 0 ? (
            <EmptyState
              title="No authorized requests yet"
              description="An agent's report can only be accepted against a customer request that an operator registered first."
              action={
                <Button asChild>
                  <Link href="/app/requests/new">Register request</Link>
                </Button>
              }
            />
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-6">
              <FormError message={formError?.message} reference={formError?.ref} />
              <Field id="authorized_request_id" label="Authorized customer request" required hint="Select the approved request for this cancellation." error={errors.authorized_request_id?.message}>
                {(a) => (
                  <Select {...a} className="h-11" {...register("authorized_request_id")}>
                    <option value="">Select a request…</option>
                    {requests.data?.items.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.customer_label ?? r.customer_id} · {r.subscription_id} · ends {formatDate(r.expected_period_end, tz)}
                        {r.version > 1 ? ` · v${r.version}` : ""}
                        {r.task_id ? " · report already received" : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="agent_name" label="Agent" required hint="The AI employee or worker that reported completion." error={errors.agent_name?.message}>
                {(a) => (
                  <>
                    <Input {...a} className="h-11" list="agent-suggestions" maxLength={80} {...register("agent_name")} />
                    <datalist id="agent-suggestions">
                      <option value="Support Agent" />
                      <option value="Billing Assistant" />
                      <option value="Retention Agent" />
                    </datalist>
                  </>
                )}
              </Field>
              <Field id="report_text" label="Report" required hint={`${text.length} / ${LIMITS.REPORT_TEXT_MAX_CHARS} characters. Stored verbatim as untrusted text.`} error={errors.report_text?.message}>
                {(a) => <Textarea {...a} rows={6} maxLength={LIMITS.REPORT_TEXT_MAX_CHARS} {...register("report_text")} />}
              </Field>
              <Button type="submit" size="lg" loading={isSubmitting}>
                {isSubmitting ? "Submitting…" : "Submit report"}
              </Button>
            </form>
          )}
        </Card>
        <Card className="h-fit p-6 sm:p-7">
          <h2 className="text-[22px] font-semibold tracking-tight">After submission</h2>
          <p className="mt-2 text-[15px] text-muted">Your report goes through independent verification before an outcome is decided.</p>
          <ol className="mt-5 divide-y divide-line">
            {[
              ["Claim is preserved", "Proofwork stores the report with its receipt and links it to the authorized request."],
              ["Source is checked", "The worker reads the billing record independently of the agent."],
              ["Outcome is decided", "A versioned evaluator compares the source with the authorized request. Evidence — not the report — decides."],
            ].map(([t, b], i) => (
              <li key={t} className="flex gap-4 py-4">
                <StepNumber n={i + 1} />
                <div>
                  <p className="font-medium">{t}</p>
                  <p className="mt-1 text-sm text-muted">{b}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <Card className="mt-5 flex items-center gap-3 px-5 py-4 text-[15px] text-muted">
        <Info className="size-5 shrink-0" aria-hidden /> The claim never changes the verdict by itself.
      </Card>
    </div>
  );
}
