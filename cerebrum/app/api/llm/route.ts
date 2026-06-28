import { NextResponse } from "next/server";
import { nvidiaJSON } from "@/lib/nvidia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerdictReq = {
  mode: "verdict";
  stock: { name: string; sector: string; subSector?: string };
};

type NewsReq = {
  mode: "news";
  stock: { name: string; sector: string; subSector?: string };
  headlines: Array<{ title: string; source: string; published_at: string; url?: string }>;
};

const VERDICT_PROMPT = (s: VerdictReq["stock"]) => `You are a senior Indian equity research analyst. Analyse this stock and return ONLY a JSON object — no markdown, no extra text.

Stock: ${s.name}
Sector: ${s.sector}${s.subSector ? " | Sub-sector: " + s.subSector : ""}

Return ONLY this JSON structure:
{
  "verdict": "Research Further",
  "confidence": 65,
  "bullish": ["pt1","pt2","pt3","pt4"],
  "bearish": ["pt1","pt2","pt3"],
  "risks": ["r1","r2","r3"],
  "triggers": ["t1","t2","t3"],
  "questions": ["q1","q2","q3"]
}

Rules:
- verdict must be EXACTLY one of: "Strong Buy Candidate", "Research Further", "Watch Closely", "Wait For Better Entry", "Avoid For Now", "Rejected"
- confidence is an integer 0-100
- All arrays must be plain strings (no nested objects), one short sentence per entry.`;

const NEWS_PROMPT = (s: NewsReq["stock"], hl: NewsReq["headlines"]) => `You are a financial news analyst. Below are the latest headlines about "${s.name}" (sector: ${s.sector}${s.subSector ? ", sub-sector: " + s.subSector : ""}).

Headlines:
${hl.slice(0, 15).map((h, i) => `${i + 1}. [${h.source}] ${h.title} (${h.published_at})`).join("\n")}

Return ONLY this JSON (no markdown):
{
  "fetchedAt": "${new Date().toISOString().slice(0, 10)}",
  "headline": "One-line most important recent development",
  "sentiment": "Positive",
  "items": [
    { "title": "headline", "category": "one of: Corporate Action, Results, Order Win, Management, Sector News, Analyst, General", "date": "DD Mon YYYY", "summary": "2-3 sentence factual summary", "impact": "Positive", "source": "source name", "url": "if available" }
  ],
  "catalysts": ["c1","c2"],
  "riskEvents": ["r1","r2"]
}

Rules:
- sentiment + impact must each be EXACTLY one of: "Positive", "Neutral", "Negative"
- Pick 4-6 items from the headlines above (keep their original source + url)
- Output VALID JSON only. No markdown fences.`;

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    if (body.mode === "verdict") {
      const out = await nvidiaJSON<any>(VERDICT_PROMPT(body.stock), { temperature: 0.3, maxTokens: 1200 });
      return NextResponse.json(out);
    }
    if (body.mode === "news") {
      if (!Array.isArray(body.headlines) || body.headlines.length === 0) {
        return NextResponse.json({ error: "No headlines provided" }, { status: 400 });
      }
      const out = await nvidiaJSON<any>(NEWS_PROMPT(body.stock, body.headlines), { temperature: 0.2, maxTokens: 1600 });
      return NextResponse.json(out);
    }
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (e: any) {
    console.error("[api/llm] error:", e?.message || e);
    return NextResponse.json({ error: e?.message || "LLM error" }, { status: 500 });
  }
}
