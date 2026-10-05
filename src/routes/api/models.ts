import { createFileRoute } from "@tanstack/react-router";

import { DEFAULT_MODELS, PROVIDERS, createGateway } from "@/lib/ai-gateway";

/** GET /api/models — which provider the saved key belongs to and the models it can use. */
export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      GET: async () => {
        let gateway: ReturnType<typeof createGateway>;
        try {
          gateway = createGateway();
        } catch {
          return Response.json({ provider: null, models: [], error: "No key configured yet." });
        }
        try {
          const provider = await gateway.provider;
          const models = await gateway.listModels().catch(() => [] as string[]);
          return Response.json({
            provider,
            label: PROVIDERS[provider].label,
            defaultModel: DEFAULT_MODELS[provider],
            keySource: gateway.keySource,
            models,
          });
        } catch (e) {
          return Response.json({ provider: null, models: [], error: (e as Error).message });
        }
      },
    },
  },
});
