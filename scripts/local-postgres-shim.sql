-- Compatibility shim for plain PostgreSQL (NOT used with Supabase).
-- Applied automatically by scripts/migrate.ts only when the `auth` schema is absent,
-- e.g. the project-local cluster from `npm run db:local:start`.
-- It creates the minimal objects the migrations reference. It does NOT provide
-- authentication: sign-up/sign-in still require Supabase Auth and show "Requires setup".

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
