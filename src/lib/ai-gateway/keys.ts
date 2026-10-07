import { PROVIDERS, PROVIDER_IDS } from "./providers";
import type { Provider } from "./types";

export type EnvSource = Record<string, string | undefined>;

/**
 * Env variable names checked, in order. Generic names come first so one
 * variable can hold any provider's key; provider-specific names pin the provider.
 */
export const ENV_KEYS: ReadonlyArray<{ name: string; provider?: Provider }> = [
  { name: "AI_PROVIDER_API_KEY" },
  { name: "AI_GATEWAY_API_KEY" },
  { name: "AI_API_KEY" },
  ...PROVIDER_IDS.map((p) => ({ name: PROVIDERS[p].envKey, provider: p })),
  { name: "GOOGLE_API_KEY", provider: "google" as const },
  { name: "GOOGLE_GENERATIVE_AI_API_KEY", provider: "google" as const },
];

/** Optional env override for the model, e.g. AI_PROVIDER_MODEL=gpt-5-mini. */
export const ENV_MODEL = "AI_PROVIDER_MODEL";
/** Optional env override to pin the provider, e.g. AI_PROVIDER=mistral. */
export const ENV_PROVIDER = "AI_PROVIDER";

export function defaultEnv(): EnvSource {
  const proc = (globalThis as { process?: { env?: EnvSource } }).process;
  return proc?.env ?? {};
}

/** Parses one or more space/newline/comma separated keys into an array. */
export function parseKeys(input?: string | string[]): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.flatMap((k) => (typeof k === "string" ? k.trim().split(/[\s,]+/) : [])).filter(Boolean);
  }
  return input.trim().split(/[\s,]+/).filter(Boolean);
}

export interface ResolvedKey {
  apiKey: string;
  provider?: Provider;
  source: string;
}

export function resolveKeyFromEnv(env: EnvSource = defaultEnv()): ResolvedKey | null {
  for (const { name, provider } of ENV_KEYS) {
    const value = env[name]?.trim();
    if (value) return { apiKey: value, source: name, ...(provider ? { provider } : {}) };
  }
  return null;
}

