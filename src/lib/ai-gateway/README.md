# @your-name/ai-gateway

Zero-dependency, ESM TypeScript gateway over Google Gemini, OpenAI, Groq and Anthropic.
Uses only `fetch`, `TextDecoder` and web streams, so it runs unchanged on Node.js 18+,
Vercel/Firebase functions and Cloudflare Workers.

## Usage

```ts
import { chat, createGateway } from "@/lib/ai-gateway";

// One-shot
const { text, provider, model } = await chat({
  apiKey: process.env.AI_PROVIDER_API_KEY!,
  prompt: "Hello",
});

// Streaming
const { textStream } = await chat({
  apiKey: process.env.AI_PROVIDER_API_KEY!,
  systemPrompt: "Be brief.",
  prompt: "Why are cold starts slow?",
  stream: true,
});
for await (const delta of textStream) console.log(delta);

// Reusable client (detection runs once)
const gateway = createGateway({ apiKey: process.env.AI_PROVIDER_API_KEY! });
const res = await gateway.chat({ messages: [{ role: "user", content: "Hi" }] });
```

## Provider detection

1. Key prefix: `sk-ant-` → Anthropic, `gsk_` → Groq, `AIza` → Google, `sk-` → OpenAI.
2. Fallback: a live `GET /models` probe against each candidate.

Pass `provider` explicitly to skip detection entirely, or `model` to override the default.

## Options

`prompt` | `messages` | `systemPrompt` | `model` | `temperature` | `maxTokens` | `stream` | `signal`

Errors throw `AIGatewayError` carrying `status` and `provider`.

## HTTP endpoint

`src/routes/api/chat.ts` wraps the gateway as `POST /api/chat`, reading the key from the
`AI_PROVIDER_API_KEY` environment variable and relaying SSE frames (`{ "delta": "..." }`,
terminated by `[DONE]`) with `X-AI-Provider` / `X-AI-Model` response headers.
