import type { Provider } from "./types";

export type EnvSource = Record<string, string | undefined>;

/**
 * Env variable names checked, in order. Generic names come first so one
 * variable can hold any provider's key; provider-specific names also pin
 * the provider (no detection needed).
 */
export const ENV_KEYS: ReadonlyArray<{ name: string; provider?: Provider }> = [
  { name: "AI_PROVIDER_API_KEY" },
  { name: "AI_GATEWAY_API_KEY" },
  { name: "GEMINI_API_KEY", provider: "google" },
  { name: "GOOGLE_API_KEY", provider: "google" },
  { name: "GOOGLE_GENERATIVE_AI_API_KEY", provider: "google" },
  { name: "OPENAI_API_KEY", provider: "openai" },
  { name: "GROQ_API_KEY", provider: "groq" },
  { name: "ANTHROPIC_API_KEY", provider: "anthropic" },
];

/** Optional env override for the model, e.g. AI_PROVIDER_MODEL=gpt-4o. */
export const ENV_MODEL = "AI_PROVIDER_MODEL";

/** Reads `process.env` safely on runtimes where `process` may not exist. */
export function defaultEnv(): EnvSource {
  const proc = (globalThis as { process?: { env?: EnvSource } }).process;
  return proc?.env ?? {};
}

export interface ResolvedKey {
  apiKey: string;
  provider?: Provider;
  source: string;
}

/** Finds the first configured key in the given env (defaults to process.env). */
export function resolveKeyFromEnv(env: EnvSource = defaultEnv()): ResolvedKey | null {
  for (const { name, provider } of ENV_KEYS) {
    const value = env[name]?.trim();
    if (value) return { apiKey: value, source: name, ...(provider ? { provider } : {}) };
  }
  return null;
}
