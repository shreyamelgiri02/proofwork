"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clock, Info, ShieldCheck, UserCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { OPERATION_STATE_LABELS, POLICY_LABELS, PROPOSAL_STATUS_LABELS, formatDate, formatDateTime, type OperationState, type PolicyMode, type ProposalStatus } from "@proofwork/domain";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { CopyButton, useToast } from "@/components/ui/feedback";
import { FormError, Label, Textarea } from "@/components/ui/form";
import { Alert, Badge, Card, EmptyState, Mono, Skeleton, StepNumber } from "@/components/ui/primitives";
import { FilterTabs } from "@/components/ui/tabs";
import { useUrlState } from "@/features/shared/hooks";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface ProposalItem {
  id: string;
  task_id: string;
  status: ProposalStatus;
  status_reason: string | null;
  diff: { changes: { field: string; label: string; before: unknown; after: unknown }[]; unchanged: { field: string; label: string; value: unknown }[] };
  expires_at: string;
  created_at: string;
  policy_version: number;
  policy_mode: PolicyMode;
  proposal_hash: string;
  subscription_id: string;
  customer_id: string;
  source_account_id: string;
  expected_period_end: string;
  customer_label: string | null;
  source_reference: string;
  request_version: number;
  agent_name: string;
  observed_at: string;
  provider_request_id: string | null;
  source_label: string;
  decision: "APPROVE" | "REJECT" | "AUTO_POLICY" | null;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  operation_state: OperationState | null;
  operation_attribution: string | null;
}

interface ApprovalsResponse {
  filter: "waiting" | "decided" | "all";
  counts: { waiting: number; decided: number; all: number };
  items: ProposalItem[];
  workspace: { timezone: string; writes_paused: boolean };
}

const DEFAULTS = { filter: "waiting", proposal: "" };
const DEFAULT_REASON = "Matches the customer's recorded cancellation request.";

export function ApprovalsPage() {
  const [state, setState] = useUrlState(DEFAULTS);
  const query = useQuery({
    queryKey: ["approvals", state.filter],
    queryFn: () => apiFetch<ApprovalsResponse>(`/api/approvals?filter=${state.filter}`),
    refetchInterval: 10_000,
  });
  const data = query.data;
  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === state.proposal) ?? items[0] ?? null;
  const tz = data?.workspace.timezone ?? "UTC";

  return (
    <div>
      <PageHeader title="Approvals" description="Review the exact change before Proofwork acts." />
      <FilterTabs
        variant="pill"
        label="Filter proposals"
        value={state.filter}
        onChange={(k) => setState({ filter: k, proposal: "" })}
        items={[
          { key: "waiting", label: "Waiting", count: data?.counts.waiting },
          { key: "decided", label: "Decided", count: data?.counts.decided },
          { key: "all", label: "All", count: data?.counts.all },
        ]}
      />

      {query.isError ? (
        <Alert tone="danger" className="mt-5" title="Approvals could not be loaded" action={<Button size="sm" variant="secondary" onClick={() => query.refetch()}>Retry</Button>}>
          {query.error instanceof ApiClientError ? query.error.message : "Try again."}
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          {query.isPending ? (
            <Card className="space-y-4 p-6">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-40" />
              <Skeleton className="h-24" />
            </Card>
          ) : items.length === 0 ? (
            <Card>
              <EmptyState
                icon={<UserCheck aria-hidden />}
                title={state.filter === "waiting" ? "Nothing is waiting for a decision" : "No decisions yet"}
                description={state.filter === "waiting" ? "When a verified mismatch can be fixed within policy, its exact proposed change appears here." : "Approved and rejected proposals will be listed here."}
                action={
                  <Button asChild variant="secondary">
                    <Link href="/app/tasks">Go to tasks</Link>
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              {items.length > 1 ? (
                <Card className="p-2">
                  <ul aria-label="Proposals" className="divide-y divide-line">
                    {items.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setState({ proposal: p.id })}
                          aria-current={selected?.id === p.id ? "true" : undefined}
                          className={cn("flex w-full flex-wrap items-center justify-between gap-2 rounded-control px-3 py-2.5 text-left text-sm transition-ui", selected?.id === p.id ? "bg-primary-soft" : "hover:bg-neutral-soft")}
                        >
                          <span className="font-medium">{p.customer_label ?? p.customer_id}</span>
                          <span className="flex items-center gap-2">
                            <Mono className="text-muted">{p.subscription_id}</Mono>
                            <StatusBadge p={p} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
              {selected ? <ProposalCard key={selected.id} p={selected} tz={tz} writesPaused={data!.workspace.writes_paused} onDecided={(id) => setState({ filter: "all", proposal: id })} /> : null}
            </>
          )}
        </div>
        <PolicyExplainer />
      </div>
    </div>
  );
}

function StatusBadge({ p }: { p: ProposalItem }) {
  if (p.decision === "APPROVE") return <Badge tone="success">Approved</Badge>;
  if (p.decision === "REJECT") return <Badge tone="danger">Rejected</Badge>;
  const meta = PROPOSAL_STATUS_LABELS[p.status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function useCountdown(expiresAt: string) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const ms = new Date(expiresAt).getTime() - now;
  return { expired: ms <= 0, minutes: Math.max(0, Math.ceil(ms / 60000)), seconds: Math.max(0, Math.floor(ms / 1000)) };
}

function ProposalCard({ p, tz, writesPaused, onDecided }: { p: ProposalItem; tz: string; writesPaused: boolean; onDecided: (proposalId: string) => void }) {
  const waiting = p.status === "AWAITING_APPROVAL" && !p.decision;
  const countdown = useCountdown(p.expires_at);
  const expired = waiting && countdown.expired;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = React.useState(DEFAULT_REASON);
  const [pending, setPending] = React.useState<"APPROVE" | "REJECT" | null>(null);
  const [error, setError] = React.useState<{ message: string; ref?: string } | null>(null);
  const [result, setResult] = React.useState<string | null>(null);

  const decide = async (decision: "APPROVE" | "REJECT") => {
    if (pending) return;
    if (decision === "REJECT" && (reason.trim().length < 3 || reason.trim() === DEFAULT_REASON)) {
      setError({ message: "Give a reason for rejecting this proposal." });
      return;
    }
    setPending(decision);
    setError(null);
    try {
      const res = await apiFetch<{ status: string; message: string }>(`/api/approvals/${p.id}/decision`, {
        body: { decision, proposal_hash: p.proposal_hash, reason: reason.trim() },
      });
      setResult(res.message);
      // Keep the decided proposal on screen instead of letting the next waiting one replace it.
      onDecided(p.id);
      toast.push({ tone: decision === "APPROVE" ? "success" : "info", title: decision === "APPROVE" ? "Approval recorded" : "Rejection recorded", description: res.message });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["task", p.task_id] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (err) {
      const e = err instanceof ApiClientError ? err : null;
      setError({ message: e?.message ?? "The decision was not recorded.", ref: e?.code === "INTERNAL_ERROR" ? e.correlationId : undefined });
      if (e && (e.code === "APPROVAL_STALE" || e.code === "APPROVAL_EXPIRED" || e.code === "CONFLICT")) {
        await queryClient.invalidateQueries({ queryKey: ["approvals"] });
      }
    } finally {
      setPending(null);
    }
  };

  const change = p.diff.changes[0];
  return (
    <Card className="p-5 sm:p-7" aria-labelledby={`proposal-${p.id}`}>
      <div className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={`proposal-${p.id}`} className="text-[26px] font-semibold tracking-tight">
            {p.customer_label ?? p.customer_id}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Subscription cancellation · <Mono>#{p.id.slice(0, 8)}</Mono>
          </p>
        </div>
        <div className="sm:text-right">
          {waiting && !expired ? (
            <Badge tone="warning" className="px-3 py-1.5 text-sm" icon={<Clock className="size-4" aria-hidden />}>
              Waiting for decision
            </Badge>
          ) : (
            <StatusBadge p={p} />
          )}
          {waiting ? (
            <p className="mt-2 text-sm text-muted" aria-live="off">
              {expired ? "Expired" : `Expires in ${countdown.minutes} minute${countdown.minutes === 1 ? "" : "s"}`}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="divide-y divide-line/0 py-4">
        <DL label="Customer">{p.customer_label ?? "—"}</DL>
        <DL label="Requested change">Schedule period-end cancellation</DL>
        <DL label="Subscription ID">
          <span className="inline-flex items-center gap-1 rounded-md bg-neutral-soft px-2 py-0.5">
            <Mono>{p.subscription_id}</Mono>
          </span>
          <CopyButton value={p.subscription_id} label="subscription ID" className="ml-1 align-middle" />
        </DL>
        <DL label="Effective date">
          {formatDate(p.expected_period_end, tz)}
          <span className="block text-[13px] text-muted">Cancellation takes effect at the end of the authorized billing period. Service continues until then.</span>
        </DL>
      </dl>

      <section className="mt-2">
        <h3 className="text-[17px] font-semibold">Exact change</h3>
        <p className="text-[13px] text-muted">Only the field below will be updated.</p>
        <div tabIndex={0} role="region" aria-label="Exact field change" className="mt-3 overflow-x-auto rounded-control border border-line">
          <table className="w-full min-w-[420px] text-left text-sm">
            <caption className="sr-only">Exact field change</caption>
            <thead className="bg-surface-muted text-[13px] text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Field</th>
                <th scope="col" className="px-4 py-2 font-medium">Current value (before)</th>
                <th scope="col" className="px-4 py-2 font-medium" aria-hidden />
                <th scope="col" className="px-4 py-2 font-medium">New value (after)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="px-4 py-3 font-normal">
                  <Mono>{change?.field ?? "cancel_at_period_end"}</Mono>
                </th>
                <td className="px-4 py-3">
                  <Badge tone="neutral">{change?.before ? "Yes" : "No"}</Badge>
                </td>
                <td className="px-2 py-3 text-muted">
                  <ArrowRight className="size-4" aria-label="changes to" />
                </td>
                <td className="px-4 py-3">
                  <Badge tone="success">{change?.after ? "Yes" : "No"}</Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5">
        <h3 className="text-[17px] font-semibold">
          Unchanged <span className="ml-2 text-[13px] font-normal text-muted">The authorized period end remains the same.</span>
        </h3>
        <div tabIndex={0} role="region" aria-label="Fields that remain unchanged" className="mt-3 overflow-x-auto rounded-control border border-line">
          <table className="w-full min-w-[360px] text-left text-sm">
            <caption className="sr-only">Fields that remain unchanged</caption>
            <thead className="bg-surface-muted text-[13px] text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Field</th>
                <th scope="col" className="px-4 py-2 font-medium">Value (unchanged)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.diff.unchanged.map((u) => (
                <tr key={u.field}>
                  <th scope="row" className="px-4 py-2.5 font-normal">
                    <Mono>{u.field}</Mono>
                  </th>
                  <td className="px-4 py-2.5">
                    <span className="rounded-md bg-neutral-soft px-2 py-0.5">
                      {u.field === "current_period_end" && typeof u.value === "string" ? <Mono>{formatDate(u.value, tz)}</Mono> : String(u.value)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h3 className="text-[17px] font-semibold">Request details</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3 sm:divide-x sm:divide-line">
          <div>
            <p className="text-sm text-muted">Proposed</p>
            <p className="font-medium">{formatDateTime(p.created_at, tz)}</p>
            <p className="text-[13px] text-muted">after report by {p.agent_name}</p>
          </div>
          <div className="sm:pl-4">
            <p className="text-sm text-muted">Approval expires</p>
            <p className="font-medium">{formatDateTime(p.expires_at, tz)}</p>
            <p className="text-[13px] text-muted">Evidence read {formatDateTime(p.observed_at, tz)}</p>
          </div>
          <div className="sm:pl-4">
            <p className="text-sm text-muted">Policy</p>
            <p className="font-medium">
              {POLICY_LABELS[p.policy_mode].short} · v{p.policy_version}
            </p>
            <p className="text-[13px] text-muted">
              {p.source_label} · ref {p.source_reference}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="text-[17px] font-semibold">Decision</h3>
        {waiting && !expired && !result ? (
          <>
            {writesPaused ? (
              <Alert tone="warning" className="mt-3">
                Recovery writes are paused. You can approve, but nothing is dispatched until writes resume and the fresh checks still pass.
              </Alert>
            ) : null}
            <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr] sm:gap-4">
              <Label htmlFor={`reason-${p.id}`} className="sm:pt-2.5">
                Decision reason
              </Label>
              <div>
                <Textarea id={`reason-${p.id}`} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} rows={3} aria-describedby={`reason-count-${p.id}`} />
                <p id={`reason-count-${p.id}`} className="mt-1 text-right text-xs text-muted">
                  {reason.length}/500
                </p>
              </div>
            </div>
            <div className="mt-3">
              <FormError message={error?.message} reference={error?.ref} />
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={() => decide("APPROVE")} loading={pending === "APPROVE"} disabled={pending !== null}>
                Approve and apply
              </Button>
              <Button size="lg" variant="danger" onClick={() => decide("REJECT")} loading={pending === "REJECT"} disabled={pending !== null}>
                Reject
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href={`/app/tasks/${p.task_id}`}>Open task</Link>
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            {result ? <Alert tone="success">{result}</Alert> : null}
            {expired && !result ? (
              <Alert tone="warning" title="This proposal expired">
                Approval windows are limited. Open the task and use Check now to prepare a proposal from current evidence.
              </Alert>
            ) : null}
            {p.decision ? (
              <p>
                {p.decision === "AUTO_POLICY" ? "Authorized by the auto-recover policy" : `${p.decision === "APPROVE" ? "Approved" : "Rejected"} by ${p.decided_by}`} on {formatDateTime(p.decided_at, tz)}
                {p.decision_reason ? <span className="block text-muted">“{p.decision_reason}”</span> : null}
              </p>
            ) : null}
            {p.operation_state ? (
              <p className="flex items-center gap-2">
                Operation: <Badge tone={OPERATION_STATE_LABELS[p.operation_state].tone}>{OPERATION_STATE_LABELS[p.operation_state].label}</Badge>
              </p>
            ) : p.decision === "APPROVE" ? (
              <p className="text-muted">Queued. The outcome will be decided by a new source read.</p>
            ) : null}
            <Button asChild variant="secondary">
              <Link href={`/app/tasks/${p.task_id}`}>Open task</Link>
            </Button>
          </div>
        )}
      </section>
    </Card>
  );
}

function DL({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-[15px]">{children}</dd>
    </div>
  );
}

function PolicyExplainer() {
  return (
    <aside aria-labelledby="approval-policy-heading">
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="size-7 shrink-0 text-primary" aria-hidden />
          <div>
            <h2 id="approval-policy-heading" className="text-[20px] font-semibold tracking-tight">
              Approval policy
            </h2>
            <p className="text-sm text-muted">Why this needs your review</p>
          </div>
        </div>
        <p className="mt-4 text-[15px] text-ink">Proofwork makes a fresh check before writing any change and an independent read after to confirm the outcome. You are approving only the change shown here.</p>
        <ol className="mt-5 space-y-5">
          {[
            ["Fresh check before write", "The subscription must still match this request, policy and source fingerprint."],
            ["Apply only this change", "cancel_at_period_end = true. No other fields are modified."],
            ["Independent read after write", "The result is decided by a new source read, not the write response."],
          ].map(([t, b], i) => (
            <li key={t} className="flex gap-3">
              <StepNumber n={i + 1} />
              <div>
                <p className="font-medium">{t}</p>
                <p className="text-sm text-muted">{b}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 border-t border-line pt-5">
          <p className="font-medium">No scope expansion</p>
          <p className="mt-1 text-sm text-muted">No refunds, immediate cancellations, price or invoice changes. Stale, expired or policy-invalid proposals cannot be applied.</p>
        </div>
        <div className="mt-5 flex gap-3 rounded-control bg-primary-soft p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="font-medium text-primary-ink">You’re in control</p>
            <p className="text-sm text-muted">Nothing is changed until you approve. Rejecting keeps the verification result unchanged.</p>
          </div>
        </div>
      </Card>
    </aside>
  );
}
