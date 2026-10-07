import type { ChatMessage, ChatOptions, Provider } from "./types";

/**
 * Provider registry — the single place to add a new AI service.
 * `kind: "openai"` means the service speaks the OpenAI Chat Completions shape,
 * so adding one is just a base URL + default model + key prefix.
 */
export interface ProviderInfo {
  label: string;
  kind: "openai" | "google" | "anthropic";
  baseUrl: string;
  defaultModel: string;
  /** Key prefixes that identify this provider (checked longest-first). */
  prefixes: string[];
  /**
   * Model-name pattern this provider serves. A requested model that does not
   * match falls back to `defaultModel` (e.g. "gpt-5" sent to a Gemini key).
   * Omit for multi-vendor hosts (OpenRouter, Groq, Together, ...) that accept any id.
   */
  family?: RegExp;
  /** Env var that pins this provider. */
  envKey: string;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  google: {
    label: "Google Gemini",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-flash-latest",
    family: /gemini|gemma|learnlm/i,
    prefixes: ["AIza", "AQ."],
    envKey: "GEMINI_API_KEY",
  },
  openai: {
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5-mini",
    family: /^(gpt|o\d|chatgpt|text-|codex)/i,
    prefixes: ["sk-proj-", "sk-svcacct-", "sk-"],
    envKey: "OPENAI_API_KEY",
  },
  anthropic: {
    label: "Anthropic Claude",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    family: /claude/i,
    prefixes: ["sk-ant-"],
    envKey: "ANTHROPIC_API_KEY",
  },
  groq: {
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    prefixes: ["gsk_"],
    envKey: "GROQ_API_KEY",
  },
  xai: {
    label: "xAI Grok",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.5",
    family: /grok/i,
    prefixes: ["xai-"],
    envKey: "XAI_API_KEY",
  },
  openrouter: {
    label: "OpenRouter (300+ models)",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/auto",
    prefixes: ["sk-or-"],
    envKey: "OPENROUTER_API_KEY",
  },
  perplexity: {
    label: "Perplexity",
    kind: "openai",
    baseUrl: "https://api.perplexity.ai",
    defaultModel: "sonar",
    prefixes: ["pplx-"],
    envKey: "PERPLEXITY_API_KEY",
  },
  cerebras: {
    label: "Cerebras",
    kind: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    prefixes: ["csk-"],
    envKey: "CEREBRAS_API_KEY",
  },
  fireworks: {
    label: "Fireworks",
    kind: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    prefixes: ["fw_"],
    envKey: "FIREWORKS_API_KEY",
  },
  // No distinctive key prefix — detected via a live /models probe.
  mistral: {
    label: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    family: /mistral|ministral|codestral|pixtral|magistral|devstral|open-/i,
    prefixes: [],
    envKey: "MISTRAL_API_KEY",
  },
  deepseek: {
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    family: /deepseek/i,
    prefixes: [],
    envKey: "DEEPSEEK_API_KEY",
  },
  together: {
    label: "Together AI",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    prefixes: [],
    envKey: "TOGETHER_API_KEY",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[];

export const DEFAULT_MODELS = Object.fromEntries(
  PROVIDER_IDS.map((p) => [p, PROVIDERS[p].defaultModel]),
) as Record<Provider, string>;

/**
 * Picks the model for a provider: the requested one when it belongs to that
 * provider's family (or the provider hosts any vendor), otherwise its default.
 * Never rewrites a valid model id — unknown ids surface as `not_found`.
 */
export function resolveModelForProvider(provider: Provider, requestedModel?: string): string {
  const req = requestedModel?.trim();
  if (!req) return DEFAULT_MODELS[provider];
  const family = PROVIDERS[provider].family;
  return !family || family.test(req) ? req : DEFAULT_MODELS[provider];
}

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  parseChunk: (json: unknown) => string;
  parseFull: (json: unknown) => string;
}

function toMessages(options: ChatOptions): ChatMessage[] {
  if (options.messages?.length) return options.messages;
  return [{ role: "user", content: options.prompt ?? "" }];
}

function pick<T>(value: unknown, path: (string | number)[]): T | undefined {
  let cur: unknown = value;
  for (const seg of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur as T | undefined;
}

/** Joins all text parts (Gemini can split one reply into several parts). */
function geminiText(json: unknown): string {
  const parts = pick<Array<{ text?: string; thought?: boolean }>>(json, ["candidates", 0, "content", "parts"]);
  return (parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
}

/** Auth headers used for both chat and the /models listing. */
export function authHeaders(provider: Provider, apiKey: string): Record<string, string> {
  const kind = PROVIDERS[provider].kind;
  if (kind === "google") return { "x-goog-api-key": apiKey };
  if (kind === "anthropic") return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  return { Authorization: `Bearer ${apiKey}` };
}

export function buildRequest(
  provider: Provider,
  apiKey: string,
  model: string,
  options: ChatOptions,
): ProviderRequest {
  const info = PROVIDERS[provider];
  const messages = toMessages(options);
  const stream = Boolean(options.stream);
  const headers = { "Content-Type": "application/json", ...authHeaders(provider, apiKey) };

  if (info.kind === "google") {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return {
      url: `${info.baseUrl}/models/${model}:${action}`,
      headers,
      body: {
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        ...(options.systemPrompt ? { systemInstruction: { parts: [{ text: options.systemPrompt }] } } : {}),
        generationConfig: {
          ...(options.temperature != null ? { temperature: options.temperature } : {}),
          ...(options.maxTokens != null ? { maxOutputTokens: options.maxTokens } : {}),
        },
      },
      parseChunk: geminiText,
      parseFull: geminiText,
    };
  }

  if (info.kind === "anthropic") {
    return {
      url: `${info.baseUrl}/messages`,
      headers,
      body: {
        model,
        max_tokens: options.maxTokens ?? 1024,
        ...(options.temperature != null ? { temperature: options.temperature } : {}),
        ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream,
      },
      parseChunk: (json) =>
        pick<string>(json, ["type"]) === "content_block_delta"
          ? (pick<string>(json, ["delta", "text"]) ?? "")
          : "",
      parseFull: (json) =>
        (pick<Array<{ type: string; text?: string }>>(json, ["content"]) ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join(""),
    };
  }

  // OpenAI-compatible (OpenAI, Groq, xAI, Mistral, DeepSeek, OpenRouter, ...).
  // OpenAI's newer models reject `max_tokens`; they want `max_completion_tokens`.
  const tokenField = provider === "openai" ? "max_completion_tokens" : "max_tokens";
  return {
    url: `${info.baseUrl}/chat/completions`,
    headers,
    body: {
      model,
      messages: [
        ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
        ...messages,
      ],
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      ...(options.maxTokens != null ? { [tokenField]: options.maxTokens } : {}),
      stream,
    },
    parseChunk: (json) => pick<string>(json, ["choices", 0, "delta", "content"]) ?? "",
    parseFull: (json) => pick<string>(json, ["choices", 0, "message", "content"]) ?? "",
  };
}

/** URL that lists a provider's models (also used as the detection probe). */
export function modelsUrl(provider: Provider): string {
  return `${PROVIDERS[provider].baseUrl}/models${PROVIDERS[provider].kind === "google" ? "?pageSize=1000" : ""}`;
}

/** Normalises any provider's /models response to a list of chat model ids. */
export function parseModels(provider: Provider, json: unknown): string[] {
  if (PROVIDERS[provider].kind === "google") {
    const list = pick<Array<{ name: string; supportedGenerationMethods?: string[] }>>(json, ["models"]) ?? [];
    return list
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
  }
  const list = pick<Array<{ id: string }>>(json, ["data"]) ?? [];
  return list.map((m) => m.id).filter(Boolean);
}
