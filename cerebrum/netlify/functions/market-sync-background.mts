// Cerebrum — market-sync background function.
// A Netlify Background Function (15-minute wall-clock limit — needed
// because the weekly news section makes one NVIDIA call per stock, which
// a 30s Scheduled Function could not fit). Triggered by
// market-sync-scheduler.mts.
//
// Pulls live NSE data from indianapi.in (LTP, historical, news,
// commodities) and summarises news through NVIDIA NIM, then writes
// everything to the market tables via Netlify DB (Postgres).
//
// Before doing any work, checks whether NSE is actually open today (not a
// weekend, not an NSE-declared trading holiday via /api/holiday-master) and
// skips the whole run if closed — no point burning indianapi.in/NVIDIA
// quota refreshing data the exchange itself isn't updating. Pass
// ?force_sync=true to bypass this for manual testing on a closed day.
//
// Env vars required (Netlify → Site configuration → Environment variables):
//   INDIANAPI_KEYS   — comma-separated x-api-key values for stock.indianapi.in.
//                      Round-robined with auto-failover on 429/401/403.
//   INDIANAPI_KEY    — legacy single-key fallback.
//   NVIDIA_API_KEY   — Bearer token for build.nvidia.com NIM
//   NVIDIA_MODEL     — optional, defaults to meta/llama-3.1-70b-instruct
//   SYNC_TRIGGER_SECRET — shared secret; the scheduler sends it as
//                      X-Sync-Secret. Rejects any other caller, since this
//                      background function has a public URL by default.
//
// Netlify DB connection string is injected automatically — see lib/db.ts.

import type { Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

const INDIANAPI_BASE = "https://stock.indianapi.in";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";
const INDIANAPI_KEYS = (process.env.INDIANAPI_KEYS || process.env.INDIANAPI_KEY || "")
  .split(",").map((k) => k.trim()).filter(Boolean);
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const SYNC_TRIGGER_SECRET = process.env.SYNC_TRIGGER_SECRET || "";

let keyPtr = 0;
function nextKeyOrder(): string[] {
  const n = INDIANAPI_KEYS.length;
  const order = Array.from({ length: n }, (_, i) => INDIANAPI_KEYS[(keyPtr + i) % n]);
  keyPtr = (keyPtr + 1) % Math.max(n, 1);
  return order;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
const CONCURRENCY = 4;

const INDEX_TILES: Array<{ key: string; nseSymbol: string }> = [
  { key: "NIFTY",     nseSymbol: "NIFTY 50" },
  { key: "BANKNIFTY", nseSymbol: "NIFTY BANK" },
  { key: "MIDCAP",    nseSymbol: "NIFTY MIDCAP 100" },
  { key: "SMALLCAP",  nseSymbol: "NIFTY SMLCAP 100" },
];

const apiCache = new Map<string, any>();

async function indianApi(path: string, useCache = true): Promise<any> {
  if (useCache && apiCache.has(path)) return apiCache.get(path);
  if (INDIANAPI_KEYS.length === 0) throw new Error("No INDIANAPI_KEYS/INDIANAPI_KEY configured");

  let lastErr = "";
  for (const key of nextKeyOrder()) {
    const res = await fetch(`${INDIANAPI_BASE}${path}`, {
      headers: { "x-api-key": key, "Accept": "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      if (useCache) apiCache.set(path, data);
      return data;
    }
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      lastErr = `key ending …${key.slice(-4)} → ${res.status}`;
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`indianapi ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  throw new Error(`All ${INDIANAPI_KEYS.length} indianapi key(s) exhausted on ${path} (${lastErr})`);
}

async function nvidiaChat(prompt: string, maxTokens = 800): Promise<string> {
  if (!NVIDIA_API_KEY) return "";
  const res = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

function num(v: any): number | null {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

// ─── Section: Indices ────────────────────────────────────────────────────

const NSE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function nseCookieJar(): Promise<string> {
  const home = await fetch("https://www.nseindia.com/", {
    headers: { "User-Agent": NSE_UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.5" },
  });
  const setCookie = home.headers.get("set-cookie") || "";
  return setCookie.split(/,(?=\s*\w+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function nseFetch(path: string): Promise<any> {
  const cookieJar = await nseCookieJar();
  const res = await fetch(`https://www.nseindia.com${path}`, {
    headers: {
      "User-Agent": NSE_UA,
      "Accept": "application/json",
      "Referer": "https://www.nseindia.com/",
      "Cookie": cookieJar,
    },
  });
  if (!res.ok) throw new Error(`NSE ${path} ${res.status}`);
  return res.json();
}

async function fetchNseAllIndices(): Promise<any[]> {
  const data = await nseFetch("/api/allIndices");
  return Array.isArray(data?.data) ? data.data : [];
}

// ─── Market-holiday check ─────────────────────────────────────────────────
// Skips the whole sync (indices/quotes/sparklines/news) on weekends
// and NSE-declared trading holidays, so it doesn't burn indianapi.in/NVIDIA
// quota writing stale data when the exchange is closed. Fails OPEN (assumes
// market is open) if the NSE holiday API itself is unreachable, so a
// transient NSE outage doesn't silently skip an entire trading day forever.
function istTodayParts(): { y: number; mon: string; d: number; dow: number } {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return { y: ist.getUTCFullYear(), mon: MONTHS[ist.getUTCMonth()], d: ist.getUTCDate(), dow: ist.getUTCDay() };
}

async function isMarketOpenToday(): Promise<{ open: boolean; reason: string }> {
  const { y, mon, d, dow } = istTodayParts();
  if (dow === 0 || dow === 6) return { open: false, reason: "weekend" };

  try {
    const data = await nseFetch("/api/holiday-master?type=trading");
    // "CM" = Capital Market (equity cash segment) — the one that governs
    // stock trading. Other segments (CD/currency, FO/derivatives, COM/
    // commodities, etc.) have their own holiday lists that don't always
    // match CM's, so checking all segments blended together would produce
    // false positives (skipping a day equities are actually open).
    const cmHolidays: any[] = Array.isArray(data?.CM) ? data.CM : [];
    const todayStr = `${String(d).padStart(2, "0")}-${mon}-${y}`;
    const hit = cmHolidays.find((h: any) => String(h?.tradingDate || "").trim() === todayStr);
    if (hit) return { open: false, reason: hit.description || "NSE trading holiday" };
    return { open: true, reason: "" };
  } catch (e) {
    console.error("[market-sync-background] holiday check failed, assuming market open:", (e as Error).message);
    return { open: true, reason: "" };
  }
}

async function syncIndices(): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];
  const rows: Array<{ key: string; price: number | null; change_pct: number | null }> = [];

  try {
    const all = await fetchNseAllIndices();
    const byName: Record<string, any> = {};
    for (const x of all) {
      const key = (x?.indexSymbol || x?.index || "").toString().toUpperCase().trim();
      if (key) byName[key] = x;
    }
    for (const tile of INDEX_TILES) {
      const row = byName[tile.nseSymbol.toUpperCase()];
      if (row) {
        rows.push({ key: tile.key, price: num(row.last), change_pct: num(row.percentChange) });
      } else {
        errors.push(`${tile.key}: NSE symbol "${tile.nseSymbol}" not in /api/allIndices`);
      }
    }
  } catch (e) {
    errors.push(`nse indices: ${(e as Error).message}`);
  }

  try {
    const com = await indianApi("/commodities");
    const list = Array.isArray(com) ? com : [];
    const gold = list.find((c: any) => /^GOLD$/i.test(c?.product));
    const silv = list.find((c: any) => /^SILVER/i.test(c?.product));
    const pctChg = (c: any) => {
      const ltp = num(c?.last_traded_price);
      const avg = num(c?.average_traded_price);
      if (ltp === null || avg === null || avg === 0) return null;
      return +(((ltp - avg) / avg) * 100).toFixed(2);
    };
    if (gold) rows.push({ key: "GOLD",   price: num(gold.last_traded_price), change_pct: pctChg(gold) });
    if (silv) rows.push({ key: "SILVER", price: num(silv.last_traded_price), change_pct: pctChg(silv) });
  } catch (e) {
    errors.push(`commodities: ${(e as Error).message}`);
  }

  for (const r of rows) {
    try {
      await getDatabase().sql`
        INSERT INTO market_indices (key, price, change_pct, updated_at)
        VALUES (${r.key}, ${r.price}, ${r.change_pct}, now())
        ON CONFLICT (key) DO UPDATE SET price = excluded.price, change_pct = excluded.change_pct, updated_at = excluded.updated_at
      `;
    } catch (e) {
      errors.push(`upsert index ${r.key}: ${(e as Error).message}`);
    }
  }

  return { rows: rows.length, errors };
}

// ─── Section: Quotes (live price for every notebook stock) ──────────────

const SKIP_SYNC_TABS = new Set(["MF", "IPO"]);
function shouldSyncStock(s: any): boolean {
  if (!s || s.arc || !s.name) return false;
  if (s.kind === "MF" || s.kind === "IPO") return false;
  if (Array.isArray(s.src) && s.src.some((t: string) => SKIP_SYNC_TABS.has(t))) return false;
  return true;
}

async function loadStockNames(): Promise<string[]> {
  const rows = await getDatabase().sql`SELECT value FROM notebook_store WHERE key = 'stocks' LIMIT 1`;
  const stocksObj = (rows?.[0]?.value ?? {}) as Record<string, any>;
  return Object.values(stocksObj).filter(shouldSyncStock).map((s: any) => s.name);
}

async function syncQuotes(names: string[]): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;

  await mapLimit(names, CONCURRENCY, async (name) => {
    try {
      const d = await indianApi(`/stock?name=${encodeURIComponent(name)}`);
      const price = num(d?.currentPrice?.NSE ?? d?.currentPrice?.BSE);
      if (price === null) return;

      const tech: any[] = Array.isArray(d?.stockTechnicalData) ? d.stockTechnicalData : [];
      const dma = (days: number) => {
        const row = tech.find((t) => Number(t?.days) === days);
        return row ? num(row.nsePrice ?? row.bsePrice) : null;
      };

      await getDatabase().sql`
        INSERT INTO market_quotes (name, price, day_pct, day_high, day_low, year_high, year_low, sma10, sma20, updated_at)
        VALUES (${name}, ${price}, ${num(d?.percentChange)}, ${num(d?.stockDetailsReusableData?.high)}, ${num(d?.stockDetailsReusableData?.low)}, ${num(d?.yearHigh)}, ${num(d?.yearLow)}, ${dma(10)}, ${dma(20)}, now())
        ON CONFLICT (name) DO UPDATE SET
          price = excluded.price, day_pct = excluded.day_pct, day_high = excluded.day_high,
          day_low = excluded.day_low, year_high = excluded.year_high, year_low = excluded.year_low,
          sma10 = excluded.sma10, sma20 = excluded.sma20, updated_at = excluded.updated_at
      `;
      saved += 1;
    } catch (e) {
      errors.push(`quote ${name}: ${(e as Error).message}`);
    }
  });

  return { rows: saved, errors };
}

// ─── Section: Sparklines ─────────────────────────────────────────────────

async function syncSparklines(names: string[]): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;

  await mapLimit(names, CONCURRENCY, async (name) => {
    try {
      const d = await indianApi(`/historical_data?stock_name=${encodeURIComponent(name)}&period=1m&filter=price`);
      const series = d?.datasets?.find((x: any) => /^Price$/i.test(x?.metric))?.values || [];
      const closes = series
        .slice(-7)
        .map((v: any) => num(v?.[1]))
        .filter((v: number | null): v is number => v !== null);
      if (closes.length < 2) return;
      const symbol = `NSE:${name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)}`;
      await getDatabase().sql`
        INSERT INTO stock_sparklines (symbol, closes, updated_at)
        VALUES (${symbol}, ${closes}, now())
        ON CONFLICT (symbol) DO UPDATE SET closes = excluded.closes, updated_at = excluded.updated_at
      `;
      saved += 1;
    } catch (e) {
      errors.push(`hist ${name}: ${(e as Error).message}`);
    }
  });

  return { rows: saved, errors };
}

// ─── Section: News (per stock) — WEEKLY, not daily ───────────────────────

function isWeeklyNewsDayIST(): boolean {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  return istNow.getUTCDay() === 1; // Monday
}

async function syncNews(names: string[], force: boolean): Promise<{ rows: number; errors: string[]; skipped?: boolean }> {
  if (!force && !isWeeklyNewsDayIST()) {
    return { rows: 0, errors: [], skipped: true };
  }
  const errors: string[] = [];
  let inserted = 0;

  await mapLimit(names, CONCURRENCY, async (name) => {
    try {
      const d = await indianApi(`/stock?name=${encodeURIComponent(name)}`);
      const recent: any[] = Array.isArray(d?.recentNews) ? d.recentNews.slice(0, 5) : [];
      if (recent.length === 0) return;
      const symbol = `NSE:${name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)}`;

      let sentiments: Record<number, string> = {};
      if (NVIDIA_API_KEY && recent.length > 0) {
        const titles = recent.map((n: any, i: number) => `${i + 1}. ${n.title || n.headline || ""}`).join("\n");
        const prompt = `Classify the sentiment of each headline for "${name}" stock. Return ONLY a JSON array of strings, one per headline, each EXACTLY one of "Positive", "Neutral", "Negative". No prose, just JSON.\n\nHeadlines:\n${titles}`;
        const raw = await nvidiaChat(prompt, 200);
        try {
          const arr = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim());
          if (Array.isArray(arr)) arr.forEach((s, i) => (sentiments[i] = String(s)));
        } catch { /* leave as null */ }
      }

      for (let i = 0; i < recent.length; i++) {
        const n = recent[i];
        const title = String(n.title || n.headline || "").slice(0, 500);
        if (!title) continue;
        const url = n.url || n.link || `${symbol}#${i}-${Date.now()}`;
        const source = String(n.source || n.publisher || "Unknown").slice(0, 100);
        const sentiment = sentiments[i] || null;
        const summary = n.summary ? String(n.summary).slice(0, 800) : null;
        const publishedAt = n.date || n.published_at || new Date().toISOString();
        try {
          await getDatabase().sql`
            INSERT INTO stock_news (symbol, url, title, source, sentiment, summary, published_at)
            VALUES (${symbol}, ${url}, ${title}, ${source}, ${sentiment}, ${summary}, ${publishedAt})
            ON CONFLICT (symbol, url) DO UPDATE SET
              title = excluded.title, source = excluded.source, sentiment = excluded.sentiment,
              summary = excluded.summary, published_at = excluded.published_at
          `;
          inserted += 1;
        } catch (e) {
          errors.push(`news row ${symbol}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      errors.push(`news fetch ${name}: ${(e as Error).message}`);
    }
  });

  return { rows: inserted, errors };
}

// ─── Section: IPOs ───────────────────────────────────────────────────────

async function syncIpos(): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];
  let allRows: any[] = [];
  try {
    const d = await indianApi("/ipo");
    const list: any[] = Array.isArray(d?.active) ? d.active : [];
    allRows = list.filter((x) => x?.symbol).map((x) => ({
      symbol: String(x.symbol).slice(0, 60),
      name: String(x.name || x.symbol).slice(0, 200),
      status: String(x.status || "active").slice(0, 30),
      is_sme: !!x.is_sme,
      additional_text: x.additional_text || null,
      min_price: num(x.min_price),
      max_price: num(x.max_price),
      issue_price: num(x.issue_price),
      listing_price: num(x.listing_price),
      listing_gains: num(x.listing_gains),
      bidding_start_date: x.bidding_start_date || null,
      bidding_end_date: x.bidding_end_date || null,
      listing_date: x.listing_date || null,
      allotment_date: x.allotment_date || null,
      lot_size: num(x.lot_size),
      min_bid_quantity: num(x.min_bid_quantity),
      total_subscription_rate: num(x.total_subscription_rate),
      document_url: x.document_url || null,
    }));
  } catch (e) {
    errors.push(`ipos: ${(e as Error).message}`);
    return { rows: 0, errors };
  }

  try {
    await getDatabase().sql`DELETE FROM market_ipos`;
    for (const x of allRows) {
      await getDatabase().sql`
        INSERT INTO market_ipos (
          symbol, name, status, is_sme, additional_text, min_price, max_price, issue_price,
          listing_price, listing_gains, bidding_start_date, bidding_end_date, listing_date,
          allotment_date, lot_size, min_bid_quantity, total_subscription_rate, document_url, updated_at
        ) VALUES (
          ${x.symbol}, ${x.name}, ${x.status}, ${x.is_sme}, ${x.additional_text}, ${x.min_price}, ${x.max_price},
          ${x.issue_price}, ${x.listing_price}, ${x.listing_gains}, ${x.bidding_start_date}, ${x.bidding_end_date},
          ${x.listing_date}, ${x.allotment_date}, ${x.lot_size}, ${x.min_bid_quantity}, ${x.total_subscription_rate},
          ${x.document_url}, now()
        )
      `;
    }
  } catch (e) {
    errors.push(`ipos write: ${(e as Error).message}`);
  }

  return { rows: allRows.length, errors };
}

// ─── Entry point ─────────────────────────────────────────────────────────

export default async (req: Request, _context: Context) => {
  if (SYNC_TRIGGER_SECRET) {
    const got = req.headers.get("x-sync-secret") || "";
    if (got !== SYNC_TRIGGER_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  if (INDIANAPI_KEYS.length === 0) {
    console.error("INDIANAPI_KEYS / INDIANAPI_KEY not set");
    return;
  }

  const url = new URL(req.url);
  const forceNews = url.searchParams.get("force_news") === "true";
  const forceSync = url.searchParams.get("force_sync") === "true";

  if (!forceSync) {
    const market = await isMarketOpenToday();
    if (!market.open) {
      console.log(`[market-sync-background] skipped — market closed (${market.reason})`);
      return;
    }
  }

  // Fetch a fresh db handle right before each section rather than reusing one
  // instance across this whole ~8s+ run, out of caution. Note: writes here
  // are correctly committed and immediately visible to a fresh connection
  // within this same function — confirmed via a diagnostic read-back during
  // investigation. There is, however, a separate and significant (10-20+ min)
  // delay before writes made by this Background Function become visible to
  // the Next.js API routes (a different Netlify function context) reading
  // the same tables — most likely a Netlify DB/Neon cross-function
  // replication characteristic, not something fixable here. Irrelevant for
  // the once-daily cron; matters only if manually testing a sync and
  // expecting the dashboard to reflect it within seconds.
  const started = Date.now();
  const report: Record<string, any> = {};

  try { report.indices = await syncIndices(); } catch (e) { report.indices = { error: String(e) }; }
  try { report.ipos = await syncIpos(); } catch (e) { report.ipos = { error: String(e) }; }

  let names: string[] = [];
  try { names = await loadStockNames(); } catch (e) { report.stockNames = { error: String(e) }; }

  try { report.quotes = await syncQuotes(names); } catch (e) { report.quotes = { error: String(e) }; }
  try { report.sparklines = await syncSparklines(names); } catch (e) { report.sparklines = { error: String(e) }; }
  try { report.news = await syncNews(names, forceNews); } catch (e) { report.news = { error: String(e) }; }

  report.elapsed_ms = Date.now() - started;
  report.indianapi_keys_configured = INDIANAPI_KEYS.length;
  report.indianapi_cache_hits = apiCache.size;
  report.ok = true;

  console.log("[market-sync-background]", JSON.stringify(report));
};
