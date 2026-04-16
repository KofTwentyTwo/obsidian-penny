# Annotation Guide

Annotations are how you tell PENNY what to revise. They are Obsidian comments placed in your chapter prose. PENNY reads them, processes them through Claude with your project's voice rules and context, and writes the revised output to a new version of the chapter.

## Syntax

```markdown
%% TAG: instruction %%
```

- **`%%`** -- Obsidian's comment delimiters. Annotations are invisible in reading view.
- **TAG** -- One of the supported tags (see below). Must be uppercase.
- **instruction** -- Your editorial direction. Be specific.

## Tags

### REWRITE

Replace the surrounding passage with a new version. Use when the prose exists but needs fundamental reworking.

**Examples:**

```markdown
The room was dark and she felt scared.
%% REWRITE: Show the darkness through specific sensory detail -- what she hears, what she can't see. No emotion words. %%
```

```markdown
He walked into the room and sat down in the chair by the window.
%% REWRITE: Give this some life. He's nervous. Show it through what he does with his hands, how he sits, where he looks. %%
```

```markdown
"I need to tell you something," she said. "It's about what happened yesterday."
"Okay," he replied. "What is it?"
%% REWRITE: The dialogue is too on-the-nose. They should be circling the topic, not stating it directly. Build tension through what they don't say. %%
```

### EXPAND

Add depth, detail, or length to the surrounding passage. Use when the bones are right but the passage needs more.

**Examples:**

```markdown
She debugged the program for hours.
%% EXPAND: Show the debugging process. What does she try? What fails? What does the terminal output look like? Make the reader feel the frustration and the small victories. %%
```

```markdown
They walked through town.
%% EXPAND: Add 2-3 paragraphs of the walk. What do they see? What's the weather? What are they talking about? Use the walk to develop their relationship. %%
```

```markdown
"That's not how routers work," she said.
%% EXPAND: Have her actually explain how routers work -- in her voice, casually technical. The friend should react in their own way. 3-4 more exchanges. %%
```

### CUT

Remove or condense the surrounding passage. Use when prose is bloated, repetitive, or overwritten.

**Examples:**

```markdown
She sat at the desk, thinking about everything that had happened over the course of the last several weeks, remembering all the conversations she'd had with her friends about the strange phenomena they'd been witnessing, and wondering if perhaps there was some kind of pattern to it all that she hadn't yet been able to identify or articulate.
%% CUT: This is one sentence doing the work of a paragraph. Break it up and cut it in half. She wouldn't narrate this -- she'd say it to Rabbit. %%
```

```markdown
The stars were beautiful. They shone brightly in the dark sky. Each one twinkled like a tiny diamond. The night was clear and she could see millions of them.
%% CUT: Four sentences saying the same thing. One will do. %%
```

```markdown
He explained the theory in detail, covering every aspect of how the system worked, from the basic principles all the way up to the most complex interactions between components.
%% CUT: Summary, not scene. Either dramatize this as dialogue or cut to what matters. %%
```

### TONE

Adjust the voice or mood of the surrounding passage. Use when the writing doesn't match the project's established register.

**Examples:**

```markdown
She observed the feline companion as it positioned itself upon the desk surface.
%% TONE: Way too formal. She'd say "Chairman Meow parked himself on my keyboard again." Match the voice tests. %%
```

```markdown
The discovery hit her like a freight train of emotions.
%% TONE: Too melodramatic. She doesn't process emotions like this. She'd notice a physical sensation or change the subject. %%
```

```markdown
"Hey bestie! OMG you won't believe what happened!"
%% TONE: Too perky. She doesn't talk like this. Check the style guide for her register -- dry, technical, sincere. %%
```

### DIALOG

Rework dialogue for voice, realism, or subtext. Use when characters do not sound like themselves or the dialogue is flat.

**Examples:**

```markdown
"I think we should consider the implications of this discovery," she said.
"Yes, I agree. It's quite significant," he responded.
%% DIALOG: Nobody talks like this. She's blunt and technical. He's either clipped (Darin) or performative (Tyler). Check which character this is and match their voice dynamic. %%
```

```markdown
"I'm feeling really sad about what happened," she told Rabbit.
%% DIALOG: She doesn't have vocabulary for feelings. She'd describe a physical sensation or use a system metaphor. See voice tests for Rabbit scenes. %%
```

```markdown
"So basically the memory allocation is causing a buffer overflow in the heap segment when the garbage collector runs its sweep cycle," she explained carefully so everyone could understand.
%% DIALOG: She doesn't explain carefully. She just talks. She doesn't simplify for non-technical people. Drop the "so everyone could understand" and let the other characters react in their own way. %%
```

### PLOT

Flag a continuity or plot concern. If the instruction is specific, PENNY attempts to fix it. If it is vague, PENNY flags it in the review note for you to address.

**Examples:**

```markdown
Tim handed her the coffee from the place on Green Street.
%% PLOT: Was Tim established as being in town this week? Check chapter 3 -- I think he's supposed to be visiting his sister. %%
```

```markdown
She ran the program and got the error at 13 minutes.
%% PLOT: The interval should be 14 minutes here -- it was 13 in the last chapter. The interval is growing. Fix the number. %%
```

```markdown
"Remember when we found that bug last summer?" Darin said.
%% PLOT: Timeline check -- is this set in the right season? Cross-reference with the timeline in 00-series/. %%
```

### PACING

Adjust the speed of the surrounding passage. Use when a section moves too fast or drags.

**Examples:**

```markdown
She walked to the window. She looked outside. She saw the stars. She thought about them. She walked back. She sat down. She typed.
%% PACING: This is a list of actions, not a scene. Vary the sentence rhythm. Combine some, skip others, add one specific detail that matters. %%
```

```markdown
In a flash, she solved the problem, told Darin, grabbed her bag, biked home, ate dinner, and went to bed.
%% PACING: Too fast. The moment she solves the problem deserves a full scene. Slow down. Let the reader sit in the discovery. %%
```

```markdown
They talked about the project for a while, going back and forth about different approaches and possibilities, each one building on the last person's idea.
%% PACING: Either dramatize this as actual dialogue or summarize it in one sentence and move on. This middle ground is dead air. %%
```

### CHARACTER

Fix character voice or behavior that does not match their established profile. PENNY loads the relevant character sheet from `02-characters/` when processing this tag.

**Examples:**

```markdown
"Maybe we should think about it more," she said quietly.
%% CHARACTER: She is never quiet or tentative. She is direct. If she's uncertain, she says "I don't know" directly, not "maybe." Check her character sheet. %%
```

```markdown
Tyler sat silently, considering the mathematical implications.
%% CHARACTER: Tyler is never silent. He's the one who arrives late, already eating something. He'd say something like "that's rude" about the AI being killed, not sit there thinking. %%
```

```markdown
Darin laughed and made a joke about the situation.
%% CHARACTER: Darin doesn't laugh or joke. He's silence and precision. A Darin reaction is a three-second pause followed by "run it again." %%
```

### NOTE

Author's note to self. PENNY does not process these. They pass through to the next version unchanged. Use them for reminders, ideas, or things to come back to later.

**Examples:**

```markdown
%% NOTE: Come back to this scene after writing chapter 12. The setup here needs to pay off there. %%
```

```markdown
%% NOTE: Consider making this the chapter where she gives Alex the book. Check emotional arc. %%
```

```markdown
%% NOTE: This is placeholder prose. Rewrite entirely once the outline for act 3 is finalized. %%
```

### RESEARCH

Flags something that needs fact-checking or verification. Not processed by PENNY. Passes through unchanged and is flagged in the review note.

**Examples:**

```markdown
She connected to the NCSA server using the legacy protocol.
%% RESEARCH: What protocols would actually be available at NCSA? Is SSH the right framing or would she use something else? %%
```

```markdown
The light took eight minutes to travel from the sun.
%% RESEARCH: Verify this number. Is it 8 minutes or 8 minutes 20 seconds? She would know the precise figure. %%
```

```markdown
He mentioned the Tao of Programming, quoting the passage about the master programmer.
%% RESEARCH: Pull the actual quote from the book. Don't paraphrase -- use the real text. %%
```

## Scope Rules

Where you place the annotation determines what passage PENNY applies it to.

### Inline (within a paragraph)

The annotation applies to the sentence or clause immediately before it.

```markdown
The server hummed quietly in the corner %% REWRITE: more specific -- what kind of hum, what frequency %% while she typed.
```

PENNY revises only "The server hummed quietly in the corner" and preserves the rest of the sentence.

### Between paragraphs (own line)

The annotation applies to the paragraph immediately above it.

```markdown
She stared at the terminal output. The numbers scrolled past faster than she could read. Something was wrong with the allocation pattern -- the intervals were shrinking when they should have been growing.

%% EXPAND: Add what she does next. Does she talk to Rabbit? Run a diagnostic? Show her process. %%

The next morning, she biked to campus.
```

PENNY revises the paragraph above the annotation. The paragraph below is untouched.

### After a heading (line after `#`)

The annotation applies to the entire section up to the next heading of equal or higher level.

```markdown
## The Lab

%% TONE: This whole section is too formal. Loosen it up to match her voice. %%

She entered the laboratory and observed the equipment arranged upon the workbenches. The fluorescent lighting cast a sterile glow across the room. She proceeded to her workstation and initiated the boot sequence.
```

PENNY revises everything from "She entered..." to the next `##` heading.

### Multiple annotations on the same passage

When multiple annotations target the same text, PENNY combines all instructions and processes them together in a single revision.

```markdown
"I suppose we might consider an alternative approach," she said thoughtfully.

%% DIALOG: She doesn't talk like this. Too formal, too hedged. %%
%% CHARACTER: Check her character sheet. She's direct and blunt. %%
%% TONE: Match the voice tests. %%
```

PENNY combines all three instructions and produces one revision that addresses dialog, character voice, and tone together.

## Tips for Writing Good Instructions

### Be specific

Vague instructions produce vague results.

| Weak | Strong |
|------|--------|
| `%% REWRITE: make it better %%` | `%% REWRITE: add the sound of rain on the window, the smell of coffee, and the blue light from the monitor. Ground it in the senses. %%` |
| `%% EXPAND: add more %%` | `%% EXPAND: add 3-4 exchanges of dialogue where she explains the memory allocation problem to Rabbit, reaching the conclusion mid-sentence. %%` |
| `%% TONE: wrong %%` | `%% TONE: too formal. She'd say "the thing broke" not "the system experienced a failure." Match the coffee scene in voice tests. %%` |

### Say what effect you want, not what prose you want

PENNY is a co-author, not a transcriptionist. Tell it the goal.

Good: `%% EXPAND: build tension. The reader should feel like something is about to go wrong. %%`

Not as good: `%% EXPAND: write "She felt a chill run down her spine as the shadows grew longer." %%`

### Reference your project files

PENNY loads your style guide, voice tests, and character sheets. Reference them in your instructions.

```markdown
%% DIALOG: His voice is wrong. Check the Tim section in voice tests -- he's dry and slow, not enthusiastic. %%
```

```markdown
%% CHARACTER: She's acting like a different person here. Reread the protagonist character sheet, especially the section on how she handles conflict. %%
```

### One concern per annotation (usually)

If you have multiple unrelated issues with a passage, separate annotations are clearer. But if the issues are entangled (wrong character voice AND wrong tone), combining them is fine.

## Anti-Patterns to Avoid

### Writing the prose yourself in the instruction

If you know exactly what the prose should say, just write it yourself. Annotations are for when you know the *direction* but want PENNY to execute.

**Avoid:**
```markdown
%% REWRITE: Change this to "The rain hammered the windows like a drummer who'd lost the beat." %%
```

**Better:**
```markdown
%% REWRITE: Add rain. Use a music metaphor -- she thinks in rhythms. %%
```

### Being too vague to act on

PENNY needs enough direction to produce useful output. "Fix this" is not enough.

**Avoid:**
```markdown
%% REWRITE: this doesn't work %%
```

**Better:**
```markdown
%% REWRITE: the emotional beat doesn't land because she's stating her feelings directly. She would never say "I'm scared." Show it through what she does -- does she grip the desk? Start typing faster? Talk to Rabbit about something unrelated? %%
```

### Annotating passages that don't exist yet

Annotations apply to existing text. If you want PENNY to generate new prose from nothing, write at least a placeholder sentence first.

**Avoid:**
```markdown
## Chapter Opening

%% EXPAND: Write the opening scene of this chapter. %%
```

**Better:**
```markdown
## Chapter Opening

She biked to the lab.

%% EXPAND: Build this into a full opening scene. The bike ride, the weather, what she's thinking about (said aloud to herself or on the phone with Tim). 2-3 paragraphs. %%
```

### Stacking too many annotations in one pass

PENNY processes annotations independently. If you have 15 annotations in one chapter, each one generates a separate API call. Consider processing in batches of 3-5 and reviewing results between passes.

## FAQ

**Do annotations show up in reading view?**

No. Obsidian's `%% ... %%` comments are hidden in reading/preview mode. They only appear in editing view.

**Can I nest annotations?**

No. Each annotation is a flat `%% TAG: instruction %%` block. Do not put annotations inside other annotations.

**What happens to annotations after processing?**

Processed annotations (`REWRITE`, `EXPAND`, `CUT`, `TONE`, `DIALOG`, `PACING`, `CHARACTER`) are removed from the new version and replaced with a revision marker: `%% REVISED(v2): [REWRITE] "summary" -- N words -> M words %%`.

`NOTE` and `RESEARCH` annotations are kept in the new version unchanged.

**Can I use lowercase tags?**

No. Tags must be uppercase: `REWRITE`, not `rewrite` or `Rewrite`.

**Can I use custom tags?**

Not currently. PENNY recognizes only the ten tags listed in this guide. Unrecognized tags are skipped and flagged in the review note.

**What if I want to undo a revision?**

Your original version is never modified. If `ch-05.v3.md` is not what you wanted, go back to `ch-05.v2.md`, add new annotations, and process again. See [Versioning](versioning.md) for details on rolling back.

**Can I put annotations in non-chapter files?**

PENNY only processes files that match the chapter file pattern (default: `ch-*.md`) inside the configured drafts folder. Annotations in other files (character sheets, outlines, etc.) are ignored.
