# Deploying the shop. (Supabase + Vercel + GitHub)

Nothing in this guide has been done for you. Each step needs your own accounts. Allow about 20–30 minutes.
Commands run from the `the-shop/` folder.

## What you'll create

| Piece | Purpose |
| --- | --- |
| **Supabase project** | Postgres database (shared catalogue + private user data under RLS), and email/password auth |
| **GitHub repository** | Source code. Vercel deploys from it |
| **Vercel project** | Hosts the Next.js app, and runs the daily sync via Vercel Cron |

## 1. Supabase

1. Create a project at <https://supabase.com/dashboard>. Pick the region closest to you and your shoppers (Mumbai `ap-south-1` for these brands), and save the database password.
2. **Collect the values** (Project → **Connect**, and Project Settings → **API Keys**):
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key (or legacy `anon` key) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Connect → **Transaction pooler** URI (port **6543**) → `DATABASE_URL`, with your password filled in
   - Connect → **Session pooler** URI (port 5432) → `DATABASE_URL_DIRECT`. Optional, used for migrations.
   - `service_role` / secret key → `SUPABASE_SERVICE_ROLE_KEY`. **Local `.env.local` only**, for the e2e test. Never put it in Vercel or in a `NEXT_PUBLIC_` variable.
3. Put them in `the-shop/.env.local`. Start from `.env.example`, and replace the local-testing values currently in that file.
4. **Run the migration:**
   ```bash
   npm run db:migrate
   ```
   This applies `supabase/migrations/*.sql` once each and records them in a private `shop_private` schema. Instead, you can paste the SQL file into the Supabase **SQL Editor**, or run `supabase db push` if you use the Supabase CLI.
5. **Auth settings** (Authentication → **URL Configuration**):
   - Site URL: your production URL, for example `https://the-shop.vercel.app`. Use `http://localhost:3100` until you have one.
   - Redirect URLs: add
     - `http://localhost:3100/**`
     - `https://YOUR-PRODUCTION-DOMAIN/**`
     - `https://*-YOUR-VERCEL-TEAM.vercel.app/**` (preview deployments, optional)
6. **Email.** Email/password sign-up is on by default, with "Confirm email" enabled. Supabase's built-in email sender is heavily rate-limited (a handful per hour), so before you launch publicly, set up custom SMTP (Authentication → **Emails** → SMTP, e.g. Resend or Postmark).
   - The default templates work as they are: links go to `/auth/callback` (PKCE), so they must be opened in the same browser.
   - To make links work across devices, change the templates' links to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` (signup) or `…&type=recovery&next=/account/reset-password` (reset). `/auth/confirm` is already implemented.
7. Optional hardening. The app only uses Supabase's Data API for auth. You can leave the API enabled: RLS and grants protect every table, and the tests prove it. Or you can restrict it under Project Settings → Data API.

## 2. Move your existing data in (safe, repeatable)

Your local SQLite catalogue is backed up in `backups/`. `the-shop-20261016-complete.db` is the full copy, alongside JSON exports. Nothing in the original `data/the-shop.db` is modified.

```bash
npm run db:import-sqlite        # sources, 1,323 products, collections, sync history → Supabase (upserts; safe to re-run)
```
It ends by verifying that every SQLite product is present in Postgres.

The 13 initial sources are marked `public_preview`. That means signed-out visitors can preview them and signed-in users see them as **suggestions**, but **no account follows them automatically**. To skip preview mode, run `npm run db:import-sqlite -- --no-preview`.

Then **seed your own account**:
1. Start the app (`npm run dev`) and sign up with your email. Confirm the email.
2. Run:
   ```bash
   npm run seed:owner -- you@example.com
   ```
   This adds the initial sources from `data/sources.seed.json` to your account only. It's safe to re-run: existing subscriptions are kept, and no other account is touched. Baaori isn't in the list, because you asked to remove it. Add it back from the Brands page if you want it.

## 3. GitHub

```bash
cd the-shop
git init -b main
git add .
git status            # check: no .env.local, no backups/, no data/*.db
git commit -m "the shop.: multi-user app on Supabase"
```
Create an **empty private** repository on GitHub (no README), then:
```bash
git remote add origin https://github.com/YOUR-USER/the-shop.git
git push -u origin main
```
`.gitignore` already excludes `.env*`, `backups/`, `data/*.db` and `.vercel`.

## 4. Vercel

1. <https://vercel.com/new> → import the GitHub repository.
2. The framework is detected as **Next.js**. Leave the build command (`next build`) and output settings as they are. Set **Node.js 22.x or 24.x** under Settings → General.
3. **Environment variables.** Add these for Production (and Preview if you use it):

   | Name | Value | Notes |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | from step 1 | public |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from step 1 | public by design |
   | `DATABASE_URL` | transaction pooler URI (6543) | **secret** |
   | `CRON_SECRET` | `openssl rand -hex 32` | **secret**. Vercel Cron sends it to `/api/sync` |
   | `NEXT_PUBLIC_SITE_URL` | `https://your-domain` | used for metadata |
   | `NEXT_PUBLIC_BRAND_NAME` | `the shop.` | optional |
   | `SYNC_INTERVAL_HOURS`, `NEW_DROP_DAYS` | `24`, `14` | optional |

   Do **not** add `SUPABASE_SERVICE_ROLE_KEY` or `DATABASE_URL_DIRECT`. The app doesn't need them.
4. **Deploy.** Then put the production URL into Supabase's Site URL and Redirect URLs (step 1.5).
5. **Scheduled sync.** `vercel.json` registers a daily Vercel Cron call to `/api/sync` (02:30 UTC). Each run works through due sources, oldest first, within the function's time limit (`maxDuration` 300 s). Vercel Hobby allows one cron run per day, so with many brands the work is spread across days; failed sources retry on the next run. To sync more often, upgrade the plan or call `POST /api/sync` with `Authorization: Bearer $CRON_SECRET` from any external scheduler.

> Ingestion from Vercel uses Vercel's IP addresses. Shopify may rate-limit them differently from your home connection. Any throttling shows up honestly on each brand's status, and the next run retries.

## 5. Production verification checklist

Run through these after the first deploy:

- [ ] `https://your-domain/` loads the signed-out preview (hero, preview banner, products)
- [ ] Sign up → confirmation email arrives → link signs you in
- [ ] Sign out / sign in. Forgot password → email → `/account/reset-password` → new password works
- [ ] `npm run seed:owner -- you@example.com` (against the production DB). Your home page then shows your 13 brands
- [ ] Add a brand by URL. Its status moves from "Checking…" to Connected (or an honest limitation). Its products appear
- [ ] Save a product → reload → still saved. Open the Saved page
- [ ] A second account (another email) sees none of your brands or saved items
- [ ] Vercel → Project → **Cron Jobs**: run `/api/sync` manually once and check its logs. Brand "Last synced" times update
- [ ] Automated multi-user check against production (creates and deletes two throwaway users):
  ```bash
  BASE_URL=https://your-domain npm run e2e
  ```
- [ ] Turn your computer off, then open the site from your phone. It should still work: nothing depends on your machine.

## Local development after setup

```bash
npm install
npm run dev                 # http://localhost:3100, using the Supabase values in .env.local
npm test                    # unit + RLS/multi-user tests on an in-process Postgres (no Supabase needed)
npm run sync -- --all       # sync every followed/preview source now
```
To try the signed-out preview without any Supabase project, start a throwaway local Postgres with `npx tsx scripts/local-pg.ts`, set `DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres` and `DB_POOL_MAX=1`, and run `npm run db:import-sqlite`. Sign-in doesn't work in this mode.
