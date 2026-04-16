# Contributing to PENNY

Thank you for your interest in contributing to PENNY. This guide covers everything you need to get started.

## Table of Contents

- [Development Setup](#development-setup)
- [Architecture Overview](#architecture-overview)
- [Branch Model](#branch-model)
- [Making Changes](#making-changes)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Branch Protection Setup (Maintainers)](#branch-protection-setup-maintainers)

## Development Setup

### Prerequisites

- Node.js 20 or later
- npm
- An Obsidian vault for manual testing
- Git

### Getting Started

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/<your-username>/obsidian-penny.git
cd obsidian-penny
npm install

# Start the development build (watches for changes):
npm run dev

# Run the test suite:
npm test

# Run a production build:
npm run build
```

### Testing in Obsidian

1. Build the plugin (`npm run dev` for watch mode, or `npm run build` for a one-off build).
2. Copy or symlink `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/penny/` directory.
3. Reload Obsidian (Ctrl/Cmd + R) and enable PENNY in Settings > Community Plugins.

## Architecture Overview

PENNY separates pure logic from the Obsidian runtime shell:

```
src/
  core/           Pure-logic modules (no Obsidian imports)
    annotations/    Annotation parsing, classification, scope detection
    versioning/     Chapter version management, idempotency
    routing/        Complexity scoring, model tier assignment
    voice/          Voice compliance checking
    providers/      LLM provider abstraction (Anthropic, Ollama)
    config/         Configuration loading, PENNY.md parsing
    git/            Git operations (commit message generation, staging)
  shell/          Obsidian-specific code
    plugin.ts       Main plugin class, command registration
    settings.ts     Settings tab UI
    commands/       Command implementations that bridge core <-> Obsidian
```

**Key principle:** Modules under `src/core/` must never import from `obsidian`. They receive all Obsidian-specific data (file contents, paths, settings) through function parameters. This keeps the core testable without mocking Obsidian APIs.

**Provider abstraction:** All LLM calls go through a provider interface. Adding a new provider means implementing the interface and registering it -- no changes to annotation processing or routing logic.

## Branch Model

- **`main`** -- Release branch. Protected. Only receives merges from `develop` via pull request. Every merge to `main` is a release.
- **`develop`** -- Integration branch. This is the default branch. All feature and fix branches merge here first.
- **Feature branches** -- Branch from `develop`, named `feature/<short-description>` or `fix/<short-description>`.

```
main -------- release tags
  \
   develop -- integration
     \
      feature/my-feature
```

## Making Changes

1. Fork the repository.
2. Create a branch from `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/my-feature
   ```
3. Make your changes.
4. Write or update tests.
5. Ensure all tests pass: `npm test`
6. Ensure the build succeeds: `npm run build`
7. Commit using conventional commit format (see below).
8. Push to your fork and open a pull request against `develop`.

## Code Style

- **TypeScript strict mode.** The `tsconfig.json` enforces strict checks. Do not weaken them.
- **No `any`.** Use proper types. If you need a flexible type, use `unknown` and narrow it.
- **Pure functions where possible.** Functions in `src/core/` should take inputs and return outputs without side effects. Side effects belong in `src/shell/`.
- **No Obsidian imports in `src/core/`.** This is a hard boundary. If you need Obsidian functionality in a core module, pass it as a parameter or callback.
- **Explicit return types** on exported functions.
- **No default exports.** Use named exports.

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Testing Requirements

- All existing tests must pass before submitting a PR.
- New features must include tests.
- Bug fixes should include a regression test.
- Tests live in `test/` and mirror the `src/` directory structure.
- Tests for `src/core/` modules should not require mocking Obsidian APIs (that is the whole point of the architecture split).

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

<optional body>

<optional footer>
```

### Types

| Type       | When to use                                      |
|------------|--------------------------------------------------|
| `feat`     | New feature                                      |
| `fix`      | Bug fix                                          |
| `docs`     | Documentation only                               |
| `style`    | Formatting, no logic change                      |
| `refactor` | Code restructuring, no feature or fix            |
| `test`     | Adding or updating tests                         |
| `chore`    | Build, CI, tooling, dependency updates           |

### Examples

```
feat(annotations): add RESEARCH annotation type
fix(versioning): handle chapters with no existing versions
docs: update annotation guide with RESEARCH examples
test(routing): add coverage for edge-case complexity scores
chore(ci): add CircleCI type-check step
```

## Pull Request Process

1. Open your PR against `develop` (not `main`).
2. Fill out the PR template completely.
3. Ensure CI passes (type check, tests, build).
4. Request review from a maintainer.
5. Address review feedback. Push new commits (do not force-push during review).
6. Once approved, a maintainer will merge.

### PR Checklist

- [ ] Branch is based on `develop`
- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No `any` types introduced
- [ ] No Obsidian imports in `src/core/`
- [ ] New features have tests
- [ ] Documentation updated if needed
- [ ] Commit messages follow conventional format

## Branch Protection Setup (Maintainers)

The following commands configure branch protection and the default branch. These require admin access to the repository and should be run once during initial setup:

```bash
# Protect the main branch: require status checks, enforce on admins, require 1 approving review
gh api repos/KofTwentyTwo/obsidian-penny/branches/main/protection \
  -X PUT \
  -f required_status_checks='{"strict":true,"contexts":["test"]}' \
  -f enforce_admins=true \
  -f required_pull_request_reviews='{"required_approving_review_count":1}' \
  -f restrictions=null

# Set develop as the default branch
gh api repos/KofTwentyTwo/obsidian-penny -X PATCH -f default_branch=develop
```

## Questions?

Open a [discussion](https://github.com/KofTwentyTwo/obsidian-penny/discussions) or reach out via an issue. We are happy to help you get oriented.
