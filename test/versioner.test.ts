import { describe, it, expect } from "vitest";
import {
  readVersion,
  nextVersion,
  readState,
  updateState,
  shouldProcess,
  serializeState,
} from "../src/versioner";
import type { AnnotatedSection, VersionState } from "../src/types";

function makeAnnotation(overrides: Partial<AnnotatedSection> = {}): AnnotatedSection {
  return {
    tag: "REWRITE",
    instruction: "fix this",
    originalText: "some text",
    lineStart: 5,
    lineEnd: 6,
    scope: "paragraph",
    actionable: true,
    hash: "abc123def456",
    ...overrides,
  };
}

describe("readVersion", () => {
  it("reads a simple version number", () => {
    expect(readVersion("1")).toBe(1);
    expect(readVersion("3")).toBe(3);
    expect(readVersion("42")).toBe(42);
  });

  it("handles whitespace and newlines", () => {
    expect(readVersion("  2  \n")).toBe(2);
    expect(readVersion("\n5\n")).toBe(5);
  });

  it("returns 0 for empty content", () => {
    expect(readVersion("")).toBe(0);
    expect(readVersion("   ")).toBe(0);
  });

  it("returns 0 for non-numeric content", () => {
    expect(readVersion("abc")).toBe(0);
    expect(readVersion("version 1")).toBe(0);
  });

  it("returns 0 for negative numbers", () => {
    expect(readVersion("-1")).toBe(0);
  });
});

describe("nextVersion", () => {
  it("increments by 1", () => {
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(5)).toBe(6);
    expect(nextVersion(0)).toBe(1);
  });
});

describe("readState", () => {
  it("parses valid state JSON", () => {
    const json = JSON.stringify({
      version: 3,
      lastProcessed: "2026-04-16T14:30:00Z",
      processedAnnotations: [
        { hash: "abc123", tag: "REWRITE", line: 10, processedInVersion: 2 },
      ],
    });

    const state = readState(json);
    expect(state.version).toBe(3);
    expect(state.lastProcessed).toBe("2026-04-16T14:30:00Z");
    expect(state.processedAnnotations).toHaveLength(1);
    expect(state.processedAnnotations[0].hash).toBe("abc123");
    expect(state.processedAnnotations[0].tag).toBe("REWRITE");
    expect(state.processedAnnotations[0].line).toBe(10);
    expect(state.processedAnnotations[0].processedInVersion).toBe(2);
  });

  it("returns default state for empty content", () => {
    const state = readState("");
    expect(state.version).toBe(0);
    expect(state.lastProcessed).toBeNull();
    expect(state.processedAnnotations).toHaveLength(0);
  });

  it("returns default state for invalid JSON", () => {
    const state = readState("{not valid json");
    expect(state.version).toBe(0);
    expect(state.processedAnnotations).toHaveLength(0);
  });

  it("handles missing fields gracefully", () => {
    const state = readState("{}");
    expect(state.version).toBe(0);
    expect(state.lastProcessed).toBeNull();
    expect(state.processedAnnotations).toHaveLength(0);
  });

  it("handles malformed processedAnnotations entries", () => {
    const json = JSON.stringify({
      version: 1,
      processedAnnotations: [
        { hash: 123, tag: null },
        "not an object",
      ],
    });
    const state = readState(json);
    // Non-object entries ("not an object") should be filtered out
    expect(state.processedAnnotations).toHaveLength(1);
    // Should coerce to strings/defaults.
    expect(state.processedAnnotations[0].hash).toBe("123");
  });

  it("filters out null, number, and string entries from processedAnnotations", () => {
    const json = JSON.stringify({
      version: 2,
      processedAnnotations: [
        null,
        42,
        "string entry",
        true,
        { hash: "valid123", tag: "REWRITE", line: 5, processedInVersion: 1 },
        undefined,
      ],
    });
    const state = readState(json);
    // Only the valid object should remain
    expect(state.processedAnnotations).toHaveLength(1);
    expect(state.processedAnnotations[0].hash).toBe("valid123");
  });
});

describe("updateState", () => {
  it("updates version and lastProcessed", () => {
    const initial: VersionState = {
      version: 1,
      lastProcessed: null,
      processedAnnotations: [],
    };

    const annotation = makeAnnotation({ hash: "aaa111bbb222" });
    const updated = updateState(initial, 2, [annotation]);

    expect(updated.version).toBe(2);
    expect(updated.lastProcessed).toBeTruthy();
    expect(updated.processedAnnotations).toHaveLength(1);
    expect(updated.processedAnnotations[0].hash).toBe("aaa111bbb222");
    expect(updated.processedAnnotations[0].processedInVersion).toBe(2);
  });

  it("merges with existing processed annotations", () => {
    const initial: VersionState = {
      version: 2,
      lastProcessed: "2026-04-15T00:00:00Z",
      processedAnnotations: [
        { hash: "existing12345", tag: "REWRITE", line: 5, processedInVersion: 2 },
      ],
    };

    const newAnnotation = makeAnnotation({ hash: "newanno123456" });
    const updated = updateState(initial, 3, [newAnnotation]);

    expect(updated.processedAnnotations).toHaveLength(2);
    const hashes = updated.processedAnnotations.map((pa) => pa.hash);
    expect(hashes).toContain("existing12345");
    expect(hashes).toContain("newanno123456");
  });

  it("deduplicates by hash (updates existing entry)", () => {
    const initial: VersionState = {
      version: 2,
      lastProcessed: null,
      processedAnnotations: [
        { hash: "samehash12345", tag: "REWRITE", line: 5, processedInVersion: 2 },
      ],
    };

    const annotation = makeAnnotation({ hash: "samehash12345" });
    const updated = updateState(initial, 3, [annotation]);

    expect(updated.processedAnnotations).toHaveLength(1);
    expect(updated.processedAnnotations[0].processedInVersion).toBe(3);
  });

  it("does not mutate the input state", () => {
    const initial: VersionState = {
      version: 1,
      lastProcessed: null,
      processedAnnotations: [],
    };

    const annotation = makeAnnotation();
    updateState(initial, 2, [annotation]);

    expect(initial.version).toBe(1);
    expect(initial.processedAnnotations).toHaveLength(0);
  });
});

describe("shouldProcess", () => {
  it("returns only actionable annotations not already processed", () => {
    const state: VersionState = {
      version: 2,
      lastProcessed: "2026-04-16T00:00:00Z",
      processedAnnotations: [
        { hash: "processed1234", tag: "REWRITE", line: 5, processedInVersion: 2 },
      ],
    };

    const annotations = [
      makeAnnotation({ hash: "processed1234", actionable: true }),
      makeAnnotation({ hash: "newone1234567", actionable: true }),
      makeAnnotation({ hash: "noteanno12345", actionable: false, tag: "NOTE" }),
    ];

    const result = shouldProcess(annotations, state);
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe("newone1234567");
  });

  it("returns empty array when all are already processed", () => {
    const state: VersionState = {
      version: 3,
      lastProcessed: "2026-04-16T00:00:00Z",
      processedAnnotations: [
        { hash: "abc123def456", tag: "REWRITE", line: 5, processedInVersion: 2 },
      ],
    };

    const annotations = [makeAnnotation({ hash: "abc123def456" })];
    const result = shouldProcess(annotations, state);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no annotations are actionable", () => {
    const state: VersionState = {
      version: 1,
      lastProcessed: null,
      processedAnnotations: [],
    };

    const annotations = [
      makeAnnotation({ actionable: false, tag: "NOTE" }),
      makeAnnotation({ actionable: false, tag: "RESEARCH" }),
    ];

    const result = shouldProcess(annotations, state);
    expect(result).toHaveLength(0);
  });

  it("handles empty state", () => {
    const state: VersionState = {
      version: 0,
      lastProcessed: null,
      processedAnnotations: [],
    };

    const annotations = [
      makeAnnotation({ hash: "new123new1234" }),
    ];

    const result = shouldProcess(annotations, state);
    expect(result).toHaveLength(1);
  });
});

describe("serializeState", () => {
  it("produces valid JSON", () => {
    const state: VersionState = {
      version: 2,
      lastProcessed: "2026-04-16T14:30:00Z",
      processedAnnotations: [
        { hash: "abc123", tag: "REWRITE", line: 10, processedInVersion: 2 },
      ],
    };

    const json = serializeState(state);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(2);
    expect(parsed.processedAnnotations).toHaveLength(1);
  });

  it("roundtrips through readState", () => {
    const state: VersionState = {
      version: 5,
      lastProcessed: "2026-04-16T00:00:00Z",
      processedAnnotations: [
        { hash: "aaa111bbb222", tag: "EXPAND", line: 20, processedInVersion: 5 },
      ],
    };

    const json = serializeState(state);
    const restored = readState(json);
    expect(restored.version).toBe(state.version);
    expect(restored.lastProcessed).toBe(state.lastProcessed);
    expect(restored.processedAnnotations).toEqual(state.processedAnnotations);
  });
});
