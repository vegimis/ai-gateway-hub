import type { Provider } from "./types";
import { AIGatewayError } from "./types";

/**
 * Key-shape heuristics. Each provider uses a distinct, stable prefix:
 *  - Anthropic: sk-ant-...
 *  - Groq:      gsk_...
 *  - Google:    AIza...
 *  - OpenAI:    sk-... / sk-proj-...
 */
export function detectProviderFromKey(apiKey: string): Provider | null {
  const key = apiKey.trim();
  if (!key) return null;
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("AIza")) return "google";
  if (key.startsWith("sk-")) return "openai";
  return null;
}

const PROBES: Record<Provider, (key: string) => { url: string; headers: HeadersInit }> = {
  google: (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    headers: {},
  }),
  openai: (key) => ({
    url: "https://api.openai.com/v1/models",
    headers: { Authorization: `Bearer ${key}` },
  }),
  groq: (key) => ({
    url: "https://api.groq.com/openai/v1/models",
    headers: { Authorization: `Bearer ${key}` },
  }),
  anthropic: (key) => ({
    url: "https://api.anthropic.com/v1/models",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  }),
};

/**
 * Detects the provider for a key: prefix first (free, instant), then a
 * live `/models` probe against each candidate as a fallback.
 */
export async function detectProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Provider> {
  const guess = detectProviderFromKey(apiKey);
  if (guess) return guess;

  const candidates: Provider[] = ["openai", "groq", "anthropic", "google"];
  for (const provider of candidates) {
    const { url, headers } = PROBES[provider](apiKey);
    try {
      const res = await fetchImpl(url, { headers });
      if (res.ok) return provider;
    } catch {
      // network hiccup on one candidate should not abort detection
    }
  }
  throw new AIGatewayError("Could not determine the provider for this API key.", 400);
}
