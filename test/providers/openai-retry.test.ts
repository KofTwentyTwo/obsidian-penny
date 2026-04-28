import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "../../src/providers/openai";

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

describe("OpenAIProvider retry", () => {
  it("retries 429 then succeeds", async () => {
    let n = 0;
    const httpFn = vi.fn(async () => {
      n += 1;
      if (n < 3) return jsonResponse(429, { "retry-after": "0" }, { error: { message: "rate" } });
      return jsonResponse(200, {}, successBody);
    });
    const provider = new OpenAIProvider(httpFn);
    const result = await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "gpt-4o-mini",
      maxTokens: 100, apiKey: "k", maxRetries: 3,
    });
    expect(result.text).toBe("revised");
    expect(httpFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 401", async () => {
    const httpFn = vi.fn(async () => jsonResponse(401, {}, { error: { message: "auth" } }));
    const provider = new OpenAIProvider(httpFn);
    await expect(
      provider.complete({
        systemPrompt: "s", userPrompt: "u", model: "gpt-4o-mini",
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
    const provider = new OpenAIProvider(httpFn);
    await provider.complete({
      systemPrompt: "s", userPrompt: "u", model: "gpt-4o-mini",
      maxTokens: 100, apiKey: "k", maxRetries: 3, onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 2, reason: "HTTP 503" });
  });
});
