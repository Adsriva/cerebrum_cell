import { NextResponse } from "next/server";

// Edge runtime: this route holds the only code path that may compare against
// MASTER_PASSWORD / the stored notebook password. The browser bundle never
// sees either value — only an { ok: boolean } result.
export const runtime = "edge";
export const dynamic = "force-dynamic";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function getStoredPassword(): Promise<string | null> {
  if (!SB_URL || !SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/notebook_store?key=eq.notebook_password&select=value`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function setStoredPassword(value: string): Promise<boolean> {
  if (!SB_URL || !SERVICE_KEY) return false;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/notebook_store`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ key: "notebook_password", value, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "login") {
    const stored = await getStoredPassword();
    const expected = stored ?? process.env.NOTEBOOK_DEFAULT_PASSWORD ?? null;
    const ok = !!expected && typeof body.password === "string" && body.password === expected;
    return NextResponse.json({ ok });
  }

  if (body.action === "verify-master") {
    const masterEnv = process.env.MASTER_PASSWORD ?? null;
    const ok = !!masterEnv && typeof body.master === "string" && body.master === masterEnv;
    return NextResponse.json({ ok });
  }

  if (body.action === "change-password") {
    const masterEnv = process.env.MASTER_PASSWORD ?? null;
    if (!masterEnv || body.master !== masterEnv) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
    if (typeof body.newPassword !== "string" || !body.newPassword.trim()) {
      return NextResponse.json({ ok: false, error: "Password cannot be empty" }, { status: 400 });
    }
    const saved = await setStoredPassword(body.newPassword.trim());
    return NextResponse.json({ ok: saved });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
