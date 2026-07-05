# Cerebrum — Stock Idea Notebook

Personal Indian-equities research notebook with live NSE data, AI verdicts/news, and dark mode. Free-hosted entirely on Netlify.

## Stack

- **Frontend** — Next.js 14 (App Router) + Tailwind + Recharts (deployed to Netlify)
- **Database** — Netlify DB (Postgres, powered by Neon) — notes, watchlists, and live market tables. Auto-provisioned on first deploy/`netlify dev`, no manual setup.
- **Live data sync** — `market-sync-background` (Netlify Background Function, pulls from [indianapi.in](https://indianapi.in) + NSE India, up to 15 min). No automatic schedule — runs only when triggered via `/api/sync/trigger` (the Dashboard's manual "Refresh" button, or a new stock being added).
- **LLM** — NVIDIA NIM (Llama-3.1 70B) called server-side: `market-sync-background` uses it for per-stock news sentiment (weekly), and the Next.js `/api/llm` route uses it for the AI Verdict tab.

## Setup (local)

```bash
cp .env.example .env.local
# fill in NVIDIA_API_KEY, MASTER_PASSWORD, NOTEBOOK_DEFAULT_PASSWORD, INDIANAPI_KEYS
npm install
npm run dev
```

Note: `npm run dev` alone has **no working database** — Netlify DB only exists once this site is deployed on Netlify, or once `netlify dev` runs against a linked site (install the Netlify CLI, `netlify link`, then `netlify dev`). Until then, `/api/auth`, `/api/notebook`, and `/api/market/*` will error. The UI itself (layout, login screen, styling) can still be previewed with plain `npm run dev`.

## Database schema

Migrations live in `netlify/database/migrations/`. Netlify applies them automatically immediately before a deploy is published — no manual `psql` step. See `netlify/database/migrations/20260704120000_initial_schema/migration.sql` for the full schema: `notebook_store`, `market_indices`, `stock_sparklines`, `stock_news`, `market_quotes`, `market_ipos`.

Nothing in this schema has RLS or a public REST layer — the database is only ever reachable from server-side code (Next.js API routes under `app/api/*`, and the two Netlify Functions), never directly from the browser.

## Market-data sync

- `netlify/functions/market-sync-background.mts` — Background Function (15-minute limit). No automatic schedule. Does the work: NSE India cookie handshake for real index levels, indianapi.in for quotes/sparklines/IPOs/news (3 rotating keys via `INDIANAPI_KEYS`), NVIDIA NIM for weekly news sentiment (only runs on Mondays IST, or with `?force_news=true`).
- `app/api/sync/trigger/route.ts` — the only way a sync ever runs. Called by the Dashboard's manual "Refresh" button. Holds `SYNC_TRIGGER_SECRET` server-side and calls the background function on the user's behalf.
- `app/api/stock/fetch-one/route.ts` — fetches one stock's quote + news immediately when it's added (no NVIDIA sentiment here, to stay fast — that gets filled in by the next full sync).

Required env vars (Netlify → Site configuration → Environment variables):
- `INDIANAPI_KEYS` — comma-separated x-api-key values for stock.indianapi.in
- `NVIDIA_API_KEY` / `NVIDIA_MODEL`
- `SYNC_TRIGGER_SECRET` — random string; `/api/sync/trigger` sends it as `X-Sync-Secret` so the background function's public URL can't be triggered by anyone else

To trigger a sync manually for testing:

```bash
curl -X POST 'https://YOUR-SITE.netlify.app/.netlify/functions/market-sync-background' \
  -H 'X-Sync-Secret: <your SYNC_TRIGGER_SECRET>'
```

## Deploy (Netlify)

1. Push this repo to GitHub.
2. Netlify → New site from Git → pick the repo, **base directory = `cerebrum/`**, build command auto-detected (`npm run build`).
3. Add env vars in Netlify → Site configuration → Environment variables:
   - `NVIDIA_API_KEY`, `NVIDIA_MODEL`
   - `MASTER_PASSWORD`, `NOTEBOOK_DEFAULT_PASSWORD`
   - `INDIANAPI_KEYS`, `SYNC_TRIGGER_SECRET`
4. Deploy. Netlify DB provisions automatically on this first deploy — nothing to configure. Auto-deploys on every push to `main`.

## Auth gate

The Cerebrum login checks a single password against `notebook_store.notebook_password`, verified **server-side only** in `app/api/auth/route.ts` via a direct Postgres query (using `@netlify/database`) — the browser never receives the password or the master password used to change it. The `notebook_password` key is only ever touched by this route; the general-purpose `/api/notebook` route explicitly refuses to read or write it.

Required server-only env vars:
- `MASTER_PASSWORD` — required to change the notebook password via the sidebar key icon
- `NOTEBOOK_DEFAULT_PASSWORD` — used only if no password has been set yet in the DB

This is still not multi-tenant auth — anyone with the link sees the login screen, and a correct password unlocks the same shared notebook for anyone who has it.
