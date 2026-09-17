"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive, DropdownMenu as MenuPrimitive, Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/* ----------------------------- Dialog (focus trap + focus return via Radix) ----------------------------- */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  preventOutsideClose,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  preventOutsideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/35 animate-pw-overlay" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-surface border border-line bg-surface p-6 shadow-float animate-pw-fade-in",
          className,
        )}
        onPointerDownOutside={preventOutsideClose ? (e) => e.preventDefault() : undefined}
        onInteractOutside={preventOutsideClose ? (e) => e.preventDefault() : undefined}
      >
        <div className="mb-4 pr-8">
          <DialogPrimitive.Title className="text-lg font-semibold tracking-tight text-ink">{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">Dialog</DialogPrimitive.Description>}
        </div>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-control text-muted hover:bg-neutral-soft hover:text-ink" aria-label="Close">
          <X className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>{children}</div>;
}

/* ----------------------------- Dropdown menu (keyboard operable) ----------------------------- */

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({ children, align = "end", className }: { children: React.ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-56 rounded-surface border border-line bg-surface p-1.5 shadow-float animate-pw-fade-in", className)}
      >
        {children}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({ children, className, onSelect, destructive, disabled }: { children: React.ReactNode; className?: string; onSelect?: (e: Event) => void; destructive?: boolean; disabled?: boolean }) {
  return (
    <MenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-neutral-soft data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted",
        destructive && "text-danger-ink [&_svg]:text-danger",
        className,
      )}
    >
      {children}
    </MenuPrimitive.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <MenuPrimitive.Label className="px-2.5 py-1.5 text-xs text-muted">{children}</MenuPrimitive.Label>;
}

export function MenuSeparator() {
  return <MenuPrimitive.Separator className="my-1 h-px bg-line" />;
}

/* ----------------------------- Switch ----------------------------- */

export function Switch({ checked, onCheckedChange, disabled, id, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; id?: string; label: string }) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent bg-line-strong transition-ui data-[state=checked]:bg-primary disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-card transition-transform duration-150 data-[state=checked]:translate-x-[21px]" />
    </SwitchPrimitive.Root>
  );
}
