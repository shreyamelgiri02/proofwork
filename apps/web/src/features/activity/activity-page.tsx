"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Clock, Database, Download, History, Search, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { formatDate, formatTime, type Tone } from "@proofwork/domain";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Alert, Card, EmptyState, Mono, Skeleton } from "@/components/ui/primitives";
import { useDebounced, useShell, useUrlState } from "@/features/shared/hooks";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface ActivityItem {
  id: string;
  event_type: string;
  label: string;
  tone: Tone;
  summary: string;
  actor_type: string;
  actor_label: string;
  task_id: string | null;
  proposal_id: string | null;
  reason_code: string | null;
  correlation_id: string;
  occurred_at: string;
  customer_label: string | null;
  subscription_id: string | null;
}

interface ActivityResponse {
  page: { number: number; size: number; total: number; pages: number };
  items: ActivityItem[];
  groups: { key: string; label: string }[];
  workspace: { timezone: string; kind: "PRIVATE" | "DEMO" };
}

const DEFAULTS = { q: "", type: "all", range: "7d", actor: "all", page: "1", task: "" };

const ACTOR_TYPE: Record<string, string> = { USER: "Owner", DEMO_OPERATOR: "Demo operator", AGENT: "Agent", WORKER: "Worker", SYSTEM: "System" };

export function ActivityPage() {
  const [state, setState, qs] = useUrlState(DEFAULTS);
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search, 300);
  const { data: shell } = useShell();
  React.useEffect(() => {
    if (debounced !== state.q) setState({ q: debounced, page: "1" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const params = new URLSearchParams({ q: state.q, type: state.type, range: state.range, actor: state.actor, page: state.page, task: state.task });
  const query = useQuery({
    queryKey: ["activity", qs],
    queryFn: () => apiFetch<ActivityResponse>(`/api/activity?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const data = query.data;
  const tz = data?.workspace.timezone ?? "UTC";
  const exportParams = new URLSearchParams({ q: state.q, type: state.type, range: state.range, actor: state.actor, task: state.task });

  // Group rows by calendar day in the workspace timezone.
  const groups = React.useMemo(() => {
    const out: { day: string; rows: ActivityItem[] }[] = [];
    for (const item of data?.items ?? []) {
      const day = formatDate(item.occurred_at, tz);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(item);
      else out.push({ day, rows: [item] });
    }
    return out;
  }, [data, tz]);
  const today = formatDate(new Date(), tz);

  return (
    <div>
      <PageHeader
        title="Activity"
        description="A complete history of reads, findings, decisions, and writes."
        actions={
          <Button asChild variant="outline" size="lg">
            <a href={`/api/activity/export?${exportParams}`} download>
              <Download aria-hidden /> Export CSV
            </a>
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-[1fr_200px_180px_170px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <label htmlFor="activity-search" className="sr-only">
            Search activity
          </label>
          <Input id="activity-search" type="search" className="h-11 pl-9" placeholder="Search activity (customer, event, actor, or details…)" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <FilterSelect id="activity-type" label="Event type" value={state.type} onChange={(v) => setState({ type: v, page: "1" })} options={(data?.groups ?? [{ key: "all", label: "All events" }]).map((g) => [g.key, g.label])} />
        <FilterSelect
          id="activity-range"
          label="Date range"
          value={state.range}
          onChange={(v) => setState({ range: v, page: "1" })}
          options={[
            ["24h", "Last 24 hours"],
            ["7d", "Last 7 days"],
            ["30d", "Last 30 days"],
            ["90d", "Last 90 days"],
            ["all", "All time"],
          ]}
        />
        <FilterSelect
          id="activity-actor"
          label="Actor"
          value={state.actor}
          onChange={(v) => setState({ actor: v, page: "1" })}
          options={[
            ["all", "All actors"],
            ["people", "People"],
            ["automation", "Proofwork & worker"],
            ["agents", "Agents (API)"],
          ]}
        />
      </div>

      {state.task ? (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="rounded-md bg-primary-soft px-2 py-1 text-primary-ink">
            Task <Mono className="text-xs">{state.task.slice(0, 8)}</Mono>
          </span>
          <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => setState({ task: "", page: "1" })}>
            <X className="size-3.5" aria-hidden /> Clear task filter
          </button>
        </div>
      ) : null}

      {query.isError ? (
        <Alert tone="danger" className="mt-5" title="Activity could not be loaded">
          {query.error instanceof ApiClientError ? query.error.message : "Try again."}
        </Alert>
      ) : null}

      <Card className="mt-5 overflow-hidden">
        {query.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={<History aria-hidden />} title="No activity in this scope" description="Change the filters or date range. Every read, decision and write is recorded here as it happens." />
        ) : (
          <div tabIndex={0} role="region" aria-label="Audit events" className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <caption className="sr-only">Audit events with time, event, actor and detail</caption>
              <thead className="border-b border-line text-sm text-ink">
                <tr>
                  <th scope="col" className="w-28 px-6 py-3.5 font-semibold">Time</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Event</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Actor</th>
                  <th scope="col" className="px-6 py-3.5 font-semibold">Detail</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.day} className="divide-y divide-line border-b border-line">
                  <tr className="bg-surface-muted">
                    <th scope="rowgroup" colSpan={4} className="px-6 py-3 text-left text-[15px] font-medium">
                      {g.day === today ? "Today" : g.day} <span className="font-normal text-muted">· {g.day}</span>
                    </th>
                  </tr>
                  {g.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-6 py-4 align-top">
                        <Mono className="text-[15px]" >{formatTime(row.occurred_at, tz)}</Mono>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className="flex items-center gap-3">
                          <EventIcon tone={row.tone} />
                          <span className="text-[15px] font-medium">{row.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className="block text-[15px]">{row.actor_label}</span>
                        <span className="block text-[13px] text-muted">{ACTOR_TYPE[row.actor_type] ?? row.actor_type}</span>
                      </td>
                      <td className="px-6 py-4 align-top text-[15px] text-ink">
                        {row.summary}
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                          {row.customer_label || row.subscription_id ? (
                            row.task_id ? (
                              <Link href={`/app/tasks/${row.task_id}`} className="text-primary-ink hover:underline">
                                {row.customer_label ?? row.subscription_id}
                              </Link>
                            ) : (
                              <span>{row.customer_label ?? row.subscription_id}</span>
                            )
                          ) : null}
                          {row.proposal_id ? (
                            <Link href={`/app/approvals?filter=all&proposal=${row.proposal_id}`} className="text-primary-ink hover:underline">
                              Proposal
                            </Link>
                          ) : null}
                          {row.reason_code ? <Mono className="text-[12px]">{row.reason_code}</Mono> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
        <div className="flex flex-col gap-3 border-t border-line px-6 py-4 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <Database className="size-4" aria-hidden />
            {shell?.connection?.display_name ?? "Evidence source"} — {data?.workspace.kind === "DEMO" ? "Demo activity (simulated billing)" : "Workspace activity"}
          </span>
          {data && data.page.pages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center gap-2">
              <span>
                Page {data.page.number} of {data.page.pages}
              </span>
              <Button variant="secondary" size="sm" disabled={data.page.number <= 1} onClick={() => setState({ page: String(data.page.number - 1) })}>
                <ChevronLeft aria-hidden /> Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={data.page.number >= data.page.pages} onClick={() => setState({ page: String(data.page.number + 1) })}>
                Next <ChevronRight aria-hidden />
              </Button>
            </nav>
          ) : data ? (
            <span>{data.page.total} events</span>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function FilterSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11">
        {options.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
    </div>
  );
}

function EventIcon({ tone }: { tone: Tone }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        tone === "success" && "bg-success-soft text-success",
        tone === "warning" && "bg-warning-soft text-warning-ink",
        tone === "danger" && "bg-danger-soft text-danger",
        (tone === "neutral" || tone === "info") && "bg-neutral-soft text-neutral-ink",
      )}
      aria-hidden
    >
      {tone === "success" ? <Check className="size-4" /> : tone === "danger" ? <X className="size-4" /> : <Clock className="size-4" />}
    </span>
  );
}
