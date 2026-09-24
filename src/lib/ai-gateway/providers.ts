import type { ChatMessage, ChatOptions, Provider } from "./types";

export const DEFAULT_MODELS: Record<Provider, string> = {
  google: "gemini-1.5-flash",
  openai: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  anthropic: "claude-3-5-haiku-latest",
};

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Pulls text out of a single SSE `data:` payload. */
  parseChunk: (json: unknown) => string;
  /** Pulls text out of a full non-streaming response. */
  parseFull: (json: unknown) => string;
  /** Some providers use a non-SSE stream framing. */
  framing: "sse" | "json-lines";
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

export function buildRequest(
  provider: Provider,
  apiKey: string,
  model: string,
  options: ChatOptions,
): ProviderRequest {
  const messages = toMessages(options);
  const stream = Boolean(options.stream);

  if (provider === "google") {
    const action = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}key=${encodeURIComponent(apiKey)}`,
      headers: { "Content-Type": "application/json" },
      body: {
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        ...(options.systemPrompt
          ? { systemInstruction: { parts: [{ text: options.systemPrompt }] } }
          : {}),
        generationConfig: {
          ...(options.temperature != null ? { temperature: options.temperature } : {}),
          ...(options.maxTokens != null ? { maxOutputTokens: options.maxTokens } : {}),
        },
      },
      framing: "sse",
      parseChunk: (json) =>
        pick<string>(json, ["candidates", 0, "content", "parts", 0, "text"]) ?? "",
      parseFull: (json) =>
        pick<string>(json, ["candidates", 0, "content", "parts", 0, "text"]) ?? "",
    };
  }

  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        max_tokens: options.maxTokens ?? 1024,
        ...(options.temperature != null ? { temperature: options.temperature } : {}),
        ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream,
      },
      framing: "sse",
      parseChunk: (json) =>
        pick<string>(json, ["delta", "text"]) ?? "",
      parseFull: (json) => pick<string>(json, ["content", 0, "text"]) ?? "",
    };
  }

  // OpenAI + Groq share the Chat Completions shape.
  const base =
    provider === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1";
  return {
    url: `${base}/chat/completions`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [
        ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
        ...messages,
      ],
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      ...(options.maxTokens != null ? { max_tokens: options.maxTokens } : {}),
      stream,
    },
    framing: "sse",
    parseChunk: (json) => pick<string>(json, ["choices", 0, "delta", "content"]) ?? "",
    parseFull: (json) => pick<string>(json, ["choices", 0, "message", "content"]) ?? "",
  };
}
