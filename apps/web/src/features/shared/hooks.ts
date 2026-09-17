"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import type { ShellData } from "@/components/shell/app-shell";
import { apiFetch } from "@/lib/api-client";

export function useShell() {
  return useQuery({ queryKey: ["session"], queryFn: () => apiFetch<ShellData>("/api/session"), staleTime: 15_000 });
}

export function useTimezone(): string {
  const { data } = useShell();
  return data?.workspace.timezone ?? "UTC";
}

/** Keep filter state in the URL so back links and reloads preserve it. */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const values = React.useMemo(() => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const v = params.get(key);
      if (v != null) (out as Record<string, string>)[key] = v;
    }
    return out;
  }, [params, defaults]);
  const set = React.useCallback(
    (patch: Partial<T>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "" || v === defaults[k]) next.delete(k);
        else next.set(k, String(v));
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, defaults],
  );
  return [values, set, params.toString()] as const;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
