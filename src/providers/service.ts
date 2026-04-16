/**
 * PENNY - LLM Service Interface
 *
 * Every LLM provider implements this interface. Adding a new provider means
 * implementing LLMService and registering it with the ProviderRegistry.
 */

/** HTTP request parameters -- mirrors Obsidian's RequestUrlParam shape. */
export interface HttpRequestParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  contentType?: string;
}

/** HTTP response shape -- mirrors Obsidian's RequestUrlResponse. */
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
}

/** Injectable HTTP function type (Obsidian's requestUrl or a test mock). */
export type HttpFn = (params: HttpRequestParam) => Promise<HttpResponse>;

/** Every LLM provider implements this interface. */
export interface LLMService {
  readonly name: string;
  readonly requiresApiKey: boolean;

  /** Available models for this provider (static list or fetched from endpoint). */
  getModels(settings?: ProviderSettings): Promise<ModelInfo[]>;

  /** Send a prompt and get a response. */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /** Rough token estimate for this provider's tokenizer. */
  estimateTokens(text: string): number;

  /** Test connectivity. Returns error message or null if OK. */
  testConnection(settings: ProviderSettings): Promise<string | null>;
}

/** Metadata about a model available from a provider. */
export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

/** Request sent to an LLM provider. */
export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxTokens: number;
  apiKey?: string;
  endpoint?: string;
  /** When true AND the model supports it, enable extended thinking. */
  useThinking?: boolean;
}

/** Response from an LLM provider. */
export interface CompletionResponse {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  model: string;
  provider: string;
}

/** Per-provider settings (API keys, endpoints, etc.). */
export interface ProviderSettings {
  apiKey?: string;
  endpoint?: string;
  [key: string]: unknown;
}
