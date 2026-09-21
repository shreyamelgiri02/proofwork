"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CalendarClock, CircleAlert, CircleCheck, CircleHelp, Clock, Database, FileText, MessageSquare, RefreshCw, ShieldCheck, Target, UserCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import {
  OPERATION_STATE_LABELS,
  POLICY_LABELS,
  PROCESSING_LABELS,
  PROPOSAL_STATUS_LABELS,
  REASON_COPY,
  auditLabel,
  formatDate,
  formatDateTime,
  formatRelative,
  type Tone,
} from "@proofwork/domain";
import { VerdictBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { CopyButton, useToast } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { Alert, Badge, Card, CardHeader, EmptyState, Mono, Skeleton } from "@/components/ui/primitives";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { EvidenceCard, reasonSummary } from "./evidence";
import { isWorking } from "./next-step";
import { InterventionButton, RetireTaskButton, ReviewButton, ScenarioControls } from "./task-actions";
import type { OperationSummary, TaskDetail } from "./types";

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const query = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => apiFetch<TaskDetail>(`/api/tasks/${taskId}`),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      const busy = isWorking(d.task.processing_state) || d.task.verdict === "PENDING" || Boolean(d.unresolved_operation) || (d.pending_job && new Date(d.pending_job.due_at).getTime() <= Date.now() + 10_000);
      return busy ? 2500 : 20_000;
    },
  });

  if (query.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-80" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (query.isError) {
    const err = query.error;
    const notFound = err instanceof ApiClientError && err.status === 404;
    return (
      <Card>
        <EmptyState
          icon={<CircleAlert aria-hidden />}
          title={notFound ? "Task not found" : "This task could not be loaded"}
          description={notFound ? "It may not exist, or it belongs to a workspace you cannot access." : err instanceof ApiClientError ? err.message : "Try again."}
          action={
            <>
              <Button asChild variant="secondary">
                <Link href="/app/tasks">Back to tasks</Link>
              </Button>
              {!notFound ? <Button onClick={() => query.refetch()}>Retry</Button> : null}
            </>
          }
        />
      </Card>
    );
  }

  const d = query.data;
  return <TaskDetailView d={d} />;
}

function TaskDetailView({ d }: { d: TaskDetail }) {
  const tz = d.workspace.timezone;
  const { task, request, latest_decision: latest } = d;
  const customer = request.customer_label ?? request.customer_id;
  const unverifiedAfterTrusted = task.verdict === "UNVERIFIABLE" && d.latest_trustworthy_decision && d.latest_trustworthy_decision.id !== latest?.id;

  return (
    <div>
      <Link href="/app/tasks" className="inline-flex items-center gap-2 text-sm text-primary-ink hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Back to tasks
      </Link>

      {/* Header */}
      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-semibold tracking-[-0.02em] sm:text-[34px]">{customer}</h1>
            <VerdictBadge verdict={task.verdict} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[15px] text-muted">Subscription</span>
            <Mono className="text-[15px]">{request.subscription_id}</Mono>
            <CopyButton value={request.subscription_id} label="subscription ID" />
            <CheckNowButton taskId={task.id} disabled={!d.allowed_actions.check_now} queued={Boolean(d.pending_job)} working={isWorking(task.processing_state)} />
          </div>
          <p className="mt-3 max-w-3xl text-[16px] text-ink">{reasonSummary(task.primary_reason_code)}</p>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {PROCESSING_LABELS[task.processing_state]}
            {task.last_checked_at ? ` · checked ${formatRelative(task.last_checked_at)}` : " · not read yet"}
            {task.next_check_at ? ` · next check ${formatDateTime(task.next_check_at, tz)}` : ""}
          </p>
        </div>
        <dl className="shrink-0 space-y-1 text-sm lg:text-right">
          <div className="flex items-center gap-2 lg:justify-end">
            <dt className="text-muted">Task</dt>
            <dd className="flex items-center gap-1">
              <Mono>{task.id}</Mono>
              <CopyButton value={task.id} label="task ID" />
            </dd>
          </div>
          <div className="flex gap-2 lg:justify-end">
            <dt className="text-muted">Accepted</dt>
            <dd>{formatDateTime(task.created_at, tz)}</dd>
          </div>
        </dl>
      </div>

      {task.retired_at ? (
        <Alert tone="neutral" className="mt-5" title="Monitoring stopped">
          {task.retirement_reason}. The verdict below is the last recorded result and remains in its reporting cohort.
        </Alert>
      ) : null}
      {unverifiedAfterTrusted ? (
        <Alert tone="warning" className="mt-5" title="The latest check could not verify the source">
          The last trustworthy read ({formatDateTime(d.latest_trustworthy_decision!.observed_at, tz)}) is kept in history below. A past successful check is not a guarantee of the current state.
        </Alert>
      ) : null}
      {request.status !== "ACTIVE" ? (
        <Alert tone="warning" className="mt-5" title={`Request ${request.status.toLowerCase()}`}>
          This request version is no longer active. No new recovery will be issued against it.
        </Alert>
      ) : null}

      {/* 1–3: request, claim, observation as separate facts */}
      <section aria-label="Request, report and observation" className="mt-6 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
        <FactCard
          icon={<CircleCheck className="size-7 text-success" aria-hidden />}
          title="Authorized request"
          headline={formatDate(request.expected_period_end, tz)}
          body={
            <>
              Customer requested cancellation at period end. Confirmed by {request.authorized_by_label}
              {request.authorization_kind === "DEMO_FIXTURE" ? " (demo fixture)" : ""} · ref {request.source_reference} · v{request.version}
            </>
          }
        />
        <ArrowRight className="mx-auto hidden size-5 self-center text-subtle md:block" aria-hidden />
        <FactCard
          icon={<MessageSquare className="size-7 text-muted" aria-hidden />}
          title="Agent report"
          headline={d.receipts.length ? "Reported complete" : "No report"}
          body={d.receipts.length ? <>{d.receipts[d.receipts.length - 1].agent_name} · a claim, not evidence{d.receipts.length > 1 ? ` · ${d.receipts.length} receipts` : ""}</> : "No claim receipt yet."}
        />
        <ArrowRight className="mx-auto hidden size-5 self-center text-subtle md:block" aria-hidden />
        <ObservedCard d={d} />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,8fr)_minmax(340px,4fr)]">
        <div className="min-w-0 space-y-5">
          {/* 4–5: field comparison and reason */}
          <EvidenceCard decision={latest} taskId={task.id} tz={tz} sourceLabel={d.connection.display_name} />
          <ReportCard d={d} />
          {d.operations.length ? <OperationsCard operations={d.operations} tz={tz} /> : null}
        </div>
        {/* 6: allowed next action */}
        <NextStepRail d={d} />
      </div>

      {/* 7: chronology */}
      <Chronology d={d} />
    </div>
  );
}

function FactCard({ icon, title, headline, body, tone }: { icon: React.ReactNode; title: string; headline: string; body: React.ReactNode; tone?: Tone }) {
  return (
    <Card className={cn("flex gap-4 p-5", tone === "danger" && "border-danger/20", tone === "warning" && "border-warning/30")}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-1 text-[17px] font-medium text-ink">{headline}</p>
        <p className="mt-1 text-sm text-muted">{body}</p>
      </div>
    </Card>
  );
}

function ObservedCard({ d }: { d: TaskDetail }) {
  const latest = d.latest_decision;
  if (!latest) {
    return <FactCard icon={<Clock className="size-7 text-subtle" aria-hidden />} title="Observed source" headline="Not read yet" body="Waiting for the worker to read the billing source." />;
  }
  if (latest.result_type === "ERROR" || !latest.snapshot) {
    return <FactCard tone="warning" icon={<CircleHelp className="size-7 text-warning" aria-hidden />} title="Observed source" headline="Could not read" body={`${REASON_COPY[latest.reason_codes[0]]?.title ?? "Source unavailable"}.`} />;
  }
  const s = latest.snapshot as { status?: string; cancel_at_period_end?: boolean; ended_at?: string | null };
  if (s.status === "canceled") {
    return <FactCard tone={latest.verdict === "SATISFIED_ENDED" ? undefined : "danger"} icon={latest.verdict === "SATISFIED_ENDED" ? <CircleCheck className="size-7 text-success" aria-hidden /> : <CircleAlert className="size-7 text-danger" aria-hidden />} title="Observed source" headline="Subscription ended" body={`Service ended ${s.ended_at ? formatDate(s.ended_at, d.workspace.timezone) : "at an unknown time"}.`} />;
  }
  const ok = latest.verdict === "SATISFIED_SCHEDULED";
  return (
    <FactCard
      tone={ok ? undefined : "danger"}
      icon={ok ? <CircleCheck className="size-7 text-success" aria-hidden /> : <CircleAlert className="size-7 text-danger" aria-hidden />}
      title="Observed source"
      headline={`Cancellation: ${s.cancel_at_period_end ? "Yes" : "No"}`}
      body={s.cancel_at_period_end ? "Billing record shows a period-end cancellation." : "Billing record does not show a scheduled cancellation."}
    />
  );
}

function CheckNowButton({ taskId, disabled, queued, working }: { taskId: string; disabled: boolean; queued: boolean; working: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const run = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await apiFetch<{ message: string }>(`/api/tasks/${taskId}/recheck`, { method: "POST", body: {} });
      toast.push({ tone: "info", title: "Check requested", description: res.message });
      await queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    } catch (err) {
      toast.push({ tone: "error", title: "Check not queued", description: err instanceof ApiClientError ? err.message : "Try again." });
    } finally {
      setPending(false);
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={disabled || working} loading={pending}>
      {pending ? null : <RefreshCw className={cn(working && "animate-pw-spin")} aria-hidden />}
      {working ? "Checking…" : queued ? "Check now (queued)" : "Check now"}
    </Button>
  );
}

function ReportCard({ d }: { d: TaskDetail }) {
  if (!d.receipts.length) return null;
  const tz = d.workspace.timezone;
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title="Agent report" description="Preserved verbatim as untrusted content. It never changes the verdict by itself." as="h2" />
      <ul className="mt-4 space-y-3">
        {d.receipts
          .slice()
          .reverse()
          .map((r) => (
            <li key={r.id} className="rounded-control border border-line bg-surface-muted p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{r.agent_name}</span>
                <span className="text-muted">
                  {formatDateTime(r.received_at, tz)} · {r.source_kind === "API" ? "Ingestion API" : r.source_kind === "DEMO" ? "Demo fixture" : "Submitted in app"}
                </span>
              </div>
              {/* Rendered as text: React escapes content; no links or HTML are interpreted. */}
              <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-line-strong pl-3 text-[15px] text-ink">{r.report_text}</blockquote>
              <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
                Receipt <Mono className="text-xs">{r.id}</Mono> <CopyButton value={r.id} label="receipt ID" /> · idempotency key <Mono className="text-xs">{r.idempotency_key}</Mono>
              </p>
            </li>
          ))}
      </ul>
    </Card>
  );
}

function NextStepRail({ d }: { d: TaskDetail }) {
  const tz = d.workspace.timezone;
  const p = d.live_proposal;
  const op = d.unresolved_operation ?? d.operations[0] ?? null;
  const change = p?.diff.changes[0];
  const verdict = d.task.verdict;

  return (
    <aside aria-labelledby="next-step-heading" className="space-y-4 xl:sticky xl:top-24 xl:self-start">
      <Card className="p-5">
        <h2 id="next-step-heading" className="text-[20px] font-semibold tracking-tight">
          Next step
        </h2>

        {p && p.status === "AWAITING_APPROVAL" ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-control bg-primary-soft p-4">
              <p className="flex items-center gap-2 font-semibold text-primary-ink">
                <Target className="size-5" aria-hidden /> Bounded recovery
              </p>
              <p className="mt-1 text-sm text-muted">Schedule the cancellation to take effect at the end of the current billing period.</p>
            </div>
            <RailItem icon={<CalendarClock aria-hidden />} title="Schedule period-end cancellation" body={`${change?.label ?? "Cancellation scheduled"}: No → Yes. Effective ${formatDate(d.request.expected_period_end, tz)}.`} />
            <RailItem icon={<UserCheck aria-hidden />} title="Human approval required" body={`A person must review and approve the exact change. Expires ${formatDateTime(p.expires_at, tz)}.`} />
            {d.workspace.writes_paused ? <Alert tone="warning">Recovery writes are paused. An approval will wait until writes resume.</Alert> : null}
            <Button asChild size="lg" className="w-full">
              <Link href={`/app/approvals?proposal=${p.id}`}>Review recovery proposal</Link>
            </Button>
          </div>
        ) : op && !op.resolved_at ? (
          <div className="mt-4 space-y-3">
            <Badge tone={OPERATION_STATE_LABELS[op.state].tone}>{OPERATION_STATE_LABELS[op.state].label}</Badge>
            <p className="text-sm text-muted">
              {op.state === "OUTCOME_UNKNOWN"
                ? "The fix may have been applied. Proofwork is checking the billing record before trying again, with the same operation key."
                : "Proofwork is applying the approved change and will read the source again. Success is shown only after that independent read."}
            </p>
            <OperationSteps op={op} />
          </div>
        ) : p && p.status === "AUTHORIZED" ? (
          <div className="mt-4 space-y-3">
            <Badge tone="info">Approved — queued</Badge>
            <p className="text-sm text-muted">
              {d.workspace.writes_paused ? "Recovery writes are paused. The approved change will be dispatched after writes resume, if it is still valid." : "Proofwork will re-check the source before writing and read it again afterwards."}
            </p>
          </div>
        ) : verdict === "SATISFIED_SCHEDULED" ? (
          <div className="mt-4 space-y-3">
            <p className="flex items-center gap-2 font-medium text-success-ink">
              <ShieldCheck className="size-5" aria-hidden /> No action needed
            </p>
            <p className="text-sm text-muted">The subscription remains active until {formatDate(d.request.expected_period_end, tz)}. Proofwork checks again {d.task.next_check_at ? `around ${formatDateTime(d.task.next_check_at, tz)}` : "at the boundary"} to confirm it ends.</p>
            {op?.state === "VERIFIED" ? <Badge tone="success">Recovered by Proofwork · verified</Badge> : op?.state === "RESOLVED_EXTERNALLY" ? <Badge tone="neutral">Corrected — attribution unclear</Badge> : null}
          </div>
        ) : verdict === "SATISFIED_ENDED" ? (
          <div className="mt-4 space-y-2">
            <p className="flex items-center gap-2 font-medium text-info-ink">
              <CircleCheck className="size-5" aria-hidden /> Cancellation completed
            </p>
            <p className="text-sm text-muted">Monitoring ended. Export the evidence from Activity if you need a record.</p>
          </div>
        ) : verdict === "PENDING" ? (
          <p className="mt-4 text-sm text-muted">Waiting for the first independent read. Nothing is marked verified until the source is evaluated.</p>
        ) : verdict === "UNVERIFIABLE" ? (
          <div className="mt-4 space-y-2">
            <p className="font-medium text-warning-ink">Could not verify</p>
            <p className="text-sm text-muted">No recovery is attempted from missing evidence. {d.task.next_check_at ? `Next retry ${formatDateTime(d.task.next_check_at, tz)}.` : "Automatic retries are exhausted — use Check now after the source recovers."}</p>
          </div>
        ) : verdict === "OUT_OF_SCOPE" ? (
          <div className="mt-4 space-y-2">
            <p className="font-medium">Manual handling</p>
            <p className="text-sm text-muted">This subscription is outside the supported structure. Automatic recovery is not available.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <p className="font-medium text-danger-ink">Needs manual review</p>
            <p className="text-sm text-muted">{d.allowed_actions.blocked_reason ?? "No supported automatic correction applies to this result."}</p>
            {d.task.recovery_state === "EXPIRED" ? <p className="text-sm text-muted">The last proposal expired. Use Check now to prepare a current proposal.</p> : null}
            {d.task.recovery_state === "REJECTED" ? <p className="text-sm text-muted">The proposal was rejected. The verification result is unchanged.</p> : null}
          </div>
        )}

        {d.allowed_actions.blocked_reason && !(verdict === "MISMATCH" && !p && !op) ? (
          <p className="mt-4 rounded-control bg-neutral-soft px-3 py-2 text-[13px] text-neutral-ink">
            <strong className="font-medium">Blocked:</strong> {d.allowed_actions.blocked_reason}
          </p>
        ) : null}
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold">Context</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Source">
            <span className="inline-flex items-center gap-1.5">
              <Database className="size-3.5 text-muted" aria-hidden /> {d.connection.display_name}
            </span>
          </Row>
          <Row label="Account">
            <Mono>{d.request.source_account_id}</Mono>
          </Row>
          <Row label="Customer">
            <Mono>{d.request.customer_id}</Mono>
          </Row>
          <Row label="Policy">{d.policy ? `${POLICY_LABELS[d.policy.mode].short} · v${d.policy.version}` : "—"}</Row>
          <Row label="Interventions">{d.task.human_intervention_count}</Row>
          <Row label="Contract">
            <Mono className="text-xs">{d.request.contract_id}</Mono>
          </Row>
        </dl>
        <div className="mt-4 flex flex-wrap gap-1 border-t border-line pt-3">
          {d.allowed_actions.retire ? <RetireTaskButton taskId={d.task.id} /> : null}
          <InterventionButton taskId={d.task.id} />
          <ReviewButton taskId={d.task.id} decisions={d.decisions} />
        </div>
      </Card>

      {d.scenario_controls ? <ScenarioControls taskId={d.task.id} hasLiveProposal={Boolean(p)} /> : null}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function RailItem({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-ink [&_svg]:size-4">{icon}</span>
      <div>
        <p className="text-[15px] font-medium">{title}</p>
        <p className="text-sm text-muted">{body}</p>
      </div>
    </div>
  );
}

const OP_CHAIN = ["PREPARED", "DISPATCHED", "AWAITING_VERIFICATION", "VERIFIED"] as const;

function OperationSteps({ op }: { op: OperationSummary }) {
  const idx = op.state === "OUTCOME_UNKNOWN" ? 1 : OP_CHAIN.indexOf(op.state as (typeof OP_CHAIN)[number]);
  return (
    <ol className="space-y-2">
      {OP_CHAIN.map((s, i) => (
        <li key={s} className="flex items-center gap-2 text-sm">
          <span className={cn("size-2.5 rounded-full", i < idx ? "bg-success" : i === idx ? "bg-primary animate-pw-pulse" : "bg-line-strong")} aria-hidden />
          <span className={cn(i === idx ? "font-medium text-ink" : "text-muted")}>{OPERATION_STATE_LABELS[s].label}</span>
          {i === idx ? <span className="sr-only">(current)</span> : null}
        </li>
      ))}
      <li className="pt-1 text-xs text-muted">
        Attempt {op.dispatch_count} of {op.max_dispatches} · key <Mono className="text-xs">{op.idempotency_key.slice(0, 18)}…</Mono>
      </li>
    </ol>
  );
}

function OperationsCard({ operations, tz }: { operations: OperationSummary[]; tz: string }) {
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title="Recovery operations" description="Durable write intents with stable keys. Outcomes come from independent reads, not write responses." />
      <ul className="mt-4 space-y-3">
        {operations.map((op) => (
          <li key={op.id} className="rounded-control border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone={OPERATION_STATE_LABELS[op.state].tone}>{OPERATION_STATE_LABELS[op.state].label}</Badge>
              <span className="text-sm text-muted">Prepared {formatDateTime(op.created_at, tz)}</span>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              <Row label="Dispatches">{`${op.dispatch_count} of ${op.max_dispatches}`}</Row>
              <Row label="Attribution">{op.attribution === "PROOFWORK" ? "Proofwork (source-confirmed)" : op.attribution === "UNATTRIBUTED" ? "Unclear" : "—"}</Row>
              <Row label="Certainty">{op.outcome_certainty === "UNCERTAIN" ? "Uncertain response" : "Response received"}</Row>
              <Row label="Resolved">{op.resolved_at ? formatDateTime(op.resolved_at, tz) : "Not yet"}</Row>
              <Row label="Operation key">
                <span className="inline-flex items-center gap-1">
                  <Mono className="text-xs">{op.idempotency_key.slice(0, 20)}…</Mono>
                  <CopyButton value={op.idempotency_key} label="operation key" />
                </span>
              </Row>
              <Row label="Provider request">{op.last_provider_request_id ? <Mono className="text-xs">{op.last_provider_request_id}</Mono> : "—"}</Row>
            </dl>
            {op.events.length ? (
              <ol className="mt-3 space-y-1 border-t border-line pt-3 text-[13px]">
                {op.events.map((e, i) => (
                  <li key={`${e.event_type}-${i}`} className="flex flex-wrap gap-x-3 text-muted">
                    <span className="tabular">{formatDateTime(e.occurred_at, tz)}</span>
                    <span className="text-ink">{e.event_type.replaceAll("_", " ").toLowerCase()}</span>
                    {e.to_state ? <span>→ {e.to_state.replaceAll("_", " ").toLowerCase()}</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Chronology({ d }: { d: TaskDetail }) {
  const [filter, setFilter] = React.useState("all");
  const tz = d.workspace.timezone;
  const events = d.events.filter((e) => {
    if (filter === "all") return true;
    if (filter === "verification") return e.event_type.startsWith("verification.") || e.event_type.startsWith("job.");
    if (filter === "recovery") return e.event_type.startsWith("recovery.");
    if (filter === "claims") return e.event_type.startsWith("claim.") || e.event_type.startsWith("request.");
    return !e.event_type.startsWith("verification.") && !e.event_type.startsWith("recovery.") && !e.event_type.startsWith("claim.");
  });
  return (
    <Card className="mt-5 p-5 sm:p-6">
      <CardHeader
        title="Task chronology"
        description="Key events for this task, most recent first."
        action={
          <div className="w-44">
            <label htmlFor="chronology-filter" className="sr-only">
              Filter events
            </label>
            <Select id="chronology-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All events</option>
              <option value="verification">Verification</option>
              <option value="recovery">Recovery</option>
              <option value="claims">Requests & claims</option>
              <option value="other">People & controls</option>
            </Select>
          </div>
        }
      />
      {events.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No events in this filter.</p>
      ) : (
        <ol className="mt-5">
          {events.map((e, i) => {
            const meta = auditLabel(e.event_type);
            return (
              <li key={e.id} className="relative grid gap-1 pb-4 pl-7 sm:grid-cols-[210px_190px_1fr] sm:gap-4">
                <span
                  className={cn(
                    "absolute left-0 top-1.5 size-2.5 rounded-full",
                    meta.tone === "success" ? "bg-success" : meta.tone === "danger" ? "bg-danger" : meta.tone === "warning" ? "bg-warning" : "bg-subtle",
                  )}
                  aria-hidden
                />
                {i < events.length - 1 ? <span className="absolute left-[4.5px] top-5 bottom-0 w-px bg-line" aria-hidden /> : null}
                <span className="text-[15px] font-medium">{meta.label}</span>
                <span className="text-sm tabular text-muted">{formatDateTime(e.occurred_at, tz)}</span>
                <span className="text-sm text-muted">
                  {e.summary} <span className="whitespace-nowrap text-xs text-subtle">— {e.actor_label}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-2 flex items-center justify-between border-t border-line pt-3 text-sm">
        <span className="text-muted">
          <FileText className="mr-1 inline size-4" aria-hidden />
          {d.decisions.length} recorded decision{d.decisions.length === 1 ? "" : "s"} · {d.receipts.length} receipt{d.receipts.length === 1 ? "" : "s"}
        </span>
        <Link href={`/app/activity?task=${d.task.id}&range=all`} className="font-medium text-primary-ink hover:underline">
          Full activity for this task
        </Link>
      </div>
      {d.proposals.length ? (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Proposal history</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {d.proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={PROPOSAL_STATUS_LABELS[p.status].tone}>{PROPOSAL_STATUS_LABELS[p.status].label}</Badge>
                <span className="text-muted">{formatDateTime(p.created_at, tz)}</span>
                {p.decided_by ? <span className="text-muted">· {p.decision === "AUTO_POLICY" ? "authorized by policy" : `${p.decision === "APPROVE" ? "approved" : "rejected"} by ${p.decided_by}`}</span> : null}
                {p.status_reason ? <span className="text-xs text-subtle">({p.status_reason.replaceAll("_", " ").toLowerCase()})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
