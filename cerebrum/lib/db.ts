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

// Postgres `numeric` columns come back from the driver as strings (to avoid
// float precision loss), not JS numbers — even though our TypeScript types
// above say `number`. Every numeric field read from the DB must be coerced
// here, at the source, so no frontend consumer can call .toFixed()/do
// arithmetic on a string and crash (this caused a real production bug: a
// stock card's live day_pct being a string broke .toFixed() on the
// Dashboard's High Conviction banner).
function n(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

export async function getIndices(): Promise<Record<string, IndexRow>> {
  const rows = await db().sql`SELECT * FROM market_indices` as unknown as any[];
  return Object.fromEntries(rows.map((r) => [r.key, {
    key: r.key, price: n(r.price) ?? 0, change_pct: n(r.change_pct) ?? 0, updated_at: r.updated_at,
  } as IndexRow]));
}

export async function getQuotes(): Promise<Record<string, QuoteRow>> {
  const rows = await db().sql`SELECT * FROM market_quotes` as unknown as any[];
  return Object.fromEntries(rows.map((r) => [r.name, {
    name: r.name, price: n(r.price) ?? 0, day_pct: n(r.day_pct),
    day_high: n(r.day_high), day_low: n(r.day_low),
    year_high: n(r.year_high), year_low: n(r.year_low),
    sma10: n(r.sma10), sma20: n(r.sma20), updated_at: r.updated_at,
  } as QuoteRow]));
}

export async function getSparklines(): Promise<Record<string, number[]>> {
  const rows = await db().sql`SELECT symbol, closes FROM stock_sparklines` as unknown as any[];
  return Object.fromEntries(rows.map((r) => [r.symbol, (r.closes || []).map((c: unknown) => n(c) ?? 0)]));
}

export async function getIpos(): Promise<IpoRow[]> {
  const rows = await db().sql`
    SELECT * FROM market_ipos ORDER BY status ASC, listing_date DESC NULLS LAST LIMIT 120
  ` as unknown as any[];
  return rows.map((r) => ({
    ...r,
    min_price: n(r.min_price), max_price: n(r.max_price), issue_price: n(r.issue_price),
    listing_price: n(r.listing_price), listing_gains: n(r.listing_gains),
    lot_size: n(r.lot_size), min_bid_quantity: n(r.min_bid_quantity),
    total_subscription_rate: n(r.total_subscription_rate),
  } as IpoRow));
}

export async function getNews(symbol: string): Promise<NewsRow[]> {
  return (await db().sql`
    SELECT * FROM stock_news WHERE symbol = ${symbol} ORDER BY published_at DESC LIMIT 10
  `) as unknown as NewsRow[];
}

export async function upsertQuote(row: {
  name: string; price: number | null; day_pct: number | null;
  day_high: number | null; day_low: number | null;
  year_high: number | null; year_low: number | null;
  sma10: number | null; sma20: number | null;
}): Promise<void> {
  await db().sql`
    INSERT INTO market_quotes (name, price, day_pct, day_high, day_low, year_high, year_low, sma10, sma20, updated_at)
    VALUES (${row.name}, ${row.price}, ${row.day_pct}, ${row.day_high}, ${row.day_low}, ${row.year_high}, ${row.year_low}, ${row.sma10}, ${row.sma20}, now())
    ON CONFLICT (name) DO UPDATE SET
      price = excluded.price, day_pct = excluded.day_pct, day_high = excluded.day_high,
      day_low = excluded.day_low, year_high = excluded.year_high, year_low = excluded.year_low,
      sma10 = excluded.sma10, sma20 = excluded.sma20, updated_at = excluded.updated_at
  `;
}

export async function upsertNewsRow(row: {
  symbol: string; url: string; title: string; source: string;
  sentiment: string | null; summary: string | null; published_at: string;
}): Promise<void> {
  await db().sql`
    INSERT INTO stock_news (symbol, url, title, source, sentiment, summary, published_at)
    VALUES (${row.symbol}, ${row.url}, ${row.title}, ${row.source}, ${row.sentiment}, ${row.summary}, ${row.published_at})
    ON CONFLICT (symbol, url) DO UPDATE SET
      title = excluded.title, source = excluded.source, sentiment = excluded.sentiment,
      summary = excluded.summary, published_at = excluded.published_at
  `;
}
