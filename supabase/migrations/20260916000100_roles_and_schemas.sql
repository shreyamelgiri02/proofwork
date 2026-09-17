-- Proofwork migration 0001: roles and schemas.
-- Application data lives in schema `app`; the independent billing source lives in
-- schema `billing_sandbox`. Neither schema is exposed through the Supabase Data API
-- (only `public` / `graphql_public` are listed in supabase/config.toml).
--
-- Roles are created NOLOGIN here. `npm run db:migrate` grants LOGIN and sets
-- passwords from DATABASE_URL / SANDBOX_DATABASE_URL so secrets never live in SQL.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'proofwork_app') then
    -- Application services and worker. BYPASSRLS because server services enforce
    -- workspace scoping explicitly; RLS remains as defense in depth for any
    -- authenticated/anon access path.
    create role proofwork_app nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'billing_sandbox_service') then
    -- Independent billing sandbox. No access to `app`.
    create role billing_sandbox_service nologin;
  end if;
end
$$;

create schema if not exists app;
create schema if not exists billing_sandbox;

revoke all on schema app from public;
revoke all on schema billing_sandbox from public;

-- Browser-facing Supabase roles never touch application or source tables directly.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema app from anon';
    execute 'revoke all on schema billing_sandbox from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema billing_sandbox from authenticated';
  end if;
end
$$;

grant usage on schema app to proofwork_app;
grant usage on schema billing_sandbox to billing_sandbox_service;
revoke all on schema app from billing_sandbox_service;
revoke all on schema billing_sandbox from proofwork_app;
