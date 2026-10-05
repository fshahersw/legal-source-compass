import { describe, expect, it } from "vitest";
import { sliceCodePoints, verifiedSectionExcerpt, type TexasSection } from "./texasBrowse";

describe("Texas code point spans", () => {
  it("slices astral Unicode by code points rather than UTF-16 units", () => {
    const text = "A😀B";
    expect(sliceCodePoints(text, 1, 2)).toBe("😀");
    expect(sliceCodePoints(text, 0, 3)).toBe(text);
    expect(sliceCodePoints(text, 0, 1)).toBe("A");
    expect(sliceCodePoints(text, 2, 3)).toBe("B");
    expect(sliceCodePoints(text, 1, 3)).toBe("😀B");
  });

  it("rejects invalid and out-of-range spans", () => {
    expect(() => sliceCodePoints("abc", -1, 1)).toThrow("Invalid code-point span");
    expect(() => sliceCodePoints("abc", 0, 4)).toThrow("outside the chapter text");
    expect(() => sliceCodePoints("abc", 2, 2)).toThrow("Invalid code-point span");
  });

  it("verifies the selected excerpt against its exact section hash", async () => {
    const section: TexasSection = {
      chapter_id: "AG:AG.1.htm",
      id: "AG:AG.1.htm:3.10:1",
      title: "Section 3.10",
      citation: "AG:3.10",
      occurrence: 1,
      hierarchy: null,
      text_span: { start: 1, end: 2, unit: "unicode_code_points" },
      text_sha256: "f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9",
      source_url: "https://statutes.capitol.texas.gov/Docs/AG/htm/AG.1.htm#3.10",
      captured_at: "2026-10-05T12:00:00Z",
      payload_sha256: "2".repeat(64),
    };
    await expect(verifiedSectionExcerpt("A😀B", section)).resolves.toBe("😀");
    section.text_sha256 = "0".repeat(64);
    await expect(verifiedSectionExcerpt("A😀B", section)).rejects.toThrow("does not match");
  });
});
