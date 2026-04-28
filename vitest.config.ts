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
        // Global floor — ratchet only up.
        //
        // After issue #17 (SSE error events): lines 90.93%, statements 89.77%,
        // functions 96.38%, branches 77.54%. The streaming-errors tests
        // exercised the previously-uncovered streaming SSE paths across all
        // four providers, delivering the global-coverage jump that audit
        // issue #41 was scoped for.
        lines: 90,
        statements: 89,
        functions: 96,
        branches: 77,

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
        "src/providers/node-stream.ts": { lines: 95, functions: 100 },
        "src/parser.ts": { lines: 88, functions: 100 },
        "src/reviewer.ts": { lines: 85 },
        "src/context.ts": { lines: 83, functions: 100 },
        "src/assembler.ts": { lines: 81 },
        "src/project-config.ts": { lines: 71 },
      },
    },
  },
});
