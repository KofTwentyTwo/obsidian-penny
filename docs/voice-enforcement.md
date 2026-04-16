# Voice Enforcement

Voice is the most important thing PENNY protects. Every revision prompt includes your style guide, voice tests, and custom voice rules. After processing, PENNY checks the output for compliance and flags issues in the review note.

## What Voice Enforcement Means

PENNY does not just rewrite passages -- it rewrites them *in your voice*. This requires three things:

1. **A style guide** that defines your prose rules (POV, tense, register, things to avoid).
2. **Voice tests** -- example passages that demonstrate what your prose should sound like.
3. **Voice rules** -- specific, enforceable rules that PENNY checks against.

The more clearly you define your voice, the better PENNY matches it.

## Writing a Style Guide PENNY Can Use

Your style guide lives at whatever path you configure in settings (default: `06-reference/style-guide.md`). PENNY loads the entire file into every revision prompt.

### What to include:

**Point of view and tense:**
```markdown
## Point of View
First person. Past tense.
```

**Register (how the narrator sounds):**
```markdown
## Register
Conversational. Technical terms used casually. Dry humor that the narrator
doesn't recognize as humor. Not literary-precious. Not YA-perky. How a smart
19-year-old actually talks.
```

**Sentence-level rules:**
```markdown
## Sentence Craft
- Short to medium sentences. Longer when she's on a roll.
- Fragments are fine. She thinks in bursts.
- Technical terms without explanation. The reader learns from context.
- Paragraph breaks are beats. White space is pacing.
```

**Dialogue conventions:**
```markdown
## Dialogue Style
- Each character has a distinct voice dynamic with the narrator.
- Tim: banter, redirect, slow vs. fast friction.
- Darin: clipped technical shorthand, loaded silences.
```

**Things to avoid (critical for PENNY):**
```markdown
## Things to Avoid
- Internal monologue (hard rule, not preference)
- The narrator knowing she's funny
- Emotion words to describe emotions ("she felt sad")
- Literary-fiction introspection
- The word "suddenly"
- Adverbs in dialogue attribution
```

The "Things to Avoid" section is particularly important. PENNY uses this to flag violations in voice compliance checks.

### Tips for effective style guides:

- **Be concrete.** "Write well" is useless. "Short sentences, no adverbs on dialogue tags, fragments are fine" is actionable.
- **Give examples.** For each rule, one good example and one bad example helps PENNY understand the boundary.
- **Name what's forbidden.** PENNY is better at avoiding things you explicitly name than inferring what you do not want.
- **Keep it under 2,000 words.** Longer style guides dilute the signal. Focus on the rules that matter most.

## Creating Voice Tests

Voice tests are example passages that show PENNY exactly what your prose sounds like. They are the gold standard. PENNY loads the relevant section into every revision prompt and uses it as a reference.

Your voice tests file lives at whatever path you configure in settings (default: `06-reference/voice-tests.md`).

### Structure:

Organize voice tests by character or situation. PENNY matches sections to the characters in the current scene.

```markdown
# Voice Tests

## Protagonist Solo (with Rabbit)

"Okay, Rabbit. Here's the thing about garbage collection."

I set my coffee down. Chairman Meow was sitting on Rabbit again, which
was disrespectful to both the dead and the debugging process, but I'd
learned to pick my battles.

"The runtime decides something isn't needed anymore, and it just...
removes it. No ceremony. No exit code. The memory is marked as free
and whatever was there is gone."

I pulled Chairman Meow off Rabbit's head. He gave me a look that said
my priorities were wrong.

"But here's what's weird. My program isn't leaking. It's not abandoned
memory. Something is actively deciding it's too big and killing it.
That's not garbage collection. That's..."

I stopped. I heard what I was about to say.

"That's murder, Rabbit. That's murder with a policy."

## Protagonist with Tim

"You need to eat something that isn't coffee."

"Coffee is a food group."

"It is not a food group."

"It contains water, which is essential for life, and caffeine, which
is essential for me. Two essentials. That's more than most food groups
can claim."

Tim did the thing where he just looks at you until you hear yourself.

"Fine. But if the bread is bad I'm leaving."

"The bread is never bad. This is the place on Green Street."

"The place on Green Street has acceptable bread."

## Protagonist with Darin

Three seconds of nothing on the call. Darin-silence. Which meant he
was seventeen steps deep and language would only slow him down.

"Run it again," he said.

I ran it again. Fourteen minutes and six seconds. Last time was
thirteen-twelve.

"It's growing."

"The interval is growing," I said. "Not the program. The program hits
the same size every time. But whatever catches it is taking longer to
notice."

More Darin-silence. Then: "What if it's not watching the clock. What
if it's watching the footprint."

Something happened in my chest. The feeling you get when two pieces
snap together and the whole picture shifts.

"Cut the allocation in half," I said.
```

### Tips for voice tests:

- **Use your best writing.** These are the passages you are most proud of. They set the ceiling.
- **Cover each major character dynamic.** PENNY needs to know how your narrator sounds with each important character.
- **Include at least one passage per character.** More is better, but one strong passage beats five weak ones.
- **Show, don't describe.** Do not explain the voice. Demonstrate it.
- **Lock them.** Once your voice tests are working, do not change them lightly. They are the foundation PENNY builds on.

## Writing Custom Voice Rules

Voice rules go in either the plugin settings (Settings > PENNY > Voice Rules) or in your `PENNY.md` file under the `## Voice Rules` section. They are injected into the "CRITICAL VOICE RULES" section of every revision prompt.

Write them as a bulleted list of specific, enforceable rules:

```markdown
- No internal monologue. She does not think in narrated sentences.
  Every scene is dialogue -- with people or with Rabbit.
- She is never named. No character addresses her by name.
- She does not describe emotions with emotion words. Physical sensations
  or subject changes only.
- Humor is structural. The gap between her sincerity and the situation.
  She never knows she is funny. She never winks at the reader.
- Technical terms used casually. Never explained to the reader. Context
  teaches.
- Each friend has a distinct voice dynamic. Tim scenes sound different
  from Darin scenes sound different from Tyler scenes.
```

### Genre-specific examples:

**Thriller:**
```markdown
- Maximum two sentences per paragraph in action scenes.
- Dialogue attribution: "said" and "asked" only. No adverbs.
- Every chapter ends on unresolved tension.
- Interior thoughts are short, clipped, tactical.
```

**Literary fiction:**
```markdown
- Metaphors from the natural world. No pop-culture references.
- Sentences can be long if they earn their length. Short if they cut.
- Interiority is the point. Go deep. Stay close to the character's consciousness.
- Dialogue is sparse. What is unsaid matters more than what is said.
```

**Fantasy:**
```markdown
- No modern idioms. The register is formal but not archaic.
- Magic has rules. Describe the cost before the effect.
- Proper nouns for invented terms. Never in italics after first use.
- Battle scenes: specific and spatial. The reader should be able to draw a map.
```

## How Context Loading Works

PENNY assembles context for each revision in this priority order:

| Priority | Source | When Loaded |
|----------|--------|-------------|
| 1 | Full current chapter | Always |
| 2 | Relevant voice test section | Always (matched to characters in scene) |
| 3 | Style guide | Always |
| 4 | Book plot outline | Always |
| 5 | Character sheets | When characters detected in scene |
| 6 | Wiki/lore entries | When matching terms found in chapter |
| 7 | Series bible | When token budget permits |
| 8 | Themes | When token budget permits |
| 9 | Adjacent chapter summaries | When available in reviews folder |

If the total context exceeds the configured token budget, PENNY drops sources from the bottom of the list. The annotated passage, your instruction, the chapter text, voice tests, and style guide are never dropped.

### Character detection:

PENNY finds characters in the scene two ways:

1. **Frontmatter `focus` field:** e.g., `focus: protagonist + darin` directly names the characters.
2. **Dialogue attribution scan:** PENNY scans the chapter for patterns like `"..." Tim said` or `"..." said Darin` and loads matching character sheets.

## Understanding Compliance Reports

After processing, the review note includes a voice compliance section:

```markdown
## Voice Compliance

- Dialogue-to-narration ratio: 0.35 (target: > 0.25)
- Narration sentences over 20 words: 2
- Self-analysis patterns detected: 0
- Internal monologue flags: 0
```

### What each metric means:

**Dialogue-to-narration ratio:** The proportion of the chapter that is dialogue versus narration. A ratio of 0.35 means 35% of the prose is dialogue. The target depends on your style -- a dialogue-heavy novel might target > 0.40, while a more introspective style might be comfortable at 0.15.

**Narration sentences over 20 words:** Long narration sentences. Not inherently bad, but a high count may indicate overwriting. Useful for catching runaway sentences that PENNY generated.

**Self-analysis patterns detected:** Counts phrases like "she realized," "she understood," "it occurred to her," "she thought about" -- patterns that indicate the character is narrating their own thought process. For many voices, these patterns break the character's perspective.

**Internal monologue flags:** Counts passages where the narrator appears to be silently reflecting without dialogue. Relevant for styles where the narrator processes through conversation, not introspection.

### How to use compliance reports:

- A single flag is not a crisis. Read the flagged passage and decide if it works.
- Recurring flags on the same metric suggest your voice rules need to be more explicit, or your voice tests need to better demonstrate the correct approach.
- If PENNY's revisions consistently score poorly on compliance, the problem is usually in the voice tests or style guide, not in PENNY's processing. Give it better examples.

## Tips by Genre and POV

### First person, unreliable narrator

- Voice tests should demonstrate the gap between what the narrator says and what actually happened.
- Voice rules should specify which topics the narrator lies about, deflects from, or avoids.
- The style guide should define the narrator's verbal tics and patterns that signal unreliability.

### Third person limited

- Voice tests should show how close the narrator gets to the POV character's thoughts.
- Define whether free indirect discourse is allowed ("The coffee was terrible" vs. "She thought the coffee was terrible").
- Specify how the narration shifts register when the POV character is emotional versus calm.

### Third person omniscient

- Voice tests should show the narrator's own voice as distinct from any character's.
- Define how head-hopping works -- does the narrator signal POV shifts, or flow between characters?
- Specify the narrator's relationship to the reader (confiding, distant, ironic).

### Multiple POV

- Create separate voice test sections for each POV character.
- PENNY matches the POV character from the chapter's `pov` frontmatter field and loads the relevant voice test section.
- Each POV character should have distinct sentence patterns, vocabulary, and areas of attention.

### Present tense

- Voice tests must all be in present tense. PENNY will match the tense of your examples.
- Flag past-tense slips in your voice rules: "All narration is present tense. Flag any past-tense narration as a violation."

### Past tense

- Be specific about when present tense is acceptable (usually only in dialogue).
- If the narrator occasionally shifts to present tense for immediacy, show this in a voice test so PENNY knows it is intentional.
