"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number | null;
}

/**
 * Filter tabs implemented as an ARIA tablist with roving focus (Left/Right/Home/End).
 * Used for result filters, where each tab re-queries the server.
 */
export function FilterTabs<K extends string>({
  items,
  value,
  onChange,
  label,
  variant = "underline",
  controls,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  variant?: "underline" | "pill";
  controls?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next].key);
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex max-w-full gap-1 overflow-x-auto overflow-y-hidden", variant === "underline" ? "border-b border-line" : "flex-wrap gap-2")}
    >
      {items.map((item, i) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm transition-ui",
              variant === "underline" &&
                cn("-mb-px border-b-2 px-3 py-2.5", selected ? "border-primary font-medium text-primary-ink" : "border-transparent text-muted hover:text-ink"),
              variant === "pill" &&
                cn("rounded-control border px-3 py-1.5", selected ? "border-primary/30 bg-primary-soft font-medium text-primary-ink" : "border-line bg-surface text-muted hover:text-ink"),
            )}
          >
            {item.label}
            {item.count != null ? (
              <span className={cn("rounded-md px-1.5 py-px text-xs tabular", selected ? "bg-primary/10 text-primary-ink" : "bg-neutral-soft text-neutral-ink")}>{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
