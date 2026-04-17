/**
 * PENNY - Anthropic Claude Provider
 *
 * Implements the LLMService interface for the Anthropic Messages API.
 * Supports Claude Opus, Sonnet, and Haiku model families.
 *
 * Key features:
 * - Adaptive thinking (extended thinking) for heavy-tier annotations
 *   on supported models (Opus 4.6, Sonnet 4.6)
 * - Static model catalog (ANTHROPIC_MODELS) for offline settings display
 * - Structured error handling with Anthropic-specific status codes
 * - Response parsing that extracts text blocks from the content array
 *   (skipping thinking blocks when extended thinking is enabled)
 *
 * Uses an injected HTTP function (Obsidian's requestUrl) so this module
 * has no direct Obsidian API dependency and can be tested with a mock.
 */

import type {
  LLMService,
  ModelInfo,
  CompletionRequest,
  CompletionResponse,
  ProviderSettings,
  HttpFn,
} from "./service";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Models that support the adaptive / extended thinking feature (Claude 4.6+). */
const THINKING_CAPABLE = new Set(["claude-opus-4-6", "claude-sonnet-4-6"]);

/**
 * Static model catalog for Anthropic.
 *
 * Intentionally hardcoded for offline/static use. The settings dropdown also
 * supports free-text input (via Ollama rows), so users are not locked to
 * this list. Update manually when Anthropic ships new model aliases.
 *
 * Context windows current as of April 2026. Opus 4.6 and Sonnet 4.6 support
 * 1M context in beta; Haiku 4.5 remains at 200k.
 */
export const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    contextWindow: 1000000,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    contextWindow: 1000000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    contextWindow: 200000,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
  },
];

/** Token estimation multiplier: ~1.33 tokens per word for Claude's tokenizer. */
const TOKEN_MULTIPLIER = 1.33;

export class AnthropicProvider implements LLMService {
  readonly name = "anthropic";
  readonly requiresApiKey = true;
  readonly tokenMultiplier = 1.33;

  constructor(private httpFn: HttpFn) {}

  async getModels(): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("Anthropic API key is required");
    }

    // When onToken is provided and fetch is available, use streaming
    if (request.onToken && typeof globalThis.fetch === "function") {
      return this.completeStreaming(request, apiKey);
    }

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.systemPrompt,
      messages: [
        { role: "user", content: request.userPrompt },
      ],
    };

    const useThinking = request.useThinking === true && THINKING_CAPABLE.has(request.model);
    if (useThinking) {
      body.thinking = { type: "adaptive" };
    }

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    };

    if (useThinking) {
      headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
    }

    const response = await this.httpFn({
      url: ANTHROPIC_API_URL,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (response.status < 200 || response.status >= 300) {
      throw this.buildHttpError(response.status, response.text);
    }

    return this.parseResponse(response.text, request.model);
  }

  /**
   * Streaming completion using native fetch + SSE parsing.
   * Calls request.onToken with each text delta as it arrives.
   */
  private async completeStreaming(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<CompletionResponse> {
    const useThinking = request.useThinking === true && THINKING_CAPABLE.has(request.model);

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
      stream: true,
    };

    if (useThinking) {
      body.thinking = { type: "adaptive" };
    }

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    };

    if (useThinking) {
      headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
    }

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw this.buildHttpError(resp.status, errText);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("Streaming not supported");

    const decoder = new TextDecoder();
    let buffer = "";
    const textParts: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);

          // Text delta -- the main output
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            const text = event.delta.text;
            textParts.push(text);
            request.onToken?.(text);
          }

          // Usage from message_delta (final event)
          if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? 0;
          }

          // Usage from message_start
          if (event.type === "message_start" && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens ?? 0;
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }

    return {
      text: textParts.join(""),
      usage: { inputTokens, outputTokens },
      model: request.model,
      provider: "anthropic",
    };
  }

  estimateTokens(text: string): number {
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    return Math.ceil(wordCount * TOKEN_MULTIPLIER);
  }

  async testConnection(settings: ProviderSettings): Promise<string | null> {
    if (!settings.apiKey) {
      return "Anthropic API key is required";
    }

    try {
      const body = {
        model: "claude-haiku-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      };

      const response = await this.httpFn({
        url: ANTHROPIC_API_URL,
        method: "POST",
        headers: {
          "x-api-key": settings.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.status >= 200 && response.status < 300) {
        return null; // success
      }
      return this.buildHttpError(response.status, response.text).message;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Anthropic connection failed: ${message}`;
    }
  }

  /**
   * Build a descriptive Error from an Anthropic HTTP error response.
   * Attempts to parse the Anthropic error JSON format; falls back to raw text.
   */
  private buildHttpError(status: number, responseText: string): Error {
    let detail: string;
    try {
      const data = JSON.parse(responseText);
      if (data?.error?.message) {
        detail = data.error.message;
      } else {
        detail = responseText;
      }
    } catch {
      detail = responseText;
    }

    if (status === 401) {
      return new Error(`Anthropic API error (401): Invalid API key. ${detail}`);
    }
    if (status === 429) {
      return new Error(`Anthropic API error (429): Rate limited. ${detail}`);
    }
    return new Error(`Anthropic API error (${status}): ${detail}`);
  }

  /**
   * Parse an Anthropic Messages API response.
   *
   * Response shape:
   * ```json
   * {
   *   "content": [
   *     { "type": "thinking", "thinking": "..." },
   *     { "type": "text", "text": "the actual output" }
   *   ],
   *   "usage": { "input_tokens": 100, "output_tokens": 50 }
   * }
   * ```
   */
  private parseResponse(responseText: string, model: string): CompletionResponse {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error("Anthropic API returned malformed response: " + responseText.slice(0, 200));
      }
      throw err;
    }

    let text = "";
    if (data && Array.isArray(data.content)) {
      const textBlock = data.content.find(
        (block: Record<string, unknown>) => block.type === "text",
      );
      if (textBlock && typeof textBlock.text === "string") {
        text = textBlock.text.trim();
      }
    }

    const usage = data.usage
      ? {
          inputTokens: data.usage.input_tokens as number | undefined,
          outputTokens: data.usage.output_tokens as number | undefined,
        }
      : undefined;

    return {
      text,
      usage,
      model,
      provider: this.name,
    };
  }
}
