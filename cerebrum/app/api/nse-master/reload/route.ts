import { NextResponse } from "next/server";
import { replaceNseEquityMaster } from "@/lib/db";

// Node runtime: needs @netlify/database.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EQUITY_LIST_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv";

// Downloads NSE's official list of every listed equity (symbol + company
// name + ISIN) and replaces the local nse_equity_master table with it.
// Not on any schedule — call this once after deploy, and again occasionally
// (new IPOs list, delisted companies drop off) since this is a slow-moving
// dataset, not live market data.
export async function POST() {
  try {
    const res = await fetch(EQUITY_LIST_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `NSE equity list ${res.status}` }, { status: 502 });
    }
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const rows: { symbol: string; company_name: string; isin: string | null }[] = [];
    // Header: SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const symbol = (cols[0] || "").trim();
      const companyName = (cols[1] || "").trim();
      const isin = (cols[6] || "").trim() || null;
      if (!symbol || !companyName) continue;
      rows.push({ symbol, company_name: companyName, isin });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "Parsed 0 rows from NSE equity list" }, { status: 500 });
    }
    const count = await replaceNseEquityMaster(rows);
    return NextResponse.json({ ok: true, count });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
