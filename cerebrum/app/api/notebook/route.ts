import { NextResponse } from "next/server";
import { getNotebookValue, setNotebookValue } from "@/lib/db";

// Node runtime: @netlify/database's pg-backed driver needs Node, not edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keys the auth route owns exclusively — never readable/writable through
// this general-purpose endpoint.
const RESTRICTED_KEYS = new Set(["notebook_password"]);

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!key || RESTRICTED_KEYS.has(key)) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  try {
    const value = await getNotebookValue(key);
    return NextResponse.json({ value });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { key, value } = body || {};
  if (!key || typeof key !== "string" || RESTRICTED_KEYS.has(key)) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  try {
    await setNotebookValue(key, value);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}
