import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      // Shell modules and pure-type files are excluded from threshold gating.
      // The pure-logic / Obsidian-shell import boundary in this codebase makes
      // these inherently hard to test without Obsidian mocking infrastructure.
      // See audit issues #7 (split commands.ts) and #39 (extract testable
      // logic from commands.ts) for the path to bringing these into coverage.
      exclude: [
        "src/main.ts",
        "src/commands.ts",
        "src/settings.ts",
        "src/setup-wizard.ts",
        "src/*-modal.ts",
        "src/statusbar.ts",
        "src/types.ts",
        "src/logger.ts",
      ],
      thresholds: {
        // Global floor — ratchet only up. Every PR that adds tests should
        // raise these toward 90% as actual coverage rises. The bulk of the
        // gap to 90% is in the four providers' streaming SSE paths; closing
        // audit issue #41 brings global coverage to ~90% in one shot.
        //
        // Baseline as of 2026-04-27:
        //   lines 81.88%, statements 81.28%, functions 91.25%, branches 69.26%
        lines: 81,
        statements: 80,
        functions: 91,
        branches: 69,

        // Per-file ratchets — each module locked at or just below its current
        // coverage so it cannot regress. When tests rise, raise the lock here
        // in the same PR. Modules at 100% are pinned at 100%.
        "src/versioner.ts": { lines: 100, functions: 100 },
        "src/migrate.ts": { lines: 100, functions: 100 },
        "src/drafter.ts": { lines: 100, functions: 100 },
        "src/progress-modal-state.ts": { lines: 100, functions: 100 },
        "src/utils.ts": { lines: 100, functions: 100 },
        "src/quotes.ts": { lines: 100, functions: 100 },
        "src/providers/registry.ts": { lines: 100, functions: 100 },
        "src/providers/router.ts": { lines: 100, functions: 100 },
        "src/providers/index.ts": { lines: 100, functions: 100 },
        "src/providers/service.ts": { lines: 100, functions: 100 },
        "src/frontmatter.ts": { lines: 97, functions: 100 },
        "src/pipeline.ts": { lines: 95, functions: 87 },
        "src/providers/node-stream.ts": { lines: 93, functions: 100 },
        "src/parser.ts": { lines: 88, functions: 100 },
        "src/reviewer.ts": { lines: 85 },
        "src/context.ts": { lines: 83, functions: 100 },
        "src/assembler.ts": { lines: 81 },
        "src/project-config.ts": { lines: 71 },
      },
    },
  },
});
