-- Cerebrum schema for Netlify DB (Postgres). Replaces the Supabase tables
-- one-for-one, minus market_sectors (only consumer was the sectoral
-- heatmap, which has been removed from the app).
--
-- No RLS here — unlike Supabase's anon-key+REST model, nothing in this
-- schema is ever reachable directly from the browser. Every read/write
-- goes through a Next.js API route or a Netlify Function, both of which
-- hold the only Postgres connection string (server-side only, injected
-- automatically by Netlify DB). The browser never sees a DB credential.

create table if not exists notebook_store (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

create table if not exists market_indices (
  key text primary key,
  price numeric,
  change_pct numeric,
  updated_at timestamptz default now()
);

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

create table if not exists stock_sparklines (
  symbol text primary key,
  closes numeric[],
  updated_at timestamptz default now()
);

create table if not exists stock_news (
  symbol text,
  url text,
  title text,
  source text,
  sentiment text,
  summary text,
  published_at timestamptz,
  primary key (symbol, url)
);

create index if not exists idx_stock_news_symbol_pub on stock_news (symbol, published_at desc);

create table if not exists market_quotes (
  name text primary key,
  price numeric,
  day_pct numeric,
  day_high numeric,
  day_low numeric,
  year_high numeric,
  year_low numeric,
  sma10 numeric,
  sma20 numeric,
  updated_at timestamptz default now()
);

create table if not exists market_ipos (
  symbol text primary key,
  name text,
  status text,
  is_sme boolean default false,
  additional_text text,
  min_price numeric,
  max_price numeric,
  issue_price numeric,
  listing_price numeric,
  listing_gains numeric,
  bidding_start_date date,
  bidding_end_date date,
  listing_date date,
  allotment_date date,
  lot_size int,
  min_bid_quantity int,
  total_subscription_rate numeric,
  document_url text,
  updated_at timestamptz default now()
);
