import { ADAPTER_LABELS, VERDICT_LABELS, type AdapterKind, type Tone, type Verdict } from "@proofwork/domain";
import { Badge, StatusIcon } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/** Verdict badge: color + icon + text, never color alone. */
export function VerdictBadge({ verdict, size = "md", className }: { verdict: Verdict; size?: "sm" | "md"; className?: string }) {
  const v = VERDICT_LABELS[verdict] ?? VERDICT_LABELS.PENDING;
  return (
    <Badge tone={v.tone} className={cn("font-mono uppercase tracking-[0.04em]", size === "md" ? "px-2.5 py-1 text-[12px]" : "", className)} icon={<StatusIcon tone={v.tone} className={size === "md" ? "size-4" : "size-3.5"} />}>
      {v.label}
    </Badge>
  );
}

export function VerdictInline({ verdict, label }: { verdict: Verdict; label?: string }) {
  const v = VERDICT_LABELS[verdict] ?? VERDICT_LABELS.PENDING;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <StatusIcon tone={v.tone} />
      {label ?? v.short}
    </span>
  );
}

export function EnvironmentBadge({ kind, adapter, className }: { kind: "PRIVATE" | "DEMO"; adapter: AdapterKind | null | undefined; className?: string }) {
  const label = kind === "DEMO" ? "Demo · Simulated billing" : adapter ? ADAPTER_LABELS[adapter].environment : "No source";
  const tone: Tone = kind === "DEMO" ? "warning" : adapter === "STRIPE_TEST" ? "info" : "neutral";
  return (
    <Badge tone={tone} className={cn("px-2.5 py-1", className)}>
      {label}
    </Badge>
  );
}
