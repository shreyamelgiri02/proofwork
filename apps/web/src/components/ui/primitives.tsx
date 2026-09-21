import { CircleAlert, CircleCheck, CircleHelp, CircleMinus, Clock, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import * as React from "react";
import type { Tone } from "@proofwork/domain";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-surface border border-line border-t-[3px] border-t-evidence bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ title, description, action, className, as: As = "h2" }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; as?: "h2" | "h3" }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <As className="text-[18px] font-semibold tracking-[-0.015em] text-ink">{title}</As>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const toneClasses: Record<Tone, string> = {
  success: "bg-success-soft text-success-ink",
  info: "bg-info-soft text-info-ink",
  danger: "bg-danger-soft text-danger-ink",
  warning: "bg-warning-soft text-warning-ink",
  neutral: "bg-neutral-soft text-neutral-ink",
};

export function Badge({ tone = "neutral", className, children, icon }: { tone?: Tone; className?: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-current/15 px-2 py-0.5 text-[12px] font-medium", toneClasses[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function StatusIcon({ tone, className }: { tone: Tone; className?: string }) {
  const base = cn("size-5 shrink-0", className);
  switch (tone) {
    case "success":
      return <CircleCheck className={cn(base, "text-success")} aria-hidden />;
    case "danger":
      return <CircleAlert className={cn(base, "text-danger")} aria-hidden />;
    case "warning":
      return <CircleHelp className={cn(base, "text-warning")} aria-hidden />;
    case "info":
      return <Clock className={cn(base, "text-info")} aria-hidden />;
    default:
      return <CircleMinus className={cn(base, "text-subtle")} aria-hidden />;
  }
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <LoaderCircle className={cn("size-5 animate-pw-spin text-primary", className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("block animate-pw-pulse rounded-[3px] bg-neutral-soft", className)} aria-hidden />;
}

export function Alert({ tone = "info", title, children, className, action }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const Icon = tone === "danger" ? CircleAlert : tone === "warning" ? TriangleAlert : tone === "success" ? CircleCheck : Info;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-control border border-l-[3px] px-4 py-3 text-sm",
        tone === "danger" && "border-danger/25 bg-danger-soft text-danger-ink",
        tone === "warning" && "border-warning/30 bg-warning-soft text-warning-ink",
        tone === "success" && "border-success/25 bg-success-soft text-success-ink",
        tone === "info" && "border-info/20 bg-info-soft text-info-ink",
        tone === "neutral" && "border-line bg-neutral-soft text-neutral-ink",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "opacity-95")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 flex size-11 items-center justify-center rounded-control border border-primary/20 bg-primary-soft text-primary [&_svg]:size-5">{icon}</div> : null}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Mono({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("font-mono text-[13px] tracking-tight", className)}>{children}</span>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

export function DefinitionRow({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-1 border-b border-line py-2.5 last:border-b-0 sm:grid-cols-[180px_1fr] sm:gap-4", className)}>
      <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

export function StepNumber({ n, tone = "primary", className }: { n: number | string; tone?: "primary" | "muted" | "done"; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[3px] border text-sm font-semibold tabular",
        tone === "primary" && "border-primary/25 bg-primary-soft text-primary-ink",
        tone === "muted" && "border-line bg-neutral-soft text-neutral-ink",
        tone === "done" && "border-success/25 bg-success-soft text-success-ink",
        className,
      )}
      aria-hidden
    >
      {n}
    </span>
  );
}
