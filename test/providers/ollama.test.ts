import { describe, it, expect } from "vitest";
import { OllamaProvider } from "../../src/providers/ollama";
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

/** Build a standard OpenAI-compatible chat completions response. */
function ollamaResponse(text: string, opts?: {
  promptTokens?: number;
  completionTokens?: number;
}): string {
  return JSON.stringify({
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: opts?.promptTokens ?? 50,
      completion_tokens: opts?.completionTokens ?? 30,
    },
  });
}

/** Build a /api/tags response listing local models. */
function tagsResponse(modelNames: string[]): string {
  return JSON.stringify({
    models: modelNames.map((name) => ({
      name,
      model: name,
      modified_at: "2024-01-01T00:00:00Z",
      size: 1000000000,
    })),
  });
}

function makeRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    systemPrompt: "You are a writing assistant.",
    userPrompt: "Rewrite this passage.",
    model: "llama3.2",
    maxTokens: 2048,
    endpoint: "http://localhost:11434",
    ...overrides,
  };
}

describe("OllamaProvider", () => {
  describe("metadata", () => {
    it("has name 'ollama'", () => {
      const { fn } = mockHttp();
      const provider = new OllamaProvider(fn);
      expect(provider.name).toBe("ollama");
    });

    it("does not require an API key", () => {
      const { fn } = mockHttp();
      const provider = new OllamaProvider(fn);
      expect(provider.requiresApiKey).toBe(false);
    });
  });

  describe("getModels", () => {
    it("fetches models from /api/tags", async () => {
      const text = tagsResponse(["llama3.2", "mistral", "deepseek-coder"]);
      const { fn, calls } = mockHttp({ text });
      const provider = new OllamaProvider(fn);

      const models = await provider.getModels({ endpoint: "http://localhost:11434" });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://localhost:11434/api/tags");
      expect(calls[0].method).toBe("GET");
      expect(models).toHaveLength(3);
      expect(models.map((m) => m.id)).toEqual(["llama3.2", "mistral", "deepseek-coder"]);
    });

    it("returns model names in both id and name fields", async () => {
      const text = tagsResponse(["llama3.2"]);
      const { fn } = mockHttp({ text });
      const provider = new OllamaProvider(fn);

      const models = await provider.getModels({ endpoint: "http://localhost:11434" });

      expect(models[0].id).toBe("llama3.2");
      expect(models[0].name).toBe("llama3.2");
    });

    it("sets cost to 0 for local models", async () => {
      const text = tagsResponse(["llama3.2"]);
      const { fn } = mockHttp({ text });
      const provider = new OllamaProvider(fn);

      const models = await provider.getModels({ endpoint: "http://localhost:11434" });

      expect(models[0].costPer1kInput).toBe(0);
      expect(models[0].costPer1kOutput).toBe(0);
    });

    it("throws when Ollama is not running (connection refused)", async () => {
      const fn: HttpFn = async () => {
        throw new Error("Connection refused");
      };
      const provider = new OllamaProvider(fn);

      await expect(
        provider.getModels({ endpoint: "http://localhost:11434" }),
      ).rejects.toThrow("Cannot connect to Ollama at http://localhost:11434. Is Ollama running?");
    });

    it("returns empty array for unexpected response format", async () => {
      const { fn } = mockHttp({ text: '{"something": "else"}' });
      const provider = new OllamaProvider(fn);

      const models = await provider.getModels({ endpoint: "http://localhost:11434" });
      expect(models).toEqual([]);
    });

    it("uses default endpoint when settings omit it", async () => {
      const text = tagsResponse(["llama3.2"]);
      const { fn, calls } = mockHttp({ text });
      const provider = new OllamaProvider(fn);

      await provider.getModels();

      expect(calls[0].url).toBe("http://localhost:11434/api/tags");
    });

    it("uses custom endpoint from settings", async () => {
      const text = tagsResponse(["llama3.2"]);
      const { fn, calls } = mockHttp({ text });
      const provider = new OllamaProvider(fn);

      await provider.getModels({ endpoint: "http://remote-server:8080" });

      expect(calls[0].url).toBe("http://remote-server:8080/api/tags");
    });
  });

  describe("complete", () => {
    it("sends correct OpenAI-format request body", async () => {
      const responseText = ollamaResponse("Revised text.");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      await provider.complete(makeRequest());

      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0].body!);

      expect(body.model).toBe("llama3.2");
      expect(body.max_tokens).toBe(2048);
      expect(body.stream).toBe(false);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0]).toEqual({ role: "system", content: "You are a writing assistant." });
      expect(body.messages[1]).toEqual({ role: "user", content: "Rewrite this passage." });
    });

    it("calls the correct endpoint URL", async () => {
      const responseText = ollamaResponse("ok");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      await provider.complete(makeRequest({ endpoint: "http://myserver:1234" }));

      expect(calls[0].url).toBe("http://myserver:1234/v1/chat/completions");
    });

    it("uses default endpoint when none provided", async () => {
      const responseText = ollamaResponse("ok");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      await provider.complete(makeRequest({ endpoint: undefined }));

      expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    });

    it("extracts text from choices[0].message.content", async () => {
      const responseText = ollamaResponse("She kicked the door open.");
      const { fn } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(result.text).toBe("She kicked the door open.");
      expect(result.provider).toBe("ollama");
      expect(result.model).toBe("llama3.2");
    });

    it("parses usage information", async () => {
      const responseText = ollamaResponse("Output.", {
        promptTokens: 300,
        completionTokens: 150,
      });
      const { fn } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(result.usage).toBeDefined();
      expect(result.usage!.inputTokens).toBe(300);
      expect(result.usage!.outputTokens).toBe(150);
    });

    it("returns empty text when response has no choices", async () => {
      const responseText = JSON.stringify({ choices: [] });
      const { fn } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      const result = await provider.complete(makeRequest());
      expect(result.text).toBe("");
    });

    it("sends content-type header", async () => {
      const responseText = ollamaResponse("ok");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      await provider.complete(makeRequest());

      expect(calls[0].headers!["content-type"]).toBe("application/json");
    });

    it("includes Bearer token when apiKey is provided", async () => {
      const responseText = ollamaResponse("ok");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      await provider.complete(makeRequest({ apiKey: "remote-key-123" }));

      expect(calls[0].headers!["Authorization"]).toBe("Bearer remote-key-123");
    });

    it("omits Authorization header when no apiKey", async () => {
      const responseText = ollamaResponse("ok");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      await provider.complete(makeRequest({ apiKey: undefined }));

      expect(calls[0].headers!["Authorization"]).toBeUndefined();
    });

    it("throws on non-2xx response with error message", async () => {
      const errorResponse = JSON.stringify({ error: "model not found" });
      const { fn } = mockHttp({ status: 404, text: errorResponse });
      const provider = new OllamaProvider(fn);

      await expect(provider.complete(makeRequest())).rejects.toThrow("Ollama error (404)");
      await expect(provider.complete(makeRequest())).rejects.toThrow("model not found");
    });

    it("throws on 500 response with raw text when not JSON", async () => {
      const { fn } = mockHttp({ status: 500, text: "Internal Server Error" });
      const provider = new OllamaProvider(fn);

      await expect(provider.complete(makeRequest())).rejects.toThrow("Ollama error (500): Internal Server Error");
    });

    it("throws connection refused message when Ollama is not running", async () => {
      const fn: HttpFn = async () => {
        throw new Error("ECONNREFUSED");
      };
      const provider = new OllamaProvider(fn);

      await expect(
        provider.complete(makeRequest()),
      ).rejects.toThrow("Cannot connect to Ollama at http://localhost:11434. Is Ollama running?");
    });
  });

  describe("streaming fallback", () => {
    it("uses httpFn path when onToken is NOT provided", async () => {
      const responseText = ollamaResponse("Non-streaming result.");
      const { fn, calls } = mockHttp({ text: responseText });
      const provider = new OllamaProvider(fn);

      const result = await provider.complete(makeRequest());

      expect(calls).toHaveLength(1);
      expect(result.text).toBe("Non-streaming result.");
      expect(result.provider).toBe("ollama");
    });

    it("falls back to httpFn when onToken is set but globalThis.fetch is unavailable", async () => {
      const originalFetch = globalThis.fetch;
      try {
        // @ts-expect-error -- deliberately removing fetch to test fallback
        globalThis.fetch = undefined;

        const responseText = ollamaResponse("Fallback result.");
        const { fn, calls } = mockHttp({ text: responseText });
        const provider = new OllamaProvider(fn);

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

        const responseText = ollamaResponse("OK");
        const { fn } = mockHttp({ text: responseText });
        const provider = new OllamaProvider(fn);

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
      const provider = new OllamaProvider(fn);

      const text = "one two three four five six seven eight nine ten";
      const estimate = provider.estimateTokens(text);
      expect(estimate).toBe(10);
    });

    it("handles empty text", () => {
      const { fn } = mockHttp();
      const provider = new OllamaProvider(fn);
      expect(provider.estimateTokens("")).toBe(0);
    });

    it("handles single word", () => {
      const { fn } = mockHttp();
      const provider = new OllamaProvider(fn);
      expect(provider.estimateTokens("hello")).toBe(1);
    });

    it("ignores extra whitespace", () => {
      const { fn } = mockHttp();
      const provider = new OllamaProvider(fn);
      expect(provider.estimateTokens("  spaced   out   text  ")).toBe(3);
    });
  });

  describe("testConnection", () => {
    it("returns null on successful connection", async () => {
      const text = tagsResponse(["llama3.2"]);
      const { fn } = mockHttp({ status: 200, text });
      const provider = new OllamaProvider(fn);

      const result = await provider.testConnection({ endpoint: "http://localhost:11434" });
      expect(result).toBeNull();
    });

    it("pings /api/tags endpoint", async () => {
      const text = tagsResponse([]);
      const { fn, calls } = mockHttp({ status: 200, text });
      const provider = new OllamaProvider(fn);

      await provider.testConnection({ endpoint: "http://localhost:11434" });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://localhost:11434/api/tags");
      expect(calls[0].method).toBe("GET");
    });

    it("returns error message on non-200 status", async () => {
      const { fn } = mockHttp({ status: 500, text: "Internal Server Error" });
      const provider = new OllamaProvider(fn);

      const result = await provider.testConnection({ endpoint: "http://localhost:11434" });
      expect(result).toContain("500");
      expect(result).toContain("Ollama error");
    });

    it("returns error message when Ollama is not running", async () => {
      const fn: HttpFn = async () => {
        throw new Error("ECONNREFUSED");
      };
      const provider = new OllamaProvider(fn);

      const result = await provider.testConnection({ endpoint: "http://localhost:11434" });
      expect(result).toContain("Cannot connect to Ollama");
      expect(result).toContain("http://localhost:11434");
      expect(result).toContain("Is Ollama running?");
    });

    it("uses default endpoint when not specified", async () => {
      const text = tagsResponse([]);
      const { fn, calls } = mockHttp({ status: 200, text });
      const provider = new OllamaProvider(fn);

      await provider.testConnection({});

      expect(calls[0].url).toBe("http://localhost:11434/api/tags");
    });

    it("uses custom endpoint from settings", async () => {
      const text = tagsResponse([]);
      const { fn, calls } = mockHttp({ status: 200, text });
      const provider = new OllamaProvider(fn);

      await provider.testConnection({ endpoint: "http://remote:8080" });

      expect(calls[0].url).toBe("http://remote:8080/api/tags");
    });
  });
});
