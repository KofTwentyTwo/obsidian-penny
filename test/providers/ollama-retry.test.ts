import { describe, it, expect, vi } from "vitest";
import { OllamaProvider } from "../../src/providers/ollama";

function jsonResponse(status: number, headers: Record<string, string>, body: unknown) {
  return {
    status,
    headers,
    text: typeof body === "string" ? body : JSON.stringify(body),
    json: typeof body === "string" ? undefined : body,
  };
}

const successBody = {
  choices: [{ message: { content: "revised" } }],
  usage: { prompt_tokens: 5, completion_tokens: 3 },
};

describe("OllamaProvider retry", () => {
  it("retries 503 then succeeds", async () => {
    let n = 0;
    const httpFn = vi.fn(async () => {
      n += 1;
      if (n < 3) return jsonResponse(503, { "retry-after": "0" }, { error: "loading model" });
      return jsonResponse(200, {}, successBody);
    });
    const provider = new OllamaProvider(httpFn);
    const result = await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "llama3.2",
      maxTokens: 100, endpoint: "http://localhost:11434", maxRetries: 3,
    });
    expect(result.text).toBe("revised");
    expect(httpFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 404 (model not found)", async () => {
    const httpFn = vi.fn(async () => jsonResponse(404, {}, { error: "model not found" }));
    const provider = new OllamaProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "missing-model",
        maxTokens: 100, endpoint: "http://localhost:11434", maxRetries: 3,
      }),
    ).rejects.toThrow(/404/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });

  it("maxRetries: 0 disables retry on 503", async () => {
    const httpFn = vi.fn(async () => jsonResponse(503, {}, { error: "busy" }));
    const provider = new OllamaProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "llama3.2",
        maxTokens: 100, endpoint: "http://localhost:11434", maxRetries: 0,
      }),
    ).rejects.toThrow(/503/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });
});
