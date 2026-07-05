import { NextResponse } from "next/server";

// Node runtime: makes a server-to-server call using SYNC_TRIGGER_SECRET,
// which must never reach the browser.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lets the Dashboard's manual "Refresh" button kick off a real market-sync-
// background run on demand. There is no automatic schedule — this route is
// the only way a sync ever runs.
export async function POST() {
  const base = process.env.URL || process.env.DEPLOY_URL || "";
  const secret = process.env.SYNC_TRIGGER_SECRET || "";
  if (!base) {
    return NextResponse.json({ error: "Site URL not available (process.env.URL unset)" }, { status: 500 });
  }
  try {
    await fetch(`${base}/.netlify/functions/market-sync-background`, {
      method: "POST",
      headers: secret ? { "X-Sync-Secret": secret } : {},
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Trigger failed" }, { status: 500 });
  }
}
