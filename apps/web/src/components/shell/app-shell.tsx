"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Building2, ChartColumn, ClipboardList, FlaskConical, Menu as MenuIcon, PauseCircle, Settings, ShieldCheck, TriangleAlert, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { POLICY_LABELS, type AdapterKind, type PolicyMode } from "@proofwork/domain";
import { Logo } from "@/components/brand";
import { EnvironmentBadge } from "@/components/status";
import { Badge } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { DemoBanner } from "./demo-banner";

export interface ShellData {
  identity: { kind: "user" | "demo"; display_name: string; email: string | null; expires_at?: string | null };
  workspace: { id: string; kind: "PRIVATE" | "DEMO"; organization: string; name: string; timezone: string; writes_paused: boolean; expires_at: string | null };
  policy: { version: number; mode: PolicyMode; label: string } | null;
  connection: { id: string; adapter: AdapterKind; health: string; display_name: string } | null;
  counts: { tasks: number; pending_approvals: number; needs_action: number };
}

const NAV = [
  { href: "/app/tasks", label: "Tasks", icon: ClipboardList, count: (d: ShellData) => d.counts.tasks },
  { href: "/app/approvals", label: "Approvals", icon: UserCheck, count: (d: ShellData) => d.counts.pending_approvals },
  { href: "/app/activity", label: "Activity", icon: Activity },
  { href: "/app/insights", label: "Insights", icon: ChartColumn },
] as const;

const TITLES: [RegExp, string][] = [
  [/^\/app\/tasks\/[^/]+$/, "Task evidence"],
  [/^\/app\/tasks/, "Tasks"],
  [/^\/app\/requests\/new/, "Register request"],
  [/^\/app\/claims\/new/, "Submit report"],
  [/^\/app\/approvals/, "Approvals"],
  [/^\/app\/activity/, "Activity"],
  [/^\/app\/insights/, "Insights"],
  [/^\/app\/settings/, "Settings"],
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`) || (href === "/app/tasks" && (pathname.startsWith("/app/requests") || pathname.startsWith("/app/claims")));
}

function DesktopNav({ data, pathname }: { data: ShellData; pathname: string }) {
  return (
    <nav aria-label="Workspace" className="hidden h-full items-stretch md:flex">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const count = "count" in item && item.count ? item.count(data) : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-w-20 items-center justify-center gap-2 px-3 text-[14px] font-medium transition-ui lg:min-w-24",
              active ? "bg-primary-soft/65 text-primary-ink" : "text-muted hover:bg-neutral-soft hover:text-ink",
            )}
          >
            <item.icon className="size-4" aria-hidden />
            <span className="hidden lg:inline">{item.label}</span>
            {count ? <span className={cn("rounded-[2px] px-1.5 py-px font-mono text-[10px]", active ? "bg-primary/10" : "bg-neutral-soft")}>{count}</span> : null}
            {active ? <span className="absolute inset-x-2 bottom-0 h-[3px] bg-primary" aria-hidden /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function MobileNavigation({ data, pathname, onNavigate }: { data: ShellData; pathname: string; onNavigate: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-5 pb-5 pt-5">
        <Logo href="/app/tasks" subtitle="Evidence ledger" />
        <div className="mt-5 flex items-center gap-3 border-l-[3px] border-primary bg-primary-soft/55 px-3 py-3">
          {data.workspace.kind === "DEMO" ? <FlaskConical className="size-4 text-primary" aria-hidden /> : <Building2 className="size-4 text-primary" aria-hidden />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{data.workspace.name || "Workspace"}</span>
            <span className="block truncate text-xs text-muted">{data.workspace.kind === "DEMO" ? "Isolated demo" : data.workspace.organization}</span>
          </span>
        </div>
      </div>
      <nav aria-label="Mobile workspace" className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const count = "count" in item && item.count ? item.count(data) : null;
            return (
              <li key={item.href}>
                <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex h-11 items-center gap-3 rounded-control border-l-[3px] px-3 text-[15px]", active ? "border-primary bg-primary-soft font-semibold text-primary-ink" : "border-transparent text-ink hover:bg-neutral-soft")}>
                  <item.icon className="size-4.5" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  {count ? <span className="font-mono text-xs text-muted">{count}</span> : null}
                </Link>
              </li>
            );
          })}
          <li className="mt-3 border-t border-line pt-3">
            <Link href="/app/settings" onClick={onNavigate} aria-current={pathname.startsWith("/app/settings") ? "page" : undefined} className={cn("flex h-11 items-center gap-3 rounded-control border-l-[3px] px-3 text-[15px]", pathname.startsWith("/app/settings") ? "border-primary bg-primary-soft font-semibold text-primary-ink" : "border-transparent text-ink hover:bg-neutral-soft")}>
              <Settings className="size-4.5" aria-hidden /> Settings
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export function AppShell({ initial, children }: { initial: ShellData; children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const { data } = useQuery({
    queryKey: ["session"],
    queryFn: () => apiFetch<ShellData>("/api/session"),
    initialData: initial,
    refetchInterval: 20_000,
  });
  const shell = data ?? initial;
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? "Workspace";

  return (
    <div className="min-h-dvh bg-canvas">
      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-evidence/45 animate-pw-overlay md:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[300px] max-w-[88vw] border-r border-line bg-surface shadow-float animate-pw-fade-in md:hidden">
            <DialogPrimitive.Title className="sr-only">Workspace navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Move between Proofwork ledgers and settings.</DialogPrimitive.Description>
            <DialogPrimitive.Close className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-control text-muted hover:bg-neutral-soft" aria-label="Close navigation">
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
            <MobileNavigation data={shell} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1600px] items-stretch px-3 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3 md:min-w-[210px] md:flex-none md:border-r md:border-line md:pr-5">
            <button type="button" className="flex size-10 items-center justify-center rounded-control text-ink hover:bg-neutral-soft md:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
              <MenuIcon className="size-5" aria-hidden />
            </button>
            <Logo href="/app/tasks" subtitle="Evidence ledger" className="hidden sm:inline-flex" />
            <span className="truncate text-sm font-semibold sm:hidden">{title}</span>
            <span className="hidden min-w-0 border-l border-line pl-3 xl:block">
              <span className="block max-w-36 truncate text-xs font-semibold">{shell.workspace.name || "Workspace"}</span>
              <span className="block max-w-36 truncate font-mono text-[9px] uppercase tracking-[0.06em] text-muted">{shell.workspace.kind === "DEMO" ? "Isolated demo" : shell.workspace.organization}</span>
            </span>
          </div>

          <DesktopNav data={shell} pathname={pathname} />

          <div className="ml-auto flex items-center gap-2 border-l border-line pl-3 sm:pl-4">
            <EnvironmentBadge kind={shell.workspace.kind} adapter={shell.connection?.adapter} className="hidden xl:inline-flex" />
            {shell.workspace.writes_paused ? (
              <Badge tone="warning" className="hidden lg:inline-flex" icon={<PauseCircle className="size-3.5" aria-hidden />}>
                Writes paused
              </Badge>
            ) : null}
            {shell.policy ? (
              <span className="hidden items-center gap-1.5 text-xs text-ink 2xl:inline-flex" title={`Recovery policy version ${shell.policy.version}`}>
                {shell.policy.mode === "OBSERVE_ONLY" ? <ShieldCheck className="size-4 text-muted" aria-hidden /> : <TriangleAlert className="size-4 text-warning" aria-hidden />}
                {POLICY_LABELS[shell.policy.mode].short}
              </span>
            ) : null}
            <Link href="/app/settings" aria-label="Settings" aria-current={pathname.startsWith("/app/settings") ? "page" : undefined} className={cn("hidden size-9 items-center justify-center rounded-control md:flex", pathname.startsWith("/app/settings") ? "bg-primary-soft text-primary" : "text-muted hover:bg-neutral-soft hover:text-ink")}>
              <Settings className="size-4" aria-hidden />
            </Link>
            <AccountMenu displayName={shell.identity.display_name} email={shell.identity.email} secondary={shell.workspace.kind === "DEMO" ? "Isolated demo" : shell.workspace.name} kind={shell.identity.kind} />
          </div>
        </div>
      </header>
      {shell.workspace.kind === "DEMO" ? <DemoBanner expiresAt={shell.workspace.expires_at} /> : null}
      <main id="main" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 md:py-8 lg:px-8">
        {children}
      </main>
    </div>
  );
}
