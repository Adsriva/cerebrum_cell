import { NextResponse } from "next/server";
import { getNotebookValue, setNotebookValue } from "@/lib/db";

// Node runtime: @netlify/database's pg-backed driver needs Node, not edge.
// This route holds the only code path that may compare against
// MASTER_PASSWORD / the stored notebook password. The browser bundle never
// sees either value — only an { ok: boolean } result.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getStoredPassword(): Promise<string | null> {
  try {
    const v = await getNotebookValue("notebook_password");
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

async function setStoredPassword(value: string): Promise<boolean> {
  try {
    await setNotebookValue("notebook_password", value);
    return true;
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
