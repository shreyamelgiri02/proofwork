-- Proofwork migration 0004: append-only protections, immutability, grants and RLS.

set search_path = app, public;

-- ---------------------------------------------------------------------------
-- Append-only guard. Ordinary application identities cannot UPDATE/DELETE evidence
-- or audit records. The documented demo purge / retention job sets the
-- transaction-local flag `proofwork.purge = on` before deleting eligible rows.
-- ---------------------------------------------------------------------------
create or replace function app.prevent_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('proofwork.purge', true), 'off') = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'Table %.% is append-only (% blocked)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['observations', 'decisions', 'audit_events', 'claim_receipts', 'policy_versions', 'approval_decisions', 'operation_events', 'interventions', 'correctness_reviews']
  loop
    execute format('create trigger %I_append_only before update or delete on app.%I for each row execute function app.prevent_mutation()', t, t);
  end loop;
end
$$;

-- Observations may only be flagged as discarded (fenced late read); nothing else changes.
drop trigger observations_append_only on app.observations;
create or replace function app.observations_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('proofwork.purge', true), 'off') = 'on' then return old; end if;
    raise exception 'observations are append-only' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'discarded') is distinct from (to_jsonb(old) - 'discarded') then
    raise exception 'observations are immutable except the discarded flag' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger observations_guard before update or delete on app.observations for each row execute function app.observations_guard();

-- Authorized requests: binding and boundary fields are immutable. Only lifecycle status changes.
create or replace function app.authorized_requests_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('proofwork.purge', true), 'off') = 'on' then return old; end if;
    raise exception 'authorized requests cannot be deleted' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - array['status', 'status_changed_at', 'status_reason', 'superseded_by'])
     is distinct from (to_jsonb(old) - array['status', 'status_changed_at', 'status_reason', 'superseded_by']) then
    raise exception 'authorized request fields are immutable; create a new version instead' using errcode = 'P0001';
  end if;
  if old.status <> 'ACTIVE' and new.status <> old.status then
    raise exception 'an inactive request cannot be reactivated' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger authorized_requests_guard before update or delete on app.authorized_requests for each row execute function app.authorized_requests_guard();

-- Operation records must survive while a possibly dispatched write is unresolved.
create or replace function app.recovery_operations_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.resolved_at is null and old.dispatch_count > 0 then
      raise exception 'cannot delete an unresolved, possibly dispatched operation' using errcode = 'P0001';
    end if;
    if coalesce(current_setting('proofwork.purge', true), 'off') = 'on' then return old; end if;
    raise exception 'recovery operations cannot be deleted' using errcode = 'P0001';
  end if;
  if new.idempotency_key <> old.idempotency_key or new.parameters <> old.parameters or new.proposal_id <> old.proposal_id then
    raise exception 'operation key, parameters and proposal binding are immutable' using errcode = 'P0001';
  end if;
  if new.dispatch_count < old.dispatch_count then
    raise exception 'dispatch count cannot decrease' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger recovery_operations_guard before update or delete on app.recovery_operations for each row execute function app.recovery_operations_guard();

-- updated_at maintenance
create or replace function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['profiles', 'workspaces', 'connections', 'tasks', 'recovery_proposals', 'recovery_operations', 'jobs']
  loop
    execute format('create trigger %I_touch before update on app.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants: only the application service role reads/writes. Browser roles get nothing.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema app to proofwork_app;
alter default privileges in schema app grant select, insert, update, delete on tables to proofwork_app;
grant execute on all functions in schema app to proofwork_app;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema app from anon';
    execute 'revoke all on all functions in schema app from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke insert, update, delete on all tables in schema app from authenticated';
    execute 'revoke all on all functions in schema app from authenticated';
  end if;
end
$$;
revoke all on all functions in schema app from public;
grant execute on all functions in schema app to proofwork_app;

-- ---------------------------------------------------------------------------
-- Row-level security (defense in depth). The server role bypasses RLS, so every
-- service ALSO filters by the resolved workspace. Member-read policies apply if a
-- future read path grants `authenticated` SELECT on these tables.
-- ---------------------------------------------------------------------------
create or replace function app.is_workspace_member(target uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.memberships m
    where m.workspace_id = target and m.user_id = auth.uid()
  );
$$;
revoke all on function app.is_workspace_member(uuid) from public;

do $$
declare t text;
begin
  foreach t in array array['workspaces', 'memberships', 'policy_versions', 'connections', 'agent_credentials', 'registration_previews', 'authorized_requests', 'tasks', 'claim_receipts', 'ingestion_rejections', 'observations', 'decisions', 'recovery_proposals', 'approval_decisions', 'recovery_operations', 'operation_events', 'jobs', 'audit_events', 'interventions', 'correctness_reviews', 'rate_limits', 'worker_heartbeats', 'profiles']
  loop
    execute format('alter table app.%I enable row level security', t);
  end loop;
end
$$;

create policy workspaces_member_read on app.workspaces for select to authenticated using (app.is_workspace_member(id));
create policy profiles_self_read on app.profiles for select to authenticated using (user_id = auth.uid());
do $$
declare t text;
begin
  -- Member read-only visibility for evidence and history. Secrets-bearing tables
  -- (agent_credentials, registration_previews, jobs, rate_limits, heartbeats) get no policy.
  foreach t in array array['memberships', 'policy_versions', 'connections', 'authorized_requests', 'tasks', 'claim_receipts', 'observations', 'decisions', 'recovery_proposals', 'approval_decisions', 'recovery_operations', 'operation_events', 'audit_events', 'interventions', 'correctness_reviews']
  loop
    execute format('create policy %I on app.%I for select to authenticated using (app.is_workspace_member(workspace_id))', t || '_member_read', t);
  end loop;
end
$$;
