/**
 * PENNY - Settings Tab
 *
 * Obsidian PluginSettingTab subclass that renders the full PENNY settings UI.
 * Uses collapsible `<details>` sections for organization:
 *
 * - Providers: Anthropic API key, Ollama endpoint, connection tests
 * - Model Routing: tier-to-model mapping, context budget, max tokens
 * - Project Structure: vault paths for drafts, characters, wiki, etc.
 * - Voice Rules: custom voice rules textarea, system prompt template
 * - Behavior: auto-process, logging, file patterns, prose marker
 * - Git Integration: auto-commit, auto-push, commit message format
 * - Commands Reference: help text with annotation syntax examples
 *
 * Created by main.ts at plugin load. Reads from and writes to plugin.settings.
 * Re-renders sections dynamically when settings change (e.g. toggling
 * useSameModelForAll swaps between single and per-tier model selectors).
 */

import { PluginSettingTab, Setting, App, Notice, TFolder, TFile, FuzzySuggestModal } from "obsidian";
import type PennyPlugin from "./main";
import { DEFAULT_SYSTEM_PROMPT } from "./types";
import type { LogLevel, PennySettings } from "./types";
import { showPennyError } from "./error-modal";
import { ANTHROPIC_MODELS } from "./providers/anthropic";
import { GOOGLE_MODELS } from "./providers/google";
import { OPENAI_MODELS } from "./providers/openai";
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
    this.renderUISection(containerEl);
    this.renderGitSection(containerEl);
    this.renderCompanionPluginsSection(containerEl);
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
    new Setting(details)
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
              showPennyError(this.app,
                "Anthropic connection failed",
                result);
            } else {
              new Notice(
                "PENNY: Anthropic connection OK.",
                4000,
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showPennyError(this.app, "Anthropic test failed", msg);
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
              showPennyError(this.app,
                "Invalid Ollama endpoint",
                "Ollama endpoint must start with http:// or https://");
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
              showPennyError(this.app,
                "Ollama connection failed",
                result);
            } else {
              new Notice(
                "PENNY: Ollama connection OK.",
                4000,
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showPennyError(this.app, "Ollama test failed", msg);
          } finally {
            button.setButtonText("Test Connection");
            button.setDisabled(false);
          }
        })
      );

    // -- Google Gemini --
    details.createEl("h4", { text: "Google Gemini" });

    new Setting(details)
      .setName("Google API key")
      .setDesc(
        "Your Google Gemini API key. Get one at aistudio.google.com. Stored locally in plugin data."
      )
      .addText((text) =>
        text
          .setPlaceholder("AIza...")
          .setValue(this.plugin.settings.googleApiKey)
          .then((t) => {
            t.inputEl.type = "password";
            t.inputEl.style.width = "300px";
          })
          .onChange(async (value) => {
            this.plugin.settings.googleApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // Google models -- show static list
    new Setting(details)
      .setName("Available Gemini models")
      .setDesc("Models available for use with Google Gemini.");
    const googleModelListEl = details.createEl("div", { cls: "penny-model-list" });
    this.loadGoogleModels(googleModelListEl);

    new Setting(details)
      .setName("Test Google connection")
      .setDesc("Verify that your API key is valid.")
      .addButton((button) =>
        button.setButtonText("Test Connection").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            const provider = this.plugin.providerRegistry.get("google");
            if (!provider) throw new Error("Google provider not registered");
            const result = await provider.testConnection({
              apiKey: this.plugin.settings.googleApiKey,
            });
            if (result) {
              showPennyError(this.app,
                "Google connection failed",
                result);
            } else {
              new Notice(
                "PENNY: Google Gemini connection OK.",
                4000,
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showPennyError(this.app, "Google Gemini test failed", msg);
          } finally {
            button.setButtonText("Test Connection");
            button.setDisabled(false);
          }
        })
      );

    // -- OpenAI --
    details.createEl("h4", { text: "OpenAI" });

    new Setting(details)
      .setName("OpenAI API key")
      .setDesc(
        "Your OpenAI API key. Get one at platform.openai.com. Stored locally in plugin data."
      )
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openaiApiKey)
          .then((t) => {
            t.inputEl.type = "password";
            t.inputEl.style.width = "300px";
          })
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // OpenAI models -- show static list
    new Setting(details)
      .setName("Available OpenAI models")
      .setDesc("Models available for use with OpenAI.");
    const openaiModelListEl = details.createEl("div", { cls: "penny-model-list" });
    this.loadOpenAIModels(openaiModelListEl);

    new Setting(details)
      .setName("Test OpenAI connection")
      .setDesc("Verify that your API key is valid.")
      .addButton((button) =>
        button.setButtonText("Test Connection").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            const provider = this.plugin.providerRegistry.get("openai");
            if (!provider) throw new Error("OpenAI provider not registered");
            const result = await provider.testConnection({
              apiKey: this.plugin.settings.openaiApiKey,
            });
            if (result) {
              showPennyError(this.app,
                "OpenAI connection failed",
                result);
            } else {
              new Notice(
                "PENNY: OpenAI connection OK.",
                4000,
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showPennyError(this.app, "OpenAI test failed", msg);
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

    // Compact routing grid
    const grid = details.createDiv({ cls: "penny-route-grid" });

    // Column headers
    const header = grid.createDiv({ cls: "penny-route-header" });
    header.createSpan({ text: "Tier" });
    header.createSpan({ text: "Provider / Model" });

    if (this.plugin.settings.useSameModelForAll) {
      this.renderRouteRow(grid, "All tiers", "routeStandard", providerNames, true);
    } else {
      this.renderRouteRow(grid, "Light", "routeLight", providerNames);
      this.renderRouteRow(grid, "Standard", "routeStandard", providerNames);
      this.renderRouteRow(grid, "Heavy", "routeHeavy", providerNames);
      grid.createDiv({ cls: "penny-route-divider" });
      this.renderRouteRow(grid, "Research", "routeResearch", providerNames);
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
    routeKey: "routeLight" | "routeStandard" | "routeHeavy" | "routeResearch",
    providerNames: string[],
    mirrorAll = false,
  ): void {
    const route = this.plugin.settings[routeKey];

    const anthropicModels = ANTHROPIC_MODELS.map((m) => ({ id: m.id, name: m.name }));
    const googleModels = GOOGLE_MODELS.map((m) => ({ id: m.id, name: m.name }));
    const openaiModels = OPENAI_MODELS.map((m) => ({ id: m.id, name: m.name }));

    const setting = new Setting(container).setName(label);

    // Provider dropdown
    setting.addDropdown((dropdown) => {
      for (const name of providerNames) {
        dropdown.addOption(name, name.charAt(0).toUpperCase() + name.slice(1));
      }
      dropdown.setValue(route.provider);
      dropdown.onChange(async (value) => {
        route.provider = value;
        // When switching providers, default to a sensible model if the current one doesn't match
        if (value === "anthropic" && !anthropicModels.some((m) => m.id === route.model)) {
          route.model = "claude-sonnet-4-6";
        } else if (value === "google" && !googleModels.some((m) => m.id === route.model)) {
          route.model = "gemini-2.5-flash";
        } else if (value === "openai" && !openaiModels.some((m) => m.id === route.model)) {
          route.model = "gpt-4.1";
        }
        if (mirrorAll) {
          this.plugin.settings.routeLight = { ...route };
          this.plugin.settings.routeHeavy = { ...route };
        }
        await this.plugin.saveSettings();
        this.display(); // Re-render to swap model widget
      });
    });

    // Model selector: dropdown for providers with static catalogs, text input for Ollama
    if (route.provider === "anthropic") {
      // Determine which tier this route represents (for display purposes)
      const tierLabel = routeKey === "routeLight" ? "light"
        : routeKey === "routeHeavy" ? "heavy"
        : routeKey === "routeResearch" ? "standard"
        : "standard";
      const resolved = resolveModel("auto-latest", tierLabel);
      // Show a clean short name: "Auto (Opus 4.6)" instead of the full model ID
      const shortName = resolved.replace("claude-", "").replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const autoLabel = `Auto (${shortName})`;

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
    } else if (route.provider === "google") {
      setting.addDropdown((dropdown) => {
        for (const m of googleModels) {
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
    } else if (route.provider === "openai") {
      setting.addDropdown((dropdown) => {
        for (const m of openaiModels) {
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
      key: keyof PennySettings;
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
        key: "researchFolder",
        name: "Research folder",
        desc: "Where PENNY saves research notes, organized by topic subfolder.",
        placeholder: "06-reference/research",
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
      .setName("Show progress modal")
      .setDesc(
        "Open a progress modal during processing showing real-time annotation status. You can minimize it to continue working."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showProgressModal)
          .onChange(async (value) => {
            this.plugin.settings.showProgressModal = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Show status notices")
      .setDesc(
        "Show notice popups for processing status updates. Active when the progress modal is minimized or disabled."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatusNotices)
          .onChange(async (value) => {
            this.plugin.settings.showStatusNotices = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Log level")
      .setDesc(
        "Controls how much detail PENNY writes to the developer console (Cmd+Opt+I). Debug = maximum detail, Off = silent."
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("debug", "Debug (maximum detail)");
        dropdown.addOption("info", "Info");
        dropdown.addOption("warn", "Warnings only");
        dropdown.addOption("error", "Errors only");
        dropdown.addOption("off", "Off (silent)");
        dropdown.setValue(this.plugin.settings.logLevel);
        dropdown.onChange(async (value) => {
          this.plugin.settings.logLevel = value as LogLevel;
          await this.plugin.saveSettings();
        });
      });

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

  /**
   * Display Google Gemini models (static catalog) in the given container element.
   */
  private async loadGoogleModels(containerEl: HTMLElement): Promise<void> {
    containerEl.empty();
    for (const m of GOOGLE_MODELS) {
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
   * Display OpenAI models (static catalog) in the given container element.
   */
  private async loadOpenAIModels(containerEl: HTMLElement): Promise<void> {
    containerEl.empty();
    for (const m of OPENAI_MODELS) {
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
      this.redisplayPreservingState();
    } else {
      new Notice(
        "PENNY: No project structure detected, or all paths are already configured.",
        6000,
      );
    }
  }

  /**
   * Re-render the settings UI while preserving the open/closed state of
   * all `<details>` sections so the user doesn't lose their place.
   */
  private redisplayPreservingState(): void {
    const { containerEl } = this;
    const openStates: boolean[] = [];
    containerEl.querySelectorAll("details").forEach((d) => {
      openStates.push(d.open);
    });

    this.display();

    containerEl.querySelectorAll("details").forEach((d, i) => {
      if (i < openStates.length) d.open = openStates[i];
    });
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
   * UI Options -- toggle ribbon icon, context menu, status bar.
   */
  private renderUISection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details");
    details.createEl("summary", { text: "UI Options" });
    details.createEl("p", {
      text: "Control which PENNY interface elements are visible. Commands are always available via the command palette (Cmd/Ctrl+P) regardless of these settings.",
      cls: "setting-item-description",
    });

    new Setting(details)
      .setName("Ribbon icon")
      .setDesc("Show the PENNY pen icon in the left sidebar. Click it to open the command menu.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showRibbonIcon)
          .onChange(async (value) => {
            this.plugin.settings.showRibbonIcon = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Right-click context menu")
      .setDesc("Add PENNY commands (Process, Dry run, Status, Research) to the editor right-click menu.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showContextMenu)
          .onChange(async (value) => {
            this.plugin.settings.showContextMenu = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(details)
      .setName("Status bar")
      .setDesc("Show annotation count and chapter info in the bottom status bar.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatusBar)
          .onChange(async (value) => {
            this.plugin.settings.showStatusBar = value;
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
      { name: "PENNY: Process this chapter", desc: "Process annotations in the active chapter (Cmd/Ctrl+Shift+P)" },
      { name: "PENNY: Process all chapters", desc: "Process all annotated chapters in the current book" },
      { name: "PENNY: Dry run", desc: "Show what would change without processing (Cmd/Ctrl+Shift+D)" },
      { name: "PENNY: Migrate chapters", desc: "Convert flat chapter files to versioned folders" },
      { name: "PENNY: Show status", desc: "Show annotation counts and version info (Cmd/Ctrl+Shift+S)" },
      { name: "PENNY: New chapter", desc: "Create a new chapter from template" },
      { name: "PENNY: New character", desc: "Create a new character from template" },
      { name: "PENNY: Commit progress", desc: "Git commit with auto-generated message" },
      { name: "PENNY: Push", desc: "Git push to remote" },
      { name: "PENNY: Commit and push", desc: "Both in one action" },
      { name: "PENNY: Do research", desc: "Research a topic and save to research folder (Cmd/Ctrl+Shift+R)" },
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

    // --- Annotation Directives Reference ---
    details.createEl("h4", { text: "Annotation Directives", attr: { style: "margin-top: 20px;" } });
    details.createEl("p", {
      text: "Add these annotations to your chapter prose using Obsidian hidden comments. PENNY processes them on the next run.",
      cls: "setting-item-description",
    });
    details.createEl("p", {
      text: "Syntax:  %% TAG: your instruction %%",
      cls: "penny-help-tip",
    });

    const directives: Array<{ tag: string; desc: string; example: string }> = [
      { tag: "REWRITE", desc: "Replace this passage with a new version", example: "%% REWRITE: More atmosphere -- rain, neon reflections, city sounds %%" },
      { tag: "EXPAND", desc: "Add depth, detail, or length to this passage", example: "%% EXPAND: Show her internal conflict through physical actions %%" },
      { tag: "CUT", desc: "Shorten or remove this passage", example: "%% CUT: Too repetitive. Trim to 2 sentences max %%" },
      { tag: "TONE", desc: "Adjust the voice or mood of this passage", example: "%% TONE: Too formal. Should be casual and fast-paced %%" },
      { tag: "DIALOG", desc: "Rework dialogue for voice, realism, or subtext", example: "%% DIALOG: Tim's voice is wrong here. Check his character sheet %%" },
      { tag: "CHARACTER", desc: "Fix character voice or behavior to match their profile", example: "%% CHARACTER: She wouldn't say this. Too passive. She's direct %%" },
      { tag: "PACING", desc: "Speed up or slow down the passage", example: "%% PACING: This drags. Compress into quick beats %%" },
      { tag: "PLOT", desc: "Flag or fix a continuity/plot issue", example: "%% PLOT: Tyler was established in Chicago in ch-03. Fix %%" },
      { tag: "NOTE", desc: "Author note (NOT processed by PENNY)", example: "%% NOTE: Come back to this after writing ch-06 %%" },
      { tag: "RESEARCH", desc: "Needs fact-checking (NOT processed, flagged in review)", example: "%% RESEARCH: Is this tech accurate for the timeline? %%" },
    ];

    const dTable = details.createEl("table", { cls: "penny-commands-table" });
    const dHead = dTable.createEl("thead");
    const dHeaderRow = dHead.createEl("tr");
    dHeaderRow.createEl("th", { text: "Tag" });
    dHeaderRow.createEl("th", { text: "What it does" });
    dHeaderRow.createEl("th", { text: "Example" });

    const dBody = dTable.createEl("tbody");
    for (const d of directives) {
      const row = dBody.createEl("tr");
      row.createEl("td", { text: d.tag, cls: "penny-command-name" });
      row.createEl("td", { text: d.desc });
      const exCell = row.createEl("td");
      exCell.createEl("code", { text: d.example, attr: { style: "font-size: 0.85em; word-break: break-word;" } });
    }

    details.createEl("h4", { text: "How Annotations Target Text", attr: { style: "margin-top: 16px;" } });
    details.createEl("p", {
      text: "Annotations always go AFTER the text they target. PENNY looks upward from the annotation to find what it applies to.",
      cls: "setting-item-description",
      attr: { style: "font-weight: 600; margin-bottom: 8px;" },
    });

    const scopeRules: Array<{ title: string; desc: string; example: string }> = [
      {
        title: "Single paragraph",
        desc: "Put the annotation on its own line after the paragraph.",
        example: "She walked into the room and sat down.\n%% REWRITE: More atmosphere %%",
      },
      {
        title: "Multiple paragraphs (block scope)",
        desc: "Wrap the target text in {{ }} markers. Put the annotation after the closing }}.",
        example: "{{\nFirst paragraph of the scene.\n\nSecond paragraph.\n\nThird paragraph.\n}}\n%% REWRITE: Rewrite this whole section %%",
      },
      {
        title: "Inline (within a line)",
        desc: "Put the annotation on the same line as the text.",
        example: "She felt happy. %% TONE: too direct, show don't tell %%",
      },
      {
        title: "Full section (under a heading)",
        desc: "Put the annotation right after a heading. Targets everything until the next heading of the same level.",
        example: "## The Coffee Ritual\n%% REWRITE: Change to espresso %%\n\nShe ground the beans...",
      },
    ];

    for (const rule of scopeRules) {
      const ruleDiv = details.createDiv({ attr: { style: "margin: 12px 0; padding: 10px 14px; border: 1px solid var(--background-modifier-border); border-radius: 6px;" } });
      ruleDiv.createEl("strong", { text: rule.title, attr: { style: "display: block; margin-bottom: 4px;" } });
      ruleDiv.createEl("span", { text: rule.desc, cls: "setting-item-description", attr: { style: "display: block; margin-bottom: 6px;" } });
      ruleDiv.createEl("pre", {
        text: rule.example,
        attr: { style: "background: var(--background-secondary); padding: 8px 12px; border-radius: 4px; font-size: 0.82em; white-space: pre-wrap; margin: 0;" },
      });
    }

    const tip = details.createEl("p", { cls: "penny-help-tip" });
    tip.createEl("strong", { text: "Tip: " });
    tip.appendText("The {{ }} block scope is the easiest way to target multiple paragraphs. Press Cmd/Ctrl+P and type \"PENNY\" to see all commands.");
  }

  // ---------------------------------------------------------------------------
  // Companion Plugins
  // ---------------------------------------------------------------------------

  /** PENNY commands that companion plugins should know about. */
  private static readonly PENNY_COMMANDS = [
    { id: "penny:process-chapter", name: "PENNY: Process chapter", icon: "zap" },
    { id: "penny:process-all", name: "PENNY: Process all", icon: "layers" },
    { id: "penny:dry-run", name: "PENNY: Dry run", icon: "eye" },
    { id: "penny:research", name: "PENNY: Research", icon: "search" },
    { id: "penny:status", name: "PENNY: Status", icon: "info" },
    { id: "penny:new-chapter", name: "PENNY: New chapter", icon: "file-plus" },
    { id: "penny:new-character", name: "PENNY: New character", icon: "user-plus" },
    { id: "penny:git-commit", name: "PENNY: Commit", icon: "git-commit-horizontal" },
    { id: "penny:git-push", name: "PENNY: Push", icon: "upload" },
  ];

  /**
   * Companion Plugins -- detect, describe, and auto-configure complementary plugins.
   */
  private renderCompanionPluginsSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details");
    details.createEl("summary", { text: "Companion Plugins" });
    details.createEl("p", {
      text: "These plugins enhance the PENNY workflow. Install them from the Community Plugins browser, then use the auto-configure button to set them up.",
      cls: "setting-item-description",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugins = (this.app as any).plugins?.manifests ?? {};

    const companions: Array<{
      id: string;
      name: string;
      desc: string;
      icon: string;
      url: string;
      configure: ((card: HTMLElement) => void) | null;
    }> = [
      {
        id: "slash-commander",
        name: "Slash Commander",
        desc: "Type / in the editor to access PENNY commands inline. Auto-configure adds all PENNY commands to your slash menu.",
        icon: "terminal",
        url: "obsidian://show-plugin?id=slash-commander",
        configure: (card) => this.configureSlashCommander(card),
      },
      {
        id: "editing-toolbar",
        name: "Editing Toolbar",
        desc: "Adds a floating toolbar with quick-access buttons. Auto-configure adds a PENNY submenu with processing and research commands.",
        icon: "panel-top",
        url: "obsidian://show-plugin?id=editing-toolbar",
        configure: (card) => this.configureEditingToolbar(card),
      },
      {
        id: "obsidian-git",
        name: "Obsidian Git",
        desc: "Automatic git backup and sync. Pairs well with PENNY's built-in git commands for version control of your prose.",
        icon: "git-branch",
        url: "obsidian://show-plugin?id=obsidian-git",
        configure: null,
      },
    ];

    const grid = details.createDiv({ cls: "penny-companion-grid" });

    for (const c of companions) {
      const installed = c.id in plugins;
      const card = grid.createDiv({ cls: `penny-companion-card ${installed ? "" : "penny-companion-dimmed"}` });

      // Header row: icon + name + status badge
      const header = card.createDiv({ cls: "penny-companion-header" });
      const titleWrap = header.createDiv({ cls: "penny-companion-title-wrap" });
      titleWrap.createSpan({ cls: "penny-companion-name", text: c.name });
      titleWrap.createSpan({
        cls: `penny-companion-badge ${installed ? "penny-badge-installed" : "penny-badge-missing"}`,
        text: installed ? "Installed" : "Not installed",
      });

      // Description
      card.createEl("p", { cls: "penny-companion-desc", text: c.desc });

      // Action buttons
      const actions = card.createDiv({ cls: "penny-companion-actions" });

      if (installed && c.configure) {
        const configBtn = actions.createEl("button", { text: "Auto-configure", cls: "mod-cta" });
        configBtn.addEventListener("click", () => c.configure!(card));
      }

      if (!installed) {
        const installLink = actions.createEl("a", {
          text: "Install from Community Plugins",
          cls: "penny-companion-link",
          href: c.url,
        });
        installLink.addEventListener("click", (e) => {
          e.preventDefault();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).open(c.url);
        });
      }
    }
  }

  /**
   * Write PENNY slash commands into Slash Commander's config.
   */
  private async configureSlashCommander(card: HTMLElement): Promise<void> {
    try {
      const configPath = `${this.app.vault.configDir}/plugins/slash-commander/data.json`;
      const raw = await this.app.vault.adapter.read(configPath);
      const config = JSON.parse(raw);

      if (!Array.isArray(config.bindings)) {
        config.bindings = [];
      }

      // Remove existing PENNY bindings to avoid duplicates
      config.bindings = config.bindings.filter(
        (b: { action?: string }) => !b.action?.startsWith("penny:")
      );

      // Add PENNY commands
      for (const cmd of PennySettingTab.PENNY_COMMANDS) {
        config.bindings.push({
          name: cmd.name,
          id: cmd.id,
          action: cmd.id,
          icon: cmd.icon,
          mode: "editing",
          triggerMode: "anywhere",
        });
      }

      await this.app.vault.adapter.write(configPath, JSON.stringify(config, null, 2));
      new Notice("PENNY commands added to Slash Commander. Reload the plugin to apply.");

      // Show success inline
      const msg = card.createDiv({ cls: "penny-companion-success" });
      msg.setText("Configured! Reload Slash Commander to apply.");
    } catch (e) {
      new Notice(`Failed to configure Slash Commander: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Write PENNY toolbar submenu into Editing Toolbar's config.
   */
  private async configureEditingToolbar(card: HTMLElement): Promise<void> {
    try {
      const configPath = `${this.app.vault.configDir}/plugins/editing-toolbar/data.json`;
      const raw = await this.app.vault.adapter.read(configPath);
      const config = JSON.parse(raw);

      if (!Array.isArray(config.menuCommands)) {
        config.menuCommands = [];
      }

      // Remove existing PENNY submenu to avoid duplicates
      config.menuCommands = config.menuCommands.filter(
        (c: { id?: string }) => c.id !== "SubmenuCommands-penny"
      );

      // Build PENNY submenu
      const pennySubmenu = {
        id: "SubmenuCommands-penny",
        name: "PENNY",
        icon: "pen-tool",
        SubmenuCommands: PennySettingTab.PENNY_COMMANDS.map((cmd) => ({
          id: cmd.id,
          name: cmd.name,
          icon: cmd.icon,
        })),
      };

      config.menuCommands.push(pennySubmenu);

      await this.app.vault.adapter.write(configPath, JSON.stringify(config, null, 2));
      new Notice("PENNY submenu added to Editing Toolbar. Reload the plugin to apply.");

      const msg = card.createDiv({ cls: "penny-companion-success" });
      msg.setText("Configured! Reload Editing Toolbar to apply.");
    } catch (e) {
      new Notice(`Failed to configure Editing Toolbar: ${e instanceof Error ? e.message : String(e)}`);
    }
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
