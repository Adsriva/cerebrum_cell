// Cerebrum — market-sync Edge Function
// Runs daily at 4PM IST (10:30 UTC) via pg_cron. Pulls live NSE data from
// indianapi.in (live LTP, gainers, historical, news, commodities) and
// summarises news through NVIDIA NIM, then writes everything to the five
// market tables (market_indices, market_sectors, market_gainers,
// stock_sparklines, stock_news).
//
// Secrets required (set with `supabase secrets set ...`):
//   INDIANAPI_KEYS   — comma-separated x-api-key values for stock.indianapi.in.
//                      Each free key is capped at 500 calls/month; this list
//                      is round-robined and auto-fails-over to the next key
//                      on a 429/401/403 (quota/auth) response. Falls back to
//                      the singular INDIANAPI_KEY if INDIANAPI_KEYS is unset.
//   INDIANAPI_KEY    — legacy single-key fallback.
//   NVIDIA_API_KEY   — Bearer token for build.nvidia.com NIM
//   NVIDIA_MODEL     — optional, defaults to meta/llama-3.1-70b-instruct
//   CRON_SECRET      — optional shared-secret; if set, callers must send
//                      it as the X-Cron-Secret header. pg_cron is set up
//                      to do this. Skip to allow anyone with the URL.
//
// Built-in by Supabase Edge runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ─── Config ──────────────────────────────────────────────────────────────

const INDIANAPI_BASE = "https://stock.indianapi.in";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = Deno.env.get("NVIDIA_MODEL") || "meta/llama-3.1-70b-instruct";
const INDIANAPI_KEYS = (Deno.env.get("INDIANAPI_KEYS") || Deno.env.get("INDIANAPI_KEY") || "")
  .split(",").map((k) => k.trim()).filter(Boolean);
const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Round-robin pointer — each fresh call starts on the NEXT key, so under
// light load every key gets used roughly evenly instead of hammering #0.
let keyPtr = 0;
function nextKeyOrder(): string[] {
  const n = INDIANAPI_KEYS.length;
  const order = Array.from({ length: n }, (_, i) => INDIANAPI_KEYS[(keyPtr + i) % n]);
  keyPtr = (keyPtr + 1) % Math.max(n, 1);
  return order;
}

// Bounded-concurrency map. Runs `limit` workers pulling from a shared queue
// instead of firing every item at once — keeps results in input order
// (results[idx] = ...) so ranking/ordering logic downstream still works,
// while cutting wall-clock time on the big per-stock loops (sectors,
// quotes, sparklines, news) roughly `limit`-fold. This is what keeps the
// whole sync under Supabase's 150s Edge Function execution ceiling now
// that the notebook has grown — with 3 rotating API keys, a concurrency of
// 4 spreads load nicely without hammering any single key.
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

// Top-gainer filter rules (user-defined).
const GAINER_MIN_PCT = 4.0;
const GAINER_MIN_MCAP_CR = 600;
const GAINER_MIN_PRICE = 13;
const GAINER_MIN_WEEK_VOL = 50_000;
const GAINER_MAX_KEEP = 30;

// Tile key (used by the frontend) → NSE India indexSymbol (canonical, real
// index level, not an ETF). Pulled via /api/allIndices below.
const INDEX_TILES: Array<{ key: string; nseSymbol: string; display: string }> = [
  { key: "NIFTY",     nseSymbol: "NIFTY 50",         display: "Nifty 50" },
  { key: "BANKNIFTY", nseSymbol: "NIFTY BANK",       display: "Bank Nifty" },
  { key: "MIDCAP",    nseSymbol: "NIFTY MIDCAP 100", display: "Midcap 100" },
  { key: "SMALLCAP",  nseSymbol: "NIFTY SMLCAP 100", display: "Smallcap 100" },
];

// ─── HTTP helpers ────────────────────────────────────────────────────────

// In-process cache so repeated calls to the same path within one sync run
// (e.g. /trending used by both syncGainers + syncSectors, or /stock for a
// notebook stock used by both syncQuotes + syncNews) only hit the API once.
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
    // 429 = quota exhausted, 401/403 = bad/expired key — try the next key.
    // Any other status is a real error (bad request, 5xx) — stop immediately,
    // retrying it on other keys would just burn quota for nothing.
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

function capBucket(mcapCr: number): string {
  if (mcapCr >= 100_000) return "Large Cap";
  if (mcapCr >= 25_000)  return "Mid Cap";
  if (mcapCr >= 5_000)   return "Small Cap";
  return "Micro Cap";
}

// ─── Section: Indices ────────────────────────────────────────────────────

// Fetch NSE India /api/allIndices — gives REAL index levels (Nifty 50,
// BankNifty, Midcap 100, Smallcap 100) and day %. Requires a cookie
// handshake: hit the homepage first, pick up cookies, then call the API.
async function fetchNseAllIndices(): Promise<any[]> {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  // 1. Get cookies from homepage
  const home = await fetch("https://www.nseindia.com/", {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.5" },
  });
  const setCookie = home.headers.get("set-cookie") || "";
  // Crudely re-pack the Set-Cookie headers into a Cookie header
  const cookieJar = setCookie.split(/,(?=\s*\w+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  // 2. Call the API with those cookies
  const res = await fetch("https://www.nseindia.com/api/allIndices", {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json",
      "Referer": "https://www.nseindia.com/",
      "Cookie": cookieJar,
    },
  });
  if (!res.ok) throw new Error(`NSE allIndices ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data : [];
}

async function syncIndices(supabase: any): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];
  const rows: Array<{ key: string; price: number | null; change_pct: number | null }> = [];

  // Nifty 50 / Bank Nifty / Midcap 100 / Smallcap 100 — real index levels
  // from NSE India.
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

  // Gold / Silver — from indianapi /commodities (MCX futures, last traded).
  // We also compute day % from previous close when present.
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

  if (rows.length > 0) {
    const { error } = await supabase
      .from("market_indices")
      .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "key" });
    if (error) errors.push(`upsert indices: ${error.message}`);
  }
  return { rows: rows.length, errors };
}

// ─── Section: Gainers ────────────────────────────────────────────────────
// Pull /trending, apply user filter (1D >= 4%, price >= 13, mcap >= 600cr).
// Fetch /stock?name=X for each candidate to get mcap. Cap at GAINER_MAX_KEEP.

async function syncGainers(supabase: any): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];
  let kept: any[] = [];

  try {
    const t = await indianApi("/trending");
    const raw: any[] = t?.trending_stocks?.top_gainers ?? [];

    // Initial filter: pct + price
    const candidates = raw
      .map((s) => ({
        ticker_id: s.ticker_id,
        symbol: (s.ric || "").replace(/\.[A-Z]{2,3}$/, "") || s.ticker_id,
        ric: s.ric,
        company: s.company_name,
        price: num(s.price),
        pct: num(s.percent_change),
        volume: num(s.volume),
        year_high: num(s.year_high),
        year_low: num(s.year_low),
      }))
      .filter((s) => s.pct !== null && s.pct >= GAINER_MIN_PCT && s.price !== null && s.price >= GAINER_MIN_PRICE && s.volume !== null && s.volume >= GAINER_MIN_WEEK_VOL);

    // Enrich each with mcap + sector from /stock — concurrent (bounded),
    // results stay in candidates' original order (mapLimit guarantee) so
    // rank below still reflects the /trending gain% ordering.
    const enriched = await mapLimit(candidates, CONCURRENCY, async (c) => {
      try {
        const d = await indianApi(`/stock?name=${encodeURIComponent(c.company)}`);
        const mcap = num(d?.stockDetailsReusableData?.marketCap) ?? num(d?.companyProfile?.peerCompanyList?.[0]?.marketCap);
        const sector = d?.industry || d?.companyProfile?.mgIndustry || "Unknown";
        if (mcap !== null && mcap >= GAINER_MIN_MCAP_CR) {
          return {
            symbol: `NSE:${c.symbol}`,
            name: c.company,
            sector,
            cap: capBucket(mcap),
            price: c.price,
            day_pct: c.pct,
            week_avg_vol: Math.round(c.volume || 0),
            mcap_cr: mcap,
            scan_ts: new Date().toISOString(),
          };
        }
        return null;
      } catch (e) {
        // Per-stock failure shouldn't kill the whole sync — log and continue.
        errors.push(`gainer ${c.company}: ${(e as Error).message}`);
        return null;
      }
    });
    kept = enriched
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, GAINER_MAX_KEEP)
      .map((x, i) => ({ ...x, rank: i + 1 }));

    if (kept.length > 0) {
      // Clear stale rows first so removed gainers don't linger.
      await supabase.from("market_gainers").delete().neq("symbol", "__never__");
      const { error } = await supabase.from("market_gainers").insert(kept);
      if (error) errors.push(`insert gainers: ${error.message}`);
    }
  } catch (e) {
    errors.push(`trending: ${(e as Error).message}`);
  }

  return { rows: kept.length, errors };
}

// ─── Section: Sectoral heatmap ───────────────────────────────────────────
// Derive sector-level % change by grouping /trending + /NSE_most_active
// stocks by sector. Approximate but useful for the heatmap.

async function syncSectors(supabase: any): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];
  const sectorAgg = new Map<string, { sum: number; n: number; mcap: number }>();

  try {
    const t = await indianApi("/trending");
    const all = [
      ...(t?.trending_stocks?.top_gainers ?? []),
      ...(t?.trending_stocks?.top_losers ?? []),
    ];

    // Each entry doesn't have sector. We could fetch /stock for each, but
    // that's 50 round-trips. For v1 we use /industry_search results that
    // come back categorised when possible; here we just bucket by the
    // company's likely sector based on ticker prefix as a rough heuristic.
    // Better: fetch /stock for the top-N by volume to get accurate sectors.
    const top = all.slice(0, 30); // limit round-trips
    // Concurrent (bounded) — each worker's Map mutation happens synchronously
    // right after its own `await`, so there's no interleaving between the
    // get/update/set triplet and no lost-update race.
    await mapLimit(top, CONCURRENCY, async (s) => {
      const pct = num(s.percent_change);
      if (pct === null) return;
      try {
        const d = await indianApi(`/stock?name=${encodeURIComponent(s.company_name)}`);
        const sector = d?.industry || d?.companyProfile?.mgIndustry || null;
        if (!sector) return;
        const mcap = num(d?.stockDetailsReusableData?.marketCap) ?? 0;
        const a = sectorAgg.get(sector) || { sum: 0, n: 0, mcap: 0 };
        a.sum += pct;
        a.n += 1;
        a.mcap += mcap;
        sectorAgg.set(sector, a);
      } catch { /* skip individual failures */ }
    });
  } catch (e) {
    errors.push(`sectors: ${(e as Error).message}`);
  }

  const rows = Array.from(sectorAgg.entries()).map(([sector, a]) => ({
    sector,
    display_name: sector,
    change_pct: a.n > 0 ? +(a.sum / a.n).toFixed(2) : 0,
    mcap_cr: Math.round(a.mcap),
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("market_sectors").upsert(rows, { onConflict: "sector" });
    if (error) errors.push(`upsert sectors: ${error.message}`);
  }

  return { rows: rows.length, errors };
}

// ─── Section: Quotes (live price for EVERY notebook stock) ──────────────
// Unlike syncGainers (only the day's top-30 movers), this loops over every
// stock the user has saved and writes a live quote keyed by name — this is
// what the frontend's useMarketData(stock.name) reads for the price shown
// on stock cards / detail panel / metrics tab.

// Tabs/kinds whose stocks should NOT be quote-synced against indianapi.
// Mutual funds aren't on the stock API; IPOs use the dedicated /ipo
// endpoint and live in market_ipos.
const SKIP_SYNC_TABS = new Set(["MF", "IPO"]);
function shouldSyncStock(s: any): boolean {
  if (!s || s.arc || !s.name) return false;
  if (s.kind === "MF" || s.kind === "IPO") return false;
  if (Array.isArray(s.src) && s.src.some((t: string) => SKIP_SYNC_TABS.has(t))) return false;
  return true;
}

async function syncQuotes(supabase: any): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];

  const { data: kv, error: kvErr } = await supabase
    .from("notebook_store")
    .select("value")
    .eq("key", "stocks")
    .limit(1);
  if (kvErr) return { rows: 0, errors: [`notebook_store: ${kvErr.message}`] };

  const stocksObj = (kv?.[0]?.value ?? {}) as Record<string, any>;
  const names = Object.values(stocksObj)
    .filter(shouldSyncStock)
    .map((s: any) => s.name);

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

      const row = {
        name,
        price,
        day_pct: num(d?.percentChange),
        day_high: num(d?.stockDetailsReusableData?.high),
        day_low: num(d?.stockDetailsReusableData?.low),
        year_high: num(d?.yearHigh),
        year_low: num(d?.yearLow),
        sma10: dma(10),
        sma20: dma(20),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("market_quotes").upsert(row, { onConflict: "name" });
      if (error) errors.push(`quote ${name}: ${error.message}`);
      else saved += 1;
    } catch (e) {
      errors.push(`quote fetch ${name}: ${(e as Error).message}`);
    }
  });

  return { rows: saved, errors };
}

// ─── Section: Sparklines ─────────────────────────────────────────────────
// For each stock in notebook_store.stocks, fetch 1-month price series and
// store the last 7 closes.

async function syncSparklines(supabase: any): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];

  // Load saved stocks from notebook_store (kv).
  const { data: kv, error: kvErr } = await supabase
    .from("notebook_store")
    .select("value")
    .eq("key", "stocks")
    .limit(1);
  if (kvErr) return { rows: 0, errors: [`notebook_store: ${kvErr.message}`] };

  const stocksObj = (kv?.[0]?.value ?? {}) as Record<string, any>;
  const names = Object.values(stocksObj)
    .filter(shouldSyncStock)
    .map((s: any) => s.name);

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
      // Use NSE symbol guess for the row key; frontend looks up by name fallback too.
      const symbol = `NSE:${name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)}`;
      const { error } = await supabase
        .from("stock_sparklines")
        .upsert({ symbol, closes, updated_at: new Date().toISOString() }, { onConflict: "symbol" });
      if (error) {
        errors.push(`spark ${name}: ${error.message}`);
      } else {
        saved += 1;
      }
    } catch (e) {
      errors.push(`hist ${name}: ${(e as Error).message}`);
    }
  });

  return { rows: saved, errors };
}

// ─── Section: News (per stock) — WEEKLY, not daily ───────────────────────
// News is far less time-sensitive than price/quotes, so it's gated to run
// only once a week (Monday, IST) even though this whole function is
// invoked daily by the same 4PM IST cron. No second cron job needed — the
// other 6 days, this section is a no-op (zero indianapi.in calls, zero
// NVIDIA calls). Pass ?force_news=true to bypass the gate for manual testing.
function isWeeklyNewsDayIST(): boolean {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  return istNow.getUTCDay() === 1; // Monday
}

async function syncNews(supabase: any, force = false): Promise<{ rows: number; errors: string[]; skipped?: boolean }> {
  if (!force && !isWeeklyNewsDayIST()) {
    return { rows: 0, errors: [], skipped: true };
  }
  const errors: string[] = [];

  const { data: kv } = await supabase
    .from("notebook_store")
    .select("value")
    .eq("key", "stocks")
    .limit(1);

  const stocksObj = (kv?.[0]?.value ?? {}) as Record<string, any>;
  const names = Object.values(stocksObj)
    .filter(shouldSyncStock)
    .map((s: any) => s.name);

  let inserted = 0;
  // Concurrent (bounded) — the NVIDIA sentiment call is the slowest single
  // step here (LLM latency), so parallelizing this loop is what saves the
  // most wall-clock time of all five sections.
  await mapLimit(names, CONCURRENCY, async (name) => {
    try {
      const d = await indianApi(`/stock?name=${encodeURIComponent(name)}`);
      const recent: any[] = Array.isArray(d?.recentNews) ? d.recentNews.slice(0, 5) : [];
      if (recent.length === 0) return;
      const symbol = `NSE:${name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)}`;

      // Optional bulk sentiment via NVIDIA NIM (one call per stock, max 5 items)
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

      const rows = recent.map((n: any, i: number) => ({
        symbol,
        url: n.url || n.link || `${symbol}#${i}-${Date.now()}`,
        title: String(n.title || n.headline || "").slice(0, 500),
        source: String(n.source || n.publisher || "Unknown").slice(0, 100),
        sentiment: sentiments[i] || null,
        summary: n.summary ? String(n.summary).slice(0, 800) : null,
        published_at: n.date || n.published_at || new Date().toISOString(),
      })).filter((r) => r.title);

      if (rows.length > 0) {
        const { error } = await supabase
          .from("stock_news")
          .upsert(rows, { onConflict: "symbol,url" });
        if (error) errors.push(`news ${name}: ${error.message}`);
        else inserted += rows.length;
      }
    } catch (e) {
      errors.push(`news fetch ${name}: ${(e as Error).message}`);
    }
  });

  return { rows: inserted, errors };
}

// ─── Entry point ─────────────────────────────────────────────────────────

// ─── Section: IPOs ───────────────────────────────────────────────────────
// Pull /ipo and keep ONLY the "active" bucket (currently open for bidding).
// upcoming/pre_apply/closed/listed are intentionally dropped — the app only
// wants IPOs the user can act on right now. market_ipos is fully replaced
// each run (delete-then-insert, even on a 0-active day) so it never holds
// stale rows from a status we no longer track.
async function syncIpos(supabase: any): Promise<{ rows: number; errors: string[] }> {
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
      updated_at: new Date().toISOString(),
    }));
  } catch (e) {
    errors.push(`ipos: ${(e as Error).message}`);
    return { rows: 0, errors };
  }

  // Always clear first — including on a 0-active day — so nothing stale lingers.
  const { error: delErr } = await supabase.from("market_ipos").delete().neq("symbol", "__never__");
  if (delErr) errors.push(`clear ipos: ${delErr.message}`);
  if (allRows.length > 0) {
    const { error } = await supabase.from("market_ipos").insert(allRows);
    if (error) errors.push(`insert ipos: ${error.message}`);
  }
  return { rows: allRows.length, errors };
}

Deno.serve(async (req: Request) => {
  // Shared-secret check (optional). pg_cron passes the same header.
  if (CRON_SECRET) {
    const got = req.headers.get("x-cron-secret") || "";
    if (got !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (INDIANAPI_KEYS.length === 0) {
    return new Response(JSON.stringify({ error: "INDIANAPI_KEYS / INDIANAPI_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return new Response(JSON.stringify({ error: "Supabase env vars missing" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // Manual override for testing the weekly news gate outside its scheduled day.
  const forceNews = new URL(req.url).searchParams.get("force_news") === "true";

  const started = Date.now();
  const report: Record<string, any> = {};

  // The 7 sections run one after another (keeps cross-section load modest),
  // but each section's own per-stock loop runs with bounded concurrency
  // internally (see mapLimit/CONCURRENCY above). Each section logs its own
  // errors and never throws, so one bad section can't take down the rest.
  try { report.indices    = await syncIndices(supabase); }    catch (e) { report.indices    = { error: String(e) }; }
  try { report.ipos       = await syncIpos(supabase); }       catch (e) { report.ipos       = { error: String(e) }; }
  try { report.gainers    = await syncGainers(supabase); }    catch (e) { report.gainers    = { error: String(e) }; }
  try { report.sectors    = await syncSectors(supabase); }    catch (e) { report.sectors    = { error: String(e) }; }
  try { report.quotes     = await syncQuotes(supabase); }     catch (e) { report.quotes     = { error: String(e) }; }
  try { report.sparklines = await syncSparklines(supabase); } catch (e) { report.sparklines = { error: String(e) }; }
  try { report.news       = await syncNews(supabase, forceNews); } catch (e) { report.news = { error: String(e) }; }

  report.elapsed_ms = Date.now() - started;
  report.indianapi_keys_configured = INDIANAPI_KEYS.length;
  report.indianapi_cache_hits = apiCache.size; // distinct paths fetched this run
  report.ok = true;

  return new Response(JSON.stringify(report, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
