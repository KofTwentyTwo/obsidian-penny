import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "../../src/providers/anthropic";
import type { HttpFn, HttpResponse, CompletionRequest } from "../../src/providers/service";

/** Create a mock HTTP function that records calls and returns a canned response. */
function mockHttp(response: Partial<HttpResponse> = {}): {
  fn: HttpFn;
  calls: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }>;
} {
  const calls: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }> = [];
  const fn: HttpFn = async (params) => {
    calls.push({
      url: params.url,
      method: params.method,
      headers: params.headers,
      body: params.body,
    });
    return {
      status: response.status ?? 200,
      headers: response.headers ?? {},
      text: response.text ?? "{}",
      json: response.json ?? {},
    };
  };
  return { fn, calls };
}

/** Build a standard Anthropic Messages API response body. */
function anthropicResponse(text: string, opts?: {
  includeThinking?: boolean;
  inputTokens?: number;
  outputTokens?: number;
}): string {
  const content: Array<Record<string, unknown>> = [];
  if (opts?.includeThinking) {
    content.push({ type: "thinking", thinking: "Let me consider this..." });
  }
  content.push({ type: "text", text });
  return JSON.stringify({
    content,
    usage: {
      input_tokens: opts?.inputTokens ?? 100,
      output_tokens: opts?.outputTokens ?? 50,
    },
  });
}

function makeRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    systemPrompt: "You are a writing assistant.",
    userPrompt: "Rewrite this passage with more tension.",
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    apiKey: "sk-test-key-123",
    ...overrides,
  };
}

describe("AnthropicProvider", () => {
  describe("metadata", () => {
    it("has name 'anthropic'", () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);
      expect(provider.name).toBe("anthropic");
    });

    it("requires an API key", () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);
      expect(provider.requiresApiKey).toBe(true);
    });
  });

  describe("getModels", () => {
    it("returns static list of Claude models", async () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);
      const models = await provider.getModels();

      expect(models.length).toBe(3);

      const ids = models.map((m) => m.id);
      expect(ids).toContain("claude-opus-4-6");
      expect(ids).toContain("claude-sonnet-4-6");
      expect(ids).toContain("claude-haiku-4-5");
    });

    it("includes context window and pricing info", async () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);
      const models = await provider.getModels();

      const opus = models.find((m) => m.id === "claude-opus-4-6");
      expect(opus).toBeDefined();
      expect(opus!.contextWindow).toBe(200000);
      expect(opus!.costPer1kInput).toBeGreaterThan(0);
      expect(opus!.costPer1kOutput).toBeGreaterThan(0);
    });
  });

  describe("complete", () => {
    it("sends correct request body format", async () => {
      const responseText = anthropicResponse("Revised passage.");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new AnthropicProvider(fn);

      await provider.complete(makeRequest());

      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0].body!);

      expect(body.model).toBe("claude-sonnet-4-6");
      expect(body.max_tokens).toBe(4096);
      expect(body.thinking).toBeDefined();
      expect(body.thinking.type).toBe("enabled");
      expect(body.system).toBe("You are a writing assistant.");
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[0].content).toBe("Rewrite this passage with more tension.");
    });

    it("sends correct headers", async () => {
      const responseText = anthropicResponse("OK");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new AnthropicProvider(fn);

      await provider.complete(makeRequest());

      expect(calls).toHaveLength(1);
      const headers = calls[0].headers!;
      expect(headers["x-api-key"]).toBe("sk-test-key-123");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers["content-type"]).toBe("application/json");
    });

    it("calls the correct API URL", async () => {
      const responseText = anthropicResponse("OK");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new AnthropicProvider(fn);

      await provider.complete(makeRequest());

      expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    });

    it("extracts text from a standard response", async () => {
      const responseText = anthropicResponse("The door slammed shut.");
      const { fn } = mockHttp({ text: responseText });
      const provider = new AnthropicProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(result.text).toBe("The door slammed shut.");
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-sonnet-4-6");
    });

    it("skips thinking blocks and extracts only text", async () => {
      const responseText = anthropicResponse("Final answer.", { includeThinking: true });
      const { fn } = mockHttp({ text: responseText });
      const provider = new AnthropicProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(result.text).toBe("Final answer.");
      expect(result.text).not.toContain("Let me consider");
    });

    it("parses usage information", async () => {
      const responseText = anthropicResponse("Output.", {
        inputTokens: 500,
        outputTokens: 200,
      });
      const { fn } = mockHttp({ text: responseText });
      const provider = new AnthropicProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(result.usage).toBeDefined();
      expect(result.usage!.inputTokens).toBe(500);
      expect(result.usage!.outputTokens).toBe(200);
    });

    it("returns empty text when response has no text block", async () => {
      const responseText = JSON.stringify({
        content: [{ type: "thinking", thinking: "..." }],
        usage: { input_tokens: 10, output_tokens: 0 },
      });
      const { fn } = mockHttp({ text: responseText });
      const provider = new AnthropicProvider(fn);

      const result = await provider.complete(makeRequest());
      expect(result.text).toBe("");
    });

    it("throws if no API key is provided", async () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);

      await expect(
        provider.complete(makeRequest({ apiKey: undefined })),
      ).rejects.toThrow("Anthropic API key is required");
    });

    it("uses the model from the request", async () => {
      const responseText = anthropicResponse("ok");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new AnthropicProvider(fn);

      await provider.complete(makeRequest({ model: "claude-opus-4-6" }));

      const body = JSON.parse(calls[0].body!);
      expect(body.model).toBe("claude-opus-4-6");
    });
  });

  describe("estimateTokens", () => {
    it("estimates tokens as words * 1.33", () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);

      // 10 words
      const text = "one two three four five six seven eight nine ten";
      const estimate = provider.estimateTokens(text);
      expect(estimate).toBe(Math.ceil(10 * 1.33)); // 14
    });

    it("handles empty text", () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);
      expect(provider.estimateTokens("")).toBe(0);
    });

    it("handles single word", () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);
      expect(provider.estimateTokens("hello")).toBe(Math.ceil(1 * 1.33)); // 2
    });

    it("ignores extra whitespace in word count", () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);
      const text = "  spaced   out   text  ";
      expect(provider.estimateTokens(text)).toBe(Math.ceil(3 * 1.33)); // 4
    });
  });

  describe("testConnection", () => {
    it("returns null on successful connection", async () => {
      const responseText = anthropicResponse("pong");
      const { fn } = mockHttp({ status: 200, text: responseText });
      const provider = new AnthropicProvider(fn);

      const result = await provider.testConnection({ apiKey: "sk-valid" });
      expect(result).toBeNull();
    });

    it("returns error message when API key is missing", async () => {
      const { fn } = mockHttp();
      const provider = new AnthropicProvider(fn);

      const result = await provider.testConnection({});
      expect(result).toBe("Anthropic API key is required");
    });

    it("returns error message on non-200 status", async () => {
      const { fn } = mockHttp({ status: 401, text: '{"error":"invalid_api_key"}' });
      const provider = new AnthropicProvider(fn);

      const result = await provider.testConnection({ apiKey: "sk-bad" });
      expect(result).toContain("401");
    });

    it("returns error message on network failure", async () => {
      const fn: HttpFn = async () => {
        throw new Error("Network error");
      };
      const provider = new AnthropicProvider(fn);

      const result = await provider.testConnection({ apiKey: "sk-key" });
      expect(result).toContain("Network error");
    });

    it("sends a minimal request to verify the key", async () => {
      const responseText = anthropicResponse("ok");
      const { fn, calls } = mockHttp({ status: 200, text: responseText });
      const provider = new AnthropicProvider(fn);

      await provider.testConnection({ apiKey: "sk-test" });

      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0].body!);
      expect(body.max_tokens).toBe(16);
      expect(body.messages).toHaveLength(1);
      expect(calls[0].headers!["x-api-key"]).toBe("sk-test");
    });
  });
});
