"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Calendar, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleHelp, ClipboardList, FileText, Search, User } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { REASON_COPY, formatDate, formatDateTime, formatRelative, type ProcessingState, type ReasonCode, type RecoveryState, type Verdict } from "@proofwork/domain";
import { PageHeader } from "@/components/page";
import { VerdictBadge, VerdictInline } from "@/components/status";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { Alert, Badge, Card, EmptyState, Mono, Skeleton } from "@/components/ui/primitives";
import { FilterTabs } from "@/components/ui/tabs";
import { useDebounced, useTimezone, useUrlState } from "@/features/shared/hooks";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { isWorking, nextStep } from "./next-step";
import { ScenarioLibrary } from "./scenario-library";

interface TaskRow {
  id: string;
  verdict: Verdict;
  primary_reason_code: ReasonCode | null;
  processing_state: ProcessingState;
  recovery_state: RecoveryState;
  agent_name: string;
  last_checked_at: string | null;
  last_trustworthy_read_at: string | null;
  created_at: string;
  retired_at: string | null;
  request_id: string;
  customer_label: string | null;
  customer_id: string;
  subscription_id: string;
  expected_period_end: string;
  awaiting_proposal_id: string | null;
  evidence_stale: boolean;
}

interface TasksResponse {
  filters: { status: string; range: string; q: string; page: number };
  cohort_definition: string;
  counts: { total: number; pending: number; scheduled: number; ended: number; mismatch: number; unverifiable: number; out_of_scope: number };
  page: { number: number; size: number; total: number; pages: number };
  priority: (TaskRow & { has_claim: boolean }) | null;
  items: TaskRow[];
}

const DEFAULTS = { status: "all", q: "", range: "30d", page: "1" };

const RANGE_LABELS: Record<string, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };

export function TasksPage() {
  const tz = useTimezone();
  const [state, setState] = useUrlState(DEFAULTS);
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search, 300);

  React.useEffect(() => {
    if (debounced !== state.q) setState({ q: debounced, page: "1" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query = useQuery({
    queryKey: ["tasks", state.status, state.q, state.range, state.page],
    queryFn: () => apiFetch<TasksResponse>(`/api/tasks?${new URLSearchParams({ status: state.status, q: state.q, range: state.range, page: state.page })}`),
    placeholderData: keepPreviousData,
    // Poll persisted state while work is in flight; slow down when idle.
    refetchInterval: (q) => (q.state.data?.items.some((t) => isWorking(t.processing_state) || t.verdict === "PENDING") ? 3000 : 30_000),
  });
  const data = query.data;
  const c = data?.counts;

  const tabs = [
    { key: "all", label: "All tasks", count: c?.total },
    { key: "needs_action", label: "Needs action", count: c?.mismatch },
    { key: "scheduled", label: "Scheduled", count: c?.scheduled },
    { key: "could_not_verify", label: "Could not verify", count: c?.unverifiable },
    { key: "completed", label: "Completed", count: c?.ended },
    { key: "outside_scope", label: "Outside scope", count: c?.out_of_scope },
    { key: "waiting", label: "Waiting", count: c?.pending },
  ];

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Every request, every claim, independently checked."
        actions={
          <>
            <Button asChild variant="secondary" size="lg">
              <Link href="/app/requests/new">Register request</Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/app/claims/new">Submit report</Link>
            </Button>
          </>
        }
      />

      {query.isError ? (
        <Alert tone="danger" title="Tasks could not be loaded" className="mb-6" action={<Button size="sm" variant="secondary" onClick={() => query.refetch()}>Retry</Button>}>
          {query.error instanceof ApiClientError ? query.error.message : "Try again."}
        </Alert>
      ) : null}

      {/* Metrics band — same cohort and search as the table */}
      <section aria-label="Task summary" className="grid grid-cols-2 overflow-hidden rounded-surface border border-line border-t-[3px] border-t-evidence bg-surface shadow-card xl:grid-cols-4">
        <Metric icon={<CircleCheck className="size-6 text-success" aria-hidden />} tint="bg-success-soft" value={c?.total} label="Accepted tasks" />
        <Metric icon={<CircleAlert className="size-6 text-danger" aria-hidden />} tint="bg-danger-soft" value={c?.mismatch} label="Needs action" />
        <Metric icon={<CircleHelp className="size-6 text-warning" aria-hidden />} tint="bg-warning-soft" value={c?.unverifiable} label="Could not verify" />
        <Metric
          icon={<FileText className="size-6 text-primary" aria-hidden />}
          tint="bg-primary-soft"
          value={c ? (c.total ? `${c.scheduled + c.ended} of ${c.total}` : "No data") : undefined}
          label="Verified intended state"
        />
      </section>
      <p className="mt-2 text-xs text-muted">
        Cohort: {RANGE_LABELS[state.range] ?? state.range} by report acceptance time{state.q ? `, matching “${state.q}”` : ""}. Results reflect the latest recorded source read.
      </p>

      {data?.priority && state.status === "all" && !state.q ? <PriorityTask task={data.priority} tz={tz} /> : null}

      <section aria-labelledby="task-list-heading" className="mt-8">
        <h2 id="task-list-heading" className="sr-only">
          Task list
        </h2>
        <FilterTabs label="Filter tasks by result" items={tabs} value={state.status} onChange={(k) => setState({ status: k, page: "1" })} controls="task-table" />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <label htmlFor="task-search" className="sr-only">
              Search tasks
            </label>
            <Input id="task-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers, subscriptions, request IDs, or agents…" className="pl-9" />
          </div>
          <div className="relative sm:w-52">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <label htmlFor="task-range" className="sr-only">
              Cohort by acceptance date
            </label>
            <Select id="task-range" value={state.range} onChange={(e) => setState({ range: e.target.value, page: "1" })} className="pl-9">
              {Object.entries(RANGE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Card className="mt-4 overflow-hidden" id="task-table">
          {query.isPending ? (
            <div className="divide-y divide-line">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="h-9 flex-[2]" />
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="hidden h-9 flex-1 md:block" />
                </div>
              ))}
            </div>
          ) : data && data.items.length === 0 ? (
            data.counts.total === 0 && !state.q ? (
              <EmptyState
                icon={<ClipboardList aria-hidden />}
                title="No reports yet"
                description="Register a customer request, then submit the agent's report. Proofwork reads the billing source and records the result here."
                action={
                  <>
                    <Button asChild variant="secondary">
                      <Link href="/app/requests/new">Register request</Link>
                    </Button>
                    <Button asChild>
                      <Link href="/app/claims/new">Submit report</Link>
                    </Button>
                  </>
                }
              />
            ) : (
              <EmptyState icon={<Search aria-hidden />} title="No tasks match these filters" description="Try another result filter, a wider date range, or a different search." action={<Button variant="secondary" onClick={() => { setSearch(""); setState({ status: "all", q: "", range: "30d", page: "1" }); }}>Clear filters</Button>} />
            )
          ) : data ? (
            <TaskTable items={data.items} tz={tz} />
          ) : null}
        </Card>

        {data && data.page.pages > 1 ? (
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>
              Page {data.page.number} of {data.page.pages} · {data.page.total} tasks
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={data.page.number <= 1} onClick={() => setState({ page: String(data.page.number - 1) })}>
                <ChevronLeft aria-hidden /> Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={data.page.number >= data.page.pages} onClick={() => setState({ page: String(data.page.number + 1) })}>
                Next <ChevronRight aria-hidden />
              </Button>
            </div>
          </nav>
        ) : null}
      </section>

      <ScenarioLibrary />
    </div>
  );
}

function Metric({ icon, tint, value, label }: { icon: React.ReactNode; tint: string; value: number | string | undefined; label: string }) {
  return (
    <div className="flex items-center gap-4 border-b border-r border-line px-4 py-4 last:border-r-0 xl:border-b-0 xl:px-5">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-control border border-current/10", tint)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold tabular tracking-tight">{value ?? <Skeleton className="h-7 w-10" />}</span>
        <span className="block truncate font-mono text-[10px] uppercase tracking-[0.045em] text-muted">{label}</span>
      </span>
    </div>
  );
}

function PriorityTask({ task, tz }: { task: TaskRow & { has_claim: boolean }; tz: string }) {
  const reason = task.primary_reason_code ? REASON_COPY[task.primary_reason_code] : null;
  const step = nextStep(task);
  return (
    <Card className="mt-6 p-5 sm:p-6" aria-labelledby="priority-heading">
      <div className="flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="priority-heading" className="text-[15px] font-medium text-ink">
              Priority task
            </h2>
            <VerdictBadge verdict={task.verdict} size="sm" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-2xl font-semibold tracking-tight">{task.customer_label ?? task.customer_id}</p>
            <Mono className="text-muted">{task.subscription_id}</Mono>
            <CopyButton value={task.subscription_id} label="subscription ID" />
          </div>
        </div>
        <Button asChild variant="outline" size="lg">
          <Link href={`/app/tasks/${task.id}`}>Open evidence</Link>
        </Button>
      </div>
      <dl className="grid gap-4 pt-4 md:grid-cols-3 md:divide-x md:divide-line">
        <div className="md:pr-4">
          <dt className="text-sm font-medium text-ink">Authorized outcome</dt>
          <dd className="mt-2 flex items-start gap-2 text-[15px]">
            <Calendar className="mt-0.5 size-4 text-muted" aria-hidden />
            <span>
              Cancel at period end
              <span className="block text-muted">{formatDate(task.expected_period_end, tz)}</span>
            </span>
          </dd>
        </div>
        <div className="md:px-4">
          <dt className="text-sm font-medium text-ink">Agent claim</dt>
          <dd className="mt-2 flex items-start gap-2 text-[15px]">
            <User className="mt-0.5 size-4 text-muted" aria-hidden />
            <span>
              Reported complete
              <span className="block text-sm text-muted">{task.agent_name} · not evidence</span>
            </span>
          </dd>
        </div>
        <div className="md:pl-4">
          <dt className="text-sm font-medium text-ink">Independent decision</dt>
          <dd className="mt-2 flex items-start gap-2 text-[15px]">
            <CircleAlert className={cn("mt-0.5 size-4", task.verdict === "MISMATCH" ? "text-danger" : "text-warning")} aria-hidden />
            <span>
              <span className="font-medium">{reason?.title ?? "See evidence"}</span>
              <span className="block text-sm text-muted">
                {step.label} · checked {formatRelative(task.last_checked_at)}
              </span>
            </span>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function TaskTable({ items, tz }: { items: TaskRow[]; tz: string }) {
  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left">
          <caption className="sr-only">Tasks with customer, agent, verification result, next step and last check</caption>
          <thead className="border-b border-line bg-surface-muted text-[13px] text-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-medium">Customer</th>
              <th scope="col" className="px-4 py-3 font-medium">Agent</th>
              <th scope="col" className="px-4 py-3 font-medium">Result</th>
              <th scope="col" className="px-4 py-3 font-medium">Next step</th>
              <th scope="col" className="px-5 py-3 font-medium">Last checked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((t) => {
              const step = nextStep(t);
              return (
                <tr key={t.id} className="group relative transition-ui hover:bg-surface-muted">
                  <td className="px-5 py-3.5">
                    <Link href={`/app/tasks/${t.id}`} className="font-medium text-ink after:absolute after:inset-0 group-hover:text-primary-ink focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-primary">
                      {t.customer_label ?? t.customer_id}
                    </Link>
                    <Mono className="block text-muted">{t.subscription_id}</Mono>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-ink">{t.agent_name}</td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-2">
                      <VerdictInline verdict={t.verdict} />
                      {isWorking(t.processing_state) ? <span className="text-xs text-muted animate-pw-pulse">· working</span> : null}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">{step.tone === "none" ? <span className="text-sm text-muted">{step.label}</span> : <Badge tone={step.tone}>{step.label}</Badge>}</td>
                  <td className="px-5 py-3.5 text-sm tabular text-ink">
                    {t.last_checked_at ? formatDateTime(t.last_checked_at, tz) : <span className="text-muted">Not yet read</span>}
                    {t.last_checked_at && !t.last_trustworthy_read_at ? <span className="block text-xs text-warning-ink">No successful read yet</span> : t.evidence_stale ? <span className="block text-xs text-warning-ink">Evidence older than 24h</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile summaries */}
      <ul className="divide-y divide-line md:hidden">
        {items.map((t) => {
          const step = nextStep(t);
          return (
            <li key={t.id}>
              <Link href={`/app/tasks/${t.id}`} className="block px-4 py-4 hover:bg-surface-muted">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.customer_label ?? t.customer_id}</p>
                    <Mono className="text-muted">{t.subscription_id}</Mono>
                  </div>
                  <VerdictInline verdict={t.verdict} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                  {step.tone === "none" ? <span>{step.label}</span> : <Badge tone={step.tone}>{step.label}</Badge>}
                  <span>· {t.agent_name}</span>
                  <span>· {t.last_checked_at ? formatRelative(t.last_checked_at) : "not yet read"}</span>
                  {t.last_checked_at && !t.last_trustworthy_read_at ? <span className="text-warning-ink">· no successful read</span> : t.evidence_stale ? <span className="text-warning-ink">· stale</span> : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
