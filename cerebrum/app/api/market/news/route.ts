import { NextResponse } from "next/server";
import { getNews } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") || "";
  if (!symbol) return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  try {
    return NextResponse.json(await getNews(symbol));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}
