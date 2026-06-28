// Supabase REST helpers used directly from the browser with the anon key.
// Mirrors the kv-style API (sbGet/sbSet) from the original single-file app,
// and adds read helpers for the live-market tables (market_indices, etc).

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const SB_HDR: Record<string, string> = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

export function isSupabaseConfigured() {
  return !!SB_URL && !!SB_KEY;
}

export async function sbGet(key: string): Promise<any> {
  if (!isSupabaseConfigured()) return null;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/notebook_store?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: SB_HDR,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.value ?? null;
  } catch {
    return null;
  }
}

export async function sbSet(key: string, value: any): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/notebook_store`, {
      method: "POST",
      headers: { ...SB_HDR, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Live-market tables (populated by GitHub Actions sync_nse.py) ──

export type IndexRow = { key: string; price: number; change_pct: number; updated_at: string };
export type SectorRow = { sector: string; display_name: string; change_pct: number; mcap_cr: number | null; updated_at: string };
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

export async function fetchIndices(): Promise<Record<string, IndexRow>> {
  if (!isSupabaseConfigured()) return {};
  try {
    const res = await fetch(`${SB_URL}/rest/v1/market_indices?select=*`, { headers: SB_HDR, cache: "no-store" });
    if (!res.ok) return {};
    const rows: IndexRow[] = await res.json();
    return Object.fromEntries(rows.map((r) => [r.key, r]));
  } catch {
    return {};
  }
}

export async function fetchSectors(): Promise<SectorRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const res = await fetch(`${SB_URL}/rest/v1/market_sectors?select=*&order=change_pct.desc`, { headers: SB_HDR, cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function fetchGainers(): Promise<GainerRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const res = await fetch(`${SB_URL}/rest/v1/market_gainers?select=*&order=rank.asc&limit=50`, { headers: SB_HDR, cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export type QuoteRow = {
  name: string; price: number; day_pct: number | null;
  day_high: number | null; day_low: number | null;
  year_high: number | null; year_low: number | null;
  sma10: number | null; sma20: number | null; updated_at: string;
};

export async function fetchQuotes(): Promise<Record<string, QuoteRow>> {
  if (!isSupabaseConfigured()) return {};
  try {
    const res = await fetch(`${SB_URL}/rest/v1/market_quotes?select=*`, { headers: SB_HDR, cache: "no-store" });
    if (!res.ok) return {};
    const rows: QuoteRow[] = await res.json();
    return Object.fromEntries(rows.map((r) => [r.name, r]));
  } catch {
    return {};
  }
}

export async function fetchSparklines(): Promise<Record<string, number[]>> {
  if (!isSupabaseConfigured()) return {};
  try {
    const res = await fetch(`${SB_URL}/rest/v1/stock_sparklines?select=symbol,closes`, { headers: SB_HDR, cache: "no-store" });
    if (!res.ok) return {};
    const rows: SparkRow[] = await res.json();
    return Object.fromEntries(rows.map((r) => [r.symbol, r.closes]));
  } catch {
    return {};
  }
}

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

export async function fetchIpos(): Promise<IpoRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const res = await fetch(`${SB_URL}/rest/v1/market_ipos?select=*&order=status.asc,listing_date.desc.nullslast&limit=120`, { headers: SB_HDR, cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function fetchNews(symbol: string): Promise<NewsRow[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/stock_news?symbol=eq.${encodeURIComponent(symbol)}&select=*&order=published_at.desc&limit=10`,
      { headers: SB_HDR, cache: "no-store" }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}
