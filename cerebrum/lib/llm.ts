// Browser-side helpers that call the /api/llm route. Server keeps NVIDIA key.

export type VerdictResult = {
  verdict: string;
  confidence: number;
  bullish: string[];
  bearish: string[];
  risks: string[];
  triggers: string[];
  questions: string[];
  ts?: string;
  aiGenerated?: boolean;
};

export type NewsResult = {
  fetchedAt: string;
  headline: string;
  sentiment: "Positive" | "Neutral" | "Negative";
  items: Array<{
    title: string;
    category: string;
    date: string;
    summary: string;
    impact: "Positive" | "Neutral" | "Negative";
    source: string;
    url?: string;
  }>;
  catalysts: string[];
  riskEvents: string[];
  aiGenerated?: boolean;
};

async function postLLM<T>(mode: "verdict" | "news", payload: any): Promise<T> {
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, ...payload }),
  });
  if (!res.ok) {
    const e = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${e || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function callVerdict(stock: { name: string; sector: string; subSector?: string }): Promise<VerdictResult> {
  return postLLM<VerdictResult>("verdict", { stock });
}

export async function callNewsSummary(stock: { name: string; sector: string; subSector?: string }, headlines: Array<{ title: string; source: string; published_at: string; url?: string }>): Promise<NewsResult> {
  return postLLM<NewsResult>("news", { stock, headlines });
}
