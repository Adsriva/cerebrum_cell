-- Cerebrum live-market tables (populated by GitHub Actions sync_nse.py + sync_news.py).
-- The existing notebook_store table is untouched.

-- Indices for the dashboard tiles (NIFTY, BANKNIFTY, MIDCAP, SMALLCAP, NASDAQ, GOLD, SILVER, …).
create table if not exists market_indices (
  key text primary key,
  price numeric,
  change_pct numeric,
  updated_at timestamptz default now()
);

-- Sectoral indices (used by the heatmap on the dashboard).
create table if not exists market_sectors (
  sector text primary key,
  display_name text,
  change_pct numeric,
  mcap_cr numeric,
  updated_at timestamptz default now()
);

-- Top-gainers feed, FILTERED by the user's rules (1D>=4%, MCap>=600cr, 1W vol>=50k, Px>=13).
-- Filter is enforced in scripts/sync_nse.py; this table only stores the survivors.
create table if not exists market_gainers (
  symbol text primary key,
  name text,
  sector text,
  cap text,
  price numeric,
  day_pct numeric,
  week_avg_vol bigint,
  mcap_cr numeric,
  rank int,
  scan_ts timestamptz default now()
);

-- 7-day closing prices per stock, for the per-row sparkline.
create table if not exists stock_sparklines (
  symbol text primary key,
  closes numeric[],
  updated_at timestamptz default now()
);

-- Raw NewsAPI items per stock, with NVIDIA-derived sentiment + summary.
create table if not exists stock_news (
  symbol text,
  url text,
  title text,
  source text,
  sentiment text,                -- 'Positive' | 'Neutral' | 'Negative'
  summary text,
  published_at timestamptz,
  primary key (symbol, url)
);

create index if not exists idx_stock_news_symbol_pub on stock_news (symbol, published_at desc);

-- ───────────────────────────────────────────────────────────────
-- RLS: the anon role can SELECT all market data. Writes require
-- the service_role (used by GitHub Actions only).
-- ───────────────────────────────────────────────────────────────

alter table market_indices    enable row level security;
alter table market_sectors    enable row level security;
alter table market_gainers    enable row level security;
alter table stock_sparklines  enable row level security;
alter table stock_news        enable row level security;

drop policy if exists anon_read_indices    on market_indices;
drop policy if exists anon_read_sectors    on market_sectors;
drop policy if exists anon_read_gainers    on market_gainers;
drop policy if exists anon_read_sparklines on stock_sparklines;
drop policy if exists anon_read_news       on stock_news;

create policy anon_read_indices    on market_indices    for select using (true);
create policy anon_read_sectors    on market_sectors    for select using (true);
create policy anon_read_gainers    on market_gainers    for select using (true);
create policy anon_read_sparklines on stock_sparklines  for select using (true);
create policy anon_read_news       on stock_news        for select using (true);
