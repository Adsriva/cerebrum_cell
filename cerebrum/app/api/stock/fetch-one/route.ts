import { NextResponse } from "next/server";
import { upsertQuote, upsertNewsRow, findNseSymbolByName } from "@/lib/db";

// Node runtime: needs @netlify/database (pg-backed).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const INDIANAPI_BASE = "https://stock.indianapi.in";
const INDIANAPI_KEYS = (process.env.INDIANAPI_KEYS || process.env.INDIANAPI_KEY || "")
  .split(",").map((k) => k.trim()).filter(Boolean);

function num(v: any): number | null {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

// Real NSE ticker, resolved in priority order: (1) the local nse_equity_master
// lookup already done above — instant, no external call; (2) indianapi.in's
// own stock lookup (e.g. "RELIANCE" for Reliance Industries); (3) only as a
// last resort, a guessed/synthetic symbol (plain uppercase-and-strip of the
// company name), which frequently doesn't match the real exchange symbol.
function symbolFor(name: string, stockDetail: any, localSymbol: string | null): string {
  if (localSymbol) return `NSE:${localSymbol}`;
  const real = stockDetail?.companyProfile?.exchangeCodeNse || stockDetail?.companyProfile?.exchangeCodeBse;
  if (real) return `NSE:${String(real).toUpperCase()}`;
  return `NSE:${name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)}`;
}

async function indianApi(path: string): Promise<any> {
  if (INDIANAPI_KEYS.length === 0) throw new Error("INDIANAPI_KEYS not configured");
  let lastErr = "";
  for (const key of INDIANAPI_KEYS) {
    const res = await fetch(`${INDIANAPI_BASE}${path}`, {
      headers: { "x-api-key": key, Accept: "application/json" },
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      lastErr = `key ending …${key.slice(-4)} → ${res.status}`;
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`indianapi ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  throw new Error(`All ${INDIANAPI_KEYS.length} indianapi key(s) exhausted on ${path} (${lastErr})`);
}

// Called right after a new stock is added, so the user sees a real quote
// and real news immediately instead of waiting for the next scheduled sync.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  if (INDIANAPI_KEYS.length === 0) {
    return NextResponse.json({ error: "INDIANAPI_KEYS not configured" }, { status: 500 });
  }

  const report: Record<string, any> = { quote: false, news: 0, symbol: null as string | null, errors: [] as string[] };

  // Instant local ticker resolution — checked first, before any live
  // indianapi.in call, against the full NSE-listed universe mirrored in
  // nse_equity_master (~2,400 companies, refreshed via /api/nse-master/reload).
  let localSymbol: string | null = null;
  try {
    localSymbol = await findNseSymbolByName(name);
    if (localSymbol) report.symbol = `NSE:${localSymbol}`;
  } catch (e: any) {
    report.errors.push(`local symbol lookup: ${e?.message}`);
  }

  try {
    const d = await indianApi(`/stock?name=${encodeURIComponent(name)}`);

    const price = num(d?.currentPrice?.NSE ?? d?.currentPrice?.BSE);
    if (price !== null) {
      const tech: any[] = Array.isArray(d?.stockTechnicalData) ? d.stockTechnicalData : [];
      const dma = (days: number) => {
        const row = tech.find((t) => Number(t?.days) === days);
        return row ? num(row.nsePrice ?? row.bsePrice) : null;
      };
      await upsertQuote({
        name, price, day_pct: num(d?.percentChange),
        day_high: num(d?.stockDetailsReusableData?.high), day_low: num(d?.stockDetailsReusableData?.low),
        year_high: num(d?.yearHigh), year_low: num(d?.yearLow),
        sma10: dma(10), sma20: dma(20),
      });
      report.quote = true;
    }

    // Note: sentiment is intentionally left null here (not classified via
    // NVIDIA) — that call alone can take 15-25s, which risked timing out
    // this synchronous request on top of the indianapi.in fetch and DB
    // writes. The next scheduled market-sync-background run (a Background
    // Function with a 15-minute budget, built for exactly this kind of
    // slow work) fills in sentiment for every stock, including this one.
    const recent: any[] = Array.isArray(d?.recentNews) ? d.recentNews.slice(0, 5) : [];
    if (recent.length > 0) {
      const symbol = symbolFor(name, d, localSymbol);
      report.symbol = symbol;

      for (let i = 0; i < recent.length; i++) {
        const n = recent[i];
        const title = String(n.title || n.headline || "").slice(0, 500);
        if (!title) continue;
        try {
          await upsertNewsRow({
            symbol,
            url: n.url || n.link || `${symbol}#${i}-${Date.now()}`,
            title,
            source: String(n.source || n.publisher || "Unknown").slice(0, 100),
            sentiment: null,
            summary: n.summary ? String(n.summary).slice(0, 800) : null,
            published_at: n.date || n.published_at || new Date().toISOString(),
          });
          report.news += 1;
        } catch (e: any) {
          report.errors.push(`news row: ${e?.message}`);
        }
      }
    }
  } catch (e: any) {
    report.errors.push(e?.message || String(e));
  }

  return NextResponse.json(report);
}
