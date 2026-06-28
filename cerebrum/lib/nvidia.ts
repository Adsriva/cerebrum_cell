// Server-side helper for NVIDIA NIM (OpenAI-compatible chat completions).
// NEVER import this from a client component.

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";

export function extractJsonFromText(raw: string): string {
  let s = raw.replace(/```json\n?|```\n?/g, "").trim();
  const start = Math.min(
    s.indexOf("{") === -1 ? Infinity : s.indexOf("{"),
    s.indexOf("[") === -1 ? Infinity : s.indexOf("[")
  );
  const endObj = s.lastIndexOf("}");
  const endArr = s.lastIndexOf("]");
  const end = Math.max(endObj, endArr);
  if (Number.isFinite(start) && end > start) s = s.slice(start, end + 1);
  return s;
}

export async function nvidiaChat(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; model?: string } = {}
): Promise<string> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY not configured");

  const res = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1500,
      stream: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`NVIDIA ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

export async function nvidiaJSON<T>(prompt: string, opts?: Parameters<typeof nvidiaChat>[1]): Promise<T> {
  const raw = await nvidiaChat(prompt, opts);
  return JSON.parse(extractJsonFromText(raw)) as T;
}
