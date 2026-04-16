import { describe, it, expect, beforeEach } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry";
import type { LLMService, ModelInfo, CompletionRequest, CompletionResponse, ProviderSettings } from "../../src/providers/service";

/** Minimal stub that satisfies LLMService for testing the registry. */
function makeStubProvider(name: string): LLMService {
  return {
    name,
    requiresApiKey: false,
    getModels: async (): Promise<ModelInfo[]> => [],
    complete: async (req: CompletionRequest): Promise<CompletionResponse> => ({
      text: "stub",
      model: req.model,
      provider: name,
    }),
    estimateTokens: (text: string) => text.split(/\s+/).length,
    testConnection: async (_settings: ProviderSettings) => null,
  };
}

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("starts empty", () => {
    expect(registry.getAll()).toHaveLength(0);
    expect(registry.getNames()).toHaveLength(0);
  });

  it("registers a provider and retrieves it by name", () => {
    const provider = makeStubProvider("test-provider");
    registry.register(provider);

    const result = registry.get("test-provider");
    expect(result).toBe(provider);
    expect(result?.name).toBe("test-provider");
  });

  it("returns undefined for an unregistered name", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("registers multiple providers", () => {
    registry.register(makeStubProvider("alpha"));
    registry.register(makeStubProvider("beta"));
    registry.register(makeStubProvider("gamma"));

    expect(registry.getAll()).toHaveLength(3);
    expect(registry.getNames()).toEqual(
      expect.arrayContaining(["alpha", "beta", "gamma"]),
    );
  });

  it("getAll returns all registered providers", () => {
    const a = makeStubProvider("a");
    const b = makeStubProvider("b");
    registry.register(a);
    registry.register(b);

    const all = registry.getAll();
    expect(all).toContain(a);
    expect(all).toContain(b);
  });

  it("getNames returns all registered names", () => {
    registry.register(makeStubProvider("anthropic"));
    registry.register(makeStubProvider("ollama"));

    const names = registry.getNames();
    expect(names).toContain("anthropic");
    expect(names).toContain("ollama");
  });

  it("overwrites an existing provider with the same name", () => {
    const first = makeStubProvider("same-name");
    const second = makeStubProvider("same-name");
    registry.register(first);
    registry.register(second);

    expect(registry.getAll()).toHaveLength(1);
    expect(registry.get("same-name")).toBe(second);
  });

  it("get is case-sensitive", () => {
    registry.register(makeStubProvider("Anthropic"));

    expect(registry.get("Anthropic")).toBeDefined();
    expect(registry.get("anthropic")).toBeUndefined();
    expect(registry.get("ANTHROPIC")).toBeUndefined();
  });
});
