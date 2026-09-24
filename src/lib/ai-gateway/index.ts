import { detectProvider, detectProviderFromKey } from "./detect";
import { DEFAULT_MODELS, buildRequest } from "./providers";
import { sseEvents } from "./stream";
import {
  AIGatewayError,
  type ChatOptions,
  type ChatResult,
  type ChatStream,
  type GatewayConfig,
  type Provider,
} from "./types";

export { AIGatewayError, DEFAULT_MODELS, detectProvider, detectProviderFromKey };
export type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ChatStream,
  GatewayConfig,
  Provider,
} from "./types";

export interface Gateway {
  readonly provider: Promise<Provider>;
  chat(options: ChatOptions & { stream: true }): Promise<ChatStream>;
  chat(options: ChatOptions & { stream?: false }): Promise<ChatResult>;
}

/**
 * Creates a provider-agnostic chat client from a single API key.
 * Provider and default model are discovered automatically.
 */
export function createGateway(config: GatewayConfig): Gateway {
  const fetchImpl = config.fetch ?? fetch;
  const apiKey = config.apiKey?.trim();
  if (!apiKey) throw new AIGatewayError("Missing API key.", 401);

  const providerPromise: Promise<Provider> = config.provider
    ? Promise.resolve(config.provider)
    : detectProvider(apiKey, fetchImpl);

  async function chat(options: ChatOptions): Promise<ChatResult | ChatStream> {
    const provider = await providerPromise;
    const model = options.model ?? config.model ?? DEFAULT_MODELS[provider];
    const req = buildRequest(provider, apiKey!, model, options);

    const res = await fetchImpl(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AIGatewayError(
        `${provider} request failed (${res.status}): ${detail.slice(0, 500)}`,
        res.status,
        provider,
      );
    }

    if (!options.stream) {
      const json = await res.json();
      return { provider, model, text: req.parseFull(json) };
    }

    if (!res.body) throw new AIGatewayError("Provider returned no stream body.", 502, provider);
    const body = res.body;

    async function* textStream() {
      for await (const data of sseEvents(body)) {
        if (data === "[DONE]") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = req.parseChunk(parsed);
        if (delta) yield delta;
      }
    }

    return { provider, model, textStream: textStream() };
  }

  return { provider: providerPromise, chat: chat as Gateway["chat"] };
}

/** One-shot convenience: `chat({ apiKey, prompt })` without holding a client. */
export async function chat(
  options: ChatOptions & { apiKey: string; provider?: Provider; stream: true },
): Promise<ChatStream>;
export async function chat(
  options: ChatOptions & { apiKey: string; provider?: Provider; stream?: false },
): Promise<ChatResult>;
export async function chat(
  options: ChatOptions & { apiKey: string; provider?: Provider },
): Promise<ChatResult | ChatStream> {
  const { apiKey, provider, ...rest } = options;
  const gateway = createGateway({ apiKey, ...(provider ? { provider } : {}) });
  return (gateway.chat as (o: ChatOptions) => Promise<ChatResult | ChatStream>)(rest);
}
