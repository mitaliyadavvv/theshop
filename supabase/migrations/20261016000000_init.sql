-- the shop. — initial schema for Supabase Postgres
--
-- Three layers, kept separate:
--   1. Shared source registry + imported catalogue (sources, products, collections, sync_runs)
--      Written only by the server's ingestion pipeline (privileged connection).
--      Readable by everyone, with anonymous visitors limited to "public preview" sources.
--   2. Private, per-user data (profiles, user_subscriptions, saved_items)
--      Row Level Security: a user can only see and change rows whose user_id = auth.uid().
--   3. Server-only bookkeeping (rate_limit_events) — no client access at all.
--
-- Supabase grants ALL on new public tables to anon/authenticated by default, so every
-- table below starts with REVOKE ALL and then grants back only what's needed.

-- ---------------------------------------------------------------------------
-- 1. Shared registry & catalogue
-- ---------------------------------------------------------------------------
create table public.sources (
  id                    text primary key,
  source_key            text not null unique,      -- dedupe key: host | host/collections/handle | social url
  name                  text not null,
  original_url          text not null,             -- URL as first supplied
  canonical_url         text,
  host                  text,
  source_type           text not null check (source_type in ('website','collection','social')),
  platform              text,
  ingestion_method      text,
  scope                 text not null default 'store' check (scope in ('store','collection')),
  collection_handle     text,
  status                text not null default 'pending'
                        check (status in ('pending','syncing','ok','partial','error','manual','unsupported')),
  status_detail         text,
  verified              boolean not null default false,
  logo_url              text,
  sync_interval_hours   real,
  last_attempted_sync   timestamptz,
  last_successful_sync  timestamptz,
  baseline_completed_at timestamptz,
  product_count         integer not null default 0,
  public_preview        boolean not null default false,  -- shown to signed-out visitors & as suggestions
  is_demo               boolean not null default false,
  notes                 text,
  sync_locked_until     timestamptz,                -- cross-instance sync lock
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
  -- Deliberately no "created_by": the registry never records which user added a source.
);
create index sources_host_idx on public.sources (host);

create table public.products (
  id                  text primary key,              -- <source_id>:<external_id>
  source_id           text not null references public.sources(id) on delete cascade,
  external_id         text not null,
  handle              text,
  name                text not null,
  brand_name          text not null,                 -- denormalised for search
  description         text,
  category            text not null default 'other',
  category_label_hint text,                         -- e.g. "Tops & shirts", so "tops" matches the normalised category
  category_basis      text,
  source_category     text,
  tags                text[] not null default '{}',
  vendor              text,
  image_url           text,
  image_urls          text[] not null default '{}',
  url                 text not null,
  price               double precision,
  price_max           double precision,
  currency            text,
  original_price      double precision,
  available           boolean,
  source_published_at timestamptz,
  source_created_at   timestamptz,
  released_at         timestamptz,
  released_basis      text check (released_basis in ('published','created','first_seen')),
  first_seen_at       timestamptz not null default now(),
  last_checked_at     timestamptz not null default now(),
  removed_at          timestamptz,
  source_type         text not null,
  provenance          text not null,
  last_ingest_status  text not null default 'ok',
  owner_user_id       uuid references auth.users(id) on delete cascade, -- set only for manually added products (private to that user)
  is_demo             boolean not null default false,
  raw                 jsonb,
  search              tsvector,
  unique (source_id, external_id)
);
create index products_source_idx   on public.products (source_id);
create index products_category_idx on public.products (category);
create index products_released_idx on public.products (released_at desc nulls last);
create index products_first_idx    on public.products (first_seen_at desc);
create index products_price_idx    on public.products (price);
create index products_url_idx      on public.products (source_id, url);
create index products_owner_idx    on public.products (owner_user_id) where owner_user_id is not null;
create index products_search_idx   on public.products using gin (search);

-- Weighted search document. A = name, B = category + tags, C = brand, D = description.
-- Garment words in a query are restricted to A/B (see src/server/catalog.ts).
create or replace function public.products_search_document() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.search :=
    setweight(to_tsvector('english', coalesce(new.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.category_label_hint, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(new.tags, ' '), '') || ' ' || coalesce(new.source_category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.brand_name, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.description, '')), 'D');
  return new;
end $$;

create trigger products_search_document before insert or update on public.products
  for each row execute function public.products_search_document();

create table public.collections (
  id              text primary key,
  source_id       text not null references public.sources(id) on delete cascade,
  external_id     text not null,
  title           text not null,
  handle          text,
  url             text not null,
  image_url       text,
  products_count  integer,
  published_at    timestamptz,
  first_seen_at   timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  unique (source_id, external_id)
);
create index collections_published_idx on public.collections (published_at desc);

create table public.sync_runs (
  id               bigint generated always as identity primary key,
  source_id        text not null references public.sources(id) on delete cascade,
  trigger          text not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null,
  products_seen    integer not null default 0,
  products_new     integer not null default 0,
  products_updated integer not null default 0,
  products_removed integer not null default 0,
  requests         integer not null default 0,
  error            text,
  warnings         jsonb not null default '[]'
);
create index sync_runs_source_idx on public.sync_runs (source_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 2. Private per-user data
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

create table public.user_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_id     text not null references public.sources(id) on delete restrict,
  original_url  text not null,                     -- what this user pasted
  canonical_url text,
  preferences   jsonb not null default '{}',       -- per-user monitoring preferences
  created_at    timestamptz not null default now(),
  unique (user_id, source_id)
);
create index user_subscriptions_source_idx on public.user_subscriptions (source_id);

create table public.saved_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  saved_at   timestamptz not null default now(),
  unique (user_id, product_id)
);

-- Profile row for every new account.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. Server-only bookkeeping
-- ---------------------------------------------------------------------------
create table public.rate_limit_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  action     text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_idx on public.rate_limit_events (user_id, action, created_at desc);

-- ---------------------------------------------------------------------------
-- Grants: start from nothing, add back the minimum
-- ---------------------------------------------------------------------------
revoke all on public.sources, public.products, public.collections, public.sync_runs,
  public.profiles, public.user_subscriptions, public.saved_items, public.rate_limit_events
  from anon, authenticated;

grant select on public.sources, public.products, public.collections to anon, authenticated;
grant select on public.sync_runs to authenticated;
grant select, update (display_name) on public.profiles to authenticated;
grant select, insert, delete on public.user_subscriptions to authenticated;
grant update (preferences) on public.user_subscriptions to authenticated;   -- user_id/source_id are immutable
grant select, insert, delete on public.saved_items to authenticated;
-- rate_limit_events: no grants. Server only.

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.sources            enable row level security;
alter table public.products           enable row level security;
alter table public.collections        enable row level security;
alter table public.sync_runs          enable row level security;
alter table public.profiles           enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.saved_items        enable row level security;
alter table public.rate_limit_events  enable row level security;

-- Shared catalogue: read-only. Signed-out visitors see public-preview sources only.
create policy "sources: preview readable by anon" on public.sources
  for select to anon using (public_preview and not is_demo);
create policy "sources: readable by signed-in users" on public.sources
  for select to authenticated using (true);

create policy "products: preview readable by anon" on public.products
  for select to anon using (
    owner_user_id is null and not is_demo
    and exists (select 1 from public.sources s where s.id = source_id and s.public_preview));
create policy "products: shared or own manual rows" on public.products
  for select to authenticated using (owner_user_id is null or owner_user_id = (select auth.uid()));

create policy "collections: preview readable by anon" on public.collections
  for select to anon using (exists (select 1 from public.sources s where s.id = source_id and s.public_preview));
create policy "collections: readable by signed-in users" on public.collections
  for select to authenticated using (true);

create policy "sync_runs: readable by signed-in users" on public.sync_runs
  for select to authenticated using (true);

-- Private data: own rows only. WITH CHECK stops creating or reassigning rows to someone else.
create policy "profiles: own row" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own row" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "subscriptions: read own" on public.user_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "subscriptions: create own" on public.user_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "subscriptions: update own" on public.user_subscriptions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "subscriptions: delete own" on public.user_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "saved: read own" on public.saved_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "saved: create own, visible products only" on public.saved_items
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id));   -- evaluated under products RLS
create policy "saved: delete own" on public.saved_items
  for delete to authenticated using (user_id = (select auth.uid()));
-- rate_limit_events: RLS on, no policies → no client access.
