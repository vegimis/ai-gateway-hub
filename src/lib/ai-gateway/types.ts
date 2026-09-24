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
  apiKey: string;
  /** Skip auto-detection when you already know the provider. */
  provider?: Provider;
  model?: string;
  fetch?: typeof fetch;
}

export class AIGatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly provider?: Provider,
  ) {
    super(message);
    this.name = "AIGatewayError";
  }
}
