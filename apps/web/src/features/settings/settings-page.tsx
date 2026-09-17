"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CircleCheck, CreditCard, Database, Info, KeyRound, LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import {
  HEALTH_LABELS,
  POLICY_LABELS,
  formatDateTime,
  formatRelative,
  initials,
  workspaceProfileSchema,
  type ConnectionHealth,
  type PolicyMode,
  type WorkspaceProfileInput,
} from "@proofwork/domain";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { CopyButton, useToast } from "@/components/ui/feedback";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent, DialogFooter, Switch } from "@/components/ui/overlay";
import { Alert, Badge, Card, CardHeader, Mono, Skeleton } from "@/components/ui/primitives";
import { PolicyOptions, useTimezones } from "@/features/onboarding/onboarding-wizard";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface ConnectionRow {
  id: string;
  adapter: "LOCAL_SANDBOX" | "STRIPE_TEST";
  source_account_id: string | null;
  display_name: string;
  is_active: boolean;
  health: ConnectionHealth;
  config_version: number;
  api_version: string | null;
  binding_method: string | null;
  last_checked_at: string | null;
  last_successful_read_at: string | null;
  last_error_code: string | null;
}

interface SettingsResponse {
  workspace: { id: string; kind: "PRIVATE" | "DEMO"; organization: string; name: string; timezone: string; writes_paused: boolean; writes_paused_reason: string | null; writes_paused_at: string | null; current_policy_version: number | null; expires_at: string | null };
  policies: { version: number; mode: PolicyMode; changed_by_label: string; change_reason: string; created_at: string }[];
  connections: { connections: ConnectionRow[]; local_sandbox: { configured: boolean }; stripe: { configured: boolean; reason: string | null; api_version: string } };
  tokens: { id: string; name: string; token_prefix: string; scope: string; created_by_label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[];
  health: {
    worker: { status: "HEALTHY" | "STALE" | "NEVER_SEEN"; name: string | null; last_completed_at: string | null; last_error_code: string | null; guidance: string | null };
    queue: { ready: number; leased: number; dead: number; overdue_seconds: number; backlog: boolean; expired_leases: number };
    operations: { unresolved: number; escalated: number };
    limits: Record<string, number>;
  };
  account: { kind: "user" | "demo"; display_name: string; email: string | null; role: string; expires_at?: string };
  ingestion: { endpoint: string };
}

export function SettingsPage() {
  const query = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<SettingsResponse>("/api/settings"), refetchInterval: 30_000 });
  const d = query.data;
  const [dirty, setDirty] = React.useState<Record<string, boolean>>({});
  const markDirty = React.useCallback((key: string, v: boolean) => setDirty((prev) => (prev[key] === v ? prev : { ...prev, [key]: v })), []);
  const anyDirty = Object.values(dirty).some(Boolean);

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Workspace identity, recovery authority, and evidence sources."
        actions={
          d ? (
            <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
              {anyDirty ? (
                <>
                  <Info className="size-4 text-warning" aria-hidden /> Unsaved changes in a section
                </>
              ) : (
                <>
                  <CircleCheck className="size-4 text-success" aria-hidden /> All changes saved
                </>
              )}
            </p>
          ) : null
        }
      />
      {query.isError ? (
        <Alert tone="danger" title="Settings could not be loaded">
          {query.error instanceof ApiClientError ? query.error.message : "Try again."}
        </Alert>
      ) : null}
      {query.isPending ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : d ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <ProfileSection d={d} onDirty={(v) => markDirty("profile", v)} />
          <PolicySection d={d} onDirty={(v) => markDirty("policy", v)} />
          <SourcesSection d={d} />
          <AccountSection d={d} />
          <IngestionSection d={d} />
          <OperationsSection d={d} />
        </div>
      ) : null}
    </div>
  );
}

function useSettingsRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["settings"] }), qc.invalidateQueries({ queryKey: ["session"] })]);
}

function ProfileSection({ d, onDirty }: { d: SettingsResponse; onDirty: (v: boolean) => void }) {
  const timezones = useTimezones();
  const toast = useToast();
  const refresh = useSettingsRefresh();
  const [error, setError] = React.useState<string | null>(null);
  const demo = d.workspace.kind === "DEMO";
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<WorkspaceProfileInput>({
    resolver: zodResolver(workspaceProfileSchema),
    defaultValues: { organization: d.workspace.organization, name: d.workspace.name, timezone: d.workspace.timezone },
  });
  React.useEffect(() => onDirty(isDirty), [isDirty, onDirty]);
  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch("/api/settings/profile", { method: "PATCH", body: values });
      reset(values);
      toast.push({ tone: "success", title: "Workspace profile saved" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save.");
    }
  });
  return (
    <Card className="p-6">
      <CardHeader title="Workspace profile" description="Basic information about this workspace." />
      <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
        {demo ? <Alert tone="neutral">The demo workspace identity is fixed.</Alert> : null}
        <FormError message={error} />
        <Field id="s-org" label="Organization" hint="Your company or organization name." error={errors.organization?.message}>
          {(a) => <Input {...a} disabled={demo} {...register("organization")} />}
        </Field>
        <Field id="s-name" label="Workspace" hint="A short name for this workspace." error={errors.name?.message}>
          {(a) => <Input {...a} disabled={demo} {...register("name")} />}
        </Field>
        <Field id="s-tz" label="Timezone" hint="Used for displayed timestamps. Evidence is stored in UTC." error={errors.timezone?.message}>
          {(a) => (
            <Select {...a} disabled={demo} {...register("timezone")}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end pt-2">
          <Button type="submit" loading={isSubmitting} disabled={demo || !isDirty}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PolicySection({ d, onDirty }: { d: SettingsResponse; onDirty: (v: boolean) => void }) {
  const current = d.policies[0]?.mode ?? "REQUIRE_APPROVAL";
  const [draft, setDraft] = React.useState<PolicyMode | null>(null);
  const mode = draft ?? current;
  const setMode = (m: PolicyMode) => setDraft(m === current ? null : m);
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmAuto, setConfirmAuto] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const refresh = useSettingsRefresh();
  React.useEffect(() => onDirty(mode !== current), [mode, current, onDirty]);

  const save = async (confirmed = false) => {
    if (mode === "AUTO_RECOVER" && !confirmed) {
      setConfirmOpen(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch<{ message: string }>("/api/settings/policy", { body: { mode, reason, confirmAutoRecover: confirmed } });
      toast.push({ tone: "success", title: "Recovery policy saved", description: res.message });
      setReason("");
      setDraft(null);
      setConfirmOpen(false);
      setConfirmAuto(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save the policy.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="p-6">
      <CardHeader title="Recovery policy" description="Controls when Proofwork can act on your behalf." action={<Badge tone="neutral">Policy version {d.workspace.current_policy_version ?? "—"}</Badge>} />
      <PolicyOptions value={mode} onChange={setMode} className="mt-5" compact />
      {mode !== current ? (
        <div className="mt-3 space-y-3">
          <Field id="policy-reason" label="Reason for change (optional)">
            {(a) => <Input {...a} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <p className="text-[13px] text-muted">Saving creates a new immutable policy version. Proposals prepared under the previous version are invalidated and re-evaluated.</p>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(current)}>
              Cancel
            </Button>
            <Button onClick={() => save()} loading={pending}>
              Save policy
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent title="Allow automatic recovery?" description="Proofwork will automatically schedule cancellation at the authorized paid-period end for verified missing schedules. This is the only supported action; every write still requires a fresh precheck, no pause, no cutoff, and an independent read afterwards.">
          <label className="flex gap-3 text-sm">
            <Checkbox checked={confirmAuto} onChange={(e) => setConfirmAuto(e.target.checked)} />I understand and authorize this single action.
          </label>
          <FormError message={error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button disabled={!confirmAuto} loading={pending} onClick={() => save(true)}>
              Enable auto-recover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PauseControl d={d} />
      {d.policies.length > 1 ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-primary-ink">Policy history</summary>
          <ul className="mt-2 space-y-1 text-muted">
            {d.policies.map((p) => (
              <li key={p.version}>
                v{p.version} · {POLICY_LABELS[p.mode].label} · {p.changed_by_label} · {formatDateTime(p.created_at, d.workspace.timezone)}
                {p.change_reason ? ` · “${p.change_reason}”` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function PauseControl({ d }: { d: SettingsResponse }) {
  const [reason, setReason] = React.useState(d.workspace.writes_paused_reason ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();
  const refresh = useSettingsRefresh();
  const toggle = async (paused: boolean) => {
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch<{ message: string }>("/api/settings/pause", { body: { paused, reason } });
      toast.push({ tone: paused ? "info" : "success", title: paused ? "Recovery writes paused" : "Recovery writes resumed", description: res.message });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not change the write pause.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium" id="pause-label">
            Pause recovery writes
          </p>
          <p className="text-sm text-muted">Stop new cancellation writes. Reads, verification and reconciliation continue.</p>
        </div>
        <Switch checked={d.workspace.writes_paused} onCheckedChange={toggle} disabled={pending} label="Pause recovery writes" />
      </div>
      <div className="mt-3">
        <Field id="pause-reason" label="Reason (optional)">
          {(a) => <Textarea {...a} rows={2} value={reason} maxLength={200} placeholder="e.g. maintenance, policy review" onChange={(e) => setReason(e.target.value)} disabled={d.workspace.writes_paused} />}
        </Field>
        <p className="mt-1 text-right text-xs text-muted">{reason.length}/200</p>
      </div>
      <FormError message={error} />
      <div className="mt-2 flex gap-2 rounded-control bg-info-soft px-3 py-2 text-[13px] text-info-ink">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {d.workspace.writes_paused
            ? `Paused ${d.workspace.writes_paused_at ? formatRelative(d.workspace.writes_paused_at) : ""}. Verification continues while paused. An operation already dispatched may still take effect and will be reconciled.`
            : "Verification continues while paused. Operations already dispatched are reconciled, not undone."}
        </span>
      </div>
    </div>
  );
}

function HealthBadge({ health }: { health: ConnectionHealth }) {
  const h = HEALTH_LABELS[health];
  return <Badge tone={h.tone}>{h.label}</Badge>;
}

function SourcesSection({ d }: { d: SettingsResponse }) {
  const toast = useToast();
  const refresh = useSettingsRefresh();
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ message: string; ref?: string } | null>(null);
  const local = d.connections.connections.find((c) => c.adapter === "LOCAL_SANDBOX");
  const stripe = d.connections.connections.find((c) => c.adapter === "STRIPE_TEST");
  const demo = d.workspace.kind === "DEMO";
  const tz = d.workspace.timezone;

  const act = async (action: "configure" | "check" | "activate", adapter: "LOCAL_SANDBOX" | "STRIPE_TEST") => {
    setPending(`${action}:${adapter}`);
    setError(null);
    try {
      const res = await apiFetch<{ connection: ConnectionRow }>("/api/settings/connections", { body: { action, adapter } });
      toast.push({ tone: res.connection.health === "CONNECTED" ? "success" : "error", title: `${res.connection.display_name}: ${HEALTH_LABELS[res.connection.health].label}` });
      await refresh();
    } catch (err) {
      setError({ message: err instanceof ApiClientError ? err.message : "The source action failed.", ref: err instanceof ApiClientError ? err.correlationId : undefined });
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="p-6">
      <CardHeader title="Evidence sources" description="Sources used to verify subscription and billing information. Secrets are never shown here." />
      <div className="mt-5 space-y-3">
        <SourceBox
          icon={<Database aria-hidden />}
          title="Local billing sandbox"
          tone={local?.is_active ? "active" : "idle"}
          badges={
            <>
              {local ? <HealthBadge health={local.health} /> : <Badge tone={d.connections.local_sandbox.configured ? "neutral" : "warning"}>{d.connections.local_sandbox.configured ? "Not configured" : "Requires setup"}</Badge>}
              {local?.is_active ? <Badge tone="info">In use</Badge> : null}
            </>
          }
          body="Independent synthetic billing service with isolated records. Simulated data — not live billing."
          meta={
            local ? (
              <>
                Account <Mono className="text-xs">{local.source_account_id}</Mono> · last successful read {local.last_successful_read_at ? formatDateTime(local.last_successful_read_at, tz) : "never"}
                {local.last_error_code ? ` · last error ${local.last_error_code}` : ""}
              </>
            ) : !d.connections.local_sandbox.configured ? (
              "Set SANDBOX_API_URL and sandbox tokens, then run npm run dev:sandbox."
            ) : null
          }
          actions={
            <>
              {local ? (
                <Button size="sm" variant="secondary" loading={pending === "check:LOCAL_SANDBOX"} onClick={() => act("check", "LOCAL_SANDBOX")}>
                  Check connection
                </Button>
              ) : !demo ? (
                <Button size="sm" variant="secondary" disabled={!d.connections.local_sandbox.configured} loading={pending === "configure:LOCAL_SANDBOX"} onClick={() => act("configure", "LOCAL_SANDBOX")}>
                  Configure
                </Button>
              ) : null}
              {local && !local.is_active && !demo ? (
                <Button size="sm" disabled={local.health !== "CONNECTED"} loading={pending === "activate:LOCAL_SANDBOX"} onClick={() => act("activate", "LOCAL_SANDBOX")}>
                  Use for new requests
                </Button>
              ) : null}
            </>
          }
        />
        <SourceBox
          icon={<CreditCard aria-hidden />}
          title="Stripe test mode"
          tone={stripe?.is_active ? "active" : "idle"}
          badges={
            <>
              {stripe ? <HealthBadge health={stripe.health} /> : <Badge tone="neutral">{d.connections.stripe.configured ? "Configured · not checked" : "Not configured"}</Badge>}
              {stripe?.is_active ? <Badge tone="info">In use</Badge> : null}
            </>
          }
          body={demo ? "Demo workspaces cannot use external billing sources." : "Server-side test-mode adapter. Live-mode keys and resources are rejected. A credential being present is not a connection — the account is validated first."}
          meta={
            stripe ? (
              <>
                Account <Mono className="text-xs">{stripe.source_account_id ?? "not bound"}</Mono> · API {stripe.api_version ?? d.connections.stripe.api_version} · last read {stripe.last_successful_read_at ? formatDateTime(stripe.last_successful_read_at, tz) : "never"}
                {stripe.last_error_code ? ` · last error ${stripe.last_error_code}` : ""}
              </>
            ) : !demo && !d.connections.stripe.configured ? (
              <>To configure: set STRIPE_TEST_SECRET_KEY (sk_test_/rk_test_) and PROOFWORK_STRIPE_WORKSPACE_ID={d.workspace.id} on the server, restart, then check the connection. {d.connections.stripe.reason}</>
            ) : null
          }
          actions={
            demo ? null : (
              <>
                <Button size="sm" variant="secondary" disabled={!d.connections.stripe.configured} loading={pending === (stripe ? "check:STRIPE_TEST" : "configure:STRIPE_TEST")} onClick={() => act(stripe ? "check" : "configure", "STRIPE_TEST")}>
                  {stripe ? "Check connection" : "Validate account"}
                </Button>
                {stripe && !stripe.is_active ? (
                  <Button size="sm" disabled={stripe.health !== "CONNECTED"} loading={pending === "activate:STRIPE_TEST"} onClick={() => act("activate", "STRIPE_TEST")}>
                    Use for new requests
                  </Button>
                ) : null}
              </>
            )
          }
        />
        <FormError message={error?.message} reference={error?.ref} />
        <p className="text-[13px] text-muted">Existing requests keep the source they were authorized against. The selected source applies to new requests.</p>
      </div>
    </Card>
  );
}

function SourceBox({ icon, title, badges, body, meta, actions, tone }: { icon: React.ReactNode; title: string; badges: React.ReactNode; body: string; meta?: React.ReactNode; actions?: React.ReactNode; tone: "active" | "idle" }) {
  return (
    <div className={cn("rounded-control border p-4", tone === "active" ? "border-success/25 bg-success-soft/40" : "border-line bg-surface-muted")}>
      <div className="flex gap-4">
        <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-control [&_svg]:size-6", tone === "active" ? "bg-success-soft text-success-ink" : "bg-neutral-soft text-neutral-ink")}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{title}</p>
            {badges}
          </div>
          <p className="mt-1 text-sm text-muted">{body}</p>
          {meta ? <p className="mt-2 break-words text-xs text-muted">{meta}</p> : null}
          {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

function AccountSection({ d }: { d: SettingsResponse }) {
  const router = useRouter();
  const qc = useQueryClient();
  const signOut = async () => {
    await apiFetch("/api/auth/sign-out", { body: {} }).catch(() => undefined);
    qc.clear();
    router.replace("/");
    router.refresh();
  };
  return (
    <Card className="p-6">
      <CardHeader title="Workspace access" description="Who can manage settings for this workspace." />
      <div className="mt-5 flex items-center gap-4">
        <span className="flex size-12 items-center justify-center rounded-full bg-neutral-soft text-[15px] font-semibold">{d.account.kind === "demo" ? "DO" : initials(d.account.display_name)}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{d.account.display_name}</p>
          <p className="truncate text-sm text-muted">{d.account.email ?? "Anonymous isolated demo session"}</p>
        </div>
        <Badge tone="info">{d.account.kind === "demo" ? "Demo operator" : "Owner"}</Badge>
      </div>
      <p className="mt-3 text-sm text-muted">
        {d.account.kind === "demo"
          ? `Isolated demo. Expires ${d.workspace.expires_at ? formatDateTime(d.workspace.expires_at, d.workspace.timezone) : "soon"}; data is purged after the retention window.`
          : "Persistent private workspace with one owner. Team members are not supported in this release."}
      </p>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
        {d.account.kind === "user" ? (
          <Button asChild variant="secondary" size="sm">
            <Link href="/forgot-password">
              <KeyRound aria-hidden /> Reset password
            </Link>
          </Button>
        ) : (
          <Button asChild variant="secondary" size="sm">
            <Link href="/sign-up">Create a private workspace</Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut aria-hidden /> {d.account.kind === "demo" ? "Leave demo" : "Sign out"}
        </Button>
      </div>
    </Card>
  );
}

function IngestionSection({ d }: { d: SettingsResponse }) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("Support agent");
  const [created, setCreated] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<SettingsResponse["tokens"][number] | null>(null);
  const toast = useToast();
  const refresh = useSettingsRefresh();
  const demo = d.workspace.kind === "DEMO";
  const tz = d.workspace.timezone;
  const endpoint = d.ingestion.endpoint || "/api/v1/claims";
  const curl = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer pwk_xxxxxxxx_REPLACE_WITH_TOKEN" \\
  -H "Idempotency-Key: support-run-1042-attempt-1" \\
  -H "Content-Type: application/json" \\
  -d '{"authorized_request_id":"REQUEST_UUID","agent":{"name":"Support Agent"},"report_text":"Cancellation scheduled for the end of the current paid period."}'`;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch<{ token: string }>("/api/settings/tokens", { body: { name } });
      setCreated(res.token);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create the token.");
    } finally {
      setPending(false);
    }
  };
  const revoke = async () => {
    if (!revoking) return;
    setPending(true);
    try {
      await apiFetch(`/api/settings/tokens/${revoking.id}/revoke`, { body: {} });
      toast.push({ tone: "success", title: "Token revoked", description: `${revoking.token_prefix}… can no longer submit claims.` });
      setRevoking(null);
      await refresh();
    } catch (err) {
      toast.push({ tone: "error", title: "Token not revoked", description: err instanceof ApiClientError ? err.message : "Try again." });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="p-6 lg:col-span-2">
      <CardHeader
        title="Agent ingestion"
        description="Scoped tokens let an external AI employee submit completion claims. Tokens are shown once and stored only as hashes."
        action={
          <Button
            size="sm"
            disabled={demo}
            onClick={() => {
              setCreated(null);
              setError(null);
              setCreateOpen(true);
            }}
          >
            <Plus aria-hidden /> Create token
          </Button>
        }
      />
      {demo ? <Alert tone="neutral" className="mt-4">Ingestion tokens are not available in the demo. Use Submit report instead, or create a private workspace.</Alert> : null}
      <div tabIndex={0} role="region" aria-label="Ingestion tokens" className="mt-4 overflow-x-auto rounded-control border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Ingestion tokens</caption>
          <thead className="bg-surface-muted text-[13px] text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Prefix</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Scope</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Created</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Last used</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-4 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.tokens.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted">
                  No tokens yet.
                </td>
              </tr>
            ) : (
              d.tokens.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3">{t.name}</td>
                  <td className="px-4 py-3">
                    <Mono>{t.token_prefix}…</Mono>
                  </td>
                  <td className="px-4 py-3">
                    <Mono>{t.scope}</Mono>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {formatDateTime(t.created_at, tz)} · {t.created_by_label}
                  </td>
                  <td className="px-4 py-3 text-muted">{t.last_used_at ? formatRelative(t.last_used_at) : "Never"}</td>
                  <td className="px-4 py-3">{t.revoked_at ? <Badge tone="neutral">Revoked</Badge> : <Badge tone="success">Active</Badge>}</td>
                  <td className="px-4 py-3 text-right">
                    {!t.revoked_at ? (
                      <Button size="sm" variant="danger" onClick={() => setRevoking(t)}>
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="text-sm font-medium">Endpoint</p>
          <p className="mt-1 flex items-center gap-1">
            <Mono className="truncate">POST {endpoint}</Mono>
            <CopyButton value={endpoint} label="endpoint" />
          </p>
          <p className="mt-3 flex items-center justify-between text-sm font-medium">
            Example request <CopyButton value={curl} label="example request" />
          </p>
          <pre tabIndex={0} role="region" aria-label="Example ingestion request" className="mt-1 overflow-x-auto rounded-control bg-surface-muted p-3 font-mono text-[12px] leading-relaxed">{curl}</pre>
          <p className="mt-2 text-[13px] text-muted">
            Returns <Mono className="text-xs">202 Accepted</Mono> with receipt and task IDs. Acceptance is never a verified outcome. The same Idempotency-Key with a different body returns <Mono className="text-xs">409</Mono>.
          </p>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent title={created ? "Copy your token now" : "Create ingestion token"} description={created ? "This is the only time the full token is shown. Store it in the agent's server-side configuration." : "The token can only submit claims for this workspace and can be revoked at any time."} preventOutsideClose={Boolean(created)}>
          {created ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-control border border-line bg-surface-muted p-3">
                <Mono className="min-w-0 flex-1 break-all">{created}</Mono>
                <CopyButton value={created} label="token" />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>I’ve stored the token</Button>
                </DialogClose>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={create} className="space-y-4">
              <Field id="token-name" label="Token name">
                {(a) => <Input {...a} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <FormError message={error} />
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" loading={pending} disabled={!name.trim()}>
                  Create token
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent title="Revoke this token?" description={`Agents using ${revoking?.token_prefix ?? ""}… will immediately be unable to submit claims. Existing receipts and tasks are kept.`}>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="dangerSolid" loading={pending} onClick={revoke}>
              Revoke token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function OperationsSection({ d }: { d: SettingsResponse }) {
  const h = d.health;
  const tz = d.workspace.timezone;
  return (
    <Card className="p-6 lg:col-span-2">
      <CardHeader title="Operating limits and health" description="Server-enforced limits and the actual state of background processing." />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Limit label="Read freshness" value={`${h.limits.read_freshness_seconds}s`} note="Maximum age of the fresh read before a write. Not a polling frequency." />
        <Limit label="Approval window" value={`${Math.round(h.limits.approval_window_seconds / 60)} min`} note="Time to approve a proposal before it expires." />
        <Limit label="Recovery cutoff" value={`${h.limits.recovery_cutoff_seconds}s`} note="No new write this close to the authorized period end." />
        <Limit label="Write attempts" value={`${h.limits.max_write_dispatches}`} note="Dispatches per operation, always with the same key." />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-control border border-line p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4 text-muted" aria-hidden /> Worker
          </p>
          <p className="mt-2">
            <Badge tone={h.worker.status === "HEALTHY" ? "success" : "warning"}>{h.worker.status === "HEALTHY" ? "Running" : h.worker.status === "STALE" ? "Delayed" : "Not seen"}</Badge>
          </p>
          <p className="mt-2 text-[13px] text-muted">Last completed cycle: {h.worker.last_completed_at ? formatDateTime(h.worker.last_completed_at, tz) : "never"}</p>
          {h.worker.guidance ? <p className="mt-1 text-[13px] text-warning-ink">{h.worker.guidance}</p> : null}
        </div>
        <div className="rounded-control border border-line p-4">
          <p className="text-sm font-medium">Queue (this workspace)</p>
          <p className="mt-2 text-[13px] text-muted">
            {h.queue.ready} ready · {h.queue.leased} in progress · {h.queue.dead} exhausted
          </p>
          <p className="mt-1 text-[13px] text-muted">{h.queue.backlog ? `Oldest due job overdue by ${h.queue.overdue_seconds}s.` : "No overdue backlog."}</p>
        </div>
        <div className="rounded-control border border-line p-4">
          <p className="text-sm font-medium">Recovery operations</p>
          <p className="mt-2 text-[13px] text-muted">
            {h.operations.unresolved} unresolved · {h.operations.escalated} escalated
          </p>
          <p className="mt-1 text-[13px] text-muted">Unresolved operations block new writes for the same subscription until reconciled.</p>
        </div>
      </div>
    </Card>
  );
}

function Limit({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-control border border-line p-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      <p className="mt-1 text-[13px] text-muted">{note}</p>
    </div>
  );
}
