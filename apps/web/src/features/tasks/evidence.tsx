"use client";

import { CircleAlert, CircleCheck, CircleHelp, CircleMinus, Database, MessageSquareText } from "lucide-react";
import * as React from "react";
import { REASON_COPY, formatDate, formatDateTime, type ReasonCode } from "@proofwork/domain";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/feedback";
import { Badge, Card, CardHeader, Mono } from "@/components/ui/primitives";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import type { ComparisonRow, DecisionRow } from "./types";

function formatValue(row: ComparisonRow, value: string | boolean | null, tz: string) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (["current_period_end", "ended_at", "cancel_at"].includes(row.field)) {
    return <span title={formatDateTime(value, "UTC", { withZone: true })}>{formatDate(value, tz)}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Mono>{value}</Mono>
    </span>
  );
}

function ResultPill({ result }: { result: ComparisonRow["result"] }) {
  if (result === "MATCH") return <Badge tone="success" icon={<CircleCheck className="size-3.5" aria-hidden />}>Match</Badge>;
  if (result === "MISMATCH") return <Badge tone="danger" icon={<CircleAlert className="size-3.5" aria-hidden />}>Mismatch</Badge>;
  if (result === "UNKNOWN") return <Badge tone="warning" icon={<CircleHelp className="size-3.5" aria-hidden />}>Unknown</Badge>;
  return <Badge tone="neutral" icon={<CircleMinus className="size-3.5" aria-hidden />}>n/a</Badge>;
}

export function EvidenceCard({ decision, taskId, tz, sourceLabel }: { decision: DecisionRow | null; taskId: string; tz: string; sourceLabel: string }) {
  if (!decision) {
    return (
      <Card className="p-5 sm:p-6">
        <CardHeader title="Evidence" description="Compare the expected outcome against the latest source data." />
        <p className="mt-6 rounded-control border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
          The source has not been read yet. The worker picks up the queued verification shortly; nothing is shown as verified until it does.
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title="Evidence" description="Compare the expected outcome against the latest source data." action={<ExplanationButton key={decision.id} taskId={taskId} decisionId={decision.id} />} />
      <div tabIndex={0} role="region" aria-label="Expected versus observed values" className="mt-5 overflow-x-auto rounded-control border border-line">
        <table className="w-full min-w-[520px] text-left text-sm">
          <caption className="sr-only">Expected versus observed values from the latest source read</caption>
          <thead className="bg-surface-muted text-[13px] text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Field</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Expected</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Observed</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {decision.comparison.length ? (
              decision.comparison.map((row) => (
                <tr key={row.field}>
                  <th scope="row" className="px-4 py-3 font-normal text-ink">{row.label}</th>
                  <td className="px-4 py-3">{formatValue(row, row.expected, tz)}</td>
                  <td className="px-4 py-3">{formatValue(row, row.observed, tz)}</td>
                  <td className="px-4 py-3">
                    <ResultPill result={row.result} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  No comparable fields were available from this read.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-[auto_1fr_1fr] sm:items-center sm:divide-x sm:divide-line">
        <span className="hidden size-11 items-center justify-center rounded-full bg-neutral-soft sm:flex">
          <Database className="size-5 text-muted" aria-hidden />
        </span>
        <div className="sm:pl-4">
          <p className="text-sm font-medium">Source</p>
          <p className="text-sm text-muted">
            {sourceLabel} · {decision.environment === "STRIPE_TEST_MODE" ? "Stripe test mode" : "Simulated billing"}
          </p>
        </div>
        <div className="sm:pl-4">
          <p className="text-sm text-muted">Read at</p>
          <p className="text-sm tabular">{formatDateTime(decision.observed_at, tz, { withZone: true })}</p>
          {decision.result_type === "ERROR" ? <p className="text-xs text-warning-ink">Read failed: {decision.error_code}</p> : null}
        </div>
      </div>

      <details className="group mt-5 rounded-control border border-line">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-ink marker:text-muted">Technical evidence</summary>
        <div className="space-y-3 border-t border-line px-4 py-4 text-[13px]">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <TechRow label="Decision ID" value={decision.id} copy />
            <TechRow label="Observation ID" value={decision.observation_id} copy />
            <TechRow label="Evaluator" value={decision.evaluator_version} />
            <TechRow label="Reason codes" value={decision.reason_codes.join(", ")} />
            <TechRow label="Trigger" value={decision.trigger} />
            <TechRow label="Policy version" value={decision.policy_version == null ? "—" : String(decision.policy_version)} />
            <TechRow label="Request version" value={String(decision.request_version)} />
            <TechRow label="Provider request ID" value={decision.provider_request_id ?? "—"} copy={Boolean(decision.provider_request_id)} />
            <TechRow label="Material fingerprint" value={decision.material_fingerprint ?? "—"} copy={Boolean(decision.material_fingerprint)} />
            <TechRow label="Evaluated at (UTC)" value={decision.evaluated_at} />
          </dl>
          {decision.snapshot ? (
            <div>
              <p className="mb-1 text-muted">Normalized source snapshot</p>
              <pre tabIndex={0} role="region" aria-label="Normalized source snapshot" className="max-h-72 overflow-auto rounded-control bg-surface-muted p-3 font-mono text-[12px] leading-relaxed text-ink">{JSON.stringify(decision.snapshot, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

function TechRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <Mono className="truncate">{value}</Mono>
        {copy ? <CopyButton value={value} label={label} /> : null}
      </dd>
    </div>
  );
}

function ExplanationButton({ taskId, decisionId }: { taskId: string; decisionId: string }) {
  const [state, setState] = React.useState<{ loading: boolean; text?: string; mode?: string; note?: string | null; error?: string }>({ loading: false });
  const load = async () => {
    setState({ loading: true });
    try {
      const res = await apiFetch<{ text: string; mode: string; fallback_reason: string | null }>(`/api/tasks/${taskId}/explanation?decision_id=${decisionId}`);
      setState({ loading: false, text: res.text, mode: res.mode, note: res.fallback_reason });
    } catch (err) {
      setState({ loading: false, error: err instanceof ApiClientError ? err.message : "Explanation unavailable." });
    }
  };
  return (
    <div className="max-w-sm">
      {state.text ? (
        <div className="rounded-control border border-line bg-surface-muted p-3 text-sm" aria-live="polite">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{state.mode === "MODEL_ASSISTED" ? "Explanation (AI-assisted, from recorded facts)" : "Why this result?"}</p>
          <p className="mt-1 text-ink">{state.text}</p>
          {state.note ? <p className="mt-1 text-xs text-muted">{state.note}</p> : null}
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={load} loading={state.loading}>
          <MessageSquareText aria-hidden /> Why this result?
        </Button>
      )}
      {state.error ? <p className="mt-1 text-xs text-danger-ink">{state.error}</p> : null}
    </div>
  );
}

export function reasonSummary(code: ReasonCode | null | undefined) {
  if (!code) return "Proofwork accepted the report and is waiting to read the billing source.";
  return REASON_COPY[code]?.explanation ?? "See the recorded evidence.";
}
