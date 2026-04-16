/**
 * PENNY - Version Management
 *
 * Manages .version manifest and .state.json files.
 * Pure functions -- no Obsidian API dependencies.
 */

import type { AnnotatedSection, VersionState, ProcessedAnnotation } from "./types";

/**
 * Read the current version number from .version file content.
 * Returns 0 if the content is empty or unparseable.
 */
export function readVersion(versionContent: string): number {
  const trimmed = versionContent.trim();
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

/**
 * Compute the next version number.
 */
export function nextVersion(current: number): number {
  return current + 1;
}

/**
 * Parse .state.json content into a VersionState.
 * Returns a default state if the content is empty or invalid JSON.
 */
export function readState(stateContent: string): VersionState {
  const defaultState: VersionState = {
    version: 0,
    lastProcessed: null,
    processedAnnotations: [],
  };

  const trimmed = stateContent.trim();
  if (trimmed.length === 0) return defaultState;

  try {
    const parsed = JSON.parse(trimmed);
    return {
      version: typeof parsed.version === "number" ? parsed.version : 0,
      lastProcessed: typeof parsed.lastProcessed === "string" ? parsed.lastProcessed : null,
      processedAnnotations: Array.isArray(parsed.processedAnnotations)
        ? parsed.processedAnnotations.map((pa: Record<string, unknown>) => ({
            hash: String(pa.hash ?? ""),
            tag: String(pa.tag ?? ""),
            line: typeof pa.line === "number" ? pa.line : 0,
            processedInVersion: typeof pa.processedInVersion === "number" ? pa.processedInVersion : 0,
          }))
        : [],
    };
  } catch {
    return defaultState;
  }
}

/**
 * Update state after processing a batch of annotations.
 *
 * @param state                 Current state.
 * @param newVersion            The version number just created.
 * @param processedAnnotations  Annotations that were processed in this pass.
 * @returns                     Updated state (new object, does not mutate input).
 */
export function updateState(
  state: VersionState,
  newVersion: number,
  processedAnnotations: AnnotatedSection[],
): VersionState {
  const now = new Date().toISOString();

  const newEntries: ProcessedAnnotation[] = processedAnnotations.map((a) => ({
    hash: a.hash,
    tag: a.tag,
    line: a.lineStart,
    processedInVersion: newVersion,
  }));

  // Merge with existing, deduplicating by hash.
  const existingByHash = new Map<string, ProcessedAnnotation>();
  for (const entry of state.processedAnnotations) {
    existingByHash.set(entry.hash, entry);
  }
  for (const entry of newEntries) {
    existingByHash.set(entry.hash, entry);
  }

  return {
    version: newVersion,
    lastProcessed: now,
    processedAnnotations: Array.from(existingByHash.values()),
  };
}

/**
 * Filter annotations to only those not yet processed (by hash).
 * This provides idempotency: running PENNY twice on the same chapter
 * with the same annotations will not re-process them.
 */
export function shouldProcess(
  annotations: AnnotatedSection[],
  state: VersionState,
): AnnotatedSection[] {
  const processedHashes = new Set(state.processedAnnotations.map((pa) => pa.hash));
  return annotations.filter((a) => a.actionable && !processedHashes.has(a.hash));
}

/**
 * Serialize a VersionState to JSON for writing to .state.json.
 */
export function serializeState(state: VersionState): string {
  return JSON.stringify(state, null, 2);
}
