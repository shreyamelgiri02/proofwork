"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, RotateCcw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/feedback";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/overlay";
import { ApiClientError, apiFetch } from "@/lib/api-client";

function minutesLeft(expiresAt: string | null) {
  if (!expiresAt) return null;
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000));
}

export function DemoBanner({ expiresAt }: { expiresAt: string | null }) {
  const [left, setLeft] = React.useState(() => minutesLeft(expiresAt));
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  React.useEffect(() => {
    const t = window.setInterval(() => setLeft(minutesLeft(expiresAt)), 30_000);
    return () => window.clearInterval(t);
  }, [expiresAt]);

  const reset = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch<{ message: string }>("/api/demo/reset", { body: { confirm: true } });
      await queryClient.invalidateQueries();
      setOpen(false);
      toast.push({ tone: "success", title: "Demo reset", description: res.message });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "The demo could not be reset.");
    } finally {
      setPending(false);
    }
  };

  return (
    <aside aria-label="Demo session" className="border-b border-warning/25 bg-warning-soft">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm text-warning-ink sm:px-6 lg:px-8">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <p className="flex-1">
          <strong className="font-semibold">Demo · Simulated billing data.</strong> Your actions affect only this isolated demo session.
          {left != null ? <span className="ml-1">{left > 0 ? `Session expires in about ${left} min.` : "This session has expired."}</span> : null}
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <RotateCcw aria-hidden /> Reset demo
          </Button>
          <DialogContent title="Reset this demo?" description="This deletes this demo's tasks, requests, evidence and activity, resets its synthetic billing records, and recreates the starter scenarios. No other workspace is affected.">
            {error ? (
              <p role="alert" className="text-sm text-danger-ink">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DialogClose>
              <Button variant="dangerSolid" loading={pending} onClick={reset}>
                Reset demo records
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </aside>
  );
}
