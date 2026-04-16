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
 */
export function getRoute(tag: string, config: RouteConfig): ResolvedRoute {
  const tier: ComplexityTier = TAG_COMPLEXITY[tag] ?? "standard";
  return config[tier];
}
