/**
 * PENNY - Version Management
 *
 * Manages the `.version` manifest and `.state.json` files that live
 * inside each chapter folder. These two files provide:
 *
 * - `.version`:     A plain integer -- the current version number.
 * - `.state.json`:  A VersionState object tracking which annotations
 *                   have been processed (by hash) to ensure idempotency.
 *
 * Called by pipeline.ts to read current state, filter already-processed
 * annotations, and write updated state after a processing pass.
 *
 * Pure functions -- no Obsidian API dependencies.
 */

import type { AnnotatedSection, VersionState, ProcessedAnnotation } from "./types";

/**
 * Read the current version number from .version file content.
 *
 * @param versionContent - Raw text content of the `.version` file
 * @returns The parsed version number, or 0 if empty/unparseable/negative
 */
export function readVersion(versionContent: string): number {
  const trimmed = versionContent.trim();
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

/**
 * Compute the next version number (simple increment).
 *
 * @param current - The current version number
 * @returns current + 1
 */
export function nextVersion(current: number): number {
  return current + 1;
}

/**
 * Parse `.state.json` content into a VersionState.
 * Defensively validates every field to handle corrupted or hand-edited files.
 *
 * @param stateContent - Raw JSON string from the `.state.json` file
 * @returns A valid VersionState (defaults to version 0 / empty history if parsing fails)
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
        ? parsed.processedAnnotations
          .filter((pa: unknown) => typeof pa === "object" && pa !== null)
          .map((pa: Record<string, unknown>) => ({
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
 *
 * Also filters out passthrough tags (NOTE, RESEARCH) which are never
 * sent to the LLM regardless of processing history.
 *
 * @param annotations - All parsed annotations from the chapter
 * @param state       - Current version state with processing history
 * @returns Only the actionable annotations whose hashes are not in state
 */
export function shouldProcess(
  annotations: AnnotatedSection[],
  state: VersionState,
): AnnotatedSection[] {
  const processedHashes = new Set(state.processedAnnotations.map((pa) => pa.hash));
  return annotations.filter((a) => a.actionable && !processedHashes.has(a.hash));
}

/**
 * Serialize a VersionState to pretty-printed JSON for writing to `.state.json`.
 *
 * @param state - The version state to serialize
 * @returns JSON string with 2-space indentation
 */
export function serializeState(state: VersionState): string {
  return JSON.stringify(state, null, 2);
}
