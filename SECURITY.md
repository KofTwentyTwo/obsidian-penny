# Security Policy

## Supported Versions

Only the latest released version of PENNY receives security updates.

| Version | Supported          |
|---------|--------------------|
| Latest  | Yes                |
| Older   | No                 |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please use one of the following methods:

1. **GitHub Security Advisories (preferred):** Go to the [Security tab](https://github.com/KofTwentyTwo/obsidian-penny/security/advisories) and click "Report a vulnerability." This creates a private channel between you and the maintainers.

2. **Email:** Send details to **james@koftwentytwo.com** with the subject line `[PENNY Security]`. Include:
   - A description of the vulnerability
   - Steps to reproduce
   - The potential impact
   - Any suggested fix (optional)

## Response Timeline

- **Acknowledgment:** Within 48 hours of receiving the report.
- **Initial assessment:** Within 7 days.
- **Fix or mitigation:** Within 30 days for confirmed vulnerabilities, with a public advisory published alongside the patch release.

If you have not received a response within 48 hours, please follow up.

## API Key and Credential Handling

PENNY stores API keys (Anthropic, Ollama endpoint URLs) in Obsidian's local plugin data store (`data.json` inside `.obsidian/plugins/penny/`). These credentials:

- Are stored only on the user's local machine.
- Are never transmitted to any server other than the LLM provider the user has explicitly configured (Anthropic API or a user-specified Ollama endpoint).
- Are never logged, telemetered, or sent to PENNY's maintainers or any third party.
- Are never included in git commits (the `data.json` file is excluded by `.gitignore`).

Users are responsible for keeping their API keys confidential and rotating them if they suspect compromise.

## Scope

This policy covers the PENNY Obsidian plugin source code and its official releases. It does not cover:

- The Anthropic API or Ollama software (report issues to those projects directly).
- User-created configuration files or vault content.
- Third-party forks or modified builds.
