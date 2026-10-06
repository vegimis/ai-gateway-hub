import { PROVIDERS, PROVIDER_IDS, authHeaders, modelsUrl } from "./providers";
import type { Provider } from "./types";
import { AIGatewayError } from "./types";

/** Prefix match, longest prefix wins (so `sk-ant-` beats `sk-`). */
export function detectProviderFromKey(apiKey: string): Provider | null {
  const key = apiKey.trim();
  if (!key) return null;
  let best: { p: Provider; len: number } | null = null;
  for (const p of PROVIDER_IDS) {
    for (const prefix of PROVIDERS[p].prefixes) {
      if (key.startsWith(prefix) && prefix.length > (best?.len ?? 0)) best = { p, len: prefix.length };
    }
  }
  // DeepSeek keys look like OpenAI's ("sk-" + 32 hex) — probe instead of guessing.
  if (best?.p === "openai" && /^sk-[0-9a-f]{32}$/.test(key)) return null;
  return best?.p ?? null;
}

/**
 * Detects the provider: key prefix first (free, instant), then a live
 * `GET /models` probe against prefix-less providers.
 */
export async function detectProvider(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<Provider> {
  const guess = detectProviderFromKey(apiKey);
  if (guess) return guess;

  const candidates: Provider[] = ["deepseek", "openai", "mistral", "together", "groq", "anthropic", "google"];
  const results = await Promise.all(
    candidates.map(async (p) => {
      try {
        const res = await fetchImpl(modelsUrl(p), { headers: authHeaders(p, apiKey) });
        await res.body?.cancel().catch(() => {});
        return res.ok ? p : null;
      } catch {
        return null;
      }
    }),
  );
  const found = results.find((p): p is Provider => p !== null);
  if (found) return found;
  throw new AIGatewayError("Could not determine the provider for this API key.", 400, undefined, "detection_failed");
}
