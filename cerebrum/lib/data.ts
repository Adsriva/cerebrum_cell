// Browser-side fetch helpers. All reads/writes go through this app's own
// Next.js API routes (backed by Netlify DB / Postgres) — the browser never
// talks to the database directly and never holds a DB credential.

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
  symbol: string;
  name: string;
  status: "upcoming" | "listed" | "active" | "closed" | "pre_apply" | string;
  is_sme: boolean;
  additional_text: string | null;
  min_price: number | null;
  max_price: number | null;
  issue_price: number | null;
  listing_price: number | null;
  listing_gains: number | null;
  bidding_start_date: string | null;
  bidding_end_date: string | null;
  listing_date: string | null;
  allotment_date: string | null;
  lot_size: number | null;
  min_bid_quantity: number | null;
  total_subscription_rate: number | null;
  document_url: string | null;
  updated_at: string;
};

export async function sbGet(key: string): Promise<any> {
  try {
    const res = await fetch(`/api/notebook?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const { value } = await res.json();
    return value ?? null;
  } catch {
    return null;
  }
}

export async function sbSet(key: string, value: any): Promise<boolean> {
  try {
    const res = await fetch("/api/notebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchIndices(): Promise<Record<string, IndexRow>> {
  try {
    const res = await fetch("/api/market/indices", { cache: "no-store" });
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

export async function fetchQuotes(): Promise<Record<string, QuoteRow>> {
  try {
    const res = await fetch("/api/market/quotes", { cache: "no-store" });
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

export async function fetchSparklines(): Promise<Record<string, number[]>> {
  try {
    const res = await fetch("/api/market/sparklines", { cache: "no-store" });
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

export async function fetchIpos(): Promise<IpoRow[]> {
  try {
    const res = await fetch("/api/market/ipos", { cache: "no-store" });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export async function fetchNews(symbol: string): Promise<NewsRow[]> {
  try {
    const res = await fetch(`/api/market/news?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

// Kicks off a real market-sync-background run on demand — there's no
// automatic schedule, this is the only way a sync ever runs. Fire-and-
// forget: the sync itself can take several seconds to minutes and its
// results may take a while to become readable afterward, so this just
// confirms the trigger was accepted, not that data updated.
export async function triggerSync(): Promise<boolean> {
  try {
    const res = await fetch("/api/sync/trigger", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

// Fetches one stock's live quote + news from indianapi.in immediately,
// instead of waiting for the next scheduled sync — called right after a
// new stock is added so it shows real data right away. Resolves the real
// NSE ticker instantly from the local nse_equity_master mirror (falls back
// to indianapi.in's own lookup, then a guessed symbol, only if not found
// locally) — the returned `symbol` reflects whichever it used.
export async function fetchOneStockNow(name: string): Promise<{ ok: boolean; symbol: string | null }> {
  try {
    const res = await fetch("/api/stock/fetch-one", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return { ok: false, symbol: null };
    const data = await res.json();
    return { ok: true, symbol: data?.symbol ?? null };
  } catch {
    return { ok: false, symbol: null };
  }
}

export type NseEquityMatch = { symbol: string; company_name: string; isin: string | null };

// Instant autocomplete against the full NSE-listed universe (~2,400
// companies) instead of a small hardcoded demo list.
export async function searchNseEquities(query: string): Promise<NseEquityMatch[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(`/api/nse-master/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}
