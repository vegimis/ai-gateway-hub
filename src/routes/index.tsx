import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { DEFAULT_MODELS, PROVIDERS, PROVIDER_IDS } from "@/lib/ai-gateway/providers";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Unified AI Model Gateway — one key, any provider" },
      {
        name: "description",
        content:
          "A tiny TypeScript gateway that detects whether your key is Gemini, OpenAI, Claude, Groq, Mistral, DeepSeek, Grok and more and exposes a single streaming chat() call.",
      },
      { property: "og:title", content: "Unified AI Model Gateway" },
      {
        property: "og:description",
        content:
          "One API key in, streaming answers out. Swap providers without touching your app code.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const SNIPPET = `import { chat } from "@/lib/ai-gateway";

// Provider + default model are detected from the key.
const { textStream } = await chat({
  apiKey: process.env.AI_PROVIDER_API_KEY!,
  systemPrompt: "You are concise.",
  prompt: "Explain edge streaming in one line.",
  stream: true,
});

for await (const delta of textStream) process.stdout.write(delta);`;

function Index() {
  const [prompt, setPrompt] = useState("Explain edge streaming in one sentence.");
  const [systemPrompt, setSystemPrompt] = useState("You are concise and precise.");
  const [answer, setAnswer] = useState("");
  const [meta, setMeta] = useState<{ provider: string; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [info, setInfo] = useState<{ label?: string; defaultModel?: string; models: string[] } | null>(null);
  const [model, setModel] = useState("");

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { label?: string; defaultModel?: string; models?: string[] }) =>
        setInfo({ ...d, models: d.models ?? [] }),
      )
      .catch(() => setInfo({ models: [] }));
  }, []);

  async function run() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setAnswer("");
    setError(null);
    setMeta(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, systemPrompt, stream: true, ...(model ? { model } : {}) }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        let message = detail || `Request failed (${res.status})`;
        try {
          const parsed = JSON.parse(detail) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // non-JSON body: keep the raw text
        }
        throw new Error(message);
      }


      setMeta({
        provider: res.headers.get("X-AI-Provider") ?? "unknown",
        model: res.headers.get("X-AI-Model") ?? "unknown",
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          const payload = JSON.parse(data) as { delta?: string; error?: string };
          if (payload.error) setError(payload.error);
          if (payload.delta) setAnswer((prev) => prev + payload.delta);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-16">
      <div className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            @your-name/ai-gateway
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            Unified AI Model Gateway
          </h1>
          <p className="text-muted-foreground">
            Give it one API key. It figures out whether the key belongs to Google Gemini, OpenAI,
            Groq or Anthropic, picks a sensible default model, and gives you a single streaming{" "}
            <code className="font-mono text-foreground">chat()</code> call.
          </p>
        </header>

        <section className="rounded-xl border border-border bg-card p-5">
          <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-card-foreground">
            {SNIPPET}
          </pre>
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-medium text-card-foreground">Try it</h2>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground" htmlFor="model">
              Model {info?.label ? `(key detected: ${info.label})` : ""}
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Automatic{info?.defaultModel ? ` — ${info.defaultModel}` : ""}</option>
              {info?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground" htmlFor="system">
              System prompt
            </label>
            <Input
              id="system"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground" htmlFor="prompt">
              Prompt
            </label>
            <Textarea
              id="prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={run} disabled={busy || !prompt.trim()}>
              {busy ? "Streaming…" : "Send"}
            </Button>
            {meta && (
              <span className="font-mono text-xs text-muted-foreground">
                {meta.provider} · {meta.model}
              </span>
            )}
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {answer && (
            <p className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm text-foreground">
              {answer}
            </p>
          )}
        </section>

        <section className="space-y-2 text-sm text-muted-foreground">
          <h2 className="text-lg font-medium text-foreground">Defaults per provider</h2>
          <ul className="space-y-1 font-mono text-xs">
            {PROVIDER_IDS.map((p) => (
              <li key={p}>
                {PROVIDERS[p].label} → {DEFAULT_MODELS[p]}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
