# Cerebrum — Stock Idea Notebook

Personal Indian-equities research notebook with live NSE data, sectoral heatmap, top-gainer filter, AI verdicts/news, and dark mode. Free-hosted on Netlify + Supabase.

## Stack

- **Frontend** — Next.js 14 (App Router) + Tailwind + Recharts (deployed to Netlify)
- **Storage** — Supabase (Postgres) — notes, watchlists, AND live market tables
- **Live data sync** — Supabase Edge Function (`market-sync`, Deno) pulling from [indianapi.in](https://indianapi.in), scheduled daily at 4 PM IST via `pg_cron` + `pg_net`
- **LLM** — NVIDIA NIM (Llama-3.1 70B) called server-side: the `market-sync` function uses it for per-stock news sentiment, and the Next.js `/api/llm` route uses it for the AI Verdict tab.

## Setup (local)

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NVIDIA_API_KEY
npm install
npm run dev
```

## Supabase setup

1. Create a Supabase project (or use the existing one).
2. Apply the migration: `supabase/migrations/0001_market_tables.sql`. Creates `market_indices`, `market_sectors`, `market_gainers`, `stock_sparklines`, `stock_news` (anon-read, service-role-write via RLS).
3. Enable extensions: `pg_cron`, `pg_net` (one-liner, see `supabase/cron-setup.sql` below).
4. Deploy the Edge Function: `supabase functions deploy market-sync`.
5. Set Edge Function secrets via Supabase Dashboard → Project Settings → Edge Functions → Secrets:
   - `INDIANAPI_KEY` — your indianapi.in x-api-key
   - `NVIDIA_API_KEY` — Bearer token from build.nvidia.com
   - `CRON_SECRET` — any random 64-char hex (used to authenticate pg_cron → function)
6. Store `CRON_SECRET` in `vault.secrets` and schedule the cron job (see `supabase/cron-setup.sql`).

The function will then auto-run at **4:00 PM IST every weekday** (= 10:30 UTC, Mon-Fri). You can also invoke it manually:

```bash
curl -X POST 'https://<project>.supabase.co/functions/v1/market-sync' \
  -H 'X-Cron-Secret: <your CRON_SECRET>' -H 'Content-Type: application/json'
```

## Top Gainer filter

The Edge Function (`supabase/functions/market-sync/index.ts`) enforces these rules:

- 1-day change ≥ **4 %**
- Market cap ≥ **₹600 Cr**
- Current price ≥ **₹13**
- Day volume ≥ **50,000**

Adjust constants at the top of the function and redeploy.

## Deploy (Netlify)

1. Push this repo to GitHub.
2. Netlify → New site from Git → pick the repo, **base directory = `cerebrum/`**, build command auto-detected (`npm run build`).
3. Add env vars in Netlify → Site Settings → Build & Deploy → Environment:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NVIDIA_API_KEY` (for the `/api/llm` server route used by the Verdict tab)
4. Deploy. Auto-deploys on every push to `main`.

Migrating to Hostinger later requires no code change — Hostinger supports Next.js Node runtime; only DNS + env vars need to move.

## Auth gate

The Cerebrum login uses a single password stored in `notebook_store.notebook_password` (default `REDACTED_ROTATED_SECRET`, changeable via the sidebar key icon with master `REDACTED_ROTATED_SECRET`). This is **not** real auth — anyone with the link sees the login screen but the data itself is exposed via Supabase RLS-allowed reads. If you publish the URL publicly, enable Supabase RLS row-level policies on `notebook_store` too.
