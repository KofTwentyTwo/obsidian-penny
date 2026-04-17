/**
 * PENNY - File Conflict Modal
 *
 * When PENNY tries to create a file that already exists, this modal
 * presents the user with options: Overwrite, Rename (auto-increment),
 * or Cancel.
 */

import { Modal, App, TFile } from "obsidian";
import type PennyPlugin from "./main";
import { showPennyError } from "./error-modal";

/** The user's chosen resolution for a file conflict. */
export type FileConflictChoice = "overwrite" | "rename" | "cancel";

/**
 * Modal that displays when a file creation conflicts with an existing file.
 * Returns a promise that resolves with the user's choice.
 */
export class FileConflictModal extends Modal {
  private resolveChoice: ((choice: FileConflictChoice) => void) | null = null;
  private filePath: string;

  constructor(app: App, filePath: string) {
    super(app);
    this.filePath = filePath;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("penny-error-modal");

    contentEl.createEl("h3", { text: "File Already Exists" });

    const messageBox = contentEl.createEl("div", { cls: "penny-error-box" });
    messageBox.createEl("p", {
      text: `File already exists: ${this.filePath}`,
      cls: "penny-error-message",
    });
    messageBox.createEl("p", {
      text: "How would you like to proceed?",
    });

    const buttonRow = contentEl.createEl("div", { cls: "penny-progress-buttons" });

    const overwriteBtn = buttonRow.createEl("button", { text: "Overwrite" });
    overwriteBtn.addEventListener("click", () => {
      this.resolve("overwrite");
    });

    const renameBtn = buttonRow.createEl("button", { text: "Rename" });
    renameBtn.addEventListener("click", () => {
      this.resolve("rename");
    });

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.resolve("cancel");
    });
  }

  onClose(): void {
    // If the modal is closed without a button click, treat as cancel
    this.resolve("cancel");
    this.contentEl.empty();
  }

  /** Wait for the user to pick an option. */
  awaitChoice(): Promise<FileConflictChoice> {
    return new Promise<FileConflictChoice>((resolve) => {
      this.resolveChoice = resolve;
    });
  }

  private resolve(choice: FileConflictChoice): void {
    if (this.resolveChoice) {
      const cb = this.resolveChoice;
      this.resolveChoice = null;
      this.close();
      cb(choice);
    }
  }
}

/**
 * Find the next available numbered path for a file.
 * e.g. "folder/file.md" -> "folder/file-2.md", "folder/file-3.md", etc.
 */
function findNextAvailablePath(plugin: PennyPlugin, originalPath: string): string {
  const dotIndex = originalPath.lastIndexOf(".");
  const base = dotIndex >= 0 ? originalPath.slice(0, dotIndex) : originalPath;
  const ext = dotIndex >= 0 ? originalPath.slice(dotIndex) : "";

  let counter = 2;
  let candidate = `${base}-${counter}${ext}`;
  while (plugin.app.vault.getAbstractFileByPath(candidate)) {
    counter++;
    candidate = `${base}-${counter}${ext}`;
  }
  return candidate;
}

/**
 * Safely create a file, showing a conflict resolution dialog if the file
 * already exists.
 *
 * Returns the created/modified TFile, or null if the user cancelled.
 * For any non-conflict error, shows the error modal with full details.
 */
export async function safeCreateFile(
  plugin: PennyPlugin,
  path: string,
  content: string,
): Promise<TFile | null> {
  try {
    return await plugin.app.vault.create(path, content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Check if the error is a "file already exists" conflict
    if (message.toLowerCase().includes("file already exists") || message.toLowerCase().includes("already exists")) {
      const modal = new FileConflictModal(plugin.app, path);
      modal.open();
      const choice = await modal.awaitChoice();

      switch (choice) {
        case "overwrite": {
          const existing = plugin.app.vault.getAbstractFileByPath(path);
          if (existing && existing instanceof TFile) {
            await plugin.app.vault.modify(existing, content);
            return existing;
          }
          // Shouldn't happen, but fall back to create
          return await plugin.app.vault.create(path, content);
        }

        case "rename": {
          const newPath = findNextAvailablePath(plugin, path);
          return await plugin.app.vault.create(newPath, content);
        }

        case "cancel":
          return null;
      }
    }

    // Non-conflict error: show the error modal
    const stack = err instanceof Error ? err.stack ?? "" : "";
    showPennyError(plugin.app, `Failed to create file: ${path}`, `${message}\n\n${stack}`);
    return null;
  }
}
