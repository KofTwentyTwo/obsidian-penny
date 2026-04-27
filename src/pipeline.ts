/**
 * PENNY - Core Processing Pipeline (pure logic)
 *
 * Orchestrates the full annotation-processing workflow for a single chapter:
 *   1. Parse annotations from the chapter markdown
 *   2. Filter to only new (unprocessed) actionable annotations
 *   3. For each annotation: assemble context, build prompt, call the LLM
 *   4. Assemble the new chapter version from all revisions
 *   5. Update frontmatter with agent-managed fields
 *   6. Update version state for idempotency
 *   7. Run voice compliance checks
 *   8. Generate review notes and activity log entries
 *
 * Extracted from commands.ts for testability. This module has NO Obsidian
 * dependencies. It takes pre-read content and an injected provider lookup
 * (dependency injection), runs the pipeline, and returns results that
 * commands.ts writes back to the vault.
 *
 * Supports cancellation via the isCancelled callback and emits real-time
 * progress events for the progress modal UI.
 */

import type { AnnotatedSection, AnnotationChange, ReviewFlag, PennySettings } from "./types";
import type { ContextFiles } from "./context";
import type { CompletionRequest, CompletionResponse } from "./providers/service";
import type { RouteConfig, ComplexityTier } from "./providers/router";
import { TAG_COMPLEXITY } from "./providers/router";
import { parseAnnotations } from "./parser";
import { assembleContext } from "./context";
import { buildPrompt, callProvider } from "./drafter";
import { assembleNewVersion } from "./assembler";
import { readVersion, nextVersion, readState, updateState, shouldProcess, serializeState } from "./versioner";
import { parseFrontmatter, serializeFrontmatter, updateAgentFields, countProseWords, detectCharacters } from "./frontmatter";
import { generateReview } from "./reviewer";
import { createLogEntry, formatLogEntry } from "./logger";
import { checkVoiceCompliance } from "./voice-check";
import { getRoute } from "./providers/router";

/**
 * A minimal provider interface for the pipeline. Matches the subset of
 * LLMService that the pipeline actually uses (complete() + optional
 * tokenMultiplier). This keeps the pipeline decoupled from the full
 * provider implementation.
 */
export interface PipelineProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /** Optional token multiplier for this provider (words-to-tokens ratio). */
  tokenMultiplier?: number;
}

/** Progress events emitted during pipeline execution. Consumed by PennyProgressModal. */
export interface ProgressEvent {
  type:
    | "start"
    | "annotation-start"
    | "annotation-done"
    | "annotation-error"
    | "assembling"
    | "complete"
    | "cancelled"
    | "token";
  total?: number;
  current?: number;
  tag?: string;
  line?: number;
  provider?: string;
  model?: string;
  wordCount?: number;
  error?: string;
  message?: string;
  /** Streaming token text (for type: "token"). */
  text?: string;
}

/**
 * Everything the pipeline needs to process a chapter.
 * All file content is pre-read by commands.ts; the pipeline never touches the vault.
 */
export interface PipelineInput {
  /** Full markdown content of the chapter file. */
  content: string;
  /** Raw text from the `.version` file (may be empty for new chapters). */
  versionContent: string;
  /** Raw JSON from the `.state.json` file (may be empty for new chapters). */
  stateContent: string;
  /** Pre-read context files (voice tests, style guide, outlines, etc.). */
  contextFiles: ContextFiles;
  /** Plugin settings (possibly with per-project overrides merged in). */
  settings: PennySettings;
  /** Chapter identifier (e.g. "ch-05"). */
  chapterId: string;
  /** Book identifier (e.g. "book-1"). */
  bookId: string;
  /** Provider lookup: given a provider name, returns an object with a complete() method, or undefined. */
  getProvider: (name: string) => PipelineProvider | undefined;
  /** Optional callback for real-time progress updates (drives the progress modal). */
  onProgress?: (event: ProgressEvent) => void;
  /** Optional cancellation check; return true to abort the pipeline loop. */
  isCancelled?: () => boolean;
  /**
   * Optional AbortSignal. When aborted, the in-flight provider call is torn
   * down immediately (not just between annotations), and the pipeline emits
   * a "cancelled" event and resolves with null.
   */
  signal?: AbortSignal;
  /** Pre-parsed annotations to avoid redundant parseAnnotations call (optimization). */
  preParsedAnnotations?: AnnotatedSection[];
}

export interface PipelineResult {
  /** The assembled new version content (with frontmatter) */
  newContent: string;
  /** The new version number */
  newVersion: number;
  /** Serialized state JSON */
  stateJson: string;
  /** Review note markdown */
  reviewContent: string;
  /** Activity log entry line (JSONL) */
  logLine: string;
  /** Number of annotations processed */
  annotationsProcessed: number;
  /** Number of annotations skipped (passthrough) */
  annotationsSkipped: number;
  /** Tags that were processed */
  tags: string[];
  /** Duration in ms */
  durationMs: number;
  /** Whether there were any errors during individual annotation processing */
  hadErrors: boolean;
}

/**
 * Build the RouteConfig from plugin settings.
 * When useSameModelForAll is true, all tiers use the standard route,
 * giving a uniform model experience regardless of annotation complexity.
 *
 * @param s - Current plugin settings
 * @returns A RouteConfig with light/standard/heavy tier assignments
 */
export function buildRouteConfig(s: PennySettings): RouteConfig {
  if (s.useSameModelForAll) {
    return {
      light: { ...s.routeStandard },
      standard: { ...s.routeStandard },
      heavy: { ...s.routeStandard },
    };
  }
  return {
    light: { ...s.routeLight },
    standard: { ...s.routeStandard },
    heavy: { ...s.routeHeavy },
  };
}

/**
 * Run the core processing pipeline on chapter content.
 *
 * Pure logic except for LLM calls (injected via getProvider).
 * Processes each actionable annotation sequentially, building up
 * revisions that are then assembled into a new chapter version.
 *
 * @param input - All pre-read content, settings, and injected dependencies
 * @returns Pipeline result with new content, state, review, and log data,
 *          or null if there are no new annotations to process
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult | null> {
  const startTime = Date.now();
  const { content, settings, chapterId, bookId } = input;
  const onProgress = input.onProgress;

  // (a) Parse annotations (use pre-parsed if provided to avoid redundant work)
  const allAnnotations = input.preParsedAnnotations ?? parseAnnotations(content);

  // (b) Read version and state
  const currentVersion = readVersion(input.versionContent);
  const state = readState(input.stateContent);

  // (c) Filter to only new actionable annotations
  const toProcess = shouldProcess(allAnnotations, state);

  if (toProcess.length === 0) {
    return null; // nothing to do
  }

  // Build route config
  const routeConfig = buildRouteConfig(settings);

  // Emit start event
  onProgress?.({
    type: "start",
    total: toProcess.length,
    message: `Processing ${toProcess.length} annotation${toProcess.length === 1 ? "" : "s"}...`,
  });

  // Count passthrough annotations
  const passthroughCount = allAnnotations.filter((a) => !a.actionable).length;

  // Word count before processing
  const wordCountBefore = countProseWords(content, settings.proseMarker);

  // (e) Process each annotation via the LLM provider
  const revisions: Array<{ annotation: AnnotatedSection; revisedText: string }> = [];
  const changes: AnnotationChange[] = [];
  const flags: ReviewFlag[] = [];
  const processedTags: string[] = [];
  let hadErrors = false;
  let completedCount = 0;

  // Unified cancellation check: either the legacy isCancelled callback OR
  // an AbortSignal being aborted counts as "cancel requested".
  const isCancelled = (): boolean =>
    (input.isCancelled?.() ?? false) || (input.signal?.aborted ?? false);

  for (let i = 0; i < toProcess.length; i++) {
    // Check for cancellation before each annotation
    if (isCancelled()) {
      onProgress?.({
        type: "cancelled",
        current: completedCount,
        total: toProcess.length,
        message: `Cancelled. Processed ${completedCount} of ${toProcess.length} annotation${toProcess.length === 1 ? "" : "s"}.`,
      });
      return null;
    }

    const annotation = toProcess[i];
    const route = getRoute(annotation.tag, routeConfig);
    const provider = input.getProvider(route.provider);

    // Emit annotation-start
    onProgress?.({
      type: "annotation-start",
      current: i + 1,
      total: toProcess.length,
      tag: annotation.tag,
      line: annotation.lineStart,
      provider: route.provider,
      model: route.model,
      message: `[${i + 1}/${toProcess.length}] ${annotation.tag} line ${annotation.lineStart} ... calling ${route.provider} ${route.model} ...`,
    });

    if (!provider) {
      // Insert error marker and continue
      const errorText = `%% AGENT-ERROR: Provider "${route.provider}" not available for ${annotation.tag} %%\n${annotation.originalText}`;
      revisions.push({ annotation, revisedText: errorText });
      flags.push({
        type: "error",
        line: annotation.lineStart,
        description: `Provider "${route.provider}" not found for [${annotation.tag}]`,
      });
      hadErrors = true;
      onProgress?.({
        type: "annotation-error",
        current: i + 1,
        total: toProcess.length,
        tag: annotation.tag,
        line: annotation.lineStart,
        error: `Provider "${route.provider}" not available`,
        message: `[${i + 1}/${toProcess.length}] ${annotation.tag} line ${annotation.lineStart} ... ERROR: Provider "${route.provider}" not available`,
      });
      continue;
    }

    try {
      // Determine token multiplier from the provider (defaults to 1.33 for Anthropic)
      const tokenMultiplier = provider.tokenMultiplier ?? 1.33;

      // Build context
      const assembledCtx = assembleContext(
        input.contextFiles,
        annotation,
        settings,
        tokenMultiplier,
      );

      // Build prompt
      const { system, user } = buildPrompt(
        assembledCtx,
        annotation,
        settings.systemPromptTemplate,
      );

      // Only enable thinking for "heavy" tier tags on Anthropic provider
      const tier: ComplexityTier = TAG_COMPLEXITY[annotation.tag] ?? "standard";
      const useThinking = tier === "heavy" && route.provider === "anthropic";

      // Call provider (with streaming token callback when progress is available)
      const response = await callProvider(provider, {
        systemPrompt: system,
        userPrompt: user,
        model: route.model,
        maxTokens: settings.maxTokens ?? 16000,
        apiKey: route.provider === "anthropic" ? settings.anthropicApiKey
              : route.provider === "ollama" ? (settings.ollamaApiKey || undefined)
              : route.provider === "google" ? settings.googleApiKey
              : route.provider === "openai" ? settings.openaiApiKey
              : undefined,
        endpoint: route.provider === "ollama" ? settings.ollamaEndpoint : undefined,
        useThinking,
        signal: input.signal,
        timeoutMs: settings.requestTimeoutMs,
        onToken: onProgress ? (text: string) => {
          onProgress({ type: "token", text, current: i + 1 });
        } : undefined,
      });

      revisions.push({ annotation, revisedText: response.text });
      processedTags.push(annotation.tag);

      // Track which context files were used
      const contextUsed: string[] = ["chapter"];
      if (assembledCtx.voiceTests) contextUsed.push("voiceTests");
      if (assembledCtx.styleGuide) contextUsed.push("styleGuide");
      if (assembledCtx.outline) contextUsed.push("outline");
      if (assembledCtx.characters) contextUsed.push("characters");
      if (assembledCtx.wiki) contextUsed.push("wiki");

      const origWords = annotation.originalText.trim().split(/\s+/).filter((w) => w.length > 0).length;
      const revisedWords = response.text.trim().split(/\s+/).filter((w) => w.length > 0).length;

      changes.push({
        tag: annotation.tag,
        instruction: annotation.instruction,
        lineStart: annotation.lineStart,
        originalWordCount: origWords,
        revisedWordCount: revisedWords,
        contextFilesUsed: contextUsed,
        provider: route.provider,
        model: route.model,
      });

      completedCount++;
      onProgress?.({
        type: "annotation-done",
        current: i + 1,
        total: toProcess.length,
        tag: annotation.tag,
        line: annotation.lineStart,
        wordCount: revisedWords,
        message: `[${i + 1}/${toProcess.length}] ${annotation.tag} line ${annotation.lineStart} ... done (${revisedWords} words)`,
      });
    } catch (err) {
      // AbortError means the user cancelled -- don't treat it as an API failure,
      // don't insert an error marker, don't create a version. Just stop.
      if (err instanceof Error && err.name === "AbortError") {
        onProgress?.({
          type: "cancelled",
          current: completedCount,
          total: toProcess.length,
          message: `Cancelled during [${i + 1}/${toProcess.length}] ${annotation.tag}. Processed ${completedCount}.`,
        });
        return null;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const errorText = `%% AGENT-ERROR(${annotation.tag}): ${errMsg} %%\n${annotation.originalText}`;
      revisions.push({ annotation, revisedText: errorText });
      flags.push({
        type: "error",
        line: annotation.lineStart,
        description: `API error for [${annotation.tag}]: ${errMsg}`,
      });
      hadErrors = true;
      onProgress?.({
        type: "annotation-error",
        current: i + 1,
        total: toProcess.length,
        tag: annotation.tag,
        line: annotation.lineStart,
        error: errMsg,
        message: `[${i + 1}/${toProcess.length}] ${annotation.tag} line ${annotation.lineStart} ... ERROR: ${errMsg}`,
      });
    }
  }

  // Check if cancelled before proceeding to assembly
  if (isCancelled()) {
    onProgress?.({
      type: "cancelled",
      current: completedCount,
      total: toProcess.length,
      message: `Cancelled. Processed ${completedCount} of ${toProcess.length}.`,
    });
    return null;
  }

  // Don't create a version if no annotations were successfully processed
  if (completedCount === 0) {
    onProgress?.({
      type: "complete",
      message: hadErrors
        ? `All ${toProcess.length} annotation(s) failed. No version created.`
        : `No annotations processed. No version created.`,
    });
    return null;
  }

  // (f) Assemble new version
  const newVer = nextVersion(currentVersion);

  onProgress?.({
    type: "assembling",
    message: `Assembling v${newVer}...`,
  });

  const assemblyResult = assembleNewVersion(content, revisions, newVer);
  const assembled = assemblyResult.content;

  // Surface any skipped overlaps as review flags
  for (const skip of assemblyResult.skippedOverlaps) {
    flags.push({
      type: "plot" as const,
      line: skip.line,
      description: `Overlapping annotation [${skip.tag}] at line ${skip.line} was skipped. Only the larger-scope annotation was processed.`,
    });
  }

  // (g) Update frontmatter
  const { frontmatter: assembledFm, body: assembledBody, keyOrder } = parseFrontmatter(assembled);
  const wordCountAfter = countProseWords(assembled, settings.proseMarker);
  const charsInScene = detectCharacters(assembled, typeof assembledFm.focus === "string" ? assembledFm.focus : "");

  // Compute pending annotations remaining in the new version
  const newAnnotations = parseAnnotations(assembled);
  const pendingCount = newAnnotations.filter((a) => a.actionable).length;

  const updatedFm = updateAgentFields(assembledFm, {
    wordcount: wordCountAfter,
    status: pendingCount > 0 ? "in-progress" : "revised",
    agent_version: newVer,
    agent_last_revised: new Date().toISOString(),
    agent_annotations_pending: pendingCount,
    characters_in_scene: charsInScene,
  });

  const newContent = serializeFrontmatter(updatedFm, assembledBody, keyOrder);

  // (h) Update state
  const newState = updateState(state, newVer, toProcess);
  const stateJson = serializeState(newState);

  // (i) Voice compliance check on the new prose
  const voiceCompliance = checkVoiceCompliance(assembledBody);

  // (j) Generate review note
  const durationMs = Date.now() - startTime;
  const reviewData = {
    timestamp: new Date().toISOString(),
    book: bookId,
    chapter: chapterId,
    version: newVer,
    annotationsProcessed: changes.length,
    annotationsSkipped: passthroughCount,
    changes,
    flags,
    voiceCompliance,
    wordCountBefore,
    wordCountAfter,
  };
  const reviewContent = generateReview(reviewData);

  // (k) Generate activity log entry
  const logEntry = createLogEntry({
    book: bookId,
    chapter: chapterId,
    versionFrom: currentVersion,
    versionTo: newVer,
    annotationsProcessed: changes.length,
    annotationsSkipped: passthroughCount,
    wordCountBefore,
    wordCountAfter,
    tags: processedTags,
    durationMs,
    provider: processedTags.length > 0 ? changes[0]?.provider ?? "unknown" : "none",
    model: processedTags.length > 0 ? changes[0]?.model ?? "unknown" : "none",
    voiceCompliance,
  });
  const logLine = formatLogEntry(logEntry);

  onProgress?.({
    type: "complete",
    message: `Done. ${changes.length} annotation${changes.length === 1 ? "" : "s"} processed, v${newVer} created.`,
  });

  return {
    newContent,
    newVersion: newVer,
    stateJson,
    reviewContent,
    logLine,
    annotationsProcessed: changes.length,
    annotationsSkipped: passthroughCount,
    tags: processedTags,
    durationMs,
    hadErrors,
  };
}
