import { detectProvider, detectProviderFromKey } from "./detect";
import { ENV_KEYS, ENV_MODEL, ENV_PROVIDER, defaultEnv, resolveKeyFromEnv, parseKeys } from "./keys";
import {
  DEFAULT_MODELS,
  MODEL_PREFERENCES,
  PROVIDERS,
  PROVIDER_IDS,
  authHeaders,
  buildRequest,
  modelsUrl,
  parseModels,
  pickModel,
  resolveModelForProvider,
} from "./providers";
import { sseEvents } from "./stream";
import {
  AIGatewayError,
  codeForStatus,
  type ChatOptions,
  type ChatResult,
  type ChatStream,
  type GatewayConfig,
  type Provider,
} from "./types";

/** Library version — keep in sync with package.json and the git tag (vX.Y.Z). */
export const VERSION = "1.3.0";

export { startupCheck, type StartupReport } from "./startup";
export {
  AIGatewayError,
  DEFAULT_MODELS,
  ENV_KEYS,
  ENV_MODEL,
  ENV_PROVIDER,
  MODEL_PREFERENCES,
  PROVIDERS,
  PROVIDER_IDS,
  detectProvider,
  detectProviderFromKey,
  parseKeys,
  pickModel,
  resolveKeyFromEnv,
  resolveModelForProvider,
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
  /** Newest fast/cheap chat model from the live list; also becomes this gateway's default. */
  latestModel(): Promise<string>;
  chat(options: ChatOptions & { stream: true }): Promise<ChatStream>;
  chat(options: ChatOptions & { stream?: false }): Promise<ChatResult>;
}

/**
 * Creates a provider-agnostic chat client with automatic multi-key failover.
 * Supports multiple keys separated by spaces in apiKey or apiKeys array.
 * If one key/model fails or is quota-limited, it automatically falls through to the next key.
 */
export function createGateway(config: GatewayConfig = {}): Gateway {
  const fetchImpl = config.fetch ?? fetch;
  const env = config.env ?? defaultEnv();

  let rawKeyString = config.apiKey?.trim();
  let candidateKeys = parseKeys(config.apiKeys ?? rawKeyString);
  let keySource = "config";

  const envProvider = env[ENV_PROVIDER]?.trim() as Provider | undefined;
  const pinned: Provider | undefined =
    config.provider ?? (envProvider && envProvider in PROVIDERS ? envProvider : undefined);

  if (candidateKeys.length === 0) {
    const found = resolveKeyFromEnv(env);
    if (found) {
      candidateKeys = parseKeys(found.apiKey);
      keySource = found.source;
    }
  }

  if (candidateKeys.length === 0) {
    throw new AIGatewayError(
      `Missing API key. Pass { apiKey } (single or space-separated) or set one of: ${ENV_KEYS.map((k) => k.name).join(", ")}.`,
      401,
      undefined,
      "missing_key",
    );
  }

  const envModel = env[ENV_MODEL]?.trim() || undefined;
  const maxAttempts = Math.max(1, config.maxAttempts ?? 3);
  const timeoutMs = config.timeoutMs ?? 60_000;

  /** fetch that aborts if the provider sends no response headers within timeoutMs (streams may run longer). */
  async function timedFetch(url: string, init: RequestInit, provider: Provider): Promise<Response> {
    const ac = new AbortController();
    const outer = init.signal;
    const onAbort = () => ac.abort(outer?.reason);
    if (outer?.aborted) onAbort();
    outer?.addEventListener("abort", onAbort, { once: true });
    const timer = timeoutMs > 0 ? setTimeout(() => ac.abort("timeout"), timeoutMs) : undefined;
    try {
      return await fetchImpl(url, { ...init, signal: ac.signal });
    } catch (e) {
      if (ac.signal.reason === "timeout") {
        throw new AIGatewayError(`${provider} did not respond within ${timeoutMs}ms.`, 504, provider, "timeout");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  interface KeyCandidate {
    key: string;
    getProvider: () => Promise<Provider>;
  }

  const candidates: KeyCandidate[] = candidateKeys.map((k, idx) => ({
    key: k,
    getProvider: () => (pinned && idx === 0 ? Promise.resolve(pinned) : detectProvider(k, fetchImpl)),
  }));

  const primaryProviderPromise = candidates[0]!.getProvider();
  primaryProviderPromise.catch(() => {});

  /** provider → model auto-discovered from the live list (per gateway instance). */
  const discovered = new Map<Provider, string>();

  async function fetchModels(provider: Provider, key: string): Promise<string[]> {
    const res = await timedFetch(modelsUrl(provider), { headers: authHeaders(provider, key) }, provider);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AIGatewayError(`${provider} model list failed (${res.status}): ${detail.slice(0, 300)}`, res.status, provider);
    }
    return parseModels(provider, await res.json()).sort();
  }

  async function discoverModel(provider: Provider, key: string): Promise<string> {
    const model = pickModel(provider, await fetchModels(provider, key));
    discovered.set(provider, model);
    return model;
  }

  /** POST with retries on 429/5xx (exponential backoff, honours Retry-After). */
  async function send(req: ReturnType<typeof buildRequest>, provider: Provider, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const res = await timedFetch(
        req.url,
        { method: "POST", headers: req.headers, body: JSON.stringify(req.body), ...(signal ? { signal } : {}) },
        provider,
      );
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt >= maxAttempts) return res;
      await res.body?.cancel().catch(() => {});
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** (attempt - 1) + Math.random() * 300;
      await new Promise((r) => setTimeout(r, Math.min(delay, 5000)));
    }
  }

  async function chat(options: ChatOptions): Promise<ChatResult | ChatStream> {
    const failures: string[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (!candidate) continue;
      let provider: Provider;
      try {
        provider = await candidate.getProvider();
      } catch (detErr: unknown) {
        const msg = detErr instanceof Error ? detErr.message : String(detErr);
        failures.push(`Key #${i + 1} (${candidate.key.slice(0, 8)}...): provider detection failed - ${msg}`);
        if (i < candidates.length - 1) {
          console.warn(`[ai-gateway] Key #${i + 1} detection failed. Jumping to next key #${i + 2}...`);
          continue;
        }
        break;
      }

      const requestedModel = options.model?.trim() || config.model || envModel;
      let model = requestedModel
        ? resolveModelForProvider(provider, requestedModel)
        : (discovered.get(provider) ?? DEFAULT_MODELS[provider]);
      let req = buildRequest(provider, candidate.key, model, options);

      try {
        let res = await send(req, provider, options.signal);

        // Default model retired? Ask the provider what exists now and use the newest fit.
        if (res.status === 404 && !requestedModel && config.discoverModels !== false) {
          await res.body?.cancel().catch(() => {});
          const next = await discoverModel(provider, candidate.key).catch(() => undefined);
          if (next && next !== model) {
            console.warn(`[ai-gateway] ${provider}: "${model}" unavailable, switching to "${next}".`);
            model = next;
            req = buildRequest(provider, candidate.key, model, options);
            res = await send(req, provider, options.signal);
          }
        }

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new AIGatewayError(
            `${provider} request failed (${res.status}): ${detail.slice(0, 500)}`,
            res.status,
            provider,
            codeForStatus(res.status),
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
      } catch (err: unknown) {
        // A cancelled request must not cascade to the next key.
        if (options.signal?.aborted) throw err;
        const errMsg = err instanceof Error ? err.message : String(err);
        failures.push(`Key #${i + 1} [${provider} / ${model}]: ${errMsg}`);
        if (i < candidates.length - 1) {
          console.warn(
            `[ai-gateway] Key #${i + 1} (${provider}) failed (${errMsg}). Cascading to next key #${i + 2}...`,
          );
          continue;
        }
        throw new AIGatewayError(
          candidates.length > 1
            ? `All ${candidates.length} API keys exhausted:\n` + failures.map((f) => `  • ${f}`).join("\n")
            : errMsg,
          err instanceof AIGatewayError ? err.status : 502,
          provider,
          err instanceof AIGatewayError ? err.code : "upstream_error",
        );
      }
    }

    throw new AIGatewayError(
      `All ${candidates.length} keys failed to execute:\n` + failures.join("\n"),
      502,
      undefined,
      "upstream_error",
    );
  }

  async function listModels(): Promise<string[]> {
    return fetchModels(await primaryProviderPromise, candidateKeys[0] || "");
  }

  async function latestModel(): Promise<string> {
    return discoverModel(await primaryProviderPromise, candidateKeys[0] || "");
  }

  return { provider: primaryProviderPromise, keySource, listModels, latestModel, chat: chat as Gateway["chat"] };
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
