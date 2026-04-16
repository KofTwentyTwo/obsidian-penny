/**
 * PENNY - Settings Tab
 *
 * Full settings UI with collapsible sections for API, project structure,
 * voice rules, behavior, and git integration.
 */

import { PluginSettingTab, Setting, App, Notice, TFolder, TFile, FuzzySuggestModal } from "obsidian";
import type PennyPlugin from "./main";
import { DEFAULT_SYSTEM_PROMPT } from "./types";
import { ANTHROPIC_MODELS } from "./providers/anthropic";
import { resolveModel } from "./providers/router";

/**
 * Settings tab for the PENNY plugin.
 *
 * Renders a multi-section settings UI using collapsible `<details>` elements.
 * Each section groups related settings and provides descriptions to guide
 * the author through configuration.
 */
export class PennySettingTab extends PluginSettingTab {
  plugin: PennyPlugin;
  /** Cached Ollama model list, populated on settings tab open */
  private ollamaModels: Array<{ id: string; name: string }> = [];

  constructor(app: App, plugin: PennyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Plugin header
    const header = containerEl.createDiv({ cls: "penny-settings-header" });
    const titleRow = header.createDiv({ cls: "penny-title-row" });
    titleRow.createEl("h1", { text: "PENNY" });
    titleRow.createEl("span", { text: `v${this.plugin.manifest.version}`, cls: "penny-version-badge" });
    header.createEl("p", {
      text: "Prose Engine for Narrative, Notes, and Yarns",
      cls: "penny-settings-subtitle",
    });
    header.createEl("p", {
      text: "AI-powered prose revision agent. Processes editorial annotations, enforces voice consistency, and manages chapter versions.",
      cls: "setting-item-description",
    });

    const links = header.createDiv({ cls: "penny-settings-links" });
    const addLink = (label: string, url: string) => {
      const a = links.createEl("a", { text: label, href: url });
      a.setAttr("target", "_blank");
    };
    addLink("Documentation", "https://github.com/KofTwentyTwo/obsidian-penny/tree/main/docs");
    links.createSpan({ text: " | " });
    addLink("Getting Started", "https://github.com/KofTwentyTwo/obsidian-penny/blob/main/docs/getting-started.md");
    links.createSpan({ text: " | " });
    addLink("Report a Bug", "https://github.com/KofTwentyTwo/obsidian-penny/issues");
    links.createSpan({ text: " | " });
    addLink("GitHub", "https://github.com/KofTwentyTwo/obsidian-penny");

    containerEl.createEl("hr");

    this.renderProvidersSection(containerEl);
    this.renderModelRoutingSection(containerEl);
    this.renderProjectStructureSection(containerEl);
    this.renderVoiceSection(containerEl);
    this.renderBehaviorSection(containerEl);
    this.renderGitSection(containerEl);
    this.renderHelpSection(containerEl);
  }

  /**
   * Providers -- Anthropic key, Ollama endpoint, test buttons.
   */
  private renderProvidersSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details", { attr: { open: "" } });
    details.createEl("summary", { text: "Providers" });
    details.createEl("p", {
      text: "Configure one or more LLM providers. PENNY can route different annotation types to different providers.",
      cls: "setting-item-description",
    });

    // -- Anthropic --
    details.createEl("h4", { text: "Anthropic (Claude API)" });

    new Setting(details)
      .setName("Anthropic API key")
      .setDesc(
        "Your Anthropic API key. Get one at console.anthropic.com. Stored locally in plugin data."
      )
      .addText((text) =>
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.anthropicApiKey)
          .then((t) => {
            t.inputEl.type = "password";
            t.inputEl.style.width = "300px";
          })
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // Anthropic models -- show static list + fetch from API if key is set
    const anthropicModelsSetting = new Setting(details)
      .setName("Available Claude models")
      .setDesc("Models available for use with Anthropic.");
    const anthropicModelListEl = details.createEl("div", { cls: "penny-model-list" });
    // Auto-load if API key is set
    this.loadAnthropicModels(anthropicModelListEl);

    new Setting(details)
      .setName("Test Anthropic connection")
      .setDesc("Verify that your API key is valid.")
      .addButton((button) =>
        button.setButtonText("Test Connection").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            const provider = this.plugin.providerRegistry.get("anthropic");
            if (!provider) throw new Error("Anthropic provider not registered");
            const result = await provider.testConnection({
              apiKey: this.plugin.settings.anthropicApiKey,
            });
            if (result) {
              new Notice(
                `PENNY: Anthropic connection failed -- ${result}`,
                6000,
              );
            } else {
              new Notice(
                "PENNY: Anthropic connection OK.",
                4000,
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(
              `PENNY: Test failed -- ${msg}`,
              6000,
            );
          } finally {
            button.setButtonText("Test Connection");
            button.setDisabled(false);
          }
        })
      );

    // -- Ollama --
    details.createEl("h4", { text: "Ollama (Local Models)" });

    new Setting(details)
      .setName("Ollama endpoint")
      .setDesc(
        "URL of the Ollama server. Default: http://localhost:11434. Change only if Ollama runs on a different host or port."
      )
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.ollamaEndpoint)
          .then((t) => {
            t.inputEl.style.width = "300px";
          })
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (trimmed && !trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
              new Notice("PENNY: Ollama endpoint must start with http:// or https://");
              return;
            }
            this.plugin.settings.ollamaEndpoint = trimmed;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Ollama API key (optional)")
      .setDesc(
        "Only needed if your Ollama instance requires authentication (e.g. remote hosted). Leave blank for local Ollama."
      )
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.ollamaApiKey)
          .then((t) => {
            t.inputEl.type = "password";
            t.inputEl.style.width = "300px";
          })
          .onChange(async (value) => {
            this.plugin.settings.ollamaApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // Ollama models -- fetch and display
    const ollamaModelListEl = details.createEl("div", { cls: "penny-model-list" });
    new Setting(details)
      .setName("Available Ollama models")
      .setDesc(
        "Models installed on your Ollama instance. Click Refresh to fetch the latest list."
      )
      .addButton((button) =>
        button.setButtonText("Refresh Models").onClick(async () => {
          await this.loadOllamaModels(ollamaModelListEl);
        })
      );
    // Auto-load on render
    this.loadOllamaModels(ollamaModelListEl);

    new Setting(details)
      .setName("Test Ollama connection")
      .setDesc("Verify that Ollama is reachable and list available models.")
      .addButton((button) =>
        button.setButtonText("Test Connection").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            const provider = this.plugin.providerRegistry.get("ollama");
            if (!provider) throw new Error("Ollama provider not registered");
            const result = await provider.testConnection({
              endpoint: this.plugin.settings.ollamaEndpoint,
              apiKey: this.plugin.settings.ollamaApiKey,
            });
            if (result) {
              new Notice(
                `PENNY: Ollama test failed -- ${result}`,
                6000,
              );
            } else {
              new Notice(
                "PENNY: Ollama connection OK.",
                4000,
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(
              `PENNY: Ollama test failed -- ${msg}`,
              6000,
            );
          } finally {
            button.setButtonText("Test Connection");
            button.setDisabled(false);
          }
        })
      );
  }

  /**
   * Model Routing -- map complexity tiers to provider+model.
   */
  private renderModelRoutingSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details", { attr: { open: "" } });
    details.createEl("summary", { text: "Model Routing" });
    details.createEl("p", {
      text: "Choose which provider and model to use for each complexity tier. Simple tasks (CUT, PACING) use Light. Complex tasks (REWRITE, DIALOG, CHARACTER) use Heavy. Everything else uses Standard.",
      cls: "setting-item-description",
    });

    const providers = this.plugin.providerRegistry.getAll();
    const providerNames = providers.map((p) => p.name);

    new Setting(details)
      .setName("Use same model for all tiers")
      .setDesc(
        "When on, all annotations use the Standard model. Turn off to assign different models per complexity tier."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useSameModelForAll)
          .onChange(async (value) => {
            this.plugin.settings.useSameModelForAll = value;
            await this.plugin.saveSettings();
            this.display(); // Re-render to show/hide per-tier rows
          })
      );

    if (this.plugin.settings.useSameModelForAll) {
      // Single row -- edits routeStandard and mirrors to light/heavy
      this.renderRouteRow(details, "All tiers", "routeStandard", providerNames, true);
    } else {
      this.renderRouteRow(details, "Light (CUT, PACING)", "routeLight", providerNames);
      this.renderRouteRow(details, "Standard (TONE, EXPAND, PLOT)", "routeStandard", providerNames);
      this.renderRouteRow(details, "Heavy (REWRITE, DIALOG, CHARACTER)", "routeHeavy", providerNames);
    }

    // Context budget (moved here from old API section since it relates to routing)
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
            if (isNaN(parsed) || parsed <= 0) {
              new Notice("PENNY: Context budget must be a positive number.");
              text.setValue(String(this.plugin.settings.contextBudget));
              return;
            }
            this.plugin.settings.contextBudget = parsed;
            await this.plugin.saveSettings();
          })
      );

    // Max output tokens
    new Setting(details)
      .setName("Max output tokens")
      .setDesc(
        "Maximum tokens the LLM can generate per revision. Higher = longer output allowed but more expensive. Default: 16000."
      )
      .addText((text) =>
        text
          .setPlaceholder("16000")
          .setValue(String(this.plugin.settings.maxTokens))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (isNaN(parsed) || parsed <= 0) {
              new Notice("PENNY: Max output tokens must be a positive number.");
              text.setValue(String(this.plugin.settings.maxTokens));
              return;
            }
            this.plugin.settings.maxTokens = parsed;
            await this.plugin.saveSettings();
          })
      );
  }

  /**
   * Render a single route row: provider dropdown + model selector.
   *
   * For Anthropic the model is a dropdown. For Ollama it is a text input
   * (the user types the model name, e.g. "llama3.2").
   */
  private renderRouteRow(
    container: HTMLElement,
    label: string,
    routeKey: "routeLight" | "routeStandard" | "routeHeavy",
    providerNames: string[],
    mirrorAll = false,
  ): void {
    const route = this.plugin.settings[routeKey];

    const anthropicModels = ANTHROPIC_MODELS.map((m) => ({ id: m.id, name: m.name }));

    const setting = new Setting(container).setName(label);

    // Provider dropdown
    setting.addDropdown((dropdown) => {
      for (const name of providerNames) {
        dropdown.addOption(name, name.charAt(0).toUpperCase() + name.slice(1));
      }
      dropdown.setValue(route.provider);
      dropdown.onChange(async (value) => {
        route.provider = value;
        // When switching to Ollama, keep model text; switching to Anthropic, default to sonnet
        if (value === "anthropic" && !anthropicModels.some((m) => m.id === route.model)) {
          route.model = "claude-sonnet-4-6";
        }
        if (mirrorAll) {
          this.plugin.settings.routeLight = { ...route };
          this.plugin.settings.routeHeavy = { ...route };
        }
        await this.plugin.saveSettings();
        this.display(); // Re-render to swap model widget
      });
    });

    // Model selector: dropdown for Anthropic, text input for Ollama
    if (route.provider === "anthropic") {
      // Determine which tier this route represents (for display purposes)
      const tierLabel = routeKey === "routeLight" ? "light"
        : routeKey === "routeHeavy" ? "heavy"
        : "standard";
      const autoResolvedModel = resolveModel("auto-latest", tierLabel);
      const autoLabel = `Auto (recommended) -> ${autoResolvedModel}`;

      setting.addDropdown((dropdown) => {
        dropdown.addOption("auto-latest", autoLabel);
        for (const m of anthropicModels) {
          dropdown.addOption(m.id, m.name);
        }
        dropdown.setValue(route.model);
        dropdown.onChange(async (value) => {
          route.model = value;
          if (mirrorAll) {
            this.plugin.settings.routeLight = { ...route };
            this.plugin.settings.routeHeavy = { ...route };
          }
          await this.plugin.saveSettings();
        });
      });
    } else {
      // Ollama: dropdown if models are cached, text input as fallback
      if (this.ollamaModels.length > 0) {
        setting.addDropdown((dropdown) => {
          dropdown.addOption("", "Select a model...");
          for (const m of this.ollamaModels) {
            dropdown.addOption(m.id, m.name);
          }
          dropdown.setValue(route.model);
          dropdown.onChange(async (value) => {
            route.model = value;
            if (mirrorAll) {
              this.plugin.settings.routeLight = { ...route };
              this.plugin.settings.routeHeavy = { ...route };
            }
            await this.plugin.saveSettings();
          });
        });
      } else {
        // Fallback: text input when Ollama models haven't been fetched yet
        setting.addText((text) =>
          text
            .setPlaceholder("e.g. llama3.2, mistral, deepseek-coder")
            .setValue(route.model)
            .then((t) => { t.inputEl.style.width = "250px"; })
            .onChange(async (value) => {
              route.model = value.trim();
              if (mirrorAll) {
                this.plugin.settings.routeLight = { ...route };
                this.plugin.settings.routeHeavy = { ...route };
              }
              await this.plugin.saveSettings();
            })
        );
      }
    }
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

    // Action buttons row
    const buttonsRow = new Setting(details)
      .setName("Project detection")
      .setDesc("Scan the vault for common novel project folder patterns, or validate that configured paths exist.");

    buttonsRow.addButton((button) =>
      button.setButtonText("Detect structure").onClick(async () => {
        this.detectProjectStructure();
      })
    );
    buttonsRow.addButton((button) =>
      button
        .setButtonText("Validate paths")
        .onClick(async () => {
          this.validateProjectPaths();
        })
    );

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
      const isFolder = ps.name.toLowerCase().includes("folder");
      let textInput: HTMLInputElement | null = null;

      const s = new Setting(details)
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
            .then((t) => { textInput = t.inputEl; })
            .onChange(async (value) => {
              (this.plugin.settings as unknown as Record<string, string>)[key] =
                value.trim();
              await this.plugin.saveSettings();
            })
        );

      // Add a browse button that opens a folder/file picker
      s.addButton((button) =>
        button.setButtonText("Browse").onClick(() => {
          if (isFolder) {
            const folders = this.plugin.app.vault.getAllLoadedFiles()
              .filter((f): f is TFolder => f instanceof TFolder)
              .map((f) => f.path)
              .sort();
            new PathSuggestModal(this.app, folders, async (chosen) => {
              (this.plugin.settings as unknown as Record<string, string>)[key] = chosen;
              await this.plugin.saveSettings();
              if (textInput) textInput.value = chosen;
            }).open();
          } else {
            const files = this.plugin.app.vault.getMarkdownFiles()
              .map((f) => f.path)
              .sort();
            new PathSuggestModal(this.app, files, async (chosen) => {
              (this.plugin.settings as unknown as Record<string, string>)[key] = chosen;
              await this.plugin.saveSettings();
              if (textInput) textInput.value = chosen;
            }).open();
          }
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

    const voiceRulesSetting = new Setting(details)
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
          .onChange(async (value) => {
            this.plugin.settings.customVoiceRules = value;
            await this.plugin.saveSettings();
          })
      );
    // Make the textarea full-width below the label
    voiceRulesSetting.settingEl.style.display = "block";
    const voiceTextarea = voiceRulesSetting.settingEl.querySelector("textarea");
    if (voiceTextarea) {
      voiceTextarea.rows = 10;
      voiceTextarea.style.width = "100%";
      voiceTextarea.style.marginTop = "8px";
    }

    const systemPromptSetting = new Setting(details)
      .setName("System prompt template")
      .setDesc(
        "The full system prompt sent with every revision request. Uses {voice_rules}, {voice_tests}, {style_guide}, {outline}, {characters}, {wiki}, {chapter}, {tag}, {passage}, {instruction} placeholders. Advanced users only."
      )
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.systemPromptTemplate)
          .onChange(async (value) => {
            if (!value.includes("{chapter}")) {
              new Notice("PENNY: Warning -- your prompt template is missing {chapter}. The LLM won't see the chapter content.");
            }
            this.plugin.settings.systemPromptTemplate = value;
            await this.plugin.saveSettings();
          })
      );
    // Make the textarea full-width below the label
    systemPromptSetting.settingEl.style.display = "block";
    const sysTextarea = systemPromptSetting.settingEl.querySelector("textarea");
    if (sysTextarea) {
      sysTextarea.rows = 16;
      sysTextarea.style.width = "100%";
      sysTextarea.style.marginTop = "8px";
      sysTextarea.style.fontFamily = "var(--font-monospace)";
      sysTextarea.style.fontSize = "12px";
    }

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
   * Detect project structure by scanning the vault for common patterns.
   */
  /**
   * Load and display Anthropic models in the given container element.
   */
  private async loadAnthropicModels(containerEl: HTMLElement): Promise<void> {
    containerEl.empty();
    // Show static catalog first
    for (const m of ANTHROPIC_MODELS) {
      const row = containerEl.createEl("div", { cls: "penny-model-row" });
      row.createEl("span", { text: m.name, cls: "penny-model-name" });
      row.createEl("span", { text: ` (${m.id})` });
      if (m.contextWindow) {
        row.createEl("span", {
          text: ` -- ${(m.contextWindow / 1000).toFixed(0)}K context`,
          cls: "penny-model-meta",
        });
      }
    }
  }

  /**
   * Fetch and display Ollama models in the given container element.
   */
  private async loadOllamaModels(containerEl: HTMLElement): Promise<void> {
    containerEl.empty();
    containerEl.createEl("div", { text: "Loading...", cls: "penny-model-meta" });
    try {
      const provider = this.plugin.providerRegistry.get("ollama");
      if (!provider) {
        containerEl.empty();
        containerEl.createEl("div", { text: "Ollama provider not available.", cls: "penny-model-meta" });
        return;
      }
      const models = await provider.getModels({
        endpoint: this.plugin.settings.ollamaEndpoint,
        apiKey: this.plugin.settings.ollamaApiKey,
      });
      // Cache for use in route dropdowns
      this.ollamaModels = models.map((m) => ({ id: m.id, name: m.name }));
      containerEl.empty();
      if (models.length === 0) {
        containerEl.createEl("div", {
          text: "No models found. Install models with: ollama pull <model>",
          cls: "penny-model-meta",
        });
      } else {
        for (const m of models) {
          const row = containerEl.createEl("div", { cls: "penny-model-row" });
          row.createEl("span", { text: m.name, cls: "penny-model-name" });
          row.createEl("span", { text: ` (${m.id})` });
        }
      }
    } catch (err) {
      containerEl.empty();
      const msg = err instanceof Error ? err.message : String(err);
      containerEl.createEl("div", {
        text: `Could not connect to Ollama: ${msg}`,
        cls: "penny-model-meta",
      });
    }
  }

  private async detectProjectStructure(): Promise<void> {
    const vault = this.plugin.app.vault;
    const allFolders = vault.getAllLoadedFiles().filter((f) => f instanceof TFolder) as TFolder[];
    const allFiles = vault.getAllLoadedFiles().filter((f) => f instanceof TFile) as TFile[];

    const folderPaths = allFolders.map((f) => f.path);
    const filePaths = allFiles.map((f) => f.path);

    // Detection patterns: key -> { type: "folder"|"file", patterns: string[] }
    const detections: Array<{
      key: string;
      type: "folder" | "file";
      patterns: RegExp[];
      label: string;
    }> = [
      { key: "draftsFolder", type: "folder", patterns: [/^(.*\/)?04-drafts$/], label: "Drafts folder" },
      { key: "styleGuide", type: "file", patterns: [/^(.*\/)?06-reference\/style-guide\.md$/], label: "Style guide" },
      { key: "voiceTests", type: "file", patterns: [/^(.*\/)?06-reference\/voice-tests\.md$/], label: "Voice tests" },
      { key: "characterSheetsFolder", type: "folder", patterns: [/^(.*\/)?02-characters$/], label: "Character sheets" },
      { key: "plotOutlinesFolder", type: "folder", patterns: [/^(.*\/)?03-plot$/], label: "Plot outlines" },
      { key: "wikiFolder", type: "folder", patterns: [/^(.*\/)?05-wiki$/], label: "Wiki folder" },
      { key: "seriesBible", type: "file", patterns: [/^(.*\/)?00-series\/series-bible\.md$/], label: "Series bible" },
      { key: "themesFile", type: "file", patterns: [/^(.*\/)?00-series\/themes\.md$/], label: "Themes file" },
      { key: "reviewsFolder", type: "folder", patterns: [/^(.*\/)?07-reviews$/], label: "Reviews folder" },
    ];

    let detectedCount = 0;
    const detected: string[] = [];

    for (const det of detections) {
      const searchPaths = det.type === "folder" ? folderPaths : filePaths;
      for (const pattern of det.patterns) {
        const match = searchPaths.find((p) => pattern.test(p));
        if (match) {
          const settings = this.plugin.settings as unknown as Record<string, string>;
          // Only fill if currently empty
          if (!settings[det.key]) {
            settings[det.key] = match;
            detectedCount++;
            detected.push(`${det.label}: ${match}`);
          }
          break;
        }
      }
    }

    if (detectedCount > 0) {
      await this.plugin.saveSettings();
      new Notice(
        `PENNY: Detected ${detectedCount} path(s):\n${detected.join("\n")}`,
        8000,
      );
      // Don't call this.display() here -- it closes the section.
      // Settings are saved; user sees the detected paths in the Notice.
      // They can collapse/reopen the section to see updated values.
    } else {
      new Notice(
        "PENNY: No project structure detected, or all paths are already configured.",
        6000,
      );
    }
  }

  /**
   * Validate that all configured project paths exist in the vault.
   */
  private validateProjectPaths(): void {
    const vault = this.plugin.app.vault;
    const settings = this.plugin.settings;

    const checks: Array<{ label: string; path: string }> = [
      { label: "Drafts folder", path: settings.draftsFolder },
      { label: "Style guide", path: settings.styleGuide },
      { label: "Voice tests", path: settings.voiceTests },
      { label: "Character sheets", path: settings.characterSheetsFolder },
      { label: "Plot outlines", path: settings.plotOutlinesFolder },
      { label: "Wiki folder", path: settings.wikiFolder },
      { label: "Series bible", path: settings.seriesBible },
      { label: "Themes file", path: settings.themesFile },
      { label: "Reviews folder", path: settings.reviewsFolder },
      { label: "Activity log", path: settings.activityLogFolder },
    ];

    const results: string[] = [];
    let okCount = 0;
    let missingCount = 0;
    let emptyCount = 0;

    for (const check of checks) {
      if (!check.path) {
        results.push(`[not set] ${check.label}`);
        emptyCount++;
      } else {
        const abstractFile = vault.getAbstractFileByPath(check.path);
        if (abstractFile) {
          results.push(`[OK] ${check.label}: ${check.path}`);
          okCount++;
        } else {
          results.push(`[MISSING] ${check.label}: ${check.path}`);
          missingCount++;
        }
      }
    }

    const summary = `Valid: ${okCount}, Missing: ${missingCount}, Not set: ${emptyCount}`;
    new Notice(
      `PENNY: Path Validation\n${summary}\n\n${results.join("\n")}`,
      12000,
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
            if (!value) {
              this.plugin.settings.autoPushAfterCommit = false;
            }
            await this.plugin.saveSettings();
            this.display(); // Re-render to update autoPush dependency state
          })
      );

    const autoPushSetting = new Setting(details)
      .setName("Auto-push after commit")
      .setDesc("Automatically push to remote after committing. Requires 'Auto-commit after processing' to be enabled.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.autoPushAfterCommit)
          .onChange(async (value) => {
            this.plugin.settings.autoPushAfterCommit = value;
            await this.plugin.saveSettings();
          });
        toggle.setDisabled(!this.plugin.settings.autoCommitAfterProcessing);
      });
    if (!this.plugin.settings.autoCommitAfterProcessing) {
      autoPushSetting.settingEl.style.opacity = "0.5";
    }

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

  /**
   * Help -- command reference and tips.
   */
  private renderHelpSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details");
    details.createEl("summary", { text: "Commands Reference" });
    details.createEl("p", {
      text: "All PENNY commands available in the command palette (Cmd/Ctrl+P).",
      cls: "setting-item-description",
    });

    const commands: Array<{ name: string; desc: string }> = [
      { name: "PENNY: Initialize project", desc: "Scaffold a new novel project structure" },
      { name: "PENNY: Process this chapter", desc: "Process annotations in the active chapter" },
      { name: "PENNY: Process all chapters", desc: "Process all annotated chapters in the current book" },
      { name: "PENNY: Dry run", desc: "Show what would change without processing" },
      { name: "PENNY: Migrate chapters", desc: "Convert flat chapter files to versioned folders" },
      { name: "PENNY: Show status", desc: "Show annotation counts and version info" },
      { name: "PENNY: New chapter", desc: "Create a new chapter from template" },
      { name: "PENNY: New character", desc: "Create a new character from template" },
      { name: "PENNY: Commit progress", desc: "Git commit with auto-generated message" },
      { name: "PENNY: Push", desc: "Git push to remote" },
      { name: "PENNY: Commit and push", desc: "Both in one action" },
    ];

    const table = details.createEl("table", { cls: "penny-commands-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "Command" });
    headerRow.createEl("th", { text: "Description" });

    const tbody = table.createEl("tbody");
    for (const cmd of commands) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: cmd.name, cls: "penny-command-name" });
      row.createEl("td", { text: cmd.desc });
    }

    const tip = details.createEl("p", { cls: "penny-help-tip" });
    tip.createEl("strong", { text: "Tip: " });
    tip.appendText("Press Cmd/Ctrl+P and type \"PENNY\" to see all commands.");
  }
}

/**
 * Simple fuzzy suggest modal for picking a vault path (folder or file).
 */
class PathSuggestModal extends FuzzySuggestModal<string> {
  private paths: string[];
  private onChoose: (path: string) => void;

  constructor(app: App, paths: string[], onChoose: (path: string) => void) {
    super(app);
    this.paths = paths;
    this.onChoose = onChoose;
    this.setPlaceholder("Type to search...");
  }

  getItems(): string[] {
    return this.paths;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onChoose(item);
  }
}
