"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, Plus } from "lucide-react";
import * as React from "react";
import { VERDICT_LABELS, type Verdict } from "@proofwork/domain";
import { VerdictBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/feedback";
import { Card } from "@/components/ui/primitives";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface ScenariosResponse {
  enabled: boolean;
  scenarios: { key: string; title: string; description: string; try_next: string; control: string | null }[];
}

const DEFINITIONS: { verdict: Verdict; meaning: string }[] = [
  { verdict: "SATISFIED_SCHEDULED", meaning: "The correct future cancellation is independently observed at the authorized period end. The subscription can remain active until then." },
  { verdict: "SATISFIED_ENDED", meaning: "Evidence shows service ended within the accepted window at the authorized boundary." },
  { verdict: "MISMATCH", meaning: "Reliable evidence confirms a material difference from the authorized outcome." },
  { verdict: "UNVERIFIABLE", meaning: "Reliable evidence is unavailable. Unknown is never converted into success." },
  { verdict: "OUT_OF_SCOPE", meaning: "The subscription structure or requested workflow is not supported." },
  { verdict: "PENDING", meaning: "The report was accepted but the source has not been evaluated yet." },
];

export function ScenarioLibrary() {
  const [open, setOpen] = React.useState(false);
  const [creating, setCreating] = React.useState<string | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["scenarios"], queryFn: () => apiFetch<ScenariosResponse>("/api/demo/scenarios"), staleTime: 60_000 });
  const panelId = "scenario-library-panel";

  const create = async (key: string) => {
    setCreating(key);
    try {
      const res = await apiFetch<{ message: string }>("/api/demo/scenarios", { body: { key } });
      toast.push({ tone: "success", title: "Scenario created", description: res.message });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (err) {
      toast.push({ tone: "error", title: "Scenario not created", description: err instanceof ApiClientError ? err.message : "Try again." });
    } finally {
      setCreating(null);
    }
  };

  return (
    <Card className="mt-8">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-4 px-5 py-4 text-left"
        >
          <BookOpen className="size-5 text-muted" aria-hidden />
          <span className="flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
            <span className="text-[17px] font-semibold text-ink">Scenario library</span>
            <span className="text-sm text-muted">{data?.enabled ? "Create synthetic source conditions and outcome definitions." : "Reference outcome definitions for supported scenarios."}</span>
          </span>
          <ChevronDown className={cn("size-5 text-muted transition-transform duration-150", open && "rotate-180")} aria-hidden />
        </button>
      </h2>
      {open ? (
        <div id={panelId} className="border-t border-line px-5 py-5">
          {data?.enabled ? (
            <>
              <p className="text-sm text-muted">
                Each scenario seeds the independent synthetic billing source, registers a request and submits the agent’s report. The worker reads the source and decides — scenarios never contain expected results.
              </p>
              <ul className="mt-4 grid gap-3 md:grid-cols-2">
                {data.scenarios.map((s) => (
                  <li key={s.key} className="flex flex-col rounded-control border border-line p-4">
                    <p className="font-medium">{s.title}</p>
                    <p className="mt-1 flex-1 text-sm text-muted">{s.description}</p>
                    <p className="mt-2 text-[13px] text-subtle">Try: {s.try_next}</p>
                    <div className="mt-3">
                      <Button size="sm" variant="secondary" loading={creating === s.key} disabled={creating !== null} onClick={() => create(s.key)}>
                        <Plus aria-hidden /> Create scenario
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <h3 className={cn("text-sm font-semibold", data?.enabled && "mt-6")}>Outcome definitions</h3>
          <dl className="mt-3 divide-y divide-line">
            {DEFINITIONS.map((d) => (
              <div key={d.verdict} className="grid gap-2 py-3 sm:grid-cols-[220px_1fr]">
                <dt>
                  <VerdictBadge verdict={d.verdict} size="sm" />
                  <span className="sr-only"> {VERDICT_LABELS[d.verdict].label}</span>
                </dt>
                <dd className="text-sm text-muted">{d.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Card>
  );
}
