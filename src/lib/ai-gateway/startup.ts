import { createGateway } from "./index";
import type { GatewayConfig } from "./types";

export interface StartupReport {
  ok: boolean;
  provider?: string;
  model?: string;
  keySource?: string;
  reply?: string;
  error?: string;
  ms: number;
}

const TAG = "[ai-gateway]";
let once: Promise<StartupReport> | undefined;

/**
 * Boot check: asks the AI to introduce itself and logs its real reply.
 * Never throws — failures are logged and returned as { ok: false }.
 * Safe to call many times; runs only once per process.
 */
export function startupCheck(config: GatewayConfig = {}): Promise<StartupReport> {
  once ??= run(config);
  return once;
}

async function run(config: GatewayConfig): Promise<StartupReport> {
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  let gateway;
  try {
    gateway = createGateway(config);
  } catch (e) {
    const error = (e as Error).message;
    console.warn(`${TAG} inactive — ${error}`);
    return { ok: false, error, ms: ms() };
  }

  let provider: string | undefined;
  try {
    provider = await gateway.provider;
    console.log(`${TAG} key found (${gateway.keySource}) → provider: ${provider}. Asking the AI to say hello…`);
    const res = await gateway.chat({
      prompt:
        "You are being started inside an app. In one short sentence, greet the developer and say which AI model you are.",
      maxTokens: 80,
    });
    const reply = res.text.trim();
    console.log(`${TAG} ✅ active — provider: ${res.provider}, model: ${res.model}, key: ${gateway.keySource} (${ms()}ms)`);
    console.log(`${TAG} 🤖 AI says: "${reply}"`);
    return { ok: true, provider: res.provider, model: res.model, keySource: gateway.keySource, reply, ms: ms() };
  } catch (e) {
    const error = (e as Error).message;
    console.warn(`${TAG} ⚠️ key present but AI did not answer${provider ? ` (${provider})` : ""}: ${error.slice(0, 300)}`);
    console.warn(`${TAG} the app keeps running; chat calls will retry on demand.`);
    return { ok: false, ...(provider ? { provider } : {}), keySource: gateway.keySource, error, ms: ms() };
  }
}
