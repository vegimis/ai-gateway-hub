import { describe, expect, it } from "vitest";
import { pickModel } from "./providers";
describe("pickModel", () => {
  it("picks newest gemini flash, skipping previews", () =>
    expect(pickModel("google", ["gemini-2.5-flash", "gemini-4-flash", "gemini-5-flash-preview", "gemini-2.5-pro"])).toBe("gemini-4-flash"));
  it("picks newest gpt mini", () => expect(pickModel("openai", ["gpt-5-mini", "gpt-6-mini", "gpt-6", "gpt-10-mini-tts"])).toBe("gpt-6-mini"));
  it("numeric order: 10 beats 9", () => expect(pickModel("openai", ["gpt-9-mini", "gpt-10-mini"])).toBe("gpt-10-mini"));
  it("falls back to default when listed", () => expect(pickModel("groq", ["x", "llama-3.3-70b-versatile"])).toBe("llama-3.3-70b-versatile"));
});
