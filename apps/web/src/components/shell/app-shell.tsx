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

function NavLinks({ data, pathname, onNavigate }: { data: ShellData; pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.href === "/app/tasks" && (pathname.startsWith("/app/requests") || pathname.startsWith("/app/claims")));
        const count = "count" in item && item.count ? item.count(data) : null;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-11 items-center gap-3 rounded-control px-3 text-[15px] transition-ui",
                active ? "bg-primary-soft font-medium text-primary-ink" : "text-ink hover:bg-neutral-soft",
              )}
            >
              {active ? <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r bg-primary" aria-hidden /> : null}
              <item.icon className={cn("size-5", active ? "text-primary" : "text-muted")} aria-hidden />
              <span className="flex-1">{item.label}</span>
              {count ? (
                <span className={cn("rounded-md px-1.5 py-px text-xs font-medium tabular", active ? "bg-primary/10 text-primary-ink" : "bg-neutral-soft text-neutral-ink")}>
                  {count}
                  <span className="sr-only">{item.label === "Approvals" ? " waiting" : " total"}</span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarBody({ data, pathname, onNavigate }: { data: ShellData; pathname: string; onNavigate?: () => void }) {
  const settingsActive = pathname.startsWith("/app/settings");
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-5">
        <Logo href="/app/tasks" subtitle="Outcome control" />
      </div>
      <nav aria-label="Workspace" className="flex-1 overflow-y-auto px-3">
        <NavLinks data={data} pathname={pathname} onNavigate={onNavigate} />
        <div className="my-4 h-px bg-line" />
        <Link
          href="/app/settings"
          onClick={onNavigate}
          aria-current={settingsActive ? "page" : undefined}
          className={cn("relative flex h-11 items-center gap-3 rounded-control px-3 text-[15px] transition-ui", settingsActive ? "bg-primary-soft font-medium text-primary-ink" : "text-ink hover:bg-neutral-soft")}
        >
          {settingsActive ? <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r bg-primary" aria-hidden /> : null}
          <Settings className={cn("size-5", settingsActive ? "text-primary" : "text-muted")} aria-hidden />
          Settings
        </Link>
      </nav>
      <div className="border-t border-line p-4">
        <div className="flex items-center gap-3 rounded-control px-1 py-1">
          <span className="flex size-9 items-center justify-center rounded-control bg-neutral-soft text-neutral-ink">
            {data.workspace.kind === "DEMO" ? <FlaskConical className="size-4" aria-hidden /> : <Building2 className="size-4" aria-hidden />}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-medium text-ink">{data.workspace.name || "Workspace"}</span>
            <span className="block truncate text-xs text-muted">{data.workspace.kind === "DEMO" ? "Isolated demo" : data.workspace.organization}</span>
          </span>
        </div>
      </div>
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
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-line bg-surface lg:block">
        <SidebarBody data={shell} pathname={pathname} />
      </aside>

      {/* Tablet/mobile drawer */}
      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/30 animate-pw-overlay lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r border-line bg-surface shadow-float animate-pw-fade-in lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Workspace navigation</DialogPrimitive.Description>
            <DialogPrimitive.Close className="absolute right-3 top-4 flex size-9 items-center justify-center rounded-control text-muted hover:bg-neutral-soft" aria-label="Close navigation">
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
            <SidebarBody data={shell} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6">
          <button type="button" className="flex size-10 items-center justify-center rounded-control text-ink hover:bg-neutral-soft lg:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
            <MenuIcon className="size-5" aria-hidden />
          </button>
          <nav aria-label="Location" className="flex min-w-0 flex-1 items-center gap-2 text-[15px]">
            <span className="hidden max-w-48 truncate text-muted md:inline">{shell.workspace.kind === "DEMO" ? "Demo workspace" : shell.workspace.organization || shell.workspace.name}</span>
            <span className="hidden text-subtle md:inline" aria-hidden>
              /
            </span>
            <span className="truncate font-medium text-ink" aria-current="page">
              {title}
            </span>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <EnvironmentBadge kind={shell.workspace.kind} adapter={shell.connection?.adapter} className="hidden sm:inline-flex" />
            {shell.workspace.writes_paused ? (
              <Badge tone="warning" className="hidden md:inline-flex" icon={<PauseCircle className="size-3.5" aria-hidden />}>
                Writes paused
              </Badge>
            ) : null}
            {shell.policy ? (
              <span className="hidden items-center gap-1.5 text-sm text-ink md:inline-flex" title={`Recovery policy version ${shell.policy.version}`}>
                {shell.policy.mode === "OBSERVE_ONLY" ? (
                  <ShieldCheck className="size-4 text-muted" aria-hidden />
                ) : (
                  <TriangleAlert className="size-4 text-warning" aria-hidden />
                )}
                {POLICY_LABELS[shell.policy.mode].short}
              </span>
            ) : null}
            <span className="hidden h-6 w-px bg-line md:block" aria-hidden />
            <AccountMenu
              displayName={shell.identity.display_name}
              email={shell.identity.email}
              secondary={shell.workspace.kind === "DEMO" ? "Isolated demo" : shell.workspace.name}
              kind={shell.identity.kind}
            />
          </div>
        </header>
        {shell.workspace.kind === "DEMO" ? <DemoBanner expiresAt={shell.workspace.expires_at} /> : null}
        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
