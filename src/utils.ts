/**
 * PENNY - Shared Utilities
 *
 * Common utility functions used across multiple modules.
 */

/**
 * Simple glob matcher supporting * and ? wildcards.
 * Uses iterative comparison to avoid ReDoS.
 *
 * @param pattern - Glob pattern (supports `*` for any sequence, `?` for single char)
 * @param text - The string to match against the pattern
 * @returns True if the text matches the pattern
 */
export function globMatch(pattern: string, text: string): boolean {
  let pi = 0;
  let ti = 0;
  let starPi = -1;
  let matchTi = -1;

  while (ti < text.length) {
    if (
      pi < pattern.length &&
      (pattern[pi] === text[ti] || pattern[pi] === "?")
    ) {
      pi++;
      ti++;
    } else if (pi < pattern.length && pattern[pi] === "*") {
      starPi = pi;
      matchTi = ti;
      pi++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      matchTi++;
      ti = matchTi;
    } else {
      return false;
    }
  }

  while (pi < pattern.length && pattern[pi] === "*") {
    pi++;
  }

  return pi === pattern.length;
}
