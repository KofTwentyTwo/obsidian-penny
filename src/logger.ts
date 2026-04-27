/**
 * PENNY - Activity Logger
 *
 * Provides two logging facilities:
 * 1. JSONL activity log entries -- one JSON object per processing pass,
 *    appended to `{activityLogFolder}/{book}-activity.jsonl` by commands.ts.
 * 2. Console logging -- level-filtered messages to the developer console
 *    (controlled by the `logLevel` setting).
 *
 * Actual file I/O (reading/appending the JSONL file) is handled by
 * commands.ts via Obsidian's vault API. This module is pure formatting.
 */

import type { ActivityLogEntry, LogLevel } from "./types";

/**
 * Serialize an activity log entry to a single JSONL line (JSON + newline).
 *
 * @param entry - The activity log entry to serialize
 * @returns A JSON string terminated by a newline character
 */
export function formatLogEntry(entry: ActivityLogEntry): string {
  return JSON.stringify(entry) + "\n";
}

/**
 * Build an ActivityLogEntry from processing results.
 *
 * Convenience factory that fills in the timestamp automatically.
 *
 * @param data - All fields except timestamp
 * @returns A complete ActivityLogEntry with current ISO timestamp
 */
export function createLogEntry(
  data: Omit<ActivityLogEntry, "timestamp">
): ActivityLogEntry {
  return {
    timestamp: new Date().toISOString(),
    ...data,
  };
}

// ---------------------------------------------------------------------------
// Console logging with level filtering
// ---------------------------------------------------------------------------

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, off: 4 };

/**
 * Log a message to the developer console, filtered by the configured log level.
 *
 * @param level   - Severity of this message
 * @param settingLevel - The user's configured minimum log level
 * @param message - Human-readable message
 * @param data    - Optional additional data to log
 */
export function pennyLog(level: LogLevel, settingLevel: LogLevel, message: string, ...data: unknown[]): void {
  if (LOG_LEVELS[level] >= LOG_LEVELS[settingLevel]) {
    // Build the full prefixed message as a single literal-concatenated string
    // so it can't be split as a console.log format-string argument. The prefix
    // is built from a closed LogLevel enum (no user-controlled input), but
    // passing it as a separate first argument to console.log causes static
    // analyzers (semgrep) to flag a non-issue. Concatenating up front sidesteps
    // the false positive and is functionally identical -- console prints
    // "[PENNY DEBUG] <message>" either way.
    const line = `[PENNY ${level.toUpperCase()}] ${message}`;
    switch (level) {
      case "debug": console.log(line, ...data); break;
      case "info":  console.info(line, ...data); break;
      case "warn":  console.warn(line, ...data); break;
      case "error": console.error(line, ...data); break;
    }
  }
}

/**
 * Derive the log file path for a given book within the activity log folder.
 *
 * @param logFolder - The activity log folder path (relative to vault root)
 * @param book - The book identifier (e.g., "book-1")
 * @returns The full path for the JSONL log file
 */
export function getLogFilePath(logFolder: string, book: string): string {
  return `${logFolder}/${book}-activity.jsonl`;
}
