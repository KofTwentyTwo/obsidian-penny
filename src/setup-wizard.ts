/**
 * PENNY - First-Run Setup Wizard
 *
 * A multi-step modal that guides new users through initial configuration.
 * Triggered on first load when no provider API key is configured.
 * Steps: Welcome -> Provider -> Project Structure -> Done.
 */

import { Modal, Setting, TFolder } from "obsidian";
import type PennyPlugin from "./main";
import type { PennySettings } from "./types";

type Step = "welcome" | "provider" | "structure" | "done";

const STEPS: Step[] = ["welcome", "provider", "structure", "done"];
const STEP_TITLES: Record<Step, string> = {
  welcome: "Welcome to PENNY",
  provider: "Choose Your LLM Provider",
  structure: "Project Structure",
  done: "You're All Set",
};

export class SetupWizardModal extends Modal {
  private plugin: PennyPlugin;
  private currentStep: Step = "welcome";
  private selectedProvider = "anthropic";

  constructor(plugin: PennyPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.modalEl.addClass("penny-wizard-modal");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Progress indicator
    const progress = contentEl.createDiv({ cls: "penny-wizard-progress" });
    const stepIdx = STEPS.indexOf(this.currentStep);
    for (let i = 0; i < STEPS.length; i++) {
      const dot = progress.createSpan({
        cls: `penny-wizard-dot ${i === stepIdx ? "penny-wizard-dot-active" : ""} ${i < stepIdx ? "penny-wizard-dot-done" : ""}`,
      });
      dot.setText(String(i + 1));
      if (i < STEPS.length - 1) {
        progress.createSpan({
          cls: `penny-wizard-line ${i < stepIdx ? "penny-wizard-line-done" : ""}`,
        });
      }
    }

    // Step title
    contentEl.createEl("h2", {
      text: STEP_TITLES[this.currentStep],
      cls: "penny-wizard-title",
    });

    // Step content
    const body = contentEl.createDiv({ cls: "penny-wizard-body" });
    switch (this.currentStep) {
      case "welcome": this.renderWelcome(body); break;
      case "provider": this.renderProvider(body); break;
      case "structure": this.renderStructure(body); break;
      case "done": this.renderDone(body); break;
    }

    // Navigation buttons
    const nav = contentEl.createDiv({ cls: "penny-wizard-nav" });
    if (stepIdx > 0 && this.currentStep !== "done") {
      const backBtn = nav.createEl("button", { text: "Back" });
      backBtn.addEventListener("click", () => {
        this.currentStep = STEPS[stepIdx - 1];
        this.render();
      });
    } else {
      nav.createDiv(); // spacer
    }

    if (this.currentStep === "done") {
      const doneBtn = nav.createEl("button", { text: "Start Writing", cls: "mod-cta" });
      doneBtn.addEventListener("click", () => this.close());
    } else {
      const skipBtn = nav.createEl("button", { text: "Skip Setup" });
      skipBtn.addEventListener("click", () => {
        this.plugin.settings.setupComplete = true;
        this.plugin.saveSettings();
        this.close();
      });

      const nextBtn = nav.createEl("button", { text: "Next", cls: "mod-cta" });
      nextBtn.addEventListener("click", () => {
        this.currentStep = STEPS[stepIdx + 1];
        this.render();
      });
    }
  }

  private renderWelcome(container: HTMLElement): void {
    container.createEl("p", {
      text: "PENNY is your AI prose co-author. It reads editorial annotations in your chapters, processes them through an LLM with your project's voice rules and context, and writes revised versions.",
    });

    const steps = container.createEl("div", { cls: "penny-wizard-checklist" });
    const items = [
      ["1", "Connect an LLM provider", "Anthropic Claude, OpenAI, Google Gemini, or local Ollama"],
      ["2", "Set your project folders", "Where your drafts, characters, and style guide live"],
      ["3", "Start annotating", "Add %% REWRITE: instructions %% to your prose and let PENNY revise"],
    ];
    for (const [num, title, desc] of items) {
      const item = steps.createDiv({ cls: "penny-wizard-check-item" });
      item.createSpan({ cls: "penny-wizard-check-num", text: num });
      const text = item.createDiv();
      text.createEl("strong", { text: title });
      text.createEl("span", { text: " -- " + desc, cls: "setting-item-description" });
    }
  }

  private renderProvider(container: HTMLElement): void {
    container.createEl("p", {
      text: "Which LLM provider do you want to use? You can add more later in Settings.",
      cls: "setting-item-description",
    });

    const providers = [
      { id: "anthropic", name: "Anthropic Claude", desc: "Best for prose. Recommended.", badge: "Recommended" },
      { id: "openai", name: "OpenAI", desc: "GPT-4.1 and o3 models.", badge: "" },
      { id: "google", name: "Google Gemini", desc: "Gemini 2.5 Pro and Flash.", badge: "" },
      { id: "ollama", name: "Ollama (Local)", desc: "Free, runs on your machine. Requires Ollama installed.", badge: "Free" },
    ];

    const grid = container.createDiv({ cls: "penny-wizard-provider-grid" });
    for (const p of providers) {
      const card = grid.createDiv({
        cls: `penny-wizard-provider-card ${this.selectedProvider === p.id ? "penny-wizard-provider-selected" : ""}`,
      });
      card.addEventListener("click", () => {
        this.selectedProvider = p.id;
        this.render();
      });

      const header = card.createDiv({ cls: "penny-wizard-provider-header" });
      header.createSpan({ text: p.name, cls: "penny-wizard-provider-name" });
      if (p.badge) {
        header.createSpan({ text: p.badge, cls: "penny-wizard-provider-badge" });
      }
      card.createEl("span", { text: p.desc, cls: "setting-item-description" });
    }

    // API key input for the selected provider
    if (this.selectedProvider !== "ollama") {
      const keyLabel = this.selectedProvider === "anthropic" ? "Anthropic"
        : this.selectedProvider === "openai" ? "OpenAI"
        : "Google";

      new Setting(container)
        .setName(`${keyLabel} API key`)
        .setDesc("Stored locally on your device. Never sent anywhere except the provider's API.")
        .addText((text) =>
          text
            .setPlaceholder(`Paste your ${keyLabel} API key`)
            .setValue(this.getApiKey())
            .then((t) => {
              t.inputEl.type = "password";
              t.inputEl.style.width = "350px";
            })
            .onChange(async (value) => {
              this.setApiKey(value.trim());
              await this.plugin.saveSettings();
            })
        );
    } else {
      new Setting(container)
        .setName("Ollama endpoint")
        .setDesc("URL of your local Ollama instance. Default works if Ollama is running.")
        .addText((text) =>
          text
            .setPlaceholder("http://localhost:11434")
            .setValue(this.plugin.settings.ollamaEndpoint)
            .then((t) => { t.inputEl.style.width = "350px"; })
            .onChange(async (value) => {
              this.plugin.settings.ollamaEndpoint = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }
  }

  private renderStructure(container: HTMLElement): void {
    container.createEl("p", {
      text: "Where are your project files? PENNY uses these paths to load context (characters, style guide, plot outlines) when revising your prose.",
      cls: "setting-item-description",
    });

    // Auto-detect common structures
    const detected = this.detectFolders();
    if (detected.length > 0) {
      const tip = container.createDiv({ cls: "penny-wizard-detected" });
      tip.createEl("strong", { text: "Detected project folders:" });
      const list = tip.createEl("ul");
      for (const d of detected) {
        list.createEl("li", { text: `${d.label}: ${d.path}` });
      }
    }

    const paths: Array<{ key: keyof PennySettings; label: string; placeholder: string }> = [
      { key: "draftsFolder", label: "Drafts folder", placeholder: "04-drafts" },
      { key: "characterSheetsFolder", label: "Characters folder", placeholder: "02-characters" },
      { key: "styleGuide", label: "Style guide", placeholder: "06-reference/style-guide.md" },
      { key: "plotOutlinesFolder", label: "Plot outlines", placeholder: "03-plot" },
    ];

    for (const p of paths) {
      new Setting(container)
        .setName(p.label)
        .addText((text) =>
          text
            .setPlaceholder(p.placeholder)
            .setValue(String(this.plugin.settings[p.key] || ""))
            .then((t) => { t.inputEl.style.width = "300px"; })
            .onChange(async (value) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (this.plugin.settings as any)[p.key] = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    container.createEl("p", {
      text: "You can change all paths later in Settings > PENNY > Project Structure.",
      cls: "setting-item-description",
      attr: { style: "margin-top: 12px; font-style: italic;" },
    });
  }

  private renderDone(container: HTMLElement): void {
    const summary = container.createDiv({ cls: "penny-wizard-summary" });

    const providerName = this.selectedProvider === "anthropic" ? "Anthropic Claude"
      : this.selectedProvider === "openai" ? "OpenAI"
      : this.selectedProvider === "google" ? "Google Gemini"
      : "Ollama (local)";

    const hasKey = this.selectedProvider === "ollama" || this.getApiKey().length > 0;

    summary.createEl("p", { text: `Provider: ${providerName} ${hasKey ? "" : "(no API key set yet)"}` });

    container.createEl("h3", { text: "Quick Start" });

    const tips = container.createEl("div", { cls: "penny-wizard-checklist" });
    const quickSteps = [
      ["1", "Open a chapter file", "Any .md file in your drafts folder"],
      ["2", "Add an annotation", "Type: %% REWRITE: your instruction here %%"],
      ["3", "Run PENNY", "Cmd/Ctrl+Shift+P or right-click > PENNY: Process this chapter"],
      ["4", "Check the output", "PENNY creates a new version file with the revision"],
    ];
    for (const [num, title, desc] of quickSteps) {
      const item = tips.createDiv({ cls: "penny-wizard-check-item" });
      item.createSpan({ cls: "penny-wizard-check-num", text: num });
      const text = item.createDiv();
      text.createEl("strong", { text: title });
      text.createEl("span", { text: " -- " + desc, cls: "setting-item-description" });
    }

    container.createEl("p", {
      text: "For multi-paragraph targets, wrap text in {{ }} markers. See Commands Reference in settings for all annotation types.",
      cls: "setting-item-description",
      attr: { style: "margin-top: 12px;" },
    });

    // Mark setup as complete
    this.plugin.settings.setupComplete = true;
    this.plugin.saveSettings();
  }

  private getApiKey(): string {
    switch (this.selectedProvider) {
      case "anthropic": return this.plugin.settings.anthropicApiKey;
      case "openai": return this.plugin.settings.openaiApiKey;
      case "google": return this.plugin.settings.googleApiKey;
      default: return "";
    }
  }

  private setApiKey(value: string): void {
    switch (this.selectedProvider) {
      case "anthropic": this.plugin.settings.anthropicApiKey = value; break;
      case "openai": this.plugin.settings.openaiApiKey = value; break;
      case "google": this.plugin.settings.googleApiKey = value; break;
    }
  }

  private detectFolders(): Array<{ label: string; path: string }> {
    const found: Array<{ label: string; path: string }> = [];
    const check = (path: string, label: string) => {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFolder) {
        found.push({ label, path });
      }
    };
    check("04-drafts", "Drafts");
    check("02-characters", "Characters");
    check("03-plot", "Plot outlines");
    check("06-reference", "Reference");
    check("01-world", "World-building");
    check("05-wiki", "Wiki");
    // Also check inside series subdirectories
    const root = this.app.vault.getRoot();
    if (root.children) {
      for (const child of root.children) {
        if (child instanceof TFolder) {
          check(`${child.name}/04-drafts`, `Drafts (${child.name})`);
          check(`${child.name}/02-characters`, `Characters (${child.name})`);
        }
      }
    }
    return found;
  }
}
