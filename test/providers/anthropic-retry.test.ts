import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "../../src/providers/anthropic";

function jsonResponse(status: number, headers: Record<string, string>, body: unknown) {
  return {
    status,
    headers,
    text: typeof body === "string" ? body : JSON.stringify(body),
    json: typeof body === "string" ? undefined : body,
  };
}

const successBody = {
  content: [{ type: "text", text: "revised" }],
  usage: { input_tokens: 5, output_tokens: 3 },
};

describe("AnthropicProvider retry", () => {
  it("retries 429 then succeeds", async () => {
    let n = 0;
    const httpFn = vi.fn(async () => {
      n += 1;
      if (n < 3) return jsonResponse(429, { "retry-after": "0" }, { error: { message: "rate" } });
      return jsonResponse(200, {}, successBody);
    });
    const provider = new AnthropicProvider(httpFn);
    const result = await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "claude-haiku-4-5",
      maxTokens: 100, apiKey: "k", maxRetries: 3,
    });
    expect(result.text).toBe("revised");
    expect(httpFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 401", async () => {
    const httpFn = vi.fn(async () => jsonResponse(401, {}, { error: { message: "auth" } }));
    const provider = new AnthropicProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "claude-haiku-4-5",
        maxTokens: 100, apiKey: "k", maxRetries: 3,
      }),
    ).rejects.toThrow(/401/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry between attempts", async () => {
    let n = 0;
    const httpFn = async () => {
      n += 1;
      if (n < 2) return jsonResponse(503, { "retry-after": "0" }, { error: { message: "svc" } });
      return jsonResponse(200, {}, successBody);
    };
    const onRetry = vi.fn();
    const provider = new AnthropicProvider(httpFn);
    await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "claude-haiku-4-5",
      maxTokens: 100, apiKey: "k", maxRetries: 3, onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 2, reason: "HTTP 503" });
  });

  it("maxRetries: 0 disables retry (single attempt only)", async () => {
    const httpFn = vi.fn(async () => jsonResponse(503, {}, { error: { message: "svc" } }));
    const provider = new AnthropicProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "claude-haiku-4-5",
        maxTokens: 100, apiKey: "k", maxRetries: 0,
      }),
    ).rejects.toThrow(/503/);
    expect(httpFn).toHaveBeenCalledTimes(1);
  });
});
