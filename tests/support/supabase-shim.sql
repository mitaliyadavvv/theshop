-- Minimal stand-in for what Supabase provides before our migrations run, so the
-- real migration + RLS policies can be tested in PGlite. Mirrors Supabase:
-- roles anon/authenticated/service_role, auth.users, auth.uid() reading the JWT
-- claims setting, and default privileges granting ALL on new public tables.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
