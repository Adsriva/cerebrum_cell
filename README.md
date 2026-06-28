# Cerebrum

Personal Indian-equities research notebook with live NSE data, top-gainer filter,
sectoral heatmap, AI verdicts/news, IPO live feed, ETF/MF tracking, and dark mode.

This repo has the production Next.js app under [`cerebrum/`](cerebrum/) plus a
standalone single-file React build ([`Cerebrum_StockNotebook.jsx`](Cerebrum_StockNotebook.jsx))
for embedding the same UI without a build step.

## Quick start (Next.js app)

```bash
cd cerebrum
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NVIDIA_API_KEY
npm install
npm run dev
```

Open <http://localhost:3000>.

## Stack

- **Frontend** — Next.js 14 (App Router) + Tailwind CSS + Recharts
- **Storage** — Supabase (Postgres) for notes/watchlists/IPO views AND live market tables
- **Live data** — Supabase Edge Function (`supabase/functions/market-sync`) runs
  daily at 4 PM IST via pg_cron. Pulls indices from NSE India + everything else
  from indianapi.in (3 keys round-robin), summarises news via NVIDIA NIM
- **AI** — NVIDIA NIM (Llama-3.1 70B) via `/api/llm` route

See [`cerebrum/README.md`](cerebrum/README.md) for the detailed deployment guide.

## Deploy

1. **Frontend → Netlify** — auto-deploys on push to `main`. Set `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NVIDIA_API_KEY` env vars in Netlify UI.
2. **Backend → Supabase** — Edge Function deploy + secrets `INDIANAPI_KEYS`,
   `NVIDIA_API_KEY`, `CRON_SECRET` already configured. Daily cron via pg_cron.
