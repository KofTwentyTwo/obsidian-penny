import { describe, it, expect, vi } from "vitest";
import { GoogleProvider } from "../../src/providers/google";
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

/** Build a standard Google Generative Language API response body. */
function googleResponse(text: string, opts?: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}): string {
  return JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: "model",
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: opts?.promptTokenCount ?? 100,
      candidatesTokenCount: opts?.candidatesTokenCount ?? 50,
    },
  });
}

function makeRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    systemPrompt: "You are a writing assistant.",
    userPrompt: "Rewrite this passage with more tension.",
    model: "gemini-2.5-flash",
    maxTokens: 4096,
    apiKey: "mock-google-test-key-123",
    ...overrides,
  };
}

describe("GoogleProvider", () => {
  describe("metadata", () => {
    it("has name 'google'", () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);
      expect(provider.name).toBe("google");
    });

    it("requires an API key", () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);
      expect(provider.requiresApiKey).toBe(true);
    });
  });

  describe("getModels", () => {
    it("returns static list of Gemini models", async () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);
      const models = await provider.getModels();

      expect(models.length).toBe(3);

      const ids = models.map((m) => m.id);
      expect(ids).toContain("gemini-2.5-pro");
      expect(ids).toContain("gemini-2.5-flash");
      expect(ids).toContain("gemini-2.0-flash");
    });

    it("includes context window info", async () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);
      const models = await provider.getModels();

      const pro = models.find((m) => m.id === "gemini-2.5-pro");
      expect(pro).toBeDefined();
      expect(pro!.contextWindow).toBe(1048576);
    });
  });

  describe("complete", () => {
    it("sends correct request body format", async () => {
      const responseText = googleResponse("Revised passage.");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new GoogleProvider(fn);

      await provider.complete(makeRequest());

      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0].body!);

      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].role).toBe("user");
      expect(body.contents[0].parts[0].text).toBe("Rewrite this passage with more tension.");
      expect(body.systemInstruction).toBeDefined();
      expect(body.systemInstruction.parts[0].text).toBe("You are a writing assistant.");
      expect(body.generationConfig.maxOutputTokens).toBe(4096);
    });

    it("calls the correct API URL with model and key", async () => {
      const responseText = googleResponse("OK");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new GoogleProvider(fn);

      await provider.complete(makeRequest());

      expect(calls[0].url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=mock-google-test-key-123"
      );
    });

    it("sends correct headers", async () => {
      const responseText = googleResponse("OK");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new GoogleProvider(fn);

      await provider.complete(makeRequest());

      expect(calls).toHaveLength(1);
      const headers = calls[0].headers!;
      expect(headers["content-type"]).toBe("application/json");
    });

    it("extracts text from a standard response", async () => {
      const responseText = googleResponse("The door slammed shut.");
      const { fn } = mockHttp({ text: responseText });
      const provider = new GoogleProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(result.text).toBe("The door slammed shut.");
      expect(result.provider).toBe("google");
      expect(result.model).toBe("gemini-2.5-flash");
    });

    it("parses usage information", async () => {
      const responseText = googleResponse("Output.", {
        promptTokenCount: 500,
        candidatesTokenCount: 200,
      });
      const { fn } = mockHttp({ text: responseText });
      const provider = new GoogleProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(result.usage).toBeDefined();
      expect(result.usage!.inputTokens).toBe(500);
      expect(result.usage!.outputTokens).toBe(200);
    });

    it("returns empty text when response has no candidates", async () => {
      const responseText = JSON.stringify({
        candidates: [],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
      });
      const { fn } = mockHttp({ text: responseText });
      const provider = new GoogleProvider(fn);

      const result = await provider.complete(makeRequest());
      expect(result.text).toBe("");
    });

    it("throws if no API key is provided", async () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);

      await expect(
        provider.complete(makeRequest({ apiKey: undefined })),
      ).rejects.toThrow("Google API key is required");
    });

    it("uses the model from the request", async () => {
      const responseText = googleResponse("ok");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new GoogleProvider(fn);

      await provider.complete(makeRequest({ model: "gemini-2.5-pro" }));

      expect(calls[0].url).toContain("gemini-2.5-pro:generateContent");
    });

    it("throws on 400 response with error message", async () => {
      const errorResponse = JSON.stringify({
        error: { code: 400, message: "Invalid request", status: "INVALID_ARGUMENT" },
      });
      const { fn } = mockHttp({ status: 400, text: errorResponse });
      const provider = new GoogleProvider(fn);

      await expect(provider.complete(makeRequest())).rejects.toThrow(
        "Google API error (400): Invalid request"
      );
    });

    it("throws 'Invalid API key' on 401 response", async () => {
      const errorResponse = JSON.stringify({
        error: { code: 401, message: "API key not valid", status: "UNAUTHENTICATED" },
      });
      const { fn } = mockHttp({ status: 401, text: errorResponse });
      const provider = new GoogleProvider(fn);

      await expect(provider.complete(makeRequest())).rejects.toThrow("Invalid API key");
      await expect(provider.complete(makeRequest())).rejects.toThrow("401");
    });

    it("throws 'Rate limited' on 429 response", async () => {
      const errorResponse = JSON.stringify({
        error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" },
      });
      const { fn } = mockHttp({ status: 429, text: errorResponse });
      const provider = new GoogleProvider(fn);

      // maxRetries: 0 keeps this single-attempt; retry behavior covered separately.
      await expect(provider.complete(makeRequest({ maxRetries: 0 }))).rejects.toThrow("Rate limited");
      await expect(provider.complete(makeRequest({ maxRetries: 0 }))).rejects.toThrow("429");
    });

    it("throws on 500 response with server error text", async () => {
      const errorResponse = JSON.stringify({
        error: { code: 500, message: "Internal error", status: "INTERNAL" },
      });
      const { fn } = mockHttp({ status: 500, text: errorResponse });
      const provider = new GoogleProvider(fn);

      await expect(provider.complete(makeRequest({ maxRetries: 0 }))).rejects.toThrow("Google API error (500)");
      await expect(provider.complete(makeRequest({ maxRetries: 0 }))).rejects.toThrow("Internal error");
    });

    it("throws with raw text when error response is not valid JSON", async () => {
      const { fn } = mockHttp({ status: 502, text: "Bad Gateway" });
      const provider = new GoogleProvider(fn);

      await expect(provider.complete(makeRequest({ maxRetries: 0 }))).rejects.toThrow("Google API error (502): Bad Gateway");
    });
  });

  describe("streaming fallback", () => {
    it("uses httpFn path when onToken is NOT provided", async () => {
      const responseText = googleResponse("Non-streaming result.");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new GoogleProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(calls).toHaveLength(1);
      expect(result.text).toBe("Non-streaming result.");
      expect(result.provider).toBe("google");
    });

    it("falls back to httpFn when onToken is set but globalThis.fetch is unavailable", async () => {
      const originalFetch = globalThis.fetch;
      try {
        // @ts-expect-error -- deliberately removing fetch to test fallback
        globalThis.fetch = undefined;

        const responseText = googleResponse("Fallback result.");
        const { fn, calls } = mockHttp({ text: responseText });
        const provider = new GoogleProvider(fn);

        const tokens: string[] = [];
        const result = await provider.complete(
          makeRequest({ onToken: (t) => tokens.push(t) }),
        );

        expect(calls).toHaveLength(1);
        expect(result.text).toBe("Fallback result.");
        expect(tokens).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("accepts onToken in the request interface without errors", async () => {
      const originalFetch = globalThis.fetch;
      try {
        // @ts-expect-error -- deliberately removing fetch to test fallback
        globalThis.fetch = undefined;

        const responseText = googleResponse("OK");
        const { fn } = mockHttp({ text: responseText });
        const provider = new GoogleProvider(fn);

        const result = await provider.complete(
          makeRequest({ onToken: () => {} }),
        );
        expect(result.text).toBe("OK");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("estimateTokens", () => {
    it("estimates tokens as words * 1.0", () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);

      // 10 words
      const text = "one two three four five six seven eight nine ten";
      const estimate = provider.estimateTokens(text);
      expect(estimate).toBe(10);
    });

    it("handles empty text", () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);
      expect(provider.estimateTokens("")).toBe(0);
    });

    it("handles single word", () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);
      expect(provider.estimateTokens("hello")).toBe(1);
    });

    it("ignores extra whitespace in word count", () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);
      const text = "  spaced   out   text  ";
      expect(provider.estimateTokens(text)).toBe(3);
    });
  });

  describe("testConnection", () => {
    it("returns null on successful connection", async () => {
      const responseText = googleResponse("pong");
      const { fn } = mockHttp({ status: 200, text: responseText });
      const provider = new GoogleProvider(fn);

      const result = await provider.testConnection({ apiKey: "mock-google-valid" });
      expect(result).toBeNull();
    });

    it("returns error message when API key is missing", async () => {
      const { fn } = mockHttp();
      const provider = new GoogleProvider(fn);

      const result = await provider.testConnection({});
      expect(result).toBe("Google API key is required");
    });

    it("returns error message on non-200 status", async () => {
      const { fn } = mockHttp({ status: 401, text: '{"error":{"message":"invalid key"}}' });
      const provider = new GoogleProvider(fn);

      const result = await provider.testConnection({ apiKey: "mock-google-bad" });
      expect(result).toContain("401");
    });

    it("returns error message on network failure", async () => {
      const fn: HttpFn = async () => {
        throw new Error("Network error");
      };
      const provider = new GoogleProvider(fn);

      const result = await provider.testConnection({ apiKey: "mock-google-key" });
      expect(result).toContain("Network error");
    });

    it("sends a minimal request to verify the key", async () => {
      const responseText = googleResponse("ok");
      const { fn, calls } = mockHttp({ status: 200, text: responseText });
      const provider = new GoogleProvider(fn);

      await provider.testConnection({ apiKey: "mock-google-test" });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("key=mock-google-test");
      expect(calls[0].url).toContain("gemini-2.0-flash:generateContent");
      const body = JSON.parse(calls[0].body!);
      expect(body.generationConfig.maxOutputTokens).toBe(16);
    });
  });
});
