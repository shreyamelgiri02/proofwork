import Link from "next/link";
import { cn } from "@/lib/utils";

/** The Proofwork evidence seal, used consistently across public and product surfaces. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden focusable="false">
      <rect width="32" height="32" rx="4" fill="#102A3A" />
      <path d="M0 0h5v32H0z" fill="#2457D6" />
      <path d="M16 6.5l7.5 2.8v5.6c0 4.9-3.2 9.1-7.5 10.6-4.3-1.5-7.5-5.7-7.5-10.6V9.3L16 6.5z" fill="#fff" fillOpacity=".18" />
      <path d="M16 6.5l7.5 2.8v5.6c0 4.9-3.2 9.1-7.5 10.6-4.3-1.5-7.5-5.7-7.5-10.6V9.3L16 6.5z" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12.4 16.1l2.5 2.5 4.8-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ href = "/", subtitle, className, size = "md" }: { href?: string | null; subtitle?: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={size === "lg" ? "size-9" : size === "sm" ? "size-7" : "size-8"} />
      <span className="flex flex-col leading-none">
        <span className={cn("font-semibold tracking-tight text-ink", size === "lg" ? "text-[22px]" : size === "sm" ? "text-[17px]" : "text-[19px]")}>Proofwork</span>
        {subtitle ? <span className="mt-1 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-muted">{subtitle}</span> : null}
      </span>
    </span>
  );
  if (!href) return content;
  return (
    <Link href={href} className="rounded-control focus-visible:outline-offset-4" aria-label="Proofwork home">
      {content}
    </Link>
  );
}
