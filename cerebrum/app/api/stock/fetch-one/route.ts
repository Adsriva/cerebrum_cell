import { NextResponse } from "next/server";
import { upsertQuote, upsertNewsRow } from "@/lib/db";
import { nvidiaChat, extractJsonFromText } from "@/lib/nvidia";

// Node runtime: needs @netlify/database (pg-backed) and can run past 10s
// for the NVIDIA sentiment call.
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

  const report: Record<string, any> = { quote: false, news: 0, errors: [] as string[] };

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

    const recent: any[] = Array.isArray(d?.recentNews) ? d.recentNews.slice(0, 5) : [];
    if (recent.length > 0) {
      const symbol = `NSE:${name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)}`;

      let sentiments: Record<number, string> = {};
      if (process.env.NVIDIA_API_KEY) {
        try {
          const titles = recent.map((n: any, i: number) => `${i + 1}. ${n.title || n.headline || ""}`).join("\n");
          const prompt = `Classify the sentiment of each headline for "${name}" stock. Return ONLY a JSON array of strings, one per headline, each EXACTLY one of "Positive", "Neutral", "Negative". No prose, just JSON.\n\nHeadlines:\n${titles}`;
          const raw = await nvidiaChat(prompt, { maxTokens: 200 });
          const arr = JSON.parse(extractJsonFromText(raw));
          if (Array.isArray(arr)) arr.forEach((s, i) => (sentiments[i] = String(s)));
        } catch (e: any) {
          report.errors.push(`sentiment: ${e?.message}`);
        }
      }

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
            sentiment: sentiments[i] || null,
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
