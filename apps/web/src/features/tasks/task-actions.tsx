"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FlaskConical } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/feedback";
import { Field, FormError, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent, DialogFooter, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlay";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import type { DecisionRow } from "./types";

function useTaskMutation(taskId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (path: string, body: unknown, success: string) => {
    const res = await apiFetch<{ message?: string }>(path, { body });
    toast.push({ tone: "success", title: success, description: res?.message });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["session"] }),
    ]);
    return res;
  };
}

/** A dialog with a reason field. Keeps the typed reason if the request fails. */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  submitLabel,
  destructive,
  onSubmit,
  children,
  minLength = 3,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  label: string;
  submitLabel: string;
  destructive?: boolean;
  onSubmit: (reason: string) => Promise<void>;
  children?: React.ReactNode;
  minLength?: number;
}) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (reason.trim().length < minLength) {
      setError(`Enter at least ${minLength} characters.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      setReason("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "The action could not be completed.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <form onSubmit={submit} className="space-y-4">
          {children}
          <Field id="dialog-reason" label={label} error={error ?? undefined}>
            {(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant={destructive ? "dangerSolid" : "primary"} loading={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RetireTaskButton({ taskId }: { taskId: string }) {
  const [open, setOpen] = React.useState(false);
  const mutate = useTaskMutation(taskId);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Stop monitoring
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Stop monitoring this task?"
        description="Routine checks and new recovery writes stop. The latest verdict, history and reporting cohort are preserved, and any possibly dispatched write keeps being reconciled. This counts as a human intervention."
        label="Reason"
        submitLabel="Stop monitoring"
        destructive
        onSubmit={async (reason) => {
          await mutate(`/api/tasks/${taskId}/retire`, { reason }, "Monitoring stopped");
        }}
      />
    </>
  );
}

export function InterventionButton({ taskId }: { taskId: string }) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState("EXTERNAL_REPAIR_RECORDED");
  const mutate = useTaskMutation(taskId);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Record intervention
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Record human involvement"
        description="Record a manual correction, escalation or resolution that happened outside Proofwork. It never changes the verdict — only a new source read can."
        label="What happened?"
        submitLabel="Record"
        onSubmit={async (note) => {
          await mutate(`/api/tasks/${taskId}/interventions`, { kind, note }, "Intervention recorded");
        }}
      >
        <Field id="intervention-kind" label="Type">
          {(a) => (
            <Select {...a} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="EXTERNAL_REPAIR_RECORDED">Manual correction made at the source</option>
              <option value="MANUAL_ESCALATION">Escalated to a person or team</option>
              <option value="MANUAL_RESOLUTION">Resolved manually outside Proofwork</option>
            </Select>
          )}
        </Field>
      </ReasonDialog>
    </>
  );
}

export function ReviewButton({ taskId, decisions }: { taskId: string; decisions: DecisionRow[] }) {
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("CORRECT");
  const [decisionId, setDecisionId] = React.useState(decisions[0]?.id ?? "");
  const mutate = useTaskMutation(taskId);
  if (!decisions.length) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Add correctness review
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Adjudicate a recorded decision"
        description="Independent review labels feed the Incorrectly accepted completions metric. A review is attached to one historic decision and never rewrites it."
        label="Evidence basis"
        submitLabel="Save review"
        onSubmit={async (basis) => {
          await mutate(`/api/tasks/${taskId}/reviews`, { decision_id: decisionId, label, evidence_basis: basis }, "Review recorded");
        }}
      >
        <Field id="review-decision" label="Decision">
          {(a) => (
            <Select {...a} value={decisionId} onChange={(e) => setDecisionId(e.target.value)}>
              {decisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {new Date(d.evaluated_at).toISOString().slice(0, 16).replace("T", " ")} UTC · {d.verdict} · {d.reason_codes[0]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="review-label" label="Label">
          {(a) => (
            <Select {...a} value={label} onChange={(e) => setLabel(e.target.value)}>
              <option value="CORRECT">Correct</option>
              <option value="INCORRECT">Incorrect</option>
              <option value="INSUFFICIENT_EVIDENCE">Insufficient evidence</option>
            </Select>
          )}
        </Field>
      </ReasonDialog>
    </>
  );
}

/** Demo / development only: change the synthetic source outside Proofwork, or trigger scenario controls. */
export function ScenarioControls({ taskId, hasLiveProposal }: { taskId: string; hasLiveProposal: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = React.useState<{ message: string; ref?: string } | null>(null);
  const run = async (path: string, body: unknown, title: string) => {
    setError(null);
    try {
      const res = await apiFetch<{ message?: string }>(path, { body });
      toast.push({ tone: "info", title, description: res?.message });
      await queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    } catch (err) {
      setError({ message: err instanceof ApiClientError ? err.message : "Control failed.", ref: err instanceof ApiClientError ? err.correlationId : undefined });
    }
  };
  const change = (c: string, label: string) => run("/api/demo/source-changes", { task_id: taskId, change: c }, label);
  return (
    <div className="rounded-control border border-dashed border-warning/40 bg-warning-soft/40 p-3">
      <p className="flex items-center gap-2 text-[13px] font-medium text-warning-ink">
        <FlaskConical className="size-4" aria-hidden /> Synthetic source controls
      </p>
      <p className="mt-1 text-xs text-muted">Changes happen at the source without telling Proofwork. Use Check now to read them.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="secondary">
              Change source <ChevronDown aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuLabel>Simulated external changes</MenuLabel>
            <MenuItem onSelect={() => change("SCHEDULE_EXTERNALLY", "Cancellation scheduled externally")}>Schedule cancellation externally</MenuItem>
            <MenuItem onSelect={() => change("REVERSE_SCHEDULE", "Schedule reversed at source")}>Reverse cancellation schedule</MenuItem>
            <MenuItem onSelect={() => change("SHIFT_PERIOD", "Billing period shifted")}>Shift billing period (+30 days)</MenuItem>
            <MenuItem onSelect={() => change("CHANGE_CUSTOMER", "Customer identity changed")}>Change customer identity</MenuItem>
            <MenuItem onSelect={() => change("SOURCE_OUTAGE", "Source outage simulated")}>Simulate source outage</MenuItem>
            <MenuItem onSelect={() => change("SOURCE_RESTORE", "Source faults cleared")}>Clear source faults</MenuItem>
          </MenuContent>
        </Menu>
        {hasLiveProposal ? (
          <Button size="sm" variant="secondary" onClick={() => run("/api/demo/controls", { task_id: taskId, control: "EXPIRE_PROPOSAL" }, "Approval window ended")}>
            Expire proposal now
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => run("/api/demo/controls", { task_id: taskId, control: "QUEUE_COMPETING_RECOVERY" }, "Competing recovery queued")}>
          Queue competing recovery
        </Button>
      </div>
      <div className="mt-2">
        <FormError message={error?.message} reference={error?.ref} />
      </div>
    </div>
  );
}
