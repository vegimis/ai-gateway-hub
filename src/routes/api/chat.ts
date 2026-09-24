import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { AIGatewayError, createGateway } from "@/lib/ai-gateway";

const Body = z.object({
  prompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["AI_PROVIDER_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "AI_PROVIDER_API_KEY is not configured." }, { status: 500 });
        }

        let input: z.infer<typeof Body>;
        try {
          input = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }

        const gateway = createGateway({ apiKey });

        try {
          if (!input.stream) {
            const result = await gateway.chat({ ...input, stream: false });
            return Response.json(result);
          }

          const { provider, model, textStream } = await gateway.chat({ ...input, stream: true });
          const encoder = new TextEncoder();
          const body = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                for await (const delta of textStream) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              } catch (error) {
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
          const status = error instanceof AIGatewayError ? (error.status ?? 500) : 500;
          const message = error instanceof Error ? error.message : "Unknown error";
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
