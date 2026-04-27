import { describe, it, expect } from "vitest";
import { createRegistry } from "../../src/providers";
import type { HttpFn } from "../../src/providers/service";

describe("createRegistry", () => {
  // Stub HttpFn — never called by registry construction; tests only assert wiring.
  const stubHttp: HttpFn = async () => ({
    status: 200,
    headers: {},
    text: "{}",
    json: {},
  });

  it("returns a registry pre-populated with all built-in providers", () => {
    const reg = createRegistry(stubHttp);
    const names = reg.getNames().sort();
    expect(names).toEqual(["anthropic", "google", "ollama", "openai"]);
  });

  it("each registered provider implements the LLMService interface", () => {
    const reg = createRegistry(stubHttp);
    for (const provider of reg.getAll()) {
      expect(typeof provider.name).toBe("string");
      expect(typeof provider.requiresApiKey).toBe("boolean");
      expect(typeof provider.complete).toBe("function");
      expect(typeof provider.estimateTokens).toBe("function");
      expect(typeof provider.testConnection).toBe("function");
      expect(typeof provider.getModels).toBe("function");
    }
  });

  it("Anthropic, Google, OpenAI require API keys; Ollama does not", () => {
    const reg = createRegistry(stubHttp);
    expect(reg.get("anthropic")?.requiresApiKey).toBe(true);
    expect(reg.get("google")?.requiresApiKey).toBe(true);
    expect(reg.get("openai")?.requiresApiKey).toBe(true);
    expect(reg.get("ollama")?.requiresApiKey).toBe(false);
  });
});
