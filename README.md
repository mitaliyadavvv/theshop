# the shop.

A fashion discovery layer: everyone gets their own collection of the independent brands they follow. You can search, filter, and save products, then go to each brand's own product page to buy. Nothing is sold here.

- **Signed out:** an editorial preview of a few brands (read-only, first 2 pages).
- **Signed in:** your own brands, your saved products, your new drops. Nobody else can see or change them.

The name is configuration: set `NEXT_PUBLIC_BRAND_NAME`.

**Deploying:** see [docs/DEPLOY.md](docs/DEPLOY.md) (Supabase + GitHub + Vercel, with a verification checklist).
**Sources:** see [docs/INGESTION.md](docs/INGESTION.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · plain CSS design tokens · **Supabase** (Postgres + Auth) · postgres.js · Vercel (hosting + Cron).

## Architecture

```
Browser ──(Supabase Auth: sign in/up/out, reset)──▶ Supabase Auth
   │
   └─▶ Next.js routes & pages (server)
         ├─ getSessionUser(): verifies the session JWT (supabase.auth.getClaims)
         ├─ withViewer(user, …): every user-facing query runs in a transaction as Postgres role
         │    `authenticated` (or `anon`) with that verified user id in request.jwt.claims,
         │    so Row Level Security applies exactly as it would through Supabase's API
         └─ ingestion pipeline (privileged connection, server only)
               adapters/shopify.ts · adapters/woocommerce.ts · manual  (+ SSRF guard, robots.txt,
               rate limiting, Retry-After, DB sync lock)  ← Vercel Cron /api/sync, Add Brand, Refresh
```

### Data model (`supabase/migrations/20261016000000_init.sql`)

| Layer | Tables | Access |
| --- | --- | --- |
| Shared registry & catalogue | `sources`, `products`, `collections`, `sync_runs` | Written only by the server pipeline. Readable when signed in; anon sees `public_preview` sources only. No user columns; manual products carry `owner_user_id` and are visible only to their owner |
| Private per-user | `profiles`, `user_subscriptions` (unique `user_id, source_id`), `saved_items` (unique `user_id, product_id`) | RLS: `user_id = auth.uid()` for select/insert/update/delete. `user_id` can't be updated (column grants), so rows can't be reassigned |
| Server-only | `rate_limit_events` | RLS on, no policies, no grants |

All table grants start from `REVOKE ALL` (Supabase grants everything by default) and add back only what's needed.

### Add Brand flow

1. Validate the URL and strip tracking parameters.
2. Check that this user doesn't already follow it (409).
3. Apply the per-user rate limit and the 200-brand cap.
4. Find the shared source by key (host, host plus collection, or social URL), or create it.
5. Insert the subscription as the user (RLS).
6. Import only if no one has imported the source before. Otherwise its existing products are reused immediately.
7. The UI polls the source's real status.

Removing a brand deletes only your subscription. Shared products and other users are untouched.

### Abuse limits (`src/server/rate-limit.ts`)

| Action | Limit |
| --- | --- |
| Follow | 30/h |
| Manual refresh | 20/h per user, and at most once per 10 min per source |
| Manual products | 60/h |
| Saves | 600/h |

Limits are stored in Postgres, so they hold across serverless instances. Every outbound fetch, including each redirect hop, is checked against private and loopback address ranges, which blocks SSRF.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js on port 3100 |
| `npm test` | Unit tests plus **multi-user / RLS tests**. These run the real migration on an in-process Postgres (PGlite), so no Supabase is needed |
| `npm run db:migrate` | Apply `supabase/migrations/*.sql` to `DATABASE_URL` |
| `npm run db:import-sqlite` | Import the old local SQLite catalogue (from `backups/`). Repeatable, and verifies counts |
| `npm run seed:owner -- you@example.com` | Add the initial 13 brands to one account (yours). Repeatable |
| `npm run sync [-- --all \| ids…]` | Run ingestion now |
| `npm run reindex` | Re-apply category rules and search documents (no network) |
| `npm run e2e` | Two-browser HTTP test against a running app with real Supabase (`BASE_URL=…`) |
| `npm run demo:seed` | Clearly labelled sample products (hidden unless `DEMO_MODE=on`) |

Environment variables are documented in [.env.example](.env.example). Only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key reach the browser. `DATABASE_URL` and `CRON_SECRET` are server-only.

## Data rules (unchanged from the single-user version)

- **New drops** use the store's own publish date. Re-publishes fall back to the creation date. First-seen dates are used only after a source's baseline import, so an import never counts as "new".
- **Dedupe** is by `(source, platform product id)`. A changed URL keeps your saves.
- Only a **complete** sync can hide removed products, and hidden products are never deleted. A failed sync never deletes data.
- **Search** is Postgres full-text search with stemming, prefix matching and a small synonym list. Garment words must match the name, category or tags; attribute words can also match descriptions. It is not semantic search.
