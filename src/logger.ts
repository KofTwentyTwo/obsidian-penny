/**
 * PENNY - Activity Logger
 *
 * Formats activity log entries as JSONL for append-only logging.
 * Actual file I/O is handled by the command layer via Obsidian's vault API.
 */

import type { ActivityLogEntry } from "./types";

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
