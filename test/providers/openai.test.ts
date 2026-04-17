import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "../../src/providers/openai";
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

/** Build a standard OpenAI Chat Completions API response body. */
function openaiResponse(text: string, opts?: {
  promptTokens?: number;
  completionTokens?: number;
  model?: string;
}): string {
  return JSON.stringify({
    choices: [
      {
        message: {
          role: "assistant",
          content: text,
        },
        finish_reason: "stop",
        index: 0,
      },
    ],
    usage: {
      prompt_tokens: opts?.promptTokens ?? 100,
      completion_tokens: opts?.completionTokens ?? 50,
    },
    model: opts?.model ?? "gpt-4.1",
  });
}

function makeRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    systemPrompt: "You are a writing assistant.",
    userPrompt: "Rewrite this passage with more tension.",
    model: "gpt-4.1",
    maxTokens: 4096,
    apiKey: "sk-test-key-123",
    ...overrides,
  };
}

describe("OpenAIProvider", () => {
  describe("metadata", () => {
    it("has name 'openai'", () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);
      expect(provider.name).toBe("openai");
    });

    it("requires an API key", () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);
      expect(provider.requiresApiKey).toBe(true);
    });
  });

  describe("getModels", () => {
    it("returns static list of OpenAI models", async () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);
      const models = await provider.getModels();

      expect(models.length).toBe(5);

      const ids = models.map((m) => m.id);
      expect(ids).toContain("gpt-4.1");
      expect(ids).toContain("gpt-4.1-mini");
      expect(ids).toContain("gpt-4.1-nano");
      expect(ids).toContain("o3");
      expect(ids).toContain("o4-mini");
    });

    it("includes context window info", async () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);
      const models = await provider.getModels();

      const gpt41 = models.find((m) => m.id === "gpt-4.1");
      expect(gpt41).toBeDefined();
      expect(gpt41!.contextWindow).toBe(1047576);

      const o3 = models.find((m) => m.id === "o3");
      expect(o3).toBeDefined();
      expect(o3!.contextWindow).toBe(200000);
    });
  });

  describe("complete", () => {
    it("sends correct request body format", async () => {
      const responseText = openaiResponse("Revised passage.");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OpenAIProvider(fn);

      await provider.complete(makeRequest());

      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0].body!);

      expect(body.model).toBe("gpt-4.1");
      expect(body.max_tokens).toBe(4096);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toBe("You are a writing assistant.");
      expect(body.messages[1].role).toBe("user");
      expect(body.messages[1].content).toBe("Rewrite this passage with more tension.");
    });

    it("calls the correct API URL", async () => {
      const responseText = openaiResponse("OK");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OpenAIProvider(fn);

      await provider.complete(makeRequest());

      expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("sends correct headers with Bearer auth", async () => {
      const responseText = openaiResponse("OK");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OpenAIProvider(fn);

      await provider.complete(makeRequest());

      expect(calls).toHaveLength(1);
      const headers = calls[0].headers!;
      expect(headers["Authorization"]).toBe("Bearer sk-test-key-123");
      expect(headers["content-type"]).toBe("application/json");
    });

    it("extracts text from a standard response", async () => {
      const responseText = openaiResponse("The door slammed shut.");
      const { fn } = mockHttp({ text: responseText });
      const provider = new OpenAIProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(result.text).toBe("The door slammed shut.");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4.1");
    });

    it("parses usage information", async () => {
      const responseText = openaiResponse("Output.", {
        promptTokens: 500,
        completionTokens: 200,
      });
      const { fn } = mockHttp({ text: responseText });
      const provider = new OpenAIProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(result.usage).toBeDefined();
      expect(result.usage!.inputTokens).toBe(500);
      expect(result.usage!.outputTokens).toBe(200);
    });

    it("returns empty text when response has no choices", async () => {
      const responseText = JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      });
      const { fn } = mockHttp({ text: responseText });
      const provider = new OpenAIProvider(fn);

      const result = await provider.complete(makeRequest());
      expect(result.text).toBe("");
    });

    it("throws if no API key is provided", async () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);

      await expect(
        provider.complete(makeRequest({ apiKey: undefined })),
      ).rejects.toThrow("OpenAI API key is required");
    });

    it("uses the model from the request", async () => {
      const responseText = openaiResponse("ok");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OpenAIProvider(fn);

      await provider.complete(makeRequest({ model: "o3" }));

      const body = JSON.parse(calls[0].body!);
      expect(body.model).toBe("o3");
    });

    it("throws on 400 response with error message", async () => {
      const errorResponse = JSON.stringify({
        error: { message: "max_tokens must be positive", type: "invalid_request_error", code: null },
      });
      const { fn } = mockHttp({ status: 400, text: errorResponse });
      const provider = new OpenAIProvider(fn);

      await expect(provider.complete(makeRequest())).rejects.toThrow(
        "OpenAI API error (400): max_tokens must be positive"
      );
    });

    it("throws 'Invalid API key' on 401 response", async () => {
      const errorResponse = JSON.stringify({
        error: { message: "Incorrect API key provided", type: "authentication_error", code: "invalid_api_key" },
      });
      const { fn } = mockHttp({ status: 401, text: errorResponse });
      const provider = new OpenAIProvider(fn);

      await expect(provider.complete(makeRequest())).rejects.toThrow("Invalid API key");
      await expect(provider.complete(makeRequest())).rejects.toThrow("401");
    });

    it("throws 'Rate limited' on 429 response", async () => {
      const errorResponse = JSON.stringify({
        error: { message: "Rate limit reached", type: "rate_limit_error", code: "rate_limit_exceeded" },
      });
      const { fn } = mockHttp({ status: 429, text: errorResponse });
      const provider = new OpenAIProvider(fn);

      await expect(provider.complete(makeRequest())).rejects.toThrow("Rate limited");
      await expect(provider.complete(makeRequest())).rejects.toThrow("429");
    });

    it("throws on 500 response with server error text", async () => {
      const errorResponse = JSON.stringify({
        error: { message: "Internal server error", type: "server_error", code: null },
      });
      const { fn } = mockHttp({ status: 500, text: errorResponse });
      const provider = new OpenAIProvider(fn);

      await expect(provider.complete(makeRequest())).rejects.toThrow("OpenAI API error (500)");
      await expect(provider.complete(makeRequest())).rejects.toThrow("Internal server error");
    });

    it("throws with raw text when error response is not valid JSON", async () => {
      const { fn } = mockHttp({ status: 502, text: "Bad Gateway" });
      const provider = new OpenAIProvider(fn);

      await expect(provider.complete(makeRequest())).rejects.toThrow("OpenAI API error (502): Bad Gateway");
    });
  });

  describe("estimateTokens", () => {
    it("estimates tokens as words * 1.0", () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);

      // 10 words
      const text = "one two three four five six seven eight nine ten";
      const estimate = provider.estimateTokens(text);
      expect(estimate).toBe(10);
    });

    it("handles empty text", () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);
      expect(provider.estimateTokens("")).toBe(0);
    });

    it("handles single word", () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);
      expect(provider.estimateTokens("hello")).toBe(1);
    });

    it("ignores extra whitespace in word count", () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);
      const text = "  spaced   out   text  ";
      expect(provider.estimateTokens(text)).toBe(3);
    });
  });

  describe("testConnection", () => {
    it("returns null on successful connection", async () => {
      const modelsResponse = JSON.stringify({ data: [{ id: "gpt-4.1" }] });
      const { fn } = mockHttp({ status: 200, text: modelsResponse });
      const provider = new OpenAIProvider(fn);

      const result = await provider.testConnection({ apiKey: "sk-valid" });
      expect(result).toBeNull();
    });

    it("returns error message when API key is missing", async () => {
      const { fn } = mockHttp();
      const provider = new OpenAIProvider(fn);

      const result = await provider.testConnection({});
      expect(result).toBe("OpenAI API key is required");
    });

    it("returns error message on non-200 status", async () => {
      const { fn } = mockHttp({ status: 401, text: '{"error":{"message":"invalid key"}}' });
      const provider = new OpenAIProvider(fn);

      const result = await provider.testConnection({ apiKey: "sk-bad" });
      expect(result).toContain("401");
    });

    it("returns error message on network failure", async () => {
      const fn: HttpFn = async () => {
        throw new Error("Network error");
      };
      const provider = new OpenAIProvider(fn);

      const result = await provider.testConnection({ apiKey: "sk-key" });
      expect(result).toContain("Network error");
    });

    it("sends a GET request to /v1/models to verify the key", async () => {
      const modelsResponse = JSON.stringify({ data: [{ id: "gpt-4.1" }] });
      const { fn, calls } = mockHttp({ status: 200, text: modelsResponse });
      const provider = new OpenAIProvider(fn);

      await provider.testConnection({ apiKey: "sk-test" });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.openai.com/v1/models");
      expect(calls[0].method).toBe("GET");
      expect(calls[0].headers!["Authorization"]).toBe("Bearer sk-test");
    });
  });
});
