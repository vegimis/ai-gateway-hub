import { describe, expect, it } from "vitest";
import { createGateway } from "./index";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ok = { choices: [{ message: { content: "hi" } }] };

describe("gateway", () => {
  it("retries a 503 and then succeeds", async () => {
    let calls = 0;
    const fetch = (async () => (++calls < 2 ? json({}, 503) : json(ok))) as typeof globalThis.fetch;
    const g = createGateway({ apiKey: "gsk_test", fetch });
    expect((await g.chat({ prompt: "x" })).text).toBe("hi");
    expect(calls).toBe(2);
  });

  it("fails over to the second key when the first is rejected", async () => {
    const fetch = (async (_u: string, init: RequestInit) =>
      String((init.headers as Record<string, string>)["Authorization"]).includes("gsk_bad")
        ? json({}, 401)
        : json(ok)) as typeof globalThis.fetch;
    const g = createGateway({ apiKey: "gsk_bad gsk_good", fetch, maxAttempts: 1 });
    expect((await g.chat({ prompt: "x" })).text).toBe("hi");
  });

  it("never puts more than 4 key characters in errors", async () => {
    const fetch = (async () => json({}, 401)) as typeof globalThis.fetch;
    const g = createGateway({ apiKey: "gsk_secret1 gsk_secret2", fetch, maxAttempts: 1 });
    await expect(g.chat({ prompt: "x" })).rejects.toThrow();
    const err = await g.chat({ prompt: "x" }).catch((e: Error) => e.message);
    expect(err).not.toContain("secret");
  });

  it("throws missing_key when no key is available", () => {
    expect(() => createGateway({ env: {} })).toThrow(/Missing API key/);
  });
});
