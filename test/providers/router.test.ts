import { describe, it, expect } from "vitest";
import { TAG_COMPLEXITY, getRoute } from "../../src/providers/router";
import type { RouteConfig, ComplexityTier } from "../../src/providers/router";

const DEFAULT_CONFIG: RouteConfig = {
  light: { provider: "ollama", model: "llama3.2" },
  standard: { provider: "anthropic", model: "claude-sonnet-4-6" },
  heavy: { provider: "anthropic", model: "claude-opus-4-6" },
};

describe("TAG_COMPLEXITY", () => {
  it("maps CUT to light", () => {
    expect(TAG_COMPLEXITY["CUT"]).toBe("light");
  });

  it("maps PACING to light", () => {
    expect(TAG_COMPLEXITY["PACING"]).toBe("light");
  });

  it("maps TONE to standard", () => {
    expect(TAG_COMPLEXITY["TONE"]).toBe("standard");
  });

  it("maps EXPAND to standard", () => {
    expect(TAG_COMPLEXITY["EXPAND"]).toBe("standard");
  });

  it("maps PLOT to standard", () => {
    expect(TAG_COMPLEXITY["PLOT"]).toBe("standard");
  });

  it("maps REWRITE to heavy", () => {
    expect(TAG_COMPLEXITY["REWRITE"]).toBe("heavy");
  });

  it("maps DIALOG to heavy", () => {
    expect(TAG_COMPLEXITY["DIALOG"]).toBe("heavy");
  });

  it("maps CHARACTER to heavy", () => {
    expect(TAG_COMPLEXITY["CHARACTER"]).toBe("heavy");
  });

  it("covers all expected tags", () => {
    const expectedTags = ["CUT", "PACING", "TONE", "EXPAND", "PLOT", "REWRITE", "DIALOG", "CHARACTER"];
    for (const tag of expectedTags) {
      expect(TAG_COMPLEXITY).toHaveProperty(tag);
    }
  });

  it("has only valid tier values", () => {
    const validTiers: ComplexityTier[] = ["light", "standard", "heavy"];
    for (const tier of Object.values(TAG_COMPLEXITY)) {
      expect(validTiers).toContain(tier);
    }
  });
});

describe("getRoute", () => {
  it("routes CUT to light tier provider+model", () => {
    const route = getRoute("CUT", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "ollama", model: "llama3.2" });
  });

  it("routes PACING to light tier", () => {
    const route = getRoute("PACING", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "ollama", model: "llama3.2" });
  });

  it("routes TONE to standard tier", () => {
    const route = getRoute("TONE", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("routes EXPAND to standard tier", () => {
    const route = getRoute("EXPAND", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("routes PLOT to standard tier", () => {
    const route = getRoute("PLOT", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("routes REWRITE to heavy tier", () => {
    const route = getRoute("REWRITE", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "anthropic", model: "claude-opus-4-6" });
  });

  it("routes DIALOG to heavy tier", () => {
    const route = getRoute("DIALOG", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "anthropic", model: "claude-opus-4-6" });
  });

  it("routes CHARACTER to heavy tier", () => {
    const route = getRoute("CHARACTER", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "anthropic", model: "claude-opus-4-6" });
  });

  it("falls back to standard for unknown tags", () => {
    const route = getRoute("UNKNOWN_TAG", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("falls back to standard for empty string tag", () => {
    const route = getRoute("", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("falls back to standard for NOTE (passthrough tag)", () => {
    const route = getRoute("NOTE", DEFAULT_CONFIG);
    expect(route).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("works with all-local config", () => {
    const localConfig: RouteConfig = {
      light: { provider: "ollama", model: "llama3.2" },
      standard: { provider: "ollama", model: "mistral" },
      heavy: { provider: "ollama", model: "deepseek-coder" },
    };
    expect(getRoute("CUT", localConfig)).toEqual({ provider: "ollama", model: "llama3.2" });
    expect(getRoute("TONE", localConfig)).toEqual({ provider: "ollama", model: "mistral" });
    expect(getRoute("REWRITE", localConfig)).toEqual({ provider: "ollama", model: "deepseek-coder" });
  });

  it("works with all-cloud config", () => {
    const cloudConfig: RouteConfig = {
      light: { provider: "anthropic", model: "claude-haiku-4-5" },
      standard: { provider: "anthropic", model: "claude-sonnet-4-6" },
      heavy: { provider: "anthropic", model: "claude-opus-4-6" },
    };
    expect(getRoute("CUT", cloudConfig)).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    expect(getRoute("EXPAND", cloudConfig)).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
    expect(getRoute("DIALOG", cloudConfig)).toEqual({ provider: "anthropic", model: "claude-opus-4-6" });
  });
});
