import type { ProcessingState, RecoveryState, Tone, Verdict } from "@proofwork/domain";

/** Operator-facing next step, derived from persisted verdict + processing + recovery state. */
export function nextStep(t: { verdict: Verdict; processing_state: ProcessingState; recovery_state: RecoveryState; retired_at?: string | null }): { label: string; tone: Tone | "none" } {
  if (t.retired_at) return { label: "Monitoring stopped", tone: "neutral" };
  if (t.recovery_state === "OUTCOME_UNKNOWN") return { label: "Reconciling write", tone: "warning" };
  if (["AUTHORIZED", "PREPARED", "DISPATCHED", "AWAITING_VERIFICATION"].includes(t.recovery_state) && t.verdict !== "SATISFIED_SCHEDULED" && t.verdict !== "SATISFIED_ENDED") {
    return { label: "Recovery in progress", tone: "info" };
  }
  switch (t.verdict) {
    case "PENDING":
      return { label: t.processing_state === "VERIFYING" ? "Reading source" : "Waiting for check", tone: "neutral" };
    case "MISMATCH":
      if (t.recovery_state === "AWAITING_APPROVAL") return { label: "Human approval", tone: "danger" };
      if (t.recovery_state === "REJECTED") return { label: "Manual handling", tone: "warning" };
      if (t.recovery_state === "FAILED_CONFIRMED") return { label: "Write failed — review", tone: "danger" };
      if (t.recovery_state === "EXPIRED") return { label: "Check again", tone: "warning" };
      return { label: "Manual review", tone: "warning" };
    case "UNVERIFIABLE":
      if (t.processing_state === "WAITING_RECHECK") return { label: "Retry scheduled", tone: "warning" };
      return { label: "Review evidence", tone: "warning" };
    case "SATISFIED_SCHEDULED":
      return { label: "Monitoring", tone: "none" };
    case "SATISFIED_ENDED":
      return { label: "None", tone: "none" };
    case "OUT_OF_SCOPE":
      return { label: "Manual handling", tone: "neutral" };
  }
}

export const isWorking = (p: ProcessingState) => p === "QUEUED" || p === "VERIFYING" || p === "RECOVERING";
