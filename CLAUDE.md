# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PENNY is an Obsidian community plugin that processes editorial annotations (`%% REWRITE: ... %%`, `%% TONE: ... %%`, etc.) inside novel chapter markdown, calls an LLM to revise the surrounding prose, and writes a new versioned chapter file alongside a review note. It supports Anthropic Claude, Ollama (local), Google Gemini, and OpenAI as providers, with per-tag complexity-tier model routing. Desktop-only (uses Node.js `child_process` for git).

## Common commands

```bash
npm install            # install deps
npm run dev            # esbuild watch mode -> writes main.js at repo root
npm run build          # tsc --noEmit + production esbuild bundle (also auto-deploys, see below)
npm run typecheck      # tsc --noEmit
npm run lint           # alias for typecheck (no separate eslint script in package.json; eslint config exists)
npm test               # vitest run
npm run test:watch     # vitest watch
npm run test:coverage  # vitest run --coverage (text + json-summary reporters)
```

Run a single test file: `npx vitest run test/parser.test.ts`
Run a single test by name: `npx vitest run -t "parses REWRITE annotation"`

### Build auto-deploy quirk

`npm run build` (production) inspects `../Books/.obsidian/plugins/penny/` and, if the directory exists, copies `main.js`, `styles.css`, and `manifest.json` into it (see `esbuild.config.mjs:48-54`). This is a developer convenience for the maintainer's local vault — do not assume the path exists in CI or for contributors. To test in your own vault, copy or symlink those three files into `<your-vault>/.obsidian/plugins/penny/` manually.

## Architecture

### The hard rule: pure-logic vs Obsidian-shell

The code splits into two zones by **what they import**:

- **Pure-logic modules** (no `obsidian` import, take pre-read strings/objects as parameters):
  `parser.ts`, `pipeline.ts`, `assembler.ts`, `drafter.ts`, `versioner.ts`, `frontmatter.ts`, `context.ts`, `reviewer.ts`, `voice-check.ts`, `logger.ts`, `migrate.ts`, `project-config.ts`, `quotes.ts`, `utils.ts`, `types.ts`, and everything under `src/providers/`.
- **Obsidian-shell modules** (free to use Obsidian APIs):
  `main.ts`, `commands.ts`, `settings.ts`, `setup-wizard.ts`, `statusbar.ts`, `progress-modal.ts`, `error-modal.ts`, `file-conflict-modal.ts`.

`commands.ts` is the bridge: it reads files via the vault API, calls `runPipeline()` from `pipeline.ts` with everything pre-loaded, then writes results back. **Never add `import { ... } from "obsidian"` to a pure-logic module** — that breaks the test architecture (vitest tests for pure modules do not mock Obsidian).

CONTRIBUTING.md describes a `src/core/` + `src/shell/` directory split, but the codebase is currently a flat `src/` with only `src/providers/` as a subfolder. The boundary is enforced by import discipline, not directory layout.

### Pipeline flow (the heart of the plugin)

1. User runs **PENNY: Process this chapter** (or save hook fires).
2. `commands.ts` reads the chapter, `.version`, `.state.json`, and all context files (style guide, voice tests, characters, outline, wiki) from the vault.
3. It calls `runPipeline()` (`src/pipeline.ts`) with that input plus a `getProvider` lookup callback.
4. The pipeline parses annotations (`parser.ts`), filters out already-processed ones via a content hash stored in `.state.json` (`versioner.ts`), assembles per-annotation context (`context.ts`), builds prompts and calls the LLM (`drafter.ts`), then assembles the final new chapter (`assembler.ts`), updates frontmatter (`frontmatter.ts`), runs voice compliance (`voice-check.ts`), and generates a review note (`reviewer.ts`).
5. `commands.ts` writes the new version file (`ch-05.v2.md`), updates `.version` / `.state.json`, writes the review file, and appends to the activity log.

The pipeline emits real-time `ProgressEvent`s (consumed by `progress-modal.ts`) and supports cancellation via an `isCancelled()` callback.

### Provider system

Four providers live in `src/providers/`: `anthropic.ts`, `ollama.ts`, `google.ts`, `openai.ts`. They all implement the `LLMService` interface from `service.ts` and **do not import `obsidian`**. Instead, they receive an `HttpFn` at construction time. `main.ts` adapts Obsidian's `requestUrl` into that shape:

```ts
this.providerRegistry = createRegistry(async (params) => {
  const resp = await requestUrl({...});
  return { status, headers, text, json };
});
```

This is why provider tests can mock the HTTP layer directly without any Obsidian shim.

`router.ts` maps annotation tags to complexity tiers (light/standard/heavy) and resolves each tier to a configured provider+model. The `"auto-latest"` model literal is resolved at call-time to the currently-recommended Anthropic model for that tier.

### Versioning model

Each chapter folder contains:
- `ch-NN.v1.md`, `ch-NN.v2.md`, ... — successive versions, never overwritten
- `.version` — plain integer of current version
- `.state.json` — `VersionState` tracking content hashes of already-processed annotations (idempotency)

A processing run that finds zero new annotations writes nothing. Annotation hashes mean re-running on the same file is a no-op even after a crash.

### Settings + per-project overrides

Settings live in Obsidian's `data.json` (loaded in `main.ts:loadSettings`, with legacy field migration via `migrateSettings` in `types.ts`). A project may override a subset by adding a `PENNY.md` at the book folder root — see `project-config.ts`. The settings tab is `settings.ts`; first-run UX is `setup-wizard.ts`.

### Save-hook debouncing

When `autoProcessOnSave` is on, `main.ts` registers a `vault.on("modify")` handler with a per-file 2-second debounce and a `processingFiles: Set<string>` re-entrancy guard. Without both, processing-induced file writes would cascade into infinite re-triggers. If you touch this code, preserve those guards.

## Code conventions

From `CONTRIBUTING.md` and `tsconfig.json` (strict mode, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`):

- **No `any`.** ESLint warns on `@typescript-eslint/no-explicit-any`. Prefer `unknown` and narrow.
- **Named exports only**, no default exports (the one exception is `class PennyPlugin extends Plugin` in `main.ts`, which Obsidian's plugin loader requires as default).
- **Explicit return types** on exported functions.
- **Pure functions in pure-logic modules**: take inputs, return outputs, no side effects. Side effects (vault I/O, network, child_process) belong in shell modules.
- TypeScript target is ES2018; bundled as CJS for Obsidian.

## Testing

- Tests live in `test/` and mirror `src/` (e.g. `src/pipeline.ts` ↔ `test/pipeline-cancel.test.ts`).
- Pure-logic tests **must not** mock Obsidian — that is the whole point of the import boundary. If a test wants to drive the pipeline, it constructs `PipelineInput` directly with raw strings.
- Provider tests mock the injected `HttpFn`, not network or Obsidian.
- Test fixtures (style guide, voice tests, sample chapter) are in `test/fixtures/`.

## Branch model

- **`develop`** — default branch, integration target for all PRs.
- **`main`** — release branch, only receives merges from `develop`.
- Feature branches: `feature/<short-description>` or `fix/<short-description>`, branched from `develop`.

Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## CI

CircleCI with the `kof22/munitor` orb (see `.circleci/config.yml` and `.munitor.yml`). The pipeline runs `npm run build` and `npm test`, plus SAST and SBOM. There is no separate ESLint job — `npm run lint` is aliased to `tsc --noEmit`, so type errors block CI but ESLint warnings do not.
