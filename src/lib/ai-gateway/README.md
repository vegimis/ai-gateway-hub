# @your-name/ai-gateway

One API key in, streaming answers out. A zero-dependency TypeScript library that talks to
**Google Gemini, OpenAI, Groq and Anthropic** through a single `chat()` call. It detects the
provider from the key, picks a sensible default model, and normalises streaming so swapping
providers never changes your app code.

- Zero dependencies — only `fetch`, `TextDecoder` and web streams
- Runs on Node.js 18+, Vercel, Firebase Functions, Cloudflare Workers, Deno, Bun
- Streaming and non-streaming, multi-turn history, system prompts, abort signals
- Automatic retries on 429 / 5xx with backoff (honours `Retry-After`)
- Typed errors with stable `code`s

> Server-side only. Never ship a provider key to the browser — call the library from a
> server function / API route and stream to the client (see "HTTP endpoint").

---

## Install / copy into a project

Copy the `src/lib/ai-gateway/` folder into the new project (files: `index.ts`, `types.ts`,
`detect.ts`, `keys.ts`, `providers.ts`, `stream.ts`). Import from wherever you placed it:

```ts
import { chat, createGateway } from "@/lib/ai-gateway";
```

---

## Giving it a key — 4 ways

The key is resolved in this order; the first one found wins.

### 1. Environment variable (recommended)

Set any one of these and call the library with no key at all:

| Variable | Provider |
| --- | --- |
| `AI_PROVIDER_API_KEY` | auto-detected (any provider) |
| `AI_GATEWAY_API_KEY` | auto-detected (any provider) |
| `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | Google |
| `OPENAI_API_KEY` | OpenAI |
| `GROQ_API_KEY` | Groq |
| `ANTHROPIC_API_KEY` | Anthropic |

Optional: `AI_PROVIDER_MODEL` overrides the default model.

```ts
const { text } = await chat({ prompt: "Hello" }); // key read from env
```

Where to set them:
- **Local**: `.env` file (`AI_PROVIDER_API_KEY=...`) — never commit it
- **Vercel**: Project → Settings → Environment Variables
- **Firebase**: `firebase functions:secrets:set AI_PROVIDER_API_KEY`
- **Cloudflare Workers**: `wrangler secret put AI_PROVIDER_API_KEY` (see option 2)
- **Lovable**: Project secrets

### 2. An explicit env object (Cloudflare Workers, tests)

Workers don't always expose `process.env`; pass the binding object instead:

```ts
export default {
  async fetch(req: Request, env: Record<string, string>) {
    const gateway = createGateway({ env });
    const { text } = await gateway.chat({ prompt: "Hi" });
    return new Response(text);
  },
};
```

### 3. Pass the key directly

Useful for "bring your own key" apps where each user supplies a key (store it encrypted
server-side):

```ts
const gateway = createGateway({ apiKey: userKey });
```

### 4. Pin the provider

If you already know the provider, skip detection entirely:

```ts
createGateway({ apiKey, provider: "anthropic", model: "claude-3-5-sonnet-latest" });
```

`gateway.keySource` tells you where the key came from (`"config"` or the env variable name).

---

## Usage

```ts
// One-shot
const { text, provider, model } = await chat({ prompt: "Hello" });

// Streaming
const { textStream } = await chat({
  systemPrompt: "Be brief.",
  prompt: "Why are cold starts slow?",
  stream: true,
});
for await (const delta of textStream) process.stdout.write(delta);

// Reusable client (detection runs once)
const gateway = createGateway();
await gateway.chat({
  messages: [
    { role: "user", content: "My name is Ana." },
    { role: "assistant", content: "Nice to meet you, Ana!" },
    { role: "user", content: "What's my name?" },
  ],
});

// Cancel
const ac = new AbortController();
gateway.chat({ prompt: "Long essay…", stream: true, signal: ac.signal });
ac.abort();
```

### Options

| Option | Type | Notes |
| --- | --- | --- |
| `prompt` | `string` | Single-turn prompt |
| `messages` | `ChatMessage[]` | Multi-turn history; overrides `prompt` |
| `systemPrompt` | `string` | System instruction |
| `model` | `string` | Overrides the default |
| `temperature` | `number` | 0–2 |
| `maxTokens` | `number` | Output cap |
| `stream` | `boolean` | Returns `{ textStream }` when true |
| `signal` | `AbortSignal` | Cancel the request |

### `createGateway(config)`

| Field | Notes |
| --- | --- |
| `apiKey` | Optional — falls back to env |
| `env` | Env object to read keys from |
| `provider` | Skip detection |
| `model` | Default model for this client |
| `maxAttempts` | Retries for 429/5xx, default `3` (`1` = no retry) |
| `fetch` | Custom fetch (tests, proxies) |

---

## Provider detection

1. **Key prefix** (instant, free): `sk-ant-` → Anthropic, `gsk_` → Groq,
   `AIza` / `AQ.` → Google, `sk-` → OpenAI.
2. **Provider-specific env name** (e.g. `GROQ_API_KEY`) pins the provider.
3. **Fallback**: a live `GET /models` probe against each provider.

### Default models

| Provider | Default |
| --- | --- |
| Google | `gemini-flash-latest` |
| OpenAI | `gpt-4o-mini` |
| Groq | `llama-3.3-70b-versatile` |
| Anthropic | `claude-3-5-haiku-latest` |

---

## Errors

Every failure throws `AIGatewayError` with `status`, `provider`, `code` and `retryable`.

| `code` | Meaning |
| --- | --- |
| `missing_key` | No key passed and none found in env |
| `detection_failed` | Key didn't match any provider |
| `invalid_request` | Bad model name / parameters (400) |
| `unauthorized` | Key invalid or revoked (401/403) |
| `not_found` | Model doesn't exist (404) |
| `rate_limited` | Quota / rate limit (429) — retry later |
| `overloaded` | Provider busy (503/529) — retry later |
| `upstream_error` | Other provider failure |
| `no_stream` | Provider returned no stream body |

```ts
try {
  await chat({ prompt: "Hi" });
} catch (e) {
  if (e instanceof AIGatewayError && e.retryable) showToast("AI is busy, try again soon");
  else throw e;
}
```

---

## HTTP endpoint

`src/routes/api/chat.ts` exposes `POST /api/chat`:

```json
{ "prompt": "Hi", "systemPrompt": "Be brief", "stream": true }
```

Streaming responses are SSE frames `data: {"delta":"..."}`, ending with `data: [DONE]`;
headers `X-AI-Provider` / `X-AI-Model` show what answered. Errors are JSON
`{ "error": "...", "code": "..." }`. A Vercel `api/chat.ts` or Firebase function can wrap
`createGateway()` the same way.

---

## Security checklist

- Keys stay on the server; the browser only talks to your own endpoint
- Never commit `.env`; rotate any key that was pasted into chat or logs
- Add rate limiting / auth to your endpoint before going public

---

## Plug & go: startup check

Call once when your app starts (or on first request in Workers). The AI itself answers — the
reply you see in the logs is generated live, not hard-coded. It never throws.

```ts
import { startupCheck } from "@/lib/ai-gateway";
startupCheck(); // or startupCheck({ apiKey, env })
```

Console output:

```
[ai-gateway] key found (AI_PROVIDER_API_KEY) → provider: google. Asking the AI to say hello…
[ai-gateway] ✅ active — provider: google, model: gemini-flash-latest, key: AI_PROVIDER_API_KEY (812ms)
[ai-gateway] 🤖 AI says: "Hello developer! I'm Gemini, a model by Google."
```

On failure (no key, bad key, provider busy) it logs a `⚠️` warning and the app keeps running.
Returns `{ ok, provider, model, keySource, reply, error, ms }`.
