export type Provider = "google" | "openai" | "groq" | "anthropic";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** Single-turn prompt. Ignored when `messages` is provided. */
  prompt?: string | undefined;
  /** Multi-turn history (alternating user/assistant). */
  messages?: ChatMessage[] | undefined;
  systemPrompt?: string | undefined;
  /** Override the provider default model. */
  model?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  /** When true, `chat()` resolves to an async iterable of text chunks. */
  stream?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface ChatResult {
  provider: Provider;
  model: string;
  text: string;
}

export interface ChatStream {
  provider: Provider;
  model: string;
  /** Text deltas as they arrive. */
  textStream: AsyncIterable<string>;
}

export interface GatewayConfig {
  /**
   * The provider key. Optional: when omitted, the key is read from `env`
   * (or `process.env`) — see ENV_KEYS for the variable names.
   */
  apiKey?: string | undefined;
  /** Env object to read keys from, e.g. the Cloudflare Workers `env` binding. */
  env?: Record<string, string | undefined> | undefined;
  /** Skip auto-detection when you already know the provider. */
  provider?: Provider | undefined;
  model?: string | undefined;
  /** Max attempts for 429/5xx responses (default 3, set 1 to disable retries). */
  maxAttempts?: number | undefined;
  fetch?: typeof fetch | undefined;
}

export type AIGatewayErrorCode =
  | "missing_key"
  | "detection_failed"
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "overloaded"
  | "upstream_error"
  | "no_stream";

export function codeForStatus(status: number | undefined): AIGatewayErrorCode {
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 503 || status === 529) return "overloaded";
  return "upstream_error";
}

export class AIGatewayError extends Error {
  readonly code: AIGatewayErrorCode;
  constructor(
    message: string,
    readonly status?: number,
    readonly provider?: Provider,
    code?: AIGatewayErrorCode,
  ) {
    super(message);
    this.name = "AIGatewayError";
    this.code = code ?? codeForStatus(status);
  }

  /** True when trying again later may succeed (rate limit / overload / 5xx). */
  get retryable(): boolean {
    return this.code === "rate_limited" || this.code === "overloaded" || (this.status ?? 0) >= 500;
  }
}
