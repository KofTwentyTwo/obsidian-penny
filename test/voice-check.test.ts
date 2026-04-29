import { describe, it, expect } from "vitest";
import { checkVoiceCompliance } from "../src/voice-check";

describe("checkVoiceCompliance", () => {
  describe("dialogue ratio", () => {
    it("calculates dialogue ratio for mixed text", () => {
      const prose = [
        'She walked in. "Hey," she said. "What are you doing here?"',
        'Tim looked up. "Nothing much."',
      ].join("\n");

      const result = checkVoiceCompliance(prose);
      // Dialogue words: Hey, What, are, you, doing, here, Nothing, much = 8
      // Total words: ~18-19
      expect(result.dialogueRatio).toBeGreaterThan(0);
      expect(result.dialogueRatio).toBeLessThan(1);
    });

    it("returns 0 for prose with no dialogue", () => {
      const prose = "She walked into the room. The lights were dim. Rain fell outside.";
      const result = checkVoiceCompliance(prose);
      expect(result.dialogueRatio).toBe(0);
    });

    it("returns high ratio for dialogue-heavy text", () => {
      const prose = '"Hello there." "Hi yourself." "How are you?" "Fine."';
      const result = checkVoiceCompliance(prose);
      expect(result.dialogueRatio).toBeGreaterThan(0.5);
    });

    it("handles curly quotes", () => {
      const prose = '\u201CHello there,\u201D she said.';
      const result = checkVoiceCompliance(prose);
      expect(result.dialogueRatio).toBeGreaterThan(0);
    });

    it("counts British single-quoted dialogue (#5)", () => {
      // 'Hello there' = 2 words of dialogue out of 5 total \u2192 ratio 0.4
      const prose = "'Hello there,' she said.";
      const result = checkVoiceCompliance(prose);
      expect(result.dialogueRatio).toBeGreaterThan(0);
      expect(result.dialogueRatio).toBeLessThan(1);
    });

    it("does not double-count apostrophes inside contractions (#5)", () => {
      // The contraction "don't" must not register as opening a quote span.
      const prose = "She said \"I don't know what you're doing.\" The day went on.";
      const result = checkVoiceCompliance(prose);
      // Dialogue: "I don't know what you're doing" = 6 words
      // Total words: ~14
      expect(result.dialogueRatio).toBeGreaterThan(0.3);
      expect(result.dialogueRatio).toBeLessThan(0.6);
    });

    it("counts mixed quote styles in the same chapter (#5)", () => {
      const prose = '"Hi," he said. \u2018Bye,\u2019 she replied. \u201CGood,\u201D he agreed.';
      const result = checkVoiceCompliance(prose);
      // Three single-word dialogue spans out of ~9 total \u2192 > 0.3
      expect(result.dialogueRatio).toBeGreaterThan(0.3);
    });

    it("strips British single-quoted dialogue from narration analysis (#5)", () => {
      // Without stripping, the long sentence below would NOT exceed 20 words
      // because the dialogue would inflate the count. With proper stripping,
      // the narration is short and below threshold.
      const prose =
        "'I think I shall walk to the very far end of the very long lane today.' She said it firmly.";
      const result = checkVoiceCompliance(prose);
      // Narration is short; should not flag a long sentence.
      expect(result.longNarrationSentences).toHaveLength(0);
    });

    it("returns 0 for empty text", () => {
      const result = checkVoiceCompliance("");
      expect(result.dialogueRatio).toBe(0);
    });
  });

  describe("long narration sentences", () => {
    it("flags narration sentences over 20 words", () => {
      const prose = [
        "She walked into the very large and very dark room that was at the end of the very long and winding hallway that seemed to stretch on forever.",
        '"Hey," she said.',
      ].join("\n");

      const result = checkVoiceCompliance(prose);
      expect(result.longNarrationSentences.length).toBeGreaterThan(0);
    });

    it("does not flag short narration sentences", () => {
      const prose = "She walked in. The lights were dim. Rain fell.";
      const result = checkVoiceCompliance(prose);
      expect(result.longNarrationSentences).toHaveLength(0);
    });

    it("does not flag long dialogue (only narration)", () => {
      const prose = '"I went to the store and bought a lot of different things including bread and milk and eggs and cheese and some other things I cannot remember right now."';
      const result = checkVoiceCompliance(prose);
      // The dialogue is stripped before checking narration length.
      expect(result.longNarrationSentences).toHaveLength(0);
    });

    it("identifies the specific long sentences", () => {
      const longSentence = "She looked at the very old and crumbling building that stood at the corner of the street where she used to play as a child many years ago.";
      const prose = `Short sentence. ${longSentence} Another short one.`;

      const result = checkVoiceCompliance(prose);
      expect(result.longNarrationSentences.length).toBeGreaterThan(0);
      // The flagged sentence should contain some of the words.
      expect(result.longNarrationSentences[0]).toContain("crumbling");
    });
  });

  describe("self-analysis patterns", () => {
    it("flags 'I feel'", () => {
      const prose = "I feel like something was wrong with the universe.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'my brain'", () => {
      const prose = "My brain kept circling back to the problem.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'I realize'", () => {
      const prose = "I realize now that the whole thing was a mistake.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'I realized'", () => {
      const prose = "I realized the pattern was repeating.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'I think about'", () => {
      const prose = "I think about this sometimes when the house is quiet.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'I notice that I'", () => {
      const prose = "I notice that I am holding my breath.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'she thought'", () => {
      const prose = "She thought about the implications.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'she felt'", () => {
      const prose = "She felt a wave of sadness wash over her.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'she realized'", () => {
      const prose = "She realized the truth had been there all along.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'it occurred to me'", () => {
      const prose = "It occurred to me that the system was rigged.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'it dawned on me'", () => {
      const prose = "It dawned on me that nobody was coming back.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'I wondered if'", () => {
      const prose = "I wondered if the whole thing was real.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("flags 'something inside me'", () => {
      const prose = "Something inside me shifted.";
      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("does not flag clean prose", () => {
      const prose = [
        '"Rabbit," I said, "the allocation pattern is wrong."',
        "Chairman Meow sat on the keyboard.",
        "The coffee was still hot.",
      ].join("\n");

      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags).toHaveLength(0);
    });

    it("flags at most once per line", () => {
      const prose = "I feel like my brain is broken and I realize it now.";
      const result = checkVoiceCompliance(prose);
      // Multiple patterns match, but should only flag the line once.
      expect(result.selfAnalysisFlags).toHaveLength(1);
    });
  });

  describe("combined analysis", () => {
    it("returns all three metrics together", () => {
      const prose = [
        "She walked into the room that was very large and decorated with many different kinds of paintings and sculptures that she had never seen before in her entire life.",
        "",
        'I feel like something is off. "Hey," Tim said. "You good?"',
        "",
        '"Yeah," I said. "Fine."',
      ].join("\n");

      const result = checkVoiceCompliance(prose);
      expect(typeof result.dialogueRatio).toBe("number");
      expect(Array.isArray(result.longNarrationSentences)).toBe(true);
      expect(Array.isArray(result.selfAnalysisFlags)).toBe(true);
      // Should have at least one long sentence and one self-analysis flag.
      expect(result.longNarrationSentences.length).toBeGreaterThan(0);
      expect(result.selfAnalysisFlags.length).toBeGreaterThan(0);
    });

    it("handles well-written compliant prose", () => {
      const prose = [
        '"Rabbit," I said. "The log stops mid-sentence."',
        "",
        "Chairman Meow jumped onto the desk.",
        "",
        '"Not crashed. Deleted. No error, no exit code."',
        "",
        "The cursor blinked. The coffee went cold.",
      ].join("\n");

      const result = checkVoiceCompliance(prose);
      expect(result.selfAnalysisFlags).toHaveLength(0);
      expect(result.longNarrationSentences).toHaveLength(0);
      expect(result.dialogueRatio).toBeGreaterThan(0);
    });
  });
});
