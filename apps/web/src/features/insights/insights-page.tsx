"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleHelp, CircleMinus, Clock, FileText, Info, User } from "lucide-react";
import * as React from "react";
import { formatDate, formatDateTime, percent } from "@proofwork/domain";
import { PageHeader } from "@/components/page";
import { Select } from "@/components/ui/form";
import { Alert, Badge, Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useUrlState } from "@/features/shared/hooks";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Ratio {
  numerator: number;
  denominator: number;
}

interface InsightsResponse {
  calculated_at: string;
  workspace_kind: "PRIVATE" | "DEMO";
  cohort: { range: string; since: string | null; definition: string };
  outcomes: { total: number; pending: number; scheduled: number; ended: number; mismatch: number; unverifiable: number; out_of_scope: number; satisfied: number; autonomous_verified: number; with_intervention: number; intervention_events: number; evidence_available: number; retired: number; stale: number };
  main_metric: Ratio & { label: string; definition: string; exclusions: string };
  resolved_with_evidence: Ratio;
  eligible_rate: Ratio & { definition: string };
  evidence_availability: Ratio;
  recovery: { attempted_tasks: number; verified_by_proofwork: number; verified_human_approved: number; verified_auto_policy: number; resolved_externally: number; failed_confirmed: number; unresolved: number; blocked_before_dispatch: number };
  human_effort: { tasks_with_intervention: number; intervention_events: number };
  pending: { waiting: number; awaiting_approval: number; queued_jobs: number; dead_jobs: number; unresolved_operations: number; retired: number; stale_monitoring: number };
  correctness: Ratio & { measured: boolean; label: string; eligible_decisions: number; reviewed: number; insufficient_evidence: number; coverage: Ratio; review_period: { from: string | null; to: string | null }; reviewers: string[]; definition: string };
  workspace: { timezone: string; kind: "PRIVATE" | "DEMO"; organization: string };
  source: { adapter: string; display_name: string } | null;
}

const DEFAULTS = { range: "30d" };
const RANGES: [string, string][] = [
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["all", "All time"],
];

export function InsightsPage() {
  const [state, setState] = useUrlState(DEFAULTS);
  const query = useQuery({
    queryKey: ["insights", state.range],
    queryFn: () => apiFetch<InsightsResponse>(`/api/insights?range=${state.range}`),
    refetchInterval: 30_000,
  });
  const d = query.data;
  const tz = d?.workspace.timezone ?? "UTC";

  return (
    <div>
      <PageHeader
        title="Insights"
        description="Every rate includes its denominator."
        actions={
          <div className="w-48">
            <label htmlFor="insights-range" className="sr-only">
              Cohort by acceptance date
            </label>
            <Select id="insights-range" value={state.range} onChange={(e) => setState({ range: e.target.value })}>
              {RANGES.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {d ? (
        <p className="-mt-3 mb-5 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone={d.workspace_kind === "DEMO" ? "warning" : "neutral"}>{d.workspace_kind === "DEMO" ? "Demo cohort · simulated billing" : `${d.source?.display_name ?? "Workspace"} cohort`}</Badge>
          <span>
            {d.cohort.since ? `Accepted since ${formatDate(d.cohort.since, tz)}` : "All accepted tasks"} · calculated {formatDateTime(d.calculated_at, tz)}
          </span>
        </p>
      ) : null}

      {query.isError ? (
        <Alert tone="danger" title="Insights could not be loaded">
          {query.error instanceof ApiClientError ? query.error.message : "Try again."}
        </Alert>
      ) : null}

      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
          <Skeleton className="h-64 md:col-span-4" />
        </div>
      ) : d && d.outcomes.total === 0 ? (
        <Card>
          <EmptyState icon={<FileText aria-hidden />} title="No data for this cohort" description="Metrics appear after agent reports are accepted and verified. Nothing is estimated or pre-filled." />
        </Card>
      ) : d ? (
        <InsightsBody d={d} tz={tz} />
      ) : null}
    </div>
  );
}

function InsightsBody({ d, tz }: { d: InsightsResponse; tz: string }) {
  const o = d.outcomes;
  const segments = [
    { key: "scheduled", label: "Scheduled correctly", value: o.scheduled, color: "bg-success", dot: "bg-success" },
    { key: "ended", label: "Cancellation completed", value: o.ended, color: "bg-info", dot: "bg-info" },
    { key: "mismatch", label: "Needs action (mismatch)", value: o.mismatch, color: "bg-danger/80", dot: "bg-danger" },
    { key: "unverifiable", label: "Could not verify", value: o.unverifiable, color: "bg-warning", dot: "bg-warning" },
    { key: "out_of_scope", label: "Outside scope", value: o.out_of_scope, color: "bg-line-strong", dot: "bg-subtle" },
    { key: "pending", label: "Waiting for verification", value: o.pending, color: "bg-neutral-soft", dot: "bg-neutral-ink/40" },
  ];

  return (
    <div className="space-y-5">
      <section aria-label="Headline counts" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<FileText className="size-6 text-primary" aria-hidden />} tint="bg-primary-soft" label="Tasks" value={String(o.total)} />
        <StatCard icon={<CircleCheck className="size-6 text-success" aria-hidden />} tint="bg-success-soft" label="Scheduled correctly" value={`${o.scheduled} of ${o.total}`} sub={percent(o.scheduled, o.total)} />
        <StatCard icon={<Clock className="size-6 text-info" aria-hidden />} tint="bg-info-soft" label="Cancellation completed" value={`${o.ended} of ${o.total}`} sub={percent(o.ended, o.total)} />
        <StatCard icon={<CircleAlert className="size-6 text-danger" aria-hidden />} tint="bg-danger-soft" label="Needs action" value={`${o.mismatch} of ${o.total}`} sub={percent(o.mismatch, o.total)} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <h2 className="text-[17px] font-semibold">Outcome distribution</h2>
          <p className="text-sm text-muted">{o.total} tasks total</p>
          <div className="mt-5 flex h-10 w-full overflow-hidden rounded-control" role="img" aria-label={segments.filter((s) => s.value).map((s) => `${s.label}: ${s.value}`).join(", ")}>
            {segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <div key={s.key} className={cn("flex items-center justify-center border-r border-surface text-sm font-medium text-ink last:border-r-0", s.color)} style={{ width: `${(s.value / o.total) * 100}%` }}>
                  {s.value / o.total >= 0.06 ? s.value : ""}
                </div>
              ))}
          </div>
          <ul className="mt-5 space-y-2.5">
            {segments.map((s) => (
              <li key={s.key} className="flex items-center justify-between text-[15px]">
                <span className="flex items-center gap-3">
                  <span className={cn("size-3 rounded-full", s.dot)} aria-hidden />
                  {s.label}
                </span>
                <span className="tabular text-ink">
                  {s.value} ({percent(s.value, o.total)})
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col p-6">
          <h2 className="text-[17px] font-semibold">{d.main_metric.label}</h2>
          <p className="mt-4 text-[52px] font-bold leading-none tracking-tight tabular">{percent(d.main_metric.numerator, d.main_metric.denominator)}</p>
          <p className="mt-3 text-[15px] text-muted">
            {d.main_metric.numerator} of {d.main_metric.denominator} accepted tasks reached the authorized outcome with no recorded human intervention.
          </p>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-medium text-primary-ink">How this is measured</summary>
            <p className="mt-2 text-muted">{d.main_metric.definition}</p>
            <p className="mt-2 text-muted">{d.main_metric.exclusions}</p>
          </details>
          <div className="mt-auto space-y-2 border-t border-line pt-4 text-sm">
            <RatioRow label="Resolved with observed evidence" r={d.resolved_with_evidence} />
            <RatioRow label="Excluding outside scope" r={d.eligible_rate} />
            <RatioRow label="Tasks with a trustworthy source read" r={d.evidence_availability} />
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-[17px] font-semibold">Unresolved work</h2>
          <ul className="mt-3 divide-y divide-line">
            <ListRow icon={<Clock className="size-5 text-warning" aria-hidden />} label="Waiting for verification" value={d.pending.waiting} />
            <ListRow icon={<CircleHelp className="size-5 text-warning" aria-hidden />} label="Could not verify" value={o.unverifiable} />
            <ListRow icon={<CircleMinus className="size-5 text-subtle" aria-hidden />} label="Outside scope" value={o.out_of_scope} />
            <ListRow icon={<User className="size-5 text-primary" aria-hidden />} label="Awaiting approval" value={d.pending.awaiting_approval} />
            <ListRow icon={<CircleAlert className="size-5 text-danger" aria-hidden />} label="Unresolved recovery operations" value={d.pending.unresolved_operations} />
            {d.pending.dead_jobs ? <ListRow icon={<CircleAlert className="size-5 text-danger" aria-hidden />} label="Background jobs that exhausted retries" value={d.pending.dead_jobs} /> : null}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="text-[17px] font-semibold">Recovery and human effort</h2>
          <ul className="mt-3 divide-y divide-line">
            <ListRow icon={<CircleCheck className="size-5 text-success" aria-hidden />} label="Recoveries verified by a later source read" value={`${d.recovery.verified_by_proofwork} of ${d.recovery.attempted_tasks}`} />
            <li className="py-2 pl-9 text-[13px] text-muted">
              Human-approved {d.recovery.verified_human_approved} · Auto-policy {d.recovery.verified_auto_policy} · Corrected, attribution unclear {d.recovery.resolved_externally} · Rejected by source {d.recovery.failed_confirmed}
            </li>
            <ListRow icon={<User className="size-5 text-primary" aria-hidden />} label="Tasks with human intervention" value={`${d.human_effort.tasks_with_intervention} (${d.human_effort.intervention_events} events)`} />
            <li className="flex items-start justify-between gap-4 py-3">
              <span className="flex items-center gap-3 text-[15px]">
                <FileText className="size-5 text-muted" aria-hidden />
                {d.correctness.label}
              </span>
              <span className="text-right">
                {d.correctness.measured ? (
                  <>
                    <span className="block text-[15px] tabular">
                      {percent(d.correctness.numerator, d.correctness.denominator)} ({d.correctness.numerator} of {d.correctness.denominator})
                    </span>
                    <span className="block text-xs text-muted">
                      Coverage {d.correctness.coverage.numerator}/{d.correctness.coverage.denominator} · {d.correctness.insufficient_evidence} insufficient · reviewers {d.correctness.reviewers.join(", ")}
                    </span>
                    {d.correctness.review_period.from ? (
                      <span className="block text-xs text-muted">
                        {formatDate(d.correctness.review_period.from, tz)} – {formatDate(d.correctness.review_period.to, tz)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="block text-[15px] font-medium">Not measured</span>
                )}
              </span>
            </li>
          </ul>
          {!d.correctness.measured ? (
            <p className="mt-2 flex gap-2 text-[13px] text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              The verifier cannot audit itself. This stays “Not measured” until independent correctness reviews are recorded on task decisions; no known incidents is not 0% error.
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, tint, label, value, sub }: { icon: React.ReactNode; tint: string; label: string; value: string; sub?: string }) {
  return (
    <Card className="flex items-start gap-4 p-5">
      <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-control", tint)}>{icon}</span>
      <span>
        <span className="block text-sm text-muted">{label}</span>
        <span className="block text-[28px] font-semibold leading-tight tabular">{value}</span>
        {sub ? <span className="block text-sm text-muted">{sub}</span> : null}
      </span>
    </Card>
  );
}

function RatioRow({ label, r }: { label: string; r: Ratio }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="tabular">
        {percent(r.numerator, r.denominator)} · {r.numerator}/{r.denominator}
      </span>
    </div>
  );
}

function ListRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <span className="flex items-center gap-3 text-[15px]">
        {icon}
        {label}
      </span>
      <span className="text-[15px] tabular">{value}</span>
    </li>
  );
}
