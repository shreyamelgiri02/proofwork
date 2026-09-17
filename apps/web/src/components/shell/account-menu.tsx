"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, KeyRound, LogOut, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { initials } from "@proofwork/domain";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function AccountMenu({
  displayName,
  email,
  secondary,
  kind,
  compact,
  prefix,
}: {
  displayName: string;
  email: string | null;
  secondary?: string | null;
  kind: "user" | "demo";
  compact?: boolean;
  prefix?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = React.useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await apiFetch("/api/auth/sign-out", { method: "POST", body: {} });
    } finally {
      // Clear all workspace-specific cached data.
      queryClient.clear();
      router.replace("/");
      router.refresh();
    }
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className="flex items-center gap-2.5 rounded-control px-1.5 py-1 text-left transition-ui hover:bg-neutral-soft" aria-label={`Account menu for ${displayName}`}>
          {prefix ? <span className="hidden text-sm text-muted lg:inline">{prefix}</span> : null}
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", kind === "demo" ? "bg-warning-soft text-warning-ink" : "bg-neutral-soft text-ink")}>
            {kind === "demo" ? "DO" : initials(displayName)}
          </span>
          {!compact ? (
            <span className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="truncate text-sm font-medium text-ink">{displayName}</span>
              {secondary ? <span className="truncate text-xs text-muted">{secondary}</span> : null}
            </span>
          ) : null}
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>
          <span className="block text-sm font-medium text-ink">{displayName}</span>
          {email ? <span className="block truncate">{email}</span> : <span className="block">Isolated demo session</span>}
        </MenuLabel>
        <MenuSeparator />
        <MenuItem onSelect={() => router.push("/app/settings")}>
          <Settings aria-hidden /> Settings
        </MenuItem>
        {kind === "user" ? (
          <MenuItem onSelect={() => router.push("/forgot-password")}>
            <KeyRound aria-hidden /> Reset password
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem onSelect={signOut} disabled={signingOut}>
          <LogOut aria-hidden /> {kind === "demo" ? "Leave demo" : "Sign out"}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
