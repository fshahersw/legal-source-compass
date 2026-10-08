import { describe, expect, it } from "vitest";
import { matchPassage, spacingNormalized } from "./passageMatch";

describe("matchPassage", () => {
  it("prefers a literal match and labels a spacing-only difference", () => {
    const fresh = "(3) WITHIN FOUR YEARS.—(a) An action relating to the determination of paternity.";
    expect(matchPassage(fresh, "(3) WITHIN FOUR YEARS.—(a) An action relating")).toBe("literal");
    expect(matchPassage(fresh, "(3) WITHIN FOUR YEARS.\n—\n(a)\nAn action relating")).toBe("spacing_normalized");
    expect(matchPassage("the injury , not the cause", "the injury, not the cause")).toBe("spacing_normalized");
    expect(matchPassage("an action for mali- cious prosecution", "an action for malicious prosecution")).toBe(
      "spacing_normalized",
    );
  });

  it("never bridges different words, numbers or punctuation", () => {
    expect(matchPassage("WITHIN FOUR YEARS.—(a) An action", "WITHIN FIVE YEARS.—(a) An action")).toBeNull();
    expect(matchPassage("within two years after", "within two years; after")).toBeNull();
    expect(matchPassage("within 2 years", "within 20 years")).toBeNull();
    expect(spacingNormalized("YEARS. — (a)")).toBe(spacingNormalized("YEARS.—(a)"));
  });
});
