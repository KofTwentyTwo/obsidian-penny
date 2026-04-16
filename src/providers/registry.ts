/**
 * PENNY - Provider Registry
 *
 * A simple registry that stores LLMService instances by name.
 * Providers register at plugin load. The router and drafter look up
 * providers by name from this registry.
 */

import type { LLMService } from "./service";

export class ProviderRegistry {
  private providers: Map<string, LLMService> = new Map();

  /** Register a provider. Overwrites any existing provider with the same name. */
  register(provider: LLMService): void {
    this.providers.set(provider.name, provider);
  }

  /** Get a provider by name. Returns undefined if not registered. */
  get(name: string): LLMService | undefined {
    return this.providers.get(name);
  }

  /** Get all registered providers. */
  getAll(): LLMService[] {
    return Array.from(this.providers.values());
  }

  /** Get names of all registered providers. */
  getNames(): string[] {
    return Array.from(this.providers.keys());
  }
}

/** Singleton registry instance for the plugin. */
export const registry = new ProviderRegistry();
