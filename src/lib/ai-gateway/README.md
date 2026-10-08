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

The library is versioned with git tags (`v1.3.0`, `v1.3.0`, …). Pin the tag so your apps
never change unexpectedly.

### Step 1 (once): give the library its own repo

Create an empty GitHub repo, e.g. `your-name/ai-gateway`, and put **only the contents of
this folder** in it (the `package.json` must be at the repo root):

```bash
cp -r src/lib/ai-gateway /tmp/ai-gateway && cd /tmp/ai-gateway
git init && git add . && git commit -m "v1.3.0"
git branch -M main
git remote add origin https://github.com/your-name/ai-gateway.git
git push -u origin main
git tag v1.3.0 && git push origin v1.3.0
```

Rename `"name"` in `package.json` from `@your-name/ai-gateway` to your own scope first.

### Step 2: install in any app, with the version

```bash
npm  install github:your-name/ai-gateway#v1.3.0
pnpm add     github:your-name/ai-gateway#v1.3.0
bun  add     github:your-name/ai-gateway#v1.3.0
yarn add     github:your-name/ai-gateway#v1.3.0
```

`package.json` then contains:

```json
"dependencies": { "@your-name/ai-gateway": "github:your-name/ai-gateway#v1.3.0" }
```

Private repo? Use `git+ssh://git@github.com/your-name/ai-gateway.git#v1.3.0`.

### Upgrade / release a new version

```bash
# in the library repo: change code, bump "version" in package.json + VERSION in index.ts + CHANGELOG
git commit -am "v1.3.0" && git tag v1.3.0 && git push && git push origin v1.3.0
# in each app
npm install github:your-name/ai-gateway#v1.3.0
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
AI_PROVIDER_MODEL=gpt-5-mini   # optional: force a model
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

**Several keys (failover):** separate them with spaces, commas or new lines —
`AI_PROVIDER_API_KEY="AIza… gsk_… sk-ant-…"` or `createGateway({ apiKeys: [k1, k2] })`.
If one key fails (quota, outage, bad key) the next one is tried, even across services.

> Never name the key `VITE_…` — Vite puts every `VITE_` variable into the browser bundle.

**b) Env object** (Workers, tests): `createGateway({ env })`
**c) Directly** (user brings own key): `createGateway({ apiKey: userKey })`
**Timeout:** `createGateway({ timeoutMs: 30_000 })` — a hanging service fails fast (and fails over to the next key).

**d) Pinned**: `createGateway({ apiKey, provider: "anthropic", model: "claude-haiku-4-5" })`

---

## 3. Use it

```ts
import { chat, createGateway, startupCheck } from "@your-name/ai-gateway";

// Automatic service + model
const { text, provider, model } = await chat({ prompt: "Hello" });

// Manual model
await chat({ prompt: "Hello", model: "gpt-5-mini" });

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
| `model` | Empty = automatic. A model from another service (e.g. `gpt-5` on a Gemini key) falls back to that service's default |
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

## 4b. Plain React + Vite + Firebase (recommended setup)

No framework needed: a Vite React app on **Firebase Hosting** + one **Cloud Function**
that holds the key. The browser only calls `/api/chat`.

```text
my-app/
├─ src/              ← React + Vite (npm create vite@latest my-app -- --template react-ts)
├─ functions/        ← firebase init functions (TypeScript)
│  └─ src/index.ts
└─ firebase.json
```

**1. Add the library to the function**

```bash
cd functions
npm install github:your-name/ai-gateway#v1.3.0 esbuild
```

The library ships TypeScript source, so bundle the function with esbuild
(`functions/package.json`):

```json
"main": "lib/index.js",
"scripts": {
  "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --packages=external --external:firebase-functions --external:firebase-admin --outfile=lib/index.js"
}
```

Remove `--packages=external` if you want the library inlined (recommended — then it is
compiled into `lib/index.js`; keep the two firebase `--external` flags).
Simpler alternative: copy the `ai-gateway` folder into `functions/src/` and import it
relatively — then the normal `tsc` build works.

**2. The function** (`functions/src/index.ts`)

```ts
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { createGateway, startupCheck, AIGatewayError } from "@your-name/ai-gateway";

const AI_KEY = defineSecret("AI_PROVIDER_API_KEY");

export const chat = onRequest({ secrets: [AI_KEY], region: "europe-west1" }, async (req, res) => {
  startupCheck(); // logs once per instance: "✅ active — provider … model …" + the AI's hello
  if (req.method !== "POST") { res.status(405).end(); return; }
  const prompt = String(req.body?.prompt ?? "").slice(0, 8000);
  if (!prompt) { res.status(400).json({ error: "prompt required" }); return; }

  try {
    const { textStream } = await createGateway().chat({ prompt, model: req.body?.model, stream: true });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    for await (const delta of textStream) res.write(delta);
    res.end();
  } catch (e) {
    const status = e instanceof AIGatewayError && e.status < 500 ? e.status : 424;
    res.status(status).json({ error: (e as Error).message });
  }
});
```

**3. Route `/api/chat` to the function** (`firebase.json`)

```json
{
  "hosting": {
    "public": "dist",
    "rewrites": [
      { "source": "/api/chat", "function": { "functionId": "chat", "region": "europe-west1" } },
      { "source": "**", "destination": "/index.html" }
    ]
  },
  "functions": { "source": "functions", "predeploy": "npm --prefix functions run build" }
}
```

**4. Save the key and deploy**

```bash
firebase functions:secrets:set AI_PROVIDER_API_KEY   # paste any supported key
npm run build                                        # builds the Vite app into dist/
firebase deploy
firebase functions:log                               # see the AI's startup greeting
```

**5. React** — use the component from section 4 (`fetch("/api/chat", …)`). For local dev,
run `firebase emulators:start` and add to `vite.config.ts`:

```ts
server: { proxy: { "/api": "http://127.0.0.1:5000" } }
```

Note: Cloud Functions need the Blaze (pay-as-you-go) plan; it has a free monthly allowance.

---

## 5. Supported services

| Service | Key looks like | Env variable | Default model |
| --- | --- | --- | --- |
| Google Gemini | `AIza…` / `AQ.…` | `GEMINI_API_KEY` | `gemini-flash-latest` |
| OpenAI | `sk-…` / `sk-proj-…` | `OPENAI_API_KEY` | `gpt-5-mini` |
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

Add a service: one entry in `PROVIDERS` (`providers.ts`) — label, base URL, default model, key prefixes, env name and optional model `family` pattern.

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
| `timeout` | No answer within `timeoutMs` (default 60 s) |
| `upstream_error` | Other failure |
| `no_stream` | No stream returned |

## 8. Scope & security

Covers text chat (assistants, summaries, chat widgets). Not included: images, embeddings,
speech, tool calling. Keep keys server-side, never commit `.env`, add auth / rate limits to
your endpoint before going public.

## Future models (auto-discovery)

Providers retire and release models constantly. The gateway handles this for you:

| Situation | What happens |
|---|---|
| You set a model (`model`, `AI_MODEL`) | Used exactly as given — never rewritten. |
| No model set | Built-in default is used (`DEFAULT_MODELS`). |
| No model set **and** the default returns 404 (retired) | The gateway fetches the provider's live `/models` list, picks the newest fast/cheap chat model, logs `switching to "…"`, retries, and remembers it. |

```ts
const ai = createGateway();
await ai.listModels();   // every model your key can use, live from the provider
await ai.latestModel();  // e.g. "gemini-4-flash" — and it becomes this gateway's default
```

- The "tier" it picks is defined by `MODEL_PREFERENCES` in `providers.ts` (regex list per provider, best first; newest version wins, `10` > `9`). Edit it to prefer e.g. `pro`/`sonnet` models instead.
- Preview / experimental / audio / image / embedding models are skipped.
- Opt out with `createGateway({ discoverModels: false })`.
- Tests: `bunx vitest run src/lib/ai-gateway`.
