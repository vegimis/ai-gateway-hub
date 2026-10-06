# @your-name/ai-gateway

**One key, any AI.** Give it one API key — it detects the AI service, picks a model, and
answers through a single `chat()` call (streaming or not). Swapping services never changes
your code.

- Zero dependencies — plain TypeScript, `fetch` + web streams (~9 small files)
- Works in any React + Vite app server side, and in Node 18+, Vercel, Firebase, Cloudflare Workers, Deno, Bun
- 12 services auto-detected; model automatic **or** manual
- Streaming, history, system prompts, cancel, retries, typed errors
- Startup check: the AI itself says hello in your logs

> **Server-side only.** Never ship an AI key to the browser. Call the library from a server
> function / API route and stream the answer to your React UI.

---

## 1. Install — pinned to a version from GitHub

The library is versioned with git tags (`v1.1.0`, `v1.2.0`, …). Pin the tag so your apps
never change unexpectedly.

### Step 1 (once): give the library its own repo

Create an empty GitHub repo, e.g. `your-name/ai-gateway`, and put **only the contents of
this folder** in it (the `package.json` must be at the repo root):

```bash
cp -r src/lib/ai-gateway /tmp/ai-gateway && cd /tmp/ai-gateway
git init && git add . && git commit -m "v1.1.0"
git branch -M main
git remote add origin https://github.com/your-name/ai-gateway.git
git push -u origin main
git tag v1.1.0 && git push origin v1.1.0
```

Rename `"name"` in `package.json` from `@your-name/ai-gateway` to your own scope first.

### Step 2: install in any app, with the version

```bash
npm  install github:your-name/ai-gateway#v1.1.0
pnpm add     github:your-name/ai-gateway#v1.1.0
bun  add     github:your-name/ai-gateway#v1.1.0
yarn add     github:your-name/ai-gateway#v1.1.0
```

`package.json` then contains:

```json
"dependencies": { "@your-name/ai-gateway": "github:your-name/ai-gateway#v1.1.0" }
```

Private repo? Use `git+ssh://git@github.com/your-name/ai-gateway.git#v1.1.0`.

### Upgrade / release a new version

```bash
# in the library repo: change code, bump "version" in package.json + VERSION in index.ts + CHANGELOG
git commit -am "v1.2.0" && git tag v1.2.0 && git push && git push origin v1.2.0
# in each app
npm install github:your-name/ai-gateway#v1.2.0
```

Check the running version: `import { VERSION } from "@your-name/ai-gateway"`.

### Alternative: copy the folder

No GitHub needed: `cp -r src/lib/ai-gateway your-app/src/lib/` and import from `@/lib/ai-gateway`.

> The package ships TypeScript source (no build step). Vite, TanStack Start, Next, Bun, Deno
> and Wrangler compile it automatically. For plain Node without a bundler use Node 22.6+ with
> `--experimental-strip-types`, or `tsx`.

---

## 2. Give it the key — 4 ways (first match wins)

**a) Environment variable (recommended)** — no code needed:

```bash
AI_PROVIDER_API_KEY=your-key   # any service, auto-detected
AI_PROVIDER_MODEL=gpt-6-luna   # optional: force a model
AI_PROVIDER=mistral            # optional: force the service
```

Service-specific names also work (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, …).

| Where | How |
| --- | --- |
| Local | `.env` (never commit it) |
| Vercel | Settings → Environment Variables |
| Firebase | `firebase functions:secrets:set AI_PROVIDER_API_KEY` |
| Cloudflare | `wrangler secret put AI_PROVIDER_API_KEY` |
| Lovable | Project secrets |

**b) Env object** (Workers, tests): `createGateway({ env })`
**c) Directly** (user brings own key): `createGateway({ apiKey: userKey })`
**d) Pinned**: `createGateway({ apiKey, provider: "anthropic", model: "claude-haiku-4-5" })`

---

## 3. Use it

```ts
import { chat, createGateway, startupCheck } from "@your-name/ai-gateway";

// Automatic service + model
const { text, provider, model } = await chat({ prompt: "Hello" });

// Manual model
await chat({ prompt: "Hello", model: "gpt-6-luna" });

// Streaming
const { textStream } = await chat({ systemPrompt: "Be brief.", prompt: "Explain DNS", stream: true });
for await (const delta of textStream) process.stdout.write(delta);

// Reusable client
const ai = createGateway();
await ai.provider;        // "google"
ai.keySource;             // "AI_PROVIDER_API_KEY"
await ai.listModels();    // models this key can use

// History + cancel
const ac = new AbortController();
await ai.chat({ messages: [{ role: "user", content: "Hi" }], signal: ac.signal });
```

| `chat()` option | Notes |
| --- | --- |
| `prompt` / `messages` | Question or full history |
| `systemPrompt` | Instructions |
| `model` | Empty = automatic |
| `temperature`, `maxTokens` | Optional |
| `stream` | `true` → `{ textStream }` |
| `signal` | `AbortSignal` |

### Startup check — the AI greets you

```ts
startupCheck(); // never throws, runs once
```

```text
[ai-gateway] key found (AI_PROVIDER_API_KEY) → provider: google. Asking the AI to say hello…
[ai-gateway] ✅ active — provider: google, model: gemini-flash-latest (812ms)
[ai-gateway] 🤖 AI says: "Hello developer! I'm Gemini, a model by Google."
```

No key / bad key / busy → a `⚠️` warning; your app keeps running.

---

## 4. React + Vite example

Server (TanStack Start route `src/routes/api/chat.ts`, or any Vite SSR/serverless handler):

```ts
import { createGateway } from "@your-name/ai-gateway";

export async function POST(request: Request) {
  const { prompt } = await request.json();
  const { textStream } = await createGateway().chat({ prompt, stream: true });
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(c) {
      for await (const delta of textStream) c.enqueue(enc.encode(delta));
      c.close();
    },
  }), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
```

React component:

```tsx
const [answer, setAnswer] = useState("");
async function ask(prompt: string) {
  setAnswer("");
  const res = await fetch("/api/chat", { method: "POST", body: JSON.stringify({ prompt }) });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    setAnswer((a) => a + value);
  }
}
```

---

## 5. Supported services

| Service | Key looks like | Env variable | Default model |
| --- | --- | --- | --- |
| Google Gemini | `AIza…` / `AQ.…` | `GEMINI_API_KEY` | `gemini-flash-latest` |
| OpenAI | `sk-…` / `sk-proj-…` | `OPENAI_API_KEY` | `gpt-6-luna` |
| Anthropic Claude | `sk-ant-…` | `ANTHROPIC_API_KEY` | `claude-haiku-4-5` |
| Groq | `gsk_…` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| xAI Grok | `xai-…` | `XAI_API_KEY` | `grok-4.5` |
| OpenRouter | `sk-or-…` | `OPENROUTER_API_KEY` | `openrouter/auto` |
| Perplexity | `pplx-…` | `PERPLEXITY_API_KEY` | `sonar` |
| Cerebras | `csk-…` | `CEREBRAS_API_KEY` | `llama-3.3-70b` |
| Fireworks | `fw_…` | `FIREWORKS_API_KEY` | `accounts/fireworks/models/llama-v3p3-70b-instruct` |
| Mistral | probed | `MISTRAL_API_KEY` | `mistral-small-latest` |
| DeepSeek | probed | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| Together AI | probed | `TOGETHER_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |

Add a service: one entry in `PROVIDERS` (`providers.ts`).

---

## 6. Test it in this demo app's UI

1. Save a key as `AI_PROVIDER_API_KEY`.
2. Open the home page — the **Model** box shows the detected service.
3. Keep **Automatic** or pick a model, type a question, press **Send**.

HTTP: `POST /api/chat` `{ prompt, model?, stream? }` and `GET /api/models`.

---

## 7. Errors

Every failure throws `AIGatewayError` (`status`, `provider`, `code`, `retryable`).

| `code` | Meaning |
| --- | --- |
| `missing_key` | No key found |
| `detection_failed` | Key matched no service |
| `invalid_request` | Bad parameters (400) |
| `unauthorized` | Bad / revoked key (401/403) |
| `not_found` | Unknown model (404) |
| `rate_limited` | Quota (429) |
| `overloaded` | Busy (503/529) |
| `upstream_error` | Other failure |
| `no_stream` | No stream returned |

## 8. Scope & security

Covers text chat (assistants, summaries, chat widgets). Not included: images, embeddings,
speech, tool calling. Keep keys server-side, never commit `.env`, add auth / rate limits to
your endpoint before going public.
