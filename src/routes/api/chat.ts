import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { AIGatewayError, PROVIDER_IDS, createGateway } from "@/lib/ai-gateway";

const Body = z.object({
  apiKey: z.string().max(4000).optional(),
  prompt: z.string().min(1).max(32_000).optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(32_000) }))
    .min(1)
    .max(100)
    .optional(),
  systemPrompt: z.string().max(16_000).optional(),
  model: z.string().max(200).optional(),
  provider: z.enum(PROVIDER_IDS as [string, ...string[]]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
}).refine((b) => b.prompt || b.messages, { message: "prompt or messages is required" });

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: z.infer<typeof Body>;
        try {
          input = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }

        let gateway: ReturnType<typeof createGateway>;
        try {
          // Key comes from request body or from env automatically (AI_PROVIDER_API_KEY, AI_API_KEY, ...).
          gateway = createGateway({
            ...(input.apiKey ? { apiKey: input.apiKey } : {}),
            ...(input.provider ? { provider: input.provider as never } : {}),
          });
        } catch {

          // Missing configuration is a client-visible setup state, not a server crash.
          return Response.json(
            {
              error:
                "No provider key configured yet. Save a key from any supported AI service as AI_PROVIDER_API_KEY to start chatting.",
              code: "missing_key",
            },
            { status: 400 },
          );
        }

        const { provider: _p, apiKey: _k, ...rest } = input;
        // Cancel the upstream AI call when the client disconnects.
        const opts = { ...rest, signal: request.signal };
        try {
          if (!input.stream) {
            const result = await gateway.chat({ ...opts, stream: false });
            return Response.json(result);
          }

          const { provider, model, textStream } = await gateway.chat({ ...opts, stream: true });
          const encoder = new TextEncoder();
          const body = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                for await (const delta of textStream) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              } catch (error) {
                if (request.signal.aborted) return controller.close();
                const message = error instanceof Error ? error.message : "Stream failed";
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
              } finally {
                controller.close();
              }
            },
          });

          return new Response(body, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              "X-AI-Provider": provider,
              "X-AI-Model": model,
            },
          });
        } catch (error) {
          // Provider problems (overload, bad key, quota) are upstream state, not an
          // app crash: return 424 Failed Dependency with a readable message.
          const upstream = error instanceof AIGatewayError ? error.status : undefined;
          const status =
            upstream === 401 || upstream === 403 || upstream === 400 || upstream === 404
              ? upstream
              : 424;
          const raw = error instanceof Error ? error.message : "Unknown error";
          const message =
            upstream === 503 || upstream === 429
              ? "The AI provider is busy right now. Please try again in a minute."
              : raw;
          return Response.json({ error: message, upstreamStatus: upstream ?? null }, { status });
        }

      },
    },
  },
});
