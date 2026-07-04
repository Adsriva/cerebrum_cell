// Server-only helpers for Netlify DB (Postgres via @netlify/database).
// NEVER import this from a client component — the connection string is
// injected by the Netlify runtime and never reaches the browser. All
// browser reads/writes go through the /api/notebook and /api/market/*
// routes, which call these functions server-side.

import { getDatabase } from "@netlify/database";

// Lazy singleton: getDatabase() throws if no connection string is present
// in the environment. Next.js's build step statically imports every API
// route module to collect page data — if getDatabase() ran at module load
// time, that build-time import alone would crash (there's no live Netlify
// DB environment during `next build`). Deferring the call to first actual
// use means the build only imports functions, never invokes them.
let _db: ReturnType<typeof getDatabase> | null = null;
function db() {
  if (!_db) _db = getDatabase();
  return _db;
}

export async function getNotebookValue(key: string): Promise<any> {
  const rows = await db().sql`SELECT value FROM notebook_store WHERE key = ${key} LIMIT 1`;
  return rows?.[0]?.value ?? null;
}

export async function setNotebookValue(key: string, value: any): Promise<void> {
  await db().sql`
    INSERT INTO notebook_store (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `;
}

export type IndexRow = { key: string; price: number; change_pct: number; updated_at: string };
export type GainerRow = {
  symbol: string; name: string; sector: string; cap: string;
  price: number; day_pct: number; week_avg_vol: number; mcap_cr: number;
  rank: number; scan_ts: string;
};
export type SparkRow = { symbol: string; closes: number[]; updated_at: string };
export type NewsRow = {
  symbol: string; url: string; title: string; source: string;
  sentiment: "Positive" | "Neutral" | "Negative" | null;
  summary: string | null; published_at: string;
};
export type QuoteRow = {
  name: string; price: number; day_pct: number | null;
  day_high: number | null; day_low: number | null;
  year_high: number | null; year_low: number | null;
  sma10: number | null; sma20: number | null; updated_at: string;
};
export type IpoRow = {
  symbol: string; name: string; status: string; is_sme: boolean;
  additional_text: string | null; min_price: number | null; max_price: number | null;
  issue_price: number | null; listing_price: number | null; listing_gains: number | null;
  bidding_start_date: string | null; bidding_end_date: string | null;
  listing_date: string | null; allotment_date: string | null;
  lot_size: number | null; min_bid_quantity: number | null;
  total_subscription_rate: number | null; document_url: string | null; updated_at: string;
};

export async function getIndices(): Promise<Record<string, IndexRow>> {
  const rows = await db().sql`SELECT * FROM market_indices` as unknown as IndexRow[];
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

export async function getGainers(): Promise<GainerRow[]> {
  return (await db().sql`SELECT * FROM market_gainers ORDER BY rank ASC LIMIT 50`) as unknown as GainerRow[];
}

export async function getQuotes(): Promise<Record<string, QuoteRow>> {
  const rows = await db().sql`SELECT * FROM market_quotes` as unknown as QuoteRow[];
  return Object.fromEntries(rows.map((r) => [r.name, r]));
}

export async function getSparklines(): Promise<Record<string, number[]>> {
  const rows = await db().sql`SELECT symbol, closes FROM stock_sparklines` as unknown as SparkRow[];
  return Object.fromEntries(rows.map((r) => [r.symbol, r.closes]));
}

export async function getIpos(): Promise<IpoRow[]> {
  return (await db().sql`
    SELECT * FROM market_ipos ORDER BY status ASC, listing_date DESC NULLS LAST LIMIT 120
  `) as unknown as IpoRow[];
}

export async function getNews(symbol: string): Promise<NewsRow[]> {
  return (await db().sql`
    SELECT * FROM stock_news WHERE symbol = ${symbol} ORDER BY published_at DESC LIMIT 10
  `) as unknown as NewsRow[];
}
