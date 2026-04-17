/**
 * PENNY - Google Gemini Provider
 *
 * Implements the LLMService interface for the Google Generative Language API.
 * Supports Gemini 2.5 Pro, 2.5 Flash, and 2.0 Flash model families.
 *
 * Key features:
 * - Static model catalog (GOOGLE_MODELS) for offline settings display
 * - Structured error handling with Google-specific status codes
 * - API key authentication via query parameter
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

const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Static model catalog for Google Gemini.
 *
 * Intentionally hardcoded for offline/static use. Update manually
 * when Google ships new model aliases.
 *
 * Context windows current as of April 2026.
 */
export const GOOGLE_MODELS: ModelInfo[] = [
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    contextWindow: 1048576,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    contextWindow: 1048576,
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    contextWindow: 1048576,
  },
];

/** Token estimation multiplier: ~1.0 tokens per word for Gemini's tokenizer. */
const TOKEN_MULTIPLIER = 1.0;

export class GoogleProvider implements LLMService {
  readonly name = "google";
  readonly requiresApiKey = true;
  readonly tokenMultiplier = 1.0;

  constructor(private httpFn: HttpFn) {}

  async getModels(): Promise<ModelInfo[]> {
    return GOOGLE_MODELS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = request.apiKey;
    if (!apiKey) {
      throw new Error("Google API key is required");
    }

    if (request.onToken && typeof globalThis.fetch === "function") {
      try {
        return await this.completeStreaming(request, apiKey);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("fetch") || msg.includes("Failed") || msg.includes("CSP")) {
          // Fall through to non-streaming
        } else {
          throw e;
        }
      }
    }

    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: request.userPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: request.maxTokens,
      },
    };

    if (request.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    const url = `${GOOGLE_API_BASE}/${request.model}:generateContent?key=${apiKey}`;

    const response = await this.httpFn({
      url,
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status < 200 || response.status >= 300) {
      throw this.buildHttpError(response.status, response.text);
    }

    return this.parseResponse(response.text, request.model);
  }

  private async completeStreaming(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: request.userPrompt }] }],
      generationConfig: { maxOutputTokens: request.maxTokens },
    };
    if (request.systemPrompt) {
      body.systemInstruction = { parts: [{ text: request.systemPrompt }] };
    }

    // Google uses streamGenerateContent with alt=sse for SSE streaming
    const url = `${GOOGLE_API_BASE}/${request.model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw this.buildHttpError(resp.status, await resp.text());
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("Streaming not supported");

    const decoder = new TextDecoder();
    let buffer = "";
    const textParts: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        try {
          const event = JSON.parse(data);
          const parts = event.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (typeof part.text === "string") {
                textParts.push(part.text);
                request.onToken?.(part.text);
              }
            }
          }
        } catch { /* skip */ }
      }
    }

    return {
      text: textParts.join(""),
      usage: {},
      model: request.model,
      provider: "google",
    };
  }

  estimateTokens(text: string): number {
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    return Math.ceil(wordCount * TOKEN_MULTIPLIER);
  }

  async testConnection(settings: ProviderSettings): Promise<string | null> {
    if (!settings.apiKey) {
      return "Google API key is required";
    }

    try {
      const body = {
        contents: [
          {
            role: "user",
            parts: [{ text: "ping" }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 16,
        },
      };

      const url = `${GOOGLE_API_BASE}/gemini-2.0-flash:generateContent?key=${settings.apiKey}`;

      const response = await this.httpFn({
        url,
        method: "POST",
        headers: {
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
      return `Google connection failed: ${message}`;
    }
  }

  /**
   * Build a descriptive Error from a Google HTTP error response.
   * Attempts to parse the Google error JSON format; falls back to raw text.
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
      return new Error(`Google API error (401): Invalid API key. ${detail}`);
    }
    if (status === 429) {
      return new Error(`Google API error (429): Rate limited. ${detail}`);
    }
    return new Error(`Google API error (${status}): ${detail}`);
  }

  /**
   * Parse a Google Generative Language API response.
   *
   * Response shape:
   * ```json
   * {
   *   "candidates": [
   *     { "content": { "parts": [{ "text": "the actual output" }] } }
   *   ],
   *   "usageMetadata": { "promptTokenCount": 100, "candidatesTokenCount": 50 }
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
        throw new Error("Google API returned malformed response: " + responseText.slice(0, 200));
      }
      throw err;
    }

    let text = "";
    if (data && Array.isArray(data.candidates) && data.candidates.length > 0) {
      const candidate = data.candidates[0];
      if (candidate.content && Array.isArray(candidate.content.parts)) {
        const textPart = candidate.content.parts.find(
          (part: Record<string, unknown>) => typeof part.text === "string",
        );
        if (textPart) {
          text = textPart.text.trim();
        }
      }
    }

    const usage = data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount as number | undefined,
          outputTokens: data.usageMetadata.candidatesTokenCount as number | undefined,
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
