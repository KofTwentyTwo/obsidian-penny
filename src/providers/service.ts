/**
 * PENNY - LLM Service Interface
 *
 * Defines the contract that every LLM provider must implement. Adding a
 * new provider (e.g. OpenAI, Google) requires:
 * 1. Implement the LLMService interface in a new file
 * 2. Register it in providers/index.ts createRegistry()
 *
 * Also defines the HTTP abstraction layer (HttpFn, HttpRequestParam,
 * HttpResponse) so providers can make HTTP calls without importing
 * Obsidian directly. The real HTTP function (Obsidian's requestUrl)
 * is injected at construction time via the provider registry.
 *
 * This file has no implementation -- it is pure interface definitions.
 */

/** HTTP request parameters. Mirrors Obsidian's RequestUrlParam shape so the adapter is thin. */
export interface HttpRequestParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  contentType?: string;
}

/** HTTP response shape. Mirrors Obsidian's RequestUrlResponse for adapter compatibility. */
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
}

/** Injectable HTTP function type. Obsidian's requestUrl at runtime; a mock in tests. */
export type HttpFn = (params: HttpRequestParam) => Promise<HttpResponse>;

/**
 * Every LLM provider implements this interface.
 * Instances are created by the provider registry (providers/index.ts)
 * and looked up by name at runtime by the pipeline.
 */
export interface LLMService {
  /** Unique provider name used in route configuration (e.g. "anthropic", "ollama"). */
  readonly name: string;
  /** Whether this provider requires an API key to function. */
  readonly requiresApiKey: boolean;

  /** Available models for this provider (static list or dynamically fetched from endpoint). */
  getModels(settings?: ProviderSettings): Promise<ModelInfo[]>;

  /** Send a prompt and get a completion response. The core LLM call. */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /** Rough token estimate for this provider's tokenizer (words * multiplier). */
  estimateTokens(text: string): number;

  /** Test connectivity and authentication. Returns an error message or null if OK. */
  testConnection(settings: ProviderSettings): Promise<string | null>;
}

/** Metadata about a model available from a provider. Used in settings dropdowns and cost estimation. */
export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

/** Request sent to an LLM provider. Built by drafter.ts, dispatched by pipeline.ts. */
export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxTokens: number;
  apiKey?: string;
  endpoint?: string;
  /** When true AND the model supports it, enable extended thinking. */
  useThinking?: boolean;
  /** Called with each text chunk during streaming. When set, provider should use streaming API. */
  onToken?: (text: string) => void;
  /**
   * Optional cancellation signal. When aborted, the provider tears down any
   * in-flight streaming request (req.destroy()) and rejects with an
   * `AbortError` (err.name === "AbortError").
   */
  signal?: AbortSignal;
  /**
   * Optional inactivity timeout in milliseconds. If the provider's HTTP call
   * goes this long without progress, the call is aborted and the request
   * rejects with `name === "TimeoutError"` (distinct from AbortError so the
   * pipeline can surface "Request timed out" in review notes / logs).
   */
  timeoutMs?: number;
  /**
   * Optional cap on retries beyond the initial call. `maxRetries: 3` means up
   * to 4 total HTTP attempts (1 initial + 3 retries). Defaults to 3 when
   * undefined. Set to 0 to disable retry entirely.
   */
  maxRetries?: number;
  /**
   * Optional callback invoked before each retry sleep. The pipeline forwards
   * this to a `ProgressEvent("retry", ...)` so the modal can render status.
   * Providers themselves never construct ProgressEvents (Obsidian-free).
   */
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
}

/** Response from an LLM provider. The `text` field contains the revised prose. */
export interface CompletionResponse {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  model: string;
  provider: string;
}

/** Per-provider settings passed to getModels() and testConnection(). Allows arbitrary extra fields via index signature. */
export interface ProviderSettings {
  apiKey?: string;
  endpoint?: string;
  [key: string]: unknown;
}
