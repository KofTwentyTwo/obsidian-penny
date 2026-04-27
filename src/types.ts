/**
 * PENNY - Prose Engine for Narrative, Notes, and Yarns
 * Shared type definitions and constants.
 *
 * Central type authority for the entire plugin. Every module imports its
 * domain types from here rather than defining them locally, ensuring a
 * single source of truth. Also exports default settings, the default
 * system prompt template, and the canonical list of annotation tags.
 *
 * This file has NO runtime dependencies on Obsidian or any provider,
 * so it can be imported freely in pure-logic modules and tests.
 */

/**
 * Log level for controlling console output verbosity.
 * Ordered from most to least verbose: debug > info > warn > error > off.
 * "off" suppresses all PENNY console output.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "off";

/**
 * Provider + model pair assigned to a single complexity tier.
 * Three of these (light, standard, heavy) make up a full RouteConfig.
 *
 * @see RouteConfig in providers/router.ts
 */
export interface ModelRoute {
  /** Provider name as registered in the ProviderRegistry (e.g. "anthropic", "ollama"). */
  provider: string;
  /** Model identifier understood by the provider, or "auto-latest" for automatic resolution. */
  model: string;
}

/**
 * Plugin settings persisted in Obsidian's data.json.
 *
 * Loaded at startup by main.ts and merged with DEFAULT_SETTINGS.
 * The settings tab (settings.ts) reads and writes these fields.
 * Per-project overrides from PENNY.md can shadow a subset of these
 * (see project-config.ts).
 */
export interface PennySettings {
  /** Whether the first-run setup wizard has been completed or skipped. */
  setupComplete: boolean;

  // Provider keys & endpoints
  /** Anthropic API key (stored locally, never transmitted except to Anthropic). */
  anthropicApiKey: string;
  /** Base URL for the Ollama instance (e.g. "http://localhost:11434"). */
  ollamaEndpoint: string;
  /** Optional API key for authenticated Ollama instances (e.g. remote hosted). */
  ollamaApiKey: string;
  /** Google Gemini API key (stored locally, never transmitted except to Google). */
  googleApiKey: string;
  /** OpenAI API key (stored locally, never transmitted except to OpenAI). */
  openaiApiKey: string;

  // Model routing
  /** Model route for lightweight tasks (CUT, PACING). */
  routeLight: ModelRoute;
  /** Model route for standard tasks (TONE, EXPAND, PLOT). */
  routeStandard: ModelRoute;
  /** Model route for complex tasks (REWRITE, DIALOG, CHARACTER). */
  routeHeavy: ModelRoute;
  /** Model route for research queries (PENNY: Do research command). */
  routeResearch: ModelRoute;
  /** When true, all tiers use the routeStandard model, ignoring light/heavy. */
  useSameModelForAll: boolean;

  // Context
  /** Max tokens to assemble for context (chapter + reference material). */
  contextBudget: number;
  /** Max tokens the LLM may generate per revision response. */
  maxTokens: number;
  /**
   * Per-call inactivity timeout in milliseconds. Prevents the modal from
   * hanging forever on a stalled connection. Default 300_000 (5 minutes) to
   * accommodate slow Opus calls with long context. Set to 0 to disable.
   */
  requestTimeoutMs: number;

  // Project structure (paths relative to vault root)
  /** Folder containing chapter draft files, organized by book subfolder. */
  draftsFolder: string;
  /** Path to the style guide markdown file. */
  styleGuide: string;
  /** Path to the voice tests / locked examples file. */
  voiceTests: string;
  /** Folder containing character profile markdown files. */
  characterSheetsFolder: string;
  /** Folder containing per-book plot outlines. */
  plotOutlinesFolder: string;
  /** Folder containing wiki/lore entries. */
  wikiFolder: string;
  /** Path to the series bible file. */
  seriesBible: string;
  /** Path to the themes file. */
  themesFile: string;
  /** Folder where PENNY writes review notes after processing. */
  reviewsFolder: string;
  /** Folder where PENNY writes JSONL activity logs. */
  activityLogFolder: string;

  // Voice
  /** Project-specific voice rules injected into the CRITICAL VOICE RULES prompt section. */
  customVoiceRules: string;
  /** Full system prompt template with {placeholder} tokens for context sections. */
  systemPromptTemplate: string;

  // Behavior
  /** Automatically process annotations when a chapter file is saved. */
  autoProcessOnSave: boolean;
  /** Controls console log verbosity. */
  logLevel: LogLevel;
  /** Glob pattern identifying chapter files within book folders (e.g. "ch-*.md"). */
  chapterFilePattern: string;
  /** HTML comment that separates outline/frontmatter from prose for word counting. */
  proseMarker: string;

  // Research
  /** Folder where the research command saves notes. */
  researchFolder: string;

  // Progress & Notifications
  /** Show a progress modal during annotation processing. */
  showProgressModal: boolean;
  /** Show Obsidian Notice popups for status updates (used when modal is minimized). */
  showStatusNotices: boolean;

  // UI
  /** Show PENNY ribbon icon (pen icon in left sidebar). */
  showRibbonIcon: boolean;
  /** Show PENNY items in the editor right-click context menu. */
  showContextMenu: boolean;
  /** Show PENNY status in the bottom status bar. */
  showStatusBar: boolean;

  // Git
  /** Stage and commit changes automatically after PENNY processes annotations. */
  autoCommitAfterProcessing: boolean;
  /** Push to remote automatically after auto-commit (requires autoCommitAfterProcessing). */
  autoPushAfterCommit: boolean;
  /** Template for auto-generated commit messages. Placeholders: {chapter}, {version}, {tags}. */
  commitMessageFormat: string;
}

/**
 * The default system prompt template with {placeholder} tokens.
 *
 * Placeholders are replaced at prompt-build time by drafter.ts:
 * - {voice_rules}  -- customVoiceRules from settings / PENNY.md
 * - {voice_tests}  -- locked voice examples
 * - {style_guide}  -- project style guide
 * - {outline}      -- book plot outline
 * - {characters}   -- character sheets for characters in scene
 * - {wiki}         -- relevant wiki/lore entries
 * - {chapter}      -- full current chapter text
 *
 * Sections whose context is empty are removed entirely (heading + placeholder)
 * to keep the prompt clean.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are PENNY, a fiction co-author. You are revising a chapter based on the author's editorial annotation. Match the project's voice exactly.

{voice_rules}

## Voice Reference
{voice_tests}

## Style Guide
{style_guide}

## Plot Outline
{outline}

## Character References
{characters}

## Wiki/Lore References
{wiki}

## Series Bible
{series_bible}

## Themes
{themes}

---

## Current Chapter (Full Text)
{chapter}

---

Write the revised passage. Rules:
- Output ONLY the replacement text. No commentary, no meta-text, no code fences.
- Match the project's established prose style exactly.
- Maintain continuity with surrounding chapter text.
- If voice tests are provided, match them precisely.
- If a character sheet exists for a character in the scene, match their voice.`;

/**
 * Migrate legacy settings (pre-provider-abstraction) to the new format.
 *
 * If saved data contains old `apiKey` or `model` fields, map them to the
 * new `anthropicApiKey` and route fields so existing users are not broken.
 *
 * @param saved - Raw settings object loaded from Obsidian's data.json
 * @returns A new object with legacy fields mapped to their modern equivalents
 */
export function migrateSettings(
  saved: Record<string, unknown>,
): Record<string, unknown> {
  const migrated = { ...saved };

  // Migrate old apiKey -> anthropicApiKey
  if ("apiKey" in migrated && !("anthropicApiKey" in migrated)) {
    migrated.anthropicApiKey = migrated.apiKey;
  }
  delete migrated.apiKey;

  // Migrate old model -> all three routes (uniform routing)
  if ("model" in migrated && typeof migrated.model === "string") {
    const oldModel = migrated.model as string;
    const route: ModelRoute = { provider: "anthropic", model: oldModel };
    if (!("routeLight" in migrated)) migrated.routeLight = { ...route };
    if (!("routeStandard" in migrated)) migrated.routeStandard = { ...route };
    if (!("routeHeavy" in migrated)) migrated.routeHeavy = { ...route };
    if (!("useSameModelForAll" in migrated)) migrated.useSameModelForAll = true;
  }
  delete migrated.model;

  // Migrate old verboseLogging boolean -> logLevel
  if ("verboseLogging" in migrated && !("logLevel" in migrated)) {
    migrated.logLevel = migrated.verboseLogging ? "debug" : "info";
  }
  delete migrated.verboseLogging;

  return migrated;
}

/** Sensible defaults for every setting. Merged with persisted data at load time. */
export const DEFAULT_SETTINGS: PennySettings = {
  setupComplete: false,

  anthropicApiKey: "",
  ollamaEndpoint: "http://localhost:11434",
  ollamaApiKey: "",
  googleApiKey: "",
  openaiApiKey: "",

  // "auto-latest" resolves at runtime to the best model for each tier.
  // See resolveModel() in providers/router.ts.
  routeLight: { provider: "anthropic", model: "auto-latest" },
  routeStandard: { provider: "anthropic", model: "auto-latest" },
  routeHeavy: { provider: "anthropic", model: "auto-latest" },
  routeResearch: { provider: "anthropic", model: "auto-latest" },
  useSameModelForAll: false,

  contextBudget: 800000,
  maxTokens: 16000,
  requestTimeoutMs: 300000,

  draftsFolder: "04-drafts",
  styleGuide: "",
  voiceTests: "",
  characterSheetsFolder: "",
  plotOutlinesFolder: "",
  wikiFolder: "",
  seriesBible: "",
  themesFile: "",
  reviewsFolder: "07-reviews",
  activityLogFolder: ".penny-log",

  customVoiceRules: "",
  systemPromptTemplate: DEFAULT_SYSTEM_PROMPT,

  autoProcessOnSave: false,
  logLevel: "debug",
  chapterFilePattern: "ch-*.md",
  proseMarker: "<!-- Prose begins below -->",

  researchFolder: "06-reference/research",

  showProgressModal: true,
  showStatusNotices: true,

  showRibbonIcon: true,
  showContextMenu: true,
  showStatusBar: true,

  autoCommitAfterProcessing: false,
  autoPushAfterCommit: false,
  commitMessageFormat: "docs({chapter}): PENNY v{version} - {tags}",
};

/**
 * Tags that trigger LLM processing. Each annotation with one of these tags
 * produces an API call to revise the targeted passage.
 */
export const ACTIONABLE_TAGS = [
  "REWRITE",
  "EXPAND",
  "CUT",
  "TONE",
  "DIALOG",
  "PLOT",
  "PACING",
  "CHARACTER",
] as const;

/**
 * Tags that are preserved in the chapter but never sent to the LLM.
 * Used for author notes and research flags that should survive processing.
 */
export const PASSTHROUGH_TAGS = ["NOTE", "RESEARCH"] as const;

/** Union of all recognized annotation tags (actionable + passthrough). */
export const ALL_TAGS = [...ACTIONABLE_TAGS, ...PASSTHROUGH_TAGS] as const;

/** Type for tags that trigger LLM revision. */
export type ActionableTag = (typeof ACTIONABLE_TAGS)[number];
/** Type for tags preserved without processing. */
export type PassthroughTag = (typeof PASSTHROUGH_TAGS)[number];
/** Union type of every valid annotation tag. */
export type AnnotationTag = (typeof ALL_TAGS)[number];

/**
 * A single parsed annotation extracted from chapter markdown.
 *
 * Created by parser.ts from `%% TAG: instruction %%` patterns.
 * Consumed by the pipeline to drive per-annotation LLM calls and
 * by the assembler to splice revised text back into the chapter.
 */
export interface AnnotatedSection {
  /** The annotation tag (e.g. "REWRITE", "NOTE"). */
  tag: AnnotationTag;
  /** The author's instruction text after the tag. */
  instruction: string;
  /** The prose passage this annotation targets (with annotation markers stripped). */
  originalText: string;
  /** Zero-based line index where the targeted passage begins. */
  lineStart: number;
  /** Zero-based line index where the targeted passage ends (inclusive). */
  lineEnd: number;
  /** How the annotation's target was determined: inline text, surrounding paragraph, heading section, or explicit {{ }} block. */
  scope: "inline" | "paragraph" | "section" | "block";
  /** True if this tag triggers LLM processing; false for passthrough tags. */
  actionable: boolean;
  /** Deterministic hash of (tag, instruction, originalText) for idempotency tracking. */
  hash: string;
}

/**
 * Persisted state for a chapter folder, stored in `.state.json`.
 *
 * Tracks which annotations have been processed to provide idempotency:
 * running PENNY twice with the same annotations will not re-process them.
 */
export interface VersionState {
  /** Current version number for this chapter. */
  version: number;
  /** ISO timestamp of the last processing pass, or null if never processed. */
  lastProcessed: string | null;
  /** History of all annotations that have been processed, keyed by hash. */
  processedAnnotations: ProcessedAnnotation[];
}

/**
 * Record of a single annotation that has been processed.
 * Stored in VersionState.processedAnnotations for idempotency checks.
 */
export interface ProcessedAnnotation {
  /** Deterministic hash identifying the annotation content. */
  hash: string;
  /** The tag that was processed (e.g. "REWRITE"). */
  tag: string;
  /** The line number where the annotation appeared at processing time. */
  line: number;
  /** The version number in which this annotation was processed. */
  processedInVersion: number;
}

/**
 * All context material assembled for a single LLM revision call.
 *
 * Built by context.ts with token-budget awareness: lower-priority
 * material is dropped when the budget is exceeded.
 */
export interface AssembledContext {
  /** Full current chapter text (always included, never truncated). */
  chapter: string;
  /** Voice test examples, possibly filtered to scene-relevant characters. */
  voiceTests: string;
  /** Project style guide content. */
  styleGuide: string;
  /** Book plot outline content. */
  outline: string;
  /** Concatenated character sheets for characters detected in the scene. */
  characters: string;
  /** Concatenated wiki/lore entries. */
  wiki: string;
  /** Series bible content (included only if budget permits). */
  seriesBible: string;
  /** Themes file content (included only if budget permits). */
  themes: string;
  /** Custom voice rules from settings or PENNY.md. */
  voiceRules: string;
  /** Estimated total token count of all assembled context. */
  totalTokenEstimate: number;
}

/**
 * YAML frontmatter fields for a chapter file.
 *
 * Author-managed fields (type through act) are set by the author.
 * Agent-managed fields (agent_*) are updated automatically by PENNY
 * after each processing pass.
 */
export interface ChapterFrontmatter {
  type?: string;
  book?: number;
  chapter?: number;
  title?: string;
  pov?: string;
  status?: string;
  wordcount?: number;
  /** Comma-separated character names for voice test filtering. */
  focus?: string;
  /** Which narrative thread this chapter advances. */
  thread?: string;
  act?: number;
  // Agent-managed fields (updated by pipeline.ts after processing)
  /** Version number set by PENNY after creating a new version. */
  agent_version?: number;
  /** ISO timestamp of the last PENNY revision. */
  agent_last_revised?: string;
  /** Count of actionable annotations remaining after processing. */
  agent_annotations_pending?: number;
  /** Characters detected in the scene via dialogue attribution patterns. */
  characters_in_scene?: string[];
  /** Allow arbitrary additional frontmatter keys. */
  [key: string]: unknown;
}

/**
 * Complete data for a review note generated after a processing pass.
 * Passed to reviewer.ts to produce the markdown review file.
 */
export interface ReviewData {
  /** ISO timestamp when processing completed. */
  timestamp: string;
  /** Book identifier (e.g. "book-1"). */
  book: string;
  /** Chapter identifier (e.g. "ch-05"). */
  chapter: string;
  /** The version number that was created. */
  version: number;
  /** Number of annotations that were sent to the LLM. */
  annotationsProcessed: number;
  /** Number of passthrough annotations that were preserved. */
  annotationsSkipped: number;
  /** Per-annotation change details. */
  changes: AnnotationChange[];
  /** Issues flagged for author attention. */
  flags: ReviewFlag[];
  /** Voice compliance metrics for the new version. */
  voiceCompliance: VoiceComplianceResult;
  /** Word count before processing. */
  wordCountBefore: number;
  /** Word count after processing. */
  wordCountAfter: number;
}

/**
 * Details about a single annotation that was processed by the LLM.
 * One entry per actionable annotation in the processing pass.
 */
export interface AnnotationChange {
  /** The annotation tag. */
  tag: string;
  /** The author's instruction. */
  instruction: string;
  /** Line where the annotation appeared. */
  lineStart: number;
  /** Word count of the original passage. */
  originalWordCount: number;
  /** Word count of the LLM-produced replacement. */
  revisedWordCount: number;
  /** Which context files were included in the prompt. */
  contextFilesUsed: string[];
  /** Provider that handled this annotation (e.g. "anthropic"). */
  provider: string;
  /** Model that produced the revision (e.g. "claude-sonnet-4-6"). */
  model: string;
}

/**
 * A flag raised during processing that needs author attention.
 * Included in the review note under "Flags for Author".
 */
export interface ReviewFlag {
  /** Category of the flag. */
  type: "research" | "plot" | "vague" | "error";
  /** Line number associated with the flag. */
  line: number;
  /** Human-readable description of what needs attention. */
  description: string;
}

/**
 * Voice compliance metrics computed by voice-check.ts.
 * Measures how well the prose adheres to the project's voice rules.
 */
export interface VoiceComplianceResult {
  /** Ratio of dialogue words to total words (0.0 to 1.0). */
  dialogueRatio: number;
  /** Narration sentences exceeding the max word threshold. */
  longNarrationSentences: string[];
  /** Lines matching self-analysis / internal monologue patterns. */
  selfAnalysisFlags: string[];
}

/**
 * Single entry in the JSONL activity log.
 * One entry per processing pass, appended to {book}-activity.jsonl.
 */
export interface ActivityLogEntry {
  /** ISO timestamp of the processing pass. */
  timestamp: string;
  /** Book identifier. */
  book: string;
  /** Chapter identifier. */
  chapter: string;
  /** Version number before processing. */
  versionFrom: number;
  /** Version number after processing. */
  versionTo: number;
  /** Number of annotations sent to the LLM. */
  annotationsProcessed: number;
  /** Number of passthrough annotations preserved. */
  annotationsSkipped: number;
  /** Prose word count before processing. */
  wordCountBefore: number;
  /** Prose word count after processing. */
  wordCountAfter: number;
  /** Tags that were processed in this pass. */
  tags: string[];
  /** Wall-clock duration of the processing pass in milliseconds. */
  durationMs: number;
  /** Primary provider used. */
  provider: string;
  /** Primary model used. */
  model: string;
  /** Voice compliance check results for the new version. */
  voiceCompliance: VoiceComplianceResult;
}

/**
 * Options for the project initialization wizard (ProjectInitModal in commands.ts).
 * Drives folder and file scaffolding for a new novel project.
 */
export interface ProjectInitOptions {
  /** Root folder name for the project (becomes a top-level vault directory). */
  projectName: string;
  /** How many books to scaffold (each gets its own plot/drafts/reviews subfolders). */
  numberOfBooks: number;
  /** How many chapter folders to create per book. */
  chaptersPerBook: number;
  /** Whether to create a templates/ folder with starter templates. */
  includeTemplates: boolean;
  /** Narrative point of view for the style guide. */
  pov: "first" | "third";
  /** Narrative tense for the style guide. */
  tense: "past" | "present";
}
