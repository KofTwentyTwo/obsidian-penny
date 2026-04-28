/**
 * PENNY - Per-Provider Streaming SSE Error Event Tests (#17)
 *
 * Verifies that each provider's streaming path detects mid-stream `error`
 * events and rejects the completion with a descriptive error, instead of
 * silently swallowing them and returning empty text.
 *
 * Mocks `streamRequest` so we can feed pre-canned SSE chunks directly to the
 * provider's onChunk callback, avoiding the need to stand up a real test
 * server with provider-specific URL routing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/providers/node-stream", async (importActual) => {
  // Keep the real HttpError / withRetry / isRetriable / backoffDelay so the
  // providers' refactored complete() wrappers function normally. Only swap
  // the network primitives (streamRequest) and bypass the timeout helper.
  const actual = await importActual<typeof import("../../src/providers/node-stream")>();
  return {
    ...actual,
    streamRequest: vi.fn(),
    withTimeout: <T>(p: Promise<T>) => p,
  };
});

import { streamRequest } from "../../src/providers/node-stream";
import { AnthropicProvider } from "../../src/providers/anthropic";
import { OpenAIProvider } from "../../src/providers/openai";
import { GoogleProvider } from "../../src/providers/google";
import { OllamaProvider } from "../../src/providers/ollama";
import type { HttpFn } from "../../src/providers/service";

const stubHttp: HttpFn = async () => ({ status: 200, headers: {}, text: "{}", json: {} });
const mockStream = vi.mocked(streamRequest);

beforeEach(() => {
  mockStream.mockReset();
});

/** Convenience: program the mock to feed a sequence of SSE-formatted chunks. */
function programChunks(chunks: string[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockStream.mockImplementation(async (opts: any) => {
    for (const chunk of chunks) {
      opts.onChunk(chunk);
    }
    return { status: 200, fullText: chunks.join("") };
  });
}

describe("Anthropic streaming — SSE error events", () => {
  it("rejects with upstream message when an error event is received mid-stream", async () => {
    programChunks([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}\n\n',
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Server is currently overloaded"}}\n\n',
    ]);

    const provider = new AnthropicProvider(stubHttp);
    const tokens: string[] = [];

    await expect(
      provider.complete({ maxRetries: 0,
        systemPrompt: "s",
        userPrompt: "u",
        model: "claude-sonnet-4-6",
        maxTokens: 100,
        apiKey: "mock-anthropic-test",
        onToken: (t) => tokens.push(t),
      }),
    ).rejects.toThrow(/Server is currently overloaded/);
  });

  it("does NOT silently include pre-error tokens in a successful result", async () => {
    programChunks([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n',
      'data: {"type":"error","error":{"type":"api_error","message":"Internal failure"}}\n\n',
    ]);

    const provider = new AnthropicProvider(stubHttp);
    const result = await provider.complete({ maxRetries: 0,
      systemPrompt: "s",
      userPrompt: "u",
      model: "claude-sonnet-4-6",
      maxTokens: 100,
      apiKey: "mock-anthropic-test",
      onToken: () => { /* ignore */ },
    }).catch((e) => e);

    // Should be a thrown Error, not a CompletionResponse
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/Internal failure/);
    // The function rejected — caller has no way to access the partial text
    expect("text" in (result as object)).toBe(false);
  });

  it("includes the error type in the thrown message", async () => {
    programChunks([
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    ]);

    const provider = new AnthropicProvider(stubHttp);
    await expect(
      provider.complete({ maxRetries: 0,
        systemPrompt: "s",
        userPrompt: "u",
        model: "claude-sonnet-4-6",
        maxTokens: 100,
        apiKey: "mock-anthropic-test",
        onToken: () => { /* required to take streaming path */ },
      }),
    ).rejects.toThrow(/overloaded_error/);
  });
});

describe("OpenAI streaming — SSE error events", () => {
  it("rejects when an error chunk is received mid-stream", async () => {
    programChunks([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"error":{"message":"Rate limit exceeded","type":"rate_limit_exceeded"}}\n\n',
    ]);

    const provider = new OpenAIProvider(stubHttp);
    await expect(
      provider.complete({ maxRetries: 0,
        systemPrompt: "s",
        userPrompt: "u",
        model: "gpt-4.1",
        maxTokens: 100,
        apiKey: "mock-openai-test",
        onToken: () => { /* ignore */ },
      }),
    ).rejects.toThrow(/Rate limit exceeded/);
  });

  it("does NOT silently include pre-error tokens", async () => {
    programChunks([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"error":{"message":"Service unavailable"}}\n\n',
    ]);

    const provider = new OpenAIProvider(stubHttp);
    const result = await provider.complete({ maxRetries: 0,
      systemPrompt: "s",
      userPrompt: "u",
      model: "gpt-4.1",
      maxTokens: 100,
      apiKey: "mock-openai-test",
      onToken: () => { /* ignore */ },
    }).catch((e) => e);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/Service unavailable/);
  });
});

describe("Google streaming — SSE error events", () => {
  it("rejects when an error chunk is received mid-stream", async () => {
    programChunks([
      'data: {"candidates":[{"content":{"parts":[{"text":"Some "}]}}]}\n\n',
      'data: {"error":{"code":429,"message":"Resource exhausted","status":"RESOURCE_EXHAUSTED"}}\n\n',
    ]);

    const provider = new GoogleProvider(stubHttp);
    await expect(
      provider.complete({ maxRetries: 0,
        systemPrompt: "s",
        userPrompt: "u",
        model: "gemini-2.5-flash",
        maxTokens: 100,
        apiKey: "mock-google-test",
        onToken: () => { /* ignore */ },
      }),
    ).rejects.toThrow(/Resource exhausted/);
  });

  it("does NOT silently include pre-error tokens", async () => {
    programChunks([
      'data: {"candidates":[{"content":{"parts":[{"text":"begin"}]}}]}\n\n',
      'data: {"error":{"message":"Filtered for safety"}}\n\n',
    ]);

    const provider = new GoogleProvider(stubHttp);
    const result = await provider.complete({ maxRetries: 0,
      systemPrompt: "s",
      userPrompt: "u",
      model: "gemini-2.5-flash",
      maxTokens: 100,
      apiKey: "mock-google-test",
      onToken: () => { /* ignore */ },
    }).catch((e) => e);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/Filtered for safety/);
  });
});

describe("Ollama streaming — SSE error events", () => {
  // Ollama's /v1/chat/completions endpoint is OpenAI-compatible; same shape.
  it("rejects when an error chunk is received mid-stream", async () => {
    programChunks([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"error":{"message":"Model not found"}}\n\n',
    ]);

    const provider = new OllamaProvider(stubHttp);
    await expect(
      provider.complete({ maxRetries: 0,
        systemPrompt: "s",
        userPrompt: "u",
        model: "llama3.2",
        maxTokens: 100,
        endpoint: "http://localhost:11434",
        onToken: () => { /* ignore */ },
      }),
    ).rejects.toThrow(/Model not found/);
  });

  it("rejects on bare-string Ollama error shape", async () => {
    // Ollama also sometimes emits `{"error": "..."}` (string, not object)
    programChunks([
      'data: {"error":"context deadline exceeded"}\n\n',
    ]);

    const provider = new OllamaProvider(stubHttp);
    await expect(
      provider.complete({ maxRetries: 0,
        systemPrompt: "s",
        userPrompt: "u",
        model: "llama3.2",
        maxTokens: 100,
        endpoint: "http://localhost:11434",
        onToken: () => { /* ignore */ },
      }),
    ).rejects.toThrow(/context deadline exceeded/);
  });
});

describe("Streaming error events — common contract", () => {
  it("error message includes the provider name for triage", async () => {
    programChunks([
      'data: {"type":"error","error":{"type":"x","message":"y"}}\n\n',
    ]);
    const provider = new AnthropicProvider(stubHttp);
    const err = await provider.complete({ maxRetries: 0,
      systemPrompt: "s",
      userPrompt: "u",
      model: "claude-sonnet-4-6",
      maxTokens: 100,
      apiKey: "mock-anthropic-test",
      onToken: () => { /* required to take streaming path */ },
    }).catch((e) => e);
    expect((err as Error).message.toLowerCase()).toContain("anthropic");
  });
});
