/**
 * PENNY - Settings Tab
 *
 * Full settings UI with collapsible sections for API, project structure,
 * voice rules, behavior, and git integration.
 */

import { PluginSettingTab, Setting, App } from "obsidian";
import type PennyPlugin from "./main";
import { DEFAULT_SYSTEM_PROMPT } from "./types";

/**
 * Settings tab for the PENNY plugin.
 *
 * Renders a multi-section settings UI using collapsible `<details>` elements.
 * Each section groups related settings and provides descriptions to guide
 * the author through configuration.
 */
export class PennySettingTab extends PluginSettingTab {
  plugin: PennyPlugin;

  constructor(app: App, plugin: PennyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h1", { text: "PENNY - Prose Co-Author" });
    containerEl.createEl("p", {
      text: "Configure PENNY to work with your novel project. Set your API key, point PENNY at your project files, and define your voice rules.",
      cls: "setting-item-description",
    });

    this.renderApiSection(containerEl);
    this.renderProjectStructureSection(containerEl);
    this.renderVoiceSection(containerEl);
    this.renderBehaviorSection(containerEl);
    this.renderGitSection(containerEl);
  }

  /**
   * API Settings -- key, model, context budget.
   */
  private renderApiSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details", { attr: { open: "" } });
    details.createEl("summary", { text: "API Settings" });

    new Setting(details)
      .setName("API key")
      .setDesc(
        "Your Anthropic API key. Get one at console.anthropic.com. Stored locally in plugin data."
      )
      .addText((text) =>
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.apiKey)
          .then((t) => {
            t.inputEl.type = "password";
            t.inputEl.style.width = "300px";
          })
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Model")
      .setDesc(
        "Claude model for revisions. Opus is the most capable. Sonnet is faster and cheaper for routine work."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("claude-opus-4-6", "Claude Opus 4.6")
          .addOption("claude-sonnet-4-6", "Claude Sonnet 4.6")
          .addOption("claude-haiku-4-5", "Claude Haiku 4.5")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Context budget")
      .setDesc(
        "Maximum tokens for context assembly. Higher values include more reference material but cost more. Default: 800,000."
      )
      .addText((text) =>
        text
          .setPlaceholder("800000")
          .setValue(String(this.plugin.settings.contextBudget))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.contextBudget = parsed;
              await this.plugin.saveSettings();
            }
          })
      );
  }

  /**
   * Project Structure -- paths to drafts, style guide, characters, etc.
   */
  private renderProjectStructureSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details");
    details.createEl("summary", { text: "Project Structure" });
    details.createEl("p", {
      text: "All paths are relative to the vault root. These tell PENNY where to find your project files. Leave a path blank to disable that context source.",
      cls: "setting-item-description",
    });

    const pathSettings: Array<{
      key: keyof typeof this.plugin.settings;
      name: string;
      desc: string;
      placeholder: string;
    }> = [
      {
        key: "draftsFolder",
        name: "Drafts folder",
        desc: "Where chapter files live, organized by book subfolder.",
        placeholder: "04-drafts",
      },
      {
        key: "styleGuide",
        name: "Style guide",
        desc: "Path to your style guide file.",
        placeholder: "06-reference/style-guide.md",
      },
      {
        key: "voiceTests",
        name: "Voice tests",
        desc: "Path to voice test/examples file. PENNY matches these precisely.",
        placeholder: "06-reference/voice-tests.md",
      },
      {
        key: "characterSheetsFolder",
        name: "Character sheets folder",
        desc: "Folder containing character profile files.",
        placeholder: "02-characters",
      },
      {
        key: "plotOutlinesFolder",
        name: "Plot outlines folder",
        desc: "Folder with per-book outlines.",
        placeholder: "03-plot",
      },
      {
        key: "wikiFolder",
        name: "Wiki/lore folder",
        desc: "Folder with world-building and lore entries.",
        placeholder: "05-wiki",
      },
      {
        key: "seriesBible",
        name: "Series bible",
        desc: "Path to the series bible file.",
        placeholder: "00-series/series-bible.md",
      },
      {
        key: "themesFile",
        name: "Themes file",
        desc: "Path to the themes file.",
        placeholder: "00-series/themes.md",
      },
      {
        key: "reviewsFolder",
        name: "Reviews folder",
        desc: "Where PENNY writes review notes after processing.",
        placeholder: "07-reviews",
      },
      {
        key: "activityLogFolder",
        name: "Activity log folder",
        desc: "Where PENNY writes JSONL activity logs.",
        placeholder: ".penny-log",
      },
    ];

    for (const ps of pathSettings) {
      const key = ps.key as string;
      new Setting(details)
        .setName(ps.name)
        .setDesc(ps.desc)
        .addText((text) =>
          text
            .setPlaceholder(ps.placeholder)
            .setValue(
              String(
                (this.plugin.settings as unknown as Record<string, string>)[key]
              )
            )
            .onChange(async (value) => {
              (this.plugin.settings as unknown as Record<string, string>)[key] =
                value.trim();
              await this.plugin.saveSettings();
            })
        );
    }
  }

  /**
   * Voice Rules -- custom voice rules and system prompt template.
   */
  private renderVoiceSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details");
    details.createEl("summary", { text: "Voice Rules" });

    new Setting(details)
      .setName("Custom voice rules")
      .setDesc(
        "Project-specific voice rules injected into every prompt. Write the rules that matter most for your project's voice. These go into the CRITICAL VOICE RULES section of the processing prompt."
      )
      .addTextArea((text) =>
        text
          .setPlaceholder(
            "e.g., No internal monologue. She never thinks in narrated sentences..."
          )
          .setValue(this.plugin.settings.customVoiceRules)
          .then((t) => {
            t.inputEl.rows = 8;
            t.inputEl.style.width = "100%";
          })
          .onChange(async (value) => {
            this.plugin.settings.customVoiceRules = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("System prompt template")
      .setDesc(
        "The full system prompt sent with every revision request. Uses {voice_rules}, {voice_tests}, {style_guide}, {outline}, {characters}, {wiki}, {chapter}, {tag}, {passage}, {instruction} placeholders. Advanced users only."
      )
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.systemPromptTemplate)
          .then((t) => {
            t.inputEl.rows = 12;
            t.inputEl.style.width = "100%";
            t.inputEl.style.fontFamily = "monospace";
            t.inputEl.style.fontSize = "12px";
          })
          .onChange(async (value) => {
            this.plugin.settings.systemPromptTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Reset system prompt")
      .setDesc("Restore the system prompt template to its default value.")
      .addButton((button) =>
        button.setButtonText("Reset to default").onClick(async () => {
          this.plugin.settings.systemPromptTemplate = DEFAULT_SYSTEM_PROMPT;
          await this.plugin.saveSettings();
          this.display(); // Re-render to show the reset value
        })
      );
  }

  /**
   * Behavior -- auto-process, logging, file patterns.
   */
  private renderBehaviorSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details");
    details.createEl("summary", { text: "Behavior" });

    new Setting(details)
      .setName("Auto-process on save")
      .setDesc(
        "Automatically process annotations when a chapter file is saved. Use with caution -- each annotation triggers an API call."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoProcessOnSave)
          .onChange(async (value) => {
            this.plugin.settings.autoProcessOnSave = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Verbose logging")
      .setDesc(
        "Write detailed activity entries to the log. Useful for debugging but increases log file size."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.verboseLogging)
          .onChange(async (value) => {
            this.plugin.settings.verboseLogging = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Chapter file pattern")
      .setDesc(
        "Glob pattern that identifies chapter files within book folders. Supports * and ? wildcards."
      )
      .addText((text) =>
        text
          .setPlaceholder("ch-*.md")
          .setValue(this.plugin.settings.chapterFilePattern)
          .onChange(async (value) => {
            this.plugin.settings.chapterFilePattern = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Prose marker")
      .setDesc(
        "HTML comment that separates frontmatter/outline from prose. Used for accurate word counts."
      )
      .addText((text) =>
        text
          .setPlaceholder("<!-- Prose begins below -->")
          .setValue(this.plugin.settings.proseMarker)
          .then((t) => {
            t.inputEl.style.width = "300px";
          })
          .onChange(async (value) => {
            this.plugin.settings.proseMarker = value;
            await this.plugin.saveSettings();
          })
      );
  }

  /**
   * Git -- auto-commit, auto-push, commit message format.
   */
  private renderGitSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details");
    details.createEl("summary", { text: "Git Integration" });

    new Setting(details)
      .setName("Auto-commit after processing")
      .setDesc(
        "Automatically stage and commit chapter and review changes after PENNY processes annotations."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoCommitAfterProcessing)
          .onChange(async (value) => {
            this.plugin.settings.autoCommitAfterProcessing = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Auto-push after commit")
      .setDesc("Automatically push to remote after committing.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoPushAfterCommit)
          .onChange(async (value) => {
            this.plugin.settings.autoPushAfterCommit = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Commit message format")
      .setDesc(
        "Template for auto-generated commit messages. Placeholders: {chapter}, {version}, {tags}."
      )
      .addText((text) =>
        text
          .setPlaceholder("docs({chapter}): PENNY v{version} - {tags}")
          .setValue(this.plugin.settings.commitMessageFormat)
          .then((t) => {
            t.inputEl.style.width = "400px";
          })
          .onChange(async (value) => {
            this.plugin.settings.commitMessageFormat = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
