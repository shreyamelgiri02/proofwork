"use client";

import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ApiClientError, apiFetch } from "@/lib/api-client";

/** Starts (or resumes) the visitor's isolated demo through POST /api/demo. */
export function ExploreDemoButton({ children = "Explore live demo", icon = false, ...props }: ButtonProps & { icon?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const start = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch<{ redirect: string }>("/api/demo", { method: "POST", body: {} });
      router.push(res.redirect);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "The demo could not start. Try again.");
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={start} loading={pending} {...props}>
        {icon && !pending ? <FlaskConical aria-hidden /> : null}
        {pending ? "Preparing isolated demo…" : children}
      </Button>
      {error ? (
        <p role="alert" className="max-w-sm text-[13px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
