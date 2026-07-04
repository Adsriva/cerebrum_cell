# Cerebrum

Personal Indian-equities research notebook with live NSE data, AI verdicts/news,
IPO live feed, ETF/MF tracking, and dark mode.

This repo has the production Next.js app under [`cerebrum/`](cerebrum/) plus a
standalone single-file React build ([`Cerebrum_StockNotebook.jsx`](Cerebrum_StockNotebook.jsx))
for embedding the same UI without a build step.

## Quick start (Next.js app)

```bash
cd cerebrum
cp .env.example .env.local
# fill in NVIDIA_API_KEY, MASTER_PASSWORD, NOTEBOOK_DEFAULT_PASSWORD, INDIANAPI_KEYS
npm install
npm run dev
```

Open <http://localhost:3000>. Note: the database (notes, watchlists, live market
data) only works once this site is deployed on Netlify or run via `netlify dev`
against a linked site — see [`cerebrum/README.md`](cerebrum/README.md).

## Stack

- **Frontend** — Next.js 14 (App Router) + Tailwind CSS + Recharts
- **Database** — Netlify DB (Postgres) for notes/watchlists/IPO views AND live market tables. Auto-provisioned on deploy, no manual setup.
- **Live data** — Netlify Scheduled Function (`market-sync-scheduler`) fires daily
  at 4 PM IST, triggering a Netlify Background Function (`market-sync-background`)
  that pulls indices from NSE India + everything else from indianapi.in (3 keys
  round-robin), summarises news via NVIDIA NIM
- **AI** — NVIDIA NIM (Llama-3.1 70B) via `/api/llm` route

See [`cerebrum/README.md`](cerebrum/README.md) for the detailed deployment guide.

## Deploy

1. Push to GitHub → Netlify → New site from Git → base directory `cerebrum/`.
2. Set env vars in Netlify UI: `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `MASTER_PASSWORD`,
   `NOTEBOOK_DEFAULT_PASSWORD`, `INDIANAPI_KEYS`, `SYNC_TRIGGER_SECRET`.
3. Deploy. Netlify DB provisions automatically on this first deploy. Auto-deploys
   on every push to `main`; the scheduled sync starts running daily immediately.
