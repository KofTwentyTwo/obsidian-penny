# Troubleshooting

Common issues and how to fix them.

## "No API key configured"

**Symptom:** PENNY shows a notice saying no API key is set when you try to process a chapter.

**Fix:**
1. Go to Settings > PENNY > API Settings.
2. Paste your Anthropic API key into the API Key field.
3. The key starts with `sk-ant-`. If your key looks different, it may be from a different provider.
4. Get a key at [console.anthropic.com](https://console.anthropic.com) if you do not have one.

## Authentication Error (401)

**Symptom:** PENNY shows "API Error: 401 Unauthorized" when processing.

**Causes:**
- The API key is invalid, expired, or revoked.
- The key was copied with leading/trailing whitespace.

**Fix:**
1. Go to Settings > PENNY > API Settings.
2. Clear the API Key field completely.
3. Go to [console.anthropic.com](https://console.anthropic.com) > API Keys.
4. Verify your key is active. If in doubt, create a new one.
5. Copy the new key carefully (no extra spaces) and paste it into the settings field.

## "No annotations found"

**Symptom:** PENNY says "No annotations to process" even though you have annotations in the file.

**Common causes:**

**Wrong syntax.** Annotations must use Obsidian's comment syntax with an uppercase tag:
```markdown
%% REWRITE: your instruction here %%
```

Check for:
- Missing `%%` delimiters (need both opening and closing).
- Lowercase tag (`%% rewrite: ... %%` does not work -- must be `%% REWRITE: ... %%`).
- Missing colon after the tag (`%% REWRITE your instruction %%` is invalid).
- Extra spaces inside the delimiters are fine: `%%  REWRITE: instruction  %%` works.

**File not recognized as a chapter.** PENNY only processes files that match the chapter file pattern (default: `ch-*.md`) inside the configured drafts folder.

Check:
- Is the file inside the drafts folder path configured in settings?
- Does the filename match the chapter file pattern?
- If you use a non-standard naming convention, update the Chapter File Pattern in settings.

**All annotations already processed.** If you ran PENNY on this file before with the same annotations, they are recorded in `.state.json` and will be skipped. Check the `.state.json` file in the chapter folder. If you want to reprocess, delete `.state.json` or modify the annotation text.

## Rate Limit Error (429)

**Symptom:** PENNY shows "API Error: 429 Too Many Requests" or "Rate limit exceeded."

**Cause:** You have exceeded Anthropic's rate limits for your API tier.

**Fix:**
- Wait a few minutes and try again. Rate limits reset on a rolling window.
- If you are processing many chapters at once (**PENNY: Process all chapters**), try processing one at a time.
- Check your API tier at [console.anthropic.com](https://console.anthropic.com). Higher tiers have higher rate limits.
- Consider using a less expensive model (`claude-sonnet-4-6` or `claude-haiku-3-5`) for bulk work -- they often have higher rate limits.

## Server Error (500, 502, 503)

**Symptom:** PENNY shows "API Error: 500 Internal Server Error" or similar.

**Cause:** A transient error on Anthropic's servers.

**Fix:**
- Wait a minute and try again.
- Check [status.anthropic.com](https://status.anthropic.com) for ongoing incidents.
- If the error persists for more than 15 minutes, the problem is likely on Anthropic's side. Try again later.

PENNY does not modify your chapter when an API error occurs. The original text is preserved, and PENNY inserts an error marker:
```markdown
%% AGENT-ERROR: Failed to process [REWRITE] at line 14. Error: 500 Internal Server Error %%
```

## Overloaded Error (529)

**Symptom:** PENNY shows "API Error: 529 Overloaded."

**Cause:** Anthropic's servers are at capacity.

**Fix:**
- Wait 30-60 seconds and try again.
- Try a different model -- if Opus is overloaded, Sonnet may be available.
- Avoid peak usage times if possible.

## Voice Compliance Flags

**Symptom:** Review notes show voice compliance warnings (internal monologue flags, low dialogue ratio, self-analysis patterns).

**This is not an error.** Compliance flags are informational. They highlight passages in PENNY's output that may not match your style rules.

**How to address:**
1. Read the flagged passages. Decide if they actually violate your voice.
2. If they do, add a new annotation and process again.
3. If compliance flags are consistently wrong (flagging things that are fine), your voice rules may need adjustment. Make the rules more specific or add exceptions.
4. If PENNY consistently generates prose that triggers compliance flags, your voice tests may not be clear enough. Add better examples of the correct approach.

## Chapters Not Detected

**Symptom:** **PENNY: Process all chapters** does not find any chapters, or the status bar shows "No chapter detected."

**Check:**
1. **Drafts folder path.** Is it set correctly in Settings > PENNY? The path is relative to the vault root.
2. **Chapter file pattern.** Default is `ch-*.md`. If your chapters are named differently (e.g., `chapter-01.md`), update the pattern in settings.
3. **Folder structure.** Chapters should be in book subfolders inside the drafts folder: `04-drafts/book-1/ch-01/ch-01.v1.md`. If chapters are not in versioned folders, run **PENNY: Migrate chapters** first.
4. **Active file location.** For **Process this chapter**, the file must be inside the configured drafts folder and match the chapter pattern.

## Git Errors

### "Not a git repository"

**Cause:** Your vault is not initialized as a git repository.

**Fix:** Open a terminal in your vault folder and run:
```bash
git init
```

Or, if you do not want to use git, you can ignore this message. Git features are optional.

### "Nothing to commit"

**Cause:** No files have changed since the last commit.

**Fix:** This is normal if you have already committed recent changes. Process a chapter first, then commit.

### "Push rejected"

**Cause:** The remote has changes that are not in your local repository.

**Fix:** Open a terminal in your vault folder and run:
```bash
git pull
```

Resolve any conflicts, then try **PENNY: Push** again.

PENNY does not pull automatically because it avoids destructive or surprising operations.

### "No remote configured"

**Cause:** Your git repository does not have a remote set up.

**Fix:** Add a remote:
```bash
git remote add origin https://github.com/your-username/your-vault.git
```

## Plugin Not Loading

**Symptom:** PENNY does not appear in the command palette or settings.

**Check:**
1. **Obsidian version.** PENNY requires Obsidian 1.5.0 or later. Check Help > About.
2. **Desktop only.** PENNY does not work on Obsidian Mobile (iOS/Android). It requires Node.js for git operations.
3. **Plugin enabled.** Go to Settings > Community plugins. Verify PENNY is in the list and toggled on.
4. **Plugin files.** Check `.obsidian/plugins/penny/`. It should contain `main.js`, `manifest.json`, and `styles.css`. If any file is missing, reinstall.
5. **Console errors.** Open the developer console (Ctrl/Cmd + Shift + I) and check for errors mentioning "penny." If there are errors, note the message and check the [GitHub issues](https://github.com/KofTwentyTwo/obsidian-penny/issues).
6. **Restart Obsidian.** Sometimes a full restart (not just reload) is needed after installation.

## Processing Takes Too Long

**Symptom:** PENNY seems stuck on "processing..." for more than 2 minutes per annotation.

**Causes:**
- Large context size (many character sheets, long style guide, long chapter).
- Using Opus model (slower but higher quality).
- Anthropic API latency.

**Fix:**
- Check the status bar -- it updates with progress. If it is advancing, PENNY is working.
- Try a faster model (`claude-sonnet-4-6` or `claude-haiku-3-5`) for routine work.
- Reduce context budget in settings. A smaller budget means less context per call but faster responses.
- Process fewer annotations per pass. If a chapter has 15 annotations, process it in batches.

## Unexpected Revision Output

**Symptom:** PENNY's revision does not match your expectations -- wrong voice, wrong content, wrong length.

**Fix:**
1. **Check your voice tests.** Does the voice test for the relevant character actually demonstrate what you want? PENNY matches what it sees.
2. **Check your instruction.** Vague instructions produce vague results. "Make it better" gives PENNY no direction. Be specific.
3. **Check the review note.** The review note shows what instruction was sent and what came back. This helps diagnose where the disconnect is.
4. **Enable verbose logging** (Settings > PENNY > Verbose Logging). Process the annotation again. Check the activity log to see the full prompt that was sent. This shows you exactly what context PENNY assembled and what instructions it received.
5. **Try a different model.** Opus handles nuanced voice and emotional beats better. Sonnet is faster but may miss subtleties. If you are using Haiku, switch to Sonnet or Opus for voice-critical work.

## "AGENT-ERROR" Markers in Chapter

**Symptom:** Your chapter contains `%% AGENT-ERROR: ... %%` comments.

**Cause:** An API call failed during processing. PENNY inserts these markers so you know which annotations were not processed.

**Fix:**
1. Read the error message in the marker to understand what went wrong.
2. Fix the underlying issue (API key, rate limit, network, etc.).
3. The original annotation is preserved. Run **PENNY: Process this chapter** again and PENNY will retry the failed annotations.
4. Delete the `AGENT-ERROR` markers after successful reprocessing -- they are informational only.
