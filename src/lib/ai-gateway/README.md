# ai-gateway — one key, any AI

A tiny, zero-dependency TypeScript library that gives every app the same AI connection.
You give it **one API key**; it works out which AI service the key belongs to, picks a good
default model, and answers through a single `chat()` call — streaming or not. Swapping AI
services never changes your app code.

- Zero dependencies (only `fetch` + web streams) — Node 18+, Vercel, Firebase, Cloudflare Workers, Deno, Bun
- 12 AI services, detected automatically
- Model chosen **automatically** or **manually**, and you can list every model your key can use
- Streaming, multi-turn history, system prompts, cancel, automatic retries on busy/rate-limit
- A startup check where the AI itself greets you in the logs
- Typed errors with stable codes

> Server-side only. Never put an AI key in browser code. Call the library from your server
> (API route / server function) and stream the answer to the browser.

---

## 1. What it does, step by step

```text
your key ──► detect service ──► pick model ──► send request ──► normalise stream ──► text
             (key prefix,        (yours, env,    (right URL,       (same {delta} chunks
              or live probe)      or default)     headers, body)    for every service)
```

1. **Find the key** — from your code, an env object, or environment variables.
2. **Detect the service** — from the key's prefix (instant); if the key has no known prefix,
   it asks each service's `/models` endpoint which one accepts it.
3. **Pick the model** — the model you pass, else `AI_PROVIDER_MODEL`, else the service default.
4. **Call the service** in its own format and turn the reply into plain text chunks.
5. **Retry** automatically (up to 3 attempts) when the service is busy (429 / 5xx).

## 2. Supported AI services

| Service | Key looks like | Env variable | Default model |
| --- | --- | --- | --- |
| Google Gemini | `AIza…` / `AQ.…` | `GEMINI_API_KEY` | `gemini-flash-latest` |
| OpenAI | `sk-…` / `sk-proj-…` | `OPENAI_API_KEY` | `gpt-6-luna` |
| Anthropic Claude | `sk-ant-…` | `ANTHROPIC_API_KEY` | `claude-haiku-4-5` |
| Groq | `gsk_…` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| xAI Grok | `xai-…` | `XAI_API_KEY` | `grok-4.5` |
| OpenRouter (300+ models) | `sk-or-…` | `OPENROUTER_API_KEY` | `openrouter/auto` |
| Perplexity | `pplx-…` | `PERPLEXITY_API_KEY` | `sonar` |
| Cerebras | `csk-…` | `CEREBRAS_API_KEY` | `llama-3.3-70b` |
| Fireworks | `fw_…` | `FIREWORKS_API_KEY` | `accounts/fireworks/models/llama-v3p3-70b-instruct` |
| Mistral | no prefix (probed) | `MISTRAL_API_KEY` | `mistral-small-latest` |
| DeepSeek | `sk-` + 32 hex (probed) | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| Together AI | no prefix (probed) | `TOGETHER_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |

Defaults are the fast, low-cost model of each service. Model names change often — use
`listModels()` (below) to see what your key can use today, and override with `model`.

**Adding a service** is one entry in `PROVIDERS` in `providers.ts` (label, base URL, default
model, key prefixes, env name). Any service with an OpenAI-compatible API works that way.

---

## 3. Reuse it in another project

The library is one folder: `src/lib/ai-gateway/`
(`index.ts`, `types.ts`, `providers.ts`, `detect.ts`, `keys.ts`, `stream.ts`, `startup.ts`, `package.json`, `README.md`).

```bash
# copy the folder into the new project
cp -r path/to/this-project/src/lib/ai-gateway  path/to/new-project/src/lib/

# or install it as a local package
npm install ./path/to/ai-gateway        # or: bun add ./path/to/ai-gateway
```

Nothing else to install. Then:

```ts
import { chat, createGateway, startupCheck } from "@/lib/ai-gateway"; // or "@your-name/ai-gateway"
```

---

## 4. Entering the key — 4 ways

Checked in this order; the first one found wins.

**a) Environment variable (recommended)** — set one, call with no key:

```bash
AI_PROVIDER_API_KEY=your-key          # any service, auto-detected
# or a service-specific name, e.g. OPENAI_API_KEY=..., ANTHROPIC_API_KEY=...
AI_PROVIDER_MODEL=gpt-6-luna          # optional: force a model
AI_PROVIDER=mistral                   # optional: force the service (skips detection)
```

Where to set it:

| Platform | How |
| --- | --- |
| Local | `.env` file (never commit it) |
| Vercel | Project → Settings → Environment Variables |
| Firebase | `firebase functions:secrets:set AI_PROVIDER_API_KEY` |
| Cloudflare Workers | `wrangler secret put AI_PROVIDER_API_KEY` |
| Lovable | Project secrets (ask the agent to "save my AI key") |

**b) An env object** (Cloudflare Workers, tests): `createGateway({ env })`

**c) Passed directly** (each user brings their own key): `createGateway({ apiKey: userKey })`

**d) Pin service and model**: `createGateway({ apiKey, provider: "anthropic", model: "claude-haiku-4-5" })`

---

## 5. Commands / usage

```ts
// Automatic: service + model detected
const { text, provider, model } = await chat({ prompt: "Hello" });

// Manual model
await chat({ prompt: "Hello", model: "gpt-6-luna" });

// Streaming
const { textStream } = await chat({ systemPrompt: "Be brief.", prompt: "Explain DNS", stream: true });
for await (const delta of textStream) process.stdout.write(delta);

// Reusable client (detection runs once)
const ai = createGateway();
console.log(await ai.provider);        // "google"
console.log(ai.keySource);             // "AI_PROVIDER_API_KEY"
console.log(await ai.listModels());    // every chat model this key can use

// Conversation history
await ai.chat({ messages: [
  { role: "user", content: "My name is Ana." },
  { role: "assistant", content: "Hi Ana!" },
  { role: "user", content: "What's my name?" },
]});

// Cancel
const ac = new AbortController();
ai.chat({ prompt: "Long essay…", stream: true, signal: ac.signal });
ac.abort();
```

### Options for `chat()`

| Option | Notes |
| --- | --- |
| `prompt` | Single question |
| `messages` | Conversation history (overrides `prompt`) |
| `systemPrompt` | Instructions for the AI |
| `model` | Manual model; empty = automatic |
| `temperature` | 0–2 (some reasoning models ignore/reject it) |
| `maxTokens` | Answer length cap |
| `stream` | `true` returns `{ textStream }` |
| `signal` | `AbortSignal` to cancel |

### `createGateway(config)`

| Field | Notes |
| --- | --- |
| `apiKey` | Optional, falls back to env |
| `env` | Env object to read keys from |
| `provider` | Skip detection |
| `model` | Default model for this client |
| `maxAttempts` | Retries for busy/rate-limit, default 3 (`1` = off) |
| `fetch` | Custom fetch (tests, proxies) |

### Startup check — the AI greets you

```ts
import { startupCheck } from "@/lib/ai-gateway";
startupCheck(); // never throws, runs once
```

```text
[ai-gateway] key found (AI_PROVIDER_API_KEY) → provider: google. Asking the AI to say hello…
[ai-gateway] ✅ active — provider: google, model: gemini-flash-latest, key: AI_PROVIDER_API_KEY (812ms)
[ai-gateway] 🤖 AI says: "Hello developer! I'm Gemini, a model by Google."
```

No key / bad key / busy service → a `⚠️` warning, and the app keeps running.

---

## 6. HTTP endpoints (in this project)

| Endpoint | What it does |
| --- | --- |
| `POST /api/chat` | Body `{ prompt, systemPrompt?, model?, provider?, temperature?, maxTokens?, stream? }`. Streaming replies are SSE `data: {"delta":"…"}` ending with `data: [DONE]`; headers `X-AI-Provider` / `X-AI-Model` |
| `GET /api/models` | `{ provider, label, defaultModel, keySource, models[] }` for the saved key |

```bash
curl -N -X POST http://localhost:8080/api/chat -H 'content-type: application/json' \
  -d '{"prompt":"Say hi","stream":true}'
curl -X POST http://localhost:8080/api/chat -H 'content-type: application/json' \
  -d '{"prompt":"Say hi","model":"gemini-3.5-flash-lite"}'
curl http://localhost:8080/api/models
```

Errors come back as JSON `{ "error": "…" }`: 400 no key / bad input, 401/403 bad key,
404 unknown model, 424 service busy or failing.

## 7. Testing it on the page

1. Save a key (`AI_PROVIDER_API_KEY`).
2. Open the home page. The **Model** box shows which service your key was detected as.
3. Leave it on **Automatic**, or pick any model from the list.
4. Type a question and press **Send** — the answer streams in, and the service · model used
   is shown next to the button.

---

## 8. Errors

Every failure throws `AIGatewayError` with `status`, `provider`, `code`, `retryable`.

| `code` | Meaning |
| --- | --- |
| `missing_key` | No key passed and none in env |
| `detection_failed` | Key didn't match any service |
| `invalid_request` | Bad parameters (400) |
| `unauthorized` | Key invalid or revoked (401/403) |
| `not_found` | Model doesn't exist / retired (404) |
| `rate_limited` | Quota / rate limit (429) |
| `overloaded` | Service busy (503/529) |
| `upstream_error` | Other service failure |
| `no_stream` | Service returned no stream |

---

## 9. Is this all you need from an AI connection?

For **text chat** (questions, assistants, summaries, rewriting, chat widgets) — yes.
Not included (add later if an app needs them): images, embeddings / vector search,
speech, tool/function calling, structured JSON output, and per-user rate limiting/auth
on your endpoint.

## 10. Security checklist

- Keys stay on the server; the browser only talks to your own endpoint
- Never commit `.env`; rotate any key pasted into chat or logs
- Add auth / rate limiting to `/api/chat` before going public
