import { detectProvider, detectProviderFromKey } from "./detect";
import { ENV_KEYS, ENV_MODEL, ENV_PROVIDER, defaultEnv, resolveKeyFromEnv } from "./keys";
import { DEFAULT_MODELS, PROVIDERS, PROVIDER_IDS, authHeaders, buildRequest, modelsUrl, parseModels } from "./providers";
import { sseEvents } from "./stream";
import {
  AIGatewayError,
  type ChatOptions,
  type ChatResult,
  type ChatStream,
  type GatewayConfig,
  type Provider,
} from "./types";

/** Library version — keep in sync with package.json and the git tag (vX.Y.Z). */
export const VERSION = "1.1.0";

export { startupCheck, type StartupReport } from "./startup";
export {
  AIGatewayError,
  DEFAULT_MODELS,
  ENV_KEYS,
  ENV_MODEL,
  ENV_PROVIDER,
  PROVIDERS,
  PROVIDER_IDS,
  detectProvider,
  detectProviderFromKey,
  resolveKeyFromEnv,
};
export type {
  AIGatewayErrorCode,
  ChatMessage,
  ChatOptions,
  ChatResult,
  ChatStream,
  GatewayConfig,
  Provider,
} from "./types";

export interface Gateway {
  readonly provider: Promise<Provider>;
  /** Where the key came from: "config" or the env variable name. */
  readonly keySource: string;
  /** Lists the chat models this key can use (live from the provider). */
  listModels(): Promise<string[]>;
  chat(options: ChatOptions & { stream: true }): Promise<ChatStream>;
  chat(options: ChatOptions & { stream?: false }): Promise<ChatResult>;
}

/**
 * Creates a provider-agnostic chat client.
 * Key: `config.apiKey`, else `config.env`, else `process.env` (see ENV_KEYS).
 * Provider and default model are discovered automatically.
 */
export function createGateway(config: GatewayConfig = {}): Gateway {
  const fetchImpl = config.fetch ?? fetch;
  const env = config.env ?? defaultEnv();

  let apiKey = config.apiKey?.trim();
  let keySource = "config";
  const envProvider = env[ENV_PROVIDER]?.trim() as Provider | undefined;
  let pinned: Provider | undefined =
    config.provider ?? (envProvider && envProvider in PROVIDERS ? envProvider : undefined);
  if (!apiKey) {
    const found = resolveKeyFromEnv(env);
    if (found) {
      apiKey = found.apiKey;
      keySource = found.source;
      pinned ??= found.provider;
    }
  }
  if (!apiKey) {
    throw new AIGatewayError(
      `Missing API key. Pass { apiKey } or set one of: ${ENV_KEYS.map((k) => k.name).join(", ")}.`,
      401,
      undefined,
      "missing_key",
    );
  }
  const key = apiKey;
  const envModel = env[ENV_MODEL]?.trim() || undefined;
  const maxAttempts = Math.max(1, config.maxAttempts ?? 3);

  const providerPromise: Promise<Provider> = pinned
    ? Promise.resolve(pinned)
    : detectProvider(key, fetchImpl);
  // Avoid unhandled rejections if detection fails before chat() is called.
  providerPromise.catch(() => {});

  async function chat(options: ChatOptions): Promise<ChatResult | ChatStream> {
    const provider = await providerPromise;
    const model = (options.model?.trim() || config.model) ?? envModel ?? DEFAULT_MODELS[provider];
    const req = buildRequest(provider, key, model, options);

    // Bounded retry for transient provider overload (429 / 5xx).
    let res: Response;
    for (let attempt = 1; ; attempt++) {
      res = await fetchImpl(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt >= maxAttempts) break;
      await res.body?.cancel().catch(() => {});
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay =
        retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** (attempt - 1) + Math.random() * 300;
      await new Promise((r) => setTimeout(r, Math.min(delay, 5000)));
    }

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

    if (!res.body) {
      throw new AIGatewayError("Provider returned no stream body.", 502, provider, "no_stream");
    }
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

  async function listModels(): Promise<string[]> {
    const provider = await providerPromise;
    const res = await fetchImpl(modelsUrl(provider), { headers: authHeaders(provider, key) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AIGatewayError(`${provider} model list failed (${res.status}): ${detail.slice(0, 300)}`, res.status, provider);
    }
    return parseModels(provider, await res.json()).sort();
  }

  return { provider: providerPromise, keySource, listModels, chat: chat as Gateway["chat"] };
}

type OneShot = ChatOptions & Pick<GatewayConfig, "apiKey" | "env" | "provider" | "fetch">;

/** One-shot convenience: `chat({ prompt })` — key from options or env. */
export async function chat(options: OneShot & { stream: true }): Promise<ChatStream>;
export async function chat(options: OneShot & { stream?: false }): Promise<ChatResult>;
export async function chat(options: OneShot): Promise<ChatResult | ChatStream> {
  const { apiKey, env, provider, fetch: f, ...rest } = options;
  const gateway = createGateway({ apiKey, env, provider, fetch: f });
  return (gateway.chat as (o: ChatOptions) => Promise<ChatResult | ChatStream>)(rest);
}
