/**
 * PENNY - Version Assembly
 *
 * Builds a new version of a chapter from processed revisions.
 * Works bottom-up to preserve line numbers during replacement.
 * Pure function -- no Obsidian API dependencies.
 */

import type { AnnotatedSection } from "./types";
import { PASSTHROUGH_TAGS } from "./types";

/** Non-global regex pattern for matching annotations. A new RegExp is created per use. */
const ANNOTATION_PATTERN = /%%\s*([A-Z]+)\s*:\s*(.*?)\s*%%/;

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function isPassthrough(tag: string): boolean {
  return (PASSTHROUGH_TAGS as readonly string[]).includes(tag);
}

/**
 * Assemble a new version of the chapter by applying revisions.
 *
 * @param originalContent  The full text of the current chapter version.
 * @param revisions        Array of { annotation, revisedText } pairs.  Each
 *                         annotation's lineStart/lineEnd mark the range to
 *                         replace, and `revisedText` is the AI-produced
 *                         replacement prose.
 * @param version          The new version number (used in REVISED markers).
 * @returns                The assembled new-version content string.
 */
export function assembleNewVersion(
  originalContent: string,
  revisions: Array<{ annotation: AnnotatedSection; revisedText: string }>,
  version: number = 1,
): string {
  const lines = originalContent.split("\n");

  // Sort revisions bottom-up (highest lineStart first) so that replacements
  // don't shift line numbers for earlier entries.
  const sorted = [...revisions].sort((a, b) => b.annotation.lineStart - a.annotation.lineStart);

  for (const { annotation, revisedText } of sorted) {
    // Skip passthrough tags -- they should never appear in revisions, but
    // guard just in case.
    if (isPassthrough(annotation.tag)) continue;

    const origSlice = lines.slice(annotation.lineStart, annotation.lineEnd + 1).join("\n");
    const origWords = wordCount(origSlice);
    const newWords = wordCount(revisedText);

    // Build the REVISED marker.
    const summary = annotation.instruction.length > 60
      ? annotation.instruction.slice(0, 57) + "..."
      : annotation.instruction;
    const marker = `%% REVISED(v${version}): [${annotation.tag}] "${summary}" -- ${origWords} words -> ${newWords} words %%`;

    // Build replacement lines: revised text + marker.
    const replacementLines = [...revisedText.split("\n"), marker];

    // Splice into the line array.
    lines.splice(
      annotation.lineStart,
      annotation.lineEnd - annotation.lineStart + 1,
      ...replacementLines,
    );
  }

  // Remove processed (actionable) annotations from the result.
  // Passthrough annotations (NOTE, RESEARCH) are kept.
  const cleaned = lines.filter((line) => {
    // Check if this line is purely an annotation (no other content).
    const withoutAnnotations = line.replace(new RegExp(ANNOTATION_PATTERN.source, "g"), "").trim();
    if (withoutAnnotations.length > 0) {
      // Line has content beyond annotations.  Strip only actionable annotations.
      return true;
    }
    // Line is purely annotation(s).  Keep it only if ALL annotations on it
    // are passthrough.
    let hasActionable = false;
    let hasAny = false;
    for (const m of line.matchAll(new RegExp(ANNOTATION_PATTERN.source, "g"))) {
      hasAny = true;
      if (!isPassthrough(m[1])) {
        hasActionable = true;
      }
    }
    // If no annotations matched at all, keep the line (it's just whitespace).
    if (!hasAny) return true;
    // If all annotations are passthrough, keep.  Otherwise remove the line.
    return !hasActionable;
  });

  // For lines that contain inline actionable annotations mixed with text,
  // strip the annotation portion but keep the text.
  const final = cleaned.map((line) => {
    if (!ANNOTATION_PATTERN.test(line)) return line;

    // Check if any annotation on this line is actionable.
    let hasActionable = false;
    for (const m of line.matchAll(new RegExp(ANNOTATION_PATTERN.source, "g"))) {
      if (!isPassthrough(m[1])) hasActionable = true;
    }
    if (!hasActionable) return line;

    // Strip only actionable annotations, keep passthrough.
    return line.replace(new RegExp(ANNOTATION_PATTERN.source, "g"), (full, tag) => {
      if (isPassthrough(tag)) return full;
      return "";
    }).trimEnd();
  });

  return final.join("\n");
}
