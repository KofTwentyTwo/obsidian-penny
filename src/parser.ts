/**
 * PENNY - Annotation Parser
 *
 * Extracts editorial annotations from markdown chapter files.
 * Called by pipeline.ts (and commands.ts for dry-run / status).
 * Returns an array of AnnotatedSection objects sorted by line position.
 *
 * Supports two annotation forms:
 * - Single-line: `%% TAG: instruction %%`
 * - Multi-line:  `%% TAG: instruction text\ncontinued...\n%%`
 *
 * Scope resolution determines WHAT each annotation targets:
 * - Inline:    annotation shares a line with prose -> targets that line
 * - Paragraph: annotation on its own line -> targets the paragraph above
 * - Section:   annotation below a heading -> targets everything to the next heading
 *
 * Pure function -- no Obsidian API dependencies.
 */

import {
  type AnnotatedSection,
  type AnnotationTag,
  ACTIONABLE_TAGS,
  ALL_TAGS,
} from "./types";

/** Single-line annotation: `%% TAG: instruction %%` on one line. Captures tag and instruction. */
const ANNOTATION_PATTERN = /%%\s*([A-Z]+)\s*:\s*(.*?)\s*%%/;

/**
 * Multi-line annotation opening: `%% TAG: instruction text...` (no closing %% on same line).
 * The instruction may continue across subsequent lines until a closing %% is found.
 */
const MULTILINE_OPEN = /%%\s*([A-Z]+)\s*:\s*(.*)/;
/** Multi-line annotation closing: captures any text before the closing %%. */
const MULTILINE_CLOSE = /(.*)%%/;

/**
 * Strip all annotation markers from a string (single-line and multi-line).
 * Used when building originalText so the passage content is clean prose.
 *
 * @param text - Raw line or block that may contain annotation markers
 * @returns The text with all `%% ... %%` patterns removed
 */
function stripAnnotations(text: string): string {
  // Strip single-line annotations first
  let result = text.replace(new RegExp(ANNOTATION_PATTERN.source, "g"), "");
  // Strip multi-line annotation fragments (lines that are part of %% ... %% blocks)
  result = result.replace(/%%[\s\S]*?%%/g, "");
  return result;
}

/**
 * Generate a deterministic hash from the annotation's identity fields.
 *
 * Used for idempotency: the versioner tracks processed hashes so the same
 * annotation is never sent to the LLM twice. Uses a cyrb53 variant rather
 * than crypto APIs because it must be a pure function that works in both
 * Node (tests) and Obsidian's Electron renderer without dependencies.
 *
 * @param tag         - The annotation tag (e.g. "REWRITE")
 * @param instruction - The author's instruction text
 * @param originalText - The prose passage the annotation targets
 * @returns A 12-character hex string (least-significant digits for max entropy)
 */
function hashAnnotation(tag: string, instruction: string, originalText: string): string {
  const input = `${tag}|${instruction}|${originalText}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  // Use slice(-12) to keep the least-significant (most entropic) hex digits
  return n.toString(16).padStart(12, "0").slice(-12);
}

/** Type guard: true if the tag string is a recognized annotation tag. */
function isValidTag(tag: string): tag is AnnotationTag {
  return (ALL_TAGS as readonly string[]).includes(tag);
}

/** True if the tag triggers LLM processing (not a passthrough tag). */
function isActionableTag(tag: string): boolean {
  return (ACTIONABLE_TAGS as readonly string[]).includes(tag);
}

/** True when a line is a markdown heading */
function isHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

/** Return the heading level (1-6) or 0 if not a heading. */
function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

/** True when the line is blank / whitespace-only. */
function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Determine the scope, lineStart, and lineEnd for an annotation found at
 * `annotationLineIndex` in the array of `lines`.
 *
 * Resolution logic:
 * 1. If the annotation shares its line with non-annotation text -> "inline"
 * 2. If the nearest non-blank line above is a heading -> "section" (to next same-level heading)
 * 3. Otherwise -> "paragraph" (the paragraph block above the annotation)
 *
 * @param lines               - All lines of the chapter file
 * @param annotationLineIndex - Zero-based index of the line containing the annotation
 * @returns Scope type plus the inclusive [lineStart, lineEnd] range
 */
function resolveScope(
  lines: string[],
  annotationLineIndex: number,
): { scope: "inline" | "paragraph" | "section"; lineStart: number; lineEnd: number } {
  const annoLine = lines[annotationLineIndex];

  // --- Check: is the annotation inline (shares a line with other text)? ---
  const stripped = stripAnnotations(annoLine).trim();
  if (stripped.length > 0) {
    // Inline: the annotation sits within a paragraph line.
    // Scope = that single line.
    return { scope: "inline", lineStart: annotationLineIndex, lineEnd: annotationLineIndex };
  }

  // The annotation is on its own line.  Look at what comes above.

  // Walk backwards to find the first non-blank line above the annotation.
  let above = annotationLineIndex - 1;
  while (above >= 0 && isBlank(lines[above])) {
    above--;
  }

  // --- Check: is the line above a heading? ---
  if (above >= 0 && isHeading(lines[above])) {
    // Section scope: everything from the heading to the next heading of equal
    // or higher level (or EOF).
    const level = headingLevel(lines[above]);
    let end = annotationLineIndex + 1;
    while (end < lines.length) {
      const hl = headingLevel(lines[end]);
      if (hl > 0 && hl <= level) break;
      end++;
    }
    // lineEnd is the last line before the next heading (or last line of file).
    return { scope: "section", lineStart: above, lineEnd: end - 1 };
  }

  // --- Otherwise: paragraph scope (paragraph immediately above). ---
  // Walk upward from `above` to find the start of that paragraph (first blank
  // line or start of file).
  if (above < 0) {
    // Nothing above -- degenerate; point at annotation itself.
    return { scope: "paragraph", lineStart: annotationLineIndex, lineEnd: annotationLineIndex };
  }
  let paraStart = above;
  while (paraStart > 0 && !isBlank(lines[paraStart - 1]) && !isHeading(lines[paraStart - 1]) && !lines[paraStart - 1].trim().startsWith("%% REVISED(")) {
    paraStart--;
  }
  return { scope: "paragraph", lineStart: paraStart, lineEnd: annotationLineIndex };
}

/**
 * Parse all annotations from a markdown chapter string.
 *
 * Scans every line for single-line and multi-line annotation patterns.
 * For each valid annotation found, resolves its scope (inline, paragraph,
 * or section) and extracts the targeted prose passage.
 *
 * @param content - The full markdown content of a chapter file
 * @returns Array of AnnotatedSection objects sorted by lineStart ascending.
 *          Malformed annotations (unrecognized tags, empty instruction) are
 *          silently skipped.
 */
export function parseAnnotations(content: string): AnnotatedSection[] {
  const lines = content.split("\n");
  const results: AnnotatedSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try single-line annotations first
    const lineRegex = new RegExp(ANNOTATION_PATTERN.source, "g");
    let foundSingleLine = false;

    for (const match of line.matchAll(lineRegex)) {
      foundSingleLine = true;
      const tag = match[1];
      const instruction = match[2].trim();

      // Skip malformed: unrecognised tag or empty instruction.
      if (!isValidTag(tag) || instruction.length === 0) {
        continue;
      }

      const { scope, lineStart, lineEnd } = resolveScope(lines, i);

      // Build the original text (the passage the annotation applies to).
      // For inline scope the original text is the line content minus annotations.
      // For paragraph / section the original text is the range [lineStart..lineEnd]
      // excluding lines that are purely annotations.
      let originalText: string;
      if (scope === "inline") {
        originalText = stripAnnotations(line).trim();
      } else {
        const passageLines: string[] = [];
        for (let j = lineStart; j <= lineEnd; j++) {
          const strippedLine = stripAnnotations(lines[j]).trim();
          // Keep heading lines, non-blank content lines.
          if (strippedLine.length > 0 || isBlank(lines[j])) {
            passageLines.push(stripAnnotations(lines[j]).trimEnd());
          }
        }
        originalText = passageLines.join("\n").trim();
      }

      const actionable = isActionableTag(tag);
      const hash = hashAnnotation(tag, instruction, originalText);

      results.push({
        tag: tag as AnnotationTag,
        instruction,
        originalText,
        lineStart,
        lineEnd,
        scope,
        actionable,
        hash,
      });
    }

    // If no single-line match, check for multi-line annotation opening
    if (!foundSingleLine) {
      const openMatch = line.match(MULTILINE_OPEN);
      if (openMatch && !line.includes("%%", line.indexOf("%%") + 2)) {
        // Found opening %% TAG: ... without closing %% on this line
        const tag = openMatch[1];
        const instructionParts = [openMatch[2].trim()];
        let closeLine = i;

        // Scan forward for closing %%
        for (let j = i + 1; j < lines.length && j < i + 20; j++) {
          const cl = lines[j];
          const closeMatch = cl.match(MULTILINE_CLOSE);
          if (closeMatch) {
            instructionParts.push(closeMatch[1].trim());
            closeLine = j;
            break;
          } else {
            instructionParts.push(cl.trim());
          }
        }

        const instruction = instructionParts.join(" ").trim();
        if (isValidTag(tag) && instruction.length > 0) {
          // Use the line AFTER the closing %% as the annotation target
          const annotationLineIndex = closeLine;
          const { scope, lineStart, lineEnd } = resolveScope(lines, annotationLineIndex);

          let originalText: string;
          if (scope === "inline") {
            originalText = stripAnnotations(lines[annotationLineIndex]).trim();
          } else {
            const passageLines: string[] = [];
            for (let j = lineStart; j <= lineEnd; j++) {
              const strippedLine = stripAnnotations(lines[j]).trim();
              if (strippedLine.length > 0 || isBlank(lines[j])) {
                passageLines.push(stripAnnotations(lines[j]).trimEnd());
              }
            }
            originalText = passageLines.join("\n").trim();
          }

          const actionable = isActionableTag(tag);
          const hash = hashAnnotation(tag, instruction, originalText);

          results.push({
            tag: tag as AnnotationTag,
            instruction,
            originalText,
            lineStart,
            lineEnd,
            scope,
            actionable,
            hash,
          });

          // Skip past the multi-line annotation
          i = closeLine;
        }
      }
    }
  }

  // Sort by lineStart ascending (stable).
  results.sort((a, b) => a.lineStart - b.lineStart);
  return results;
}
