/**
 * PENNY - Activity Logger
 *
 * Formats activity log entries as JSONL for append-only logging.
 * Actual file I/O is handled by the command layer via Obsidian's vault API.
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
    const prefix = `[PENNY ${level.toUpperCase()}]`;
    switch (level) {
      case "debug": console.log(prefix, message, ...data); break;
      case "info":  console.info(prefix, message, ...data); break;
      case "warn":  console.warn(prefix, message, ...data); break;
      case "error": console.error(prefix, message, ...data); break;
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
