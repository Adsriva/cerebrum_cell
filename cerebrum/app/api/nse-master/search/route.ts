import { NextResponse } from "next/server";
import { searchNseEquityMaster } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Instant local autocomplete against the full NSE-listed universe (~2,400
// companies), not the old ~50-stock hardcoded demo list — no external API
// call, no wait.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json([]);
  try {
    return NextResponse.json(await searchNseEquityMaster(q.trim()));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}
