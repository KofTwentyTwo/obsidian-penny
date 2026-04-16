/**
 * PENNY - Model Router
 *
 * Maps annotation tags to complexity tiers, then resolves the tier to a
 * specific provider + model via a user-configured RouteConfig.
 *
 * Light tasks (CUT, PACING) can use cheaper/faster models.
 * Heavy tasks (REWRITE, DIALOG, CHARACTER) get the strongest model.
 * Standard is the middle ground.
 *
 * Unknown tags fall back to "standard".
 */

/** Complexity tiers that map to model slots. */
export type ComplexityTier = "light" | "standard" | "heavy";

/** Maps annotation tags to their complexity tier. */
export const TAG_COMPLEXITY: Record<string, ComplexityTier> = {
  CUT: "light",
  PACING: "light",
  TONE: "standard",
  EXPAND: "standard",
  PLOT: "standard",
  REWRITE: "heavy",
  DIALOG: "heavy",
  CHARACTER: "heavy",
};

/** User-configured model assignments per complexity tier. */
export interface RouteConfig {
  light: { provider: string; model: string };
  standard: { provider: string; model: string };
  heavy: { provider: string; model: string };
}

/** A resolved route: which provider and model to use. */
export interface ResolvedRoute {
  provider: string;
  model: string;
}

/**
 * Resolve a tag to a provider + model.
 *
 * 1. Look up the tag in TAG_COMPLEXITY to get a tier.
 * 2. If not found, fall back to "standard".
 * 3. Return the provider+model from the config for that tier.
 * 4. If the model is "auto-latest", resolve it to the recommended model for that tier.
 */
export function getRoute(tag: string, config: RouteConfig): ResolvedRoute {
  const tier: ComplexityTier = TAG_COMPLEXITY[tag] ?? "standard";
  const route = config[tier];
  return {
    provider: route.provider,
    model: resolveModel(route.model, tier),
  };
}

/**
 * Map the special "auto-latest" model identifier to the recommended
 * concrete model for the given complexity tier.
 *
 * When the user selects "Auto (recommended)" in settings, the model
 * field is stored as "auto-latest". At runtime this resolves to the
 * best Anthropic model for the tier.
 */
export function resolveModel(model: string, tier: string): string {
  if (model === "auto-latest") {
    switch (tier) {
      case "light": return "claude-haiku-4-5";
      case "standard": return "claude-sonnet-4-6";
      case "heavy": return "claude-opus-4-6";
      default: return "claude-sonnet-4-6";
    }
  }
  return model;
}
