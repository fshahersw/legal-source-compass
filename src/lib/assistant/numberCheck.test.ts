import { describe, expect, it } from "vitest";
import {
  checkSummary,
  numberMentions,
  splitSentences,
  supported,
  THIN_SENTENCE,
} from "./numberCheck";

const CONTEXT = [
  "Section: Federal civil cases filed",
  "Scope: United States",
  "Period: FY2025",
  "Source: Federal Judicial Center, Integrated Database",
  "Figures:",
  "- Cases filed: 303,716 cases (FY2025)",
  "- Change on FY2024: +4.4% (FY2025)",
  "- Cases filed: 290,980 cases (FY2024)",
  "- Largest settlement: $3.94 billion",
  "- Per 100,000 residents: 617.9",
].join("\n");

const known = numberMentions(CONTEXT);
const ok = (text: string) => numberMentions(text).every((m) => supported(m, known));

describe("numberMentions", () => {
  it("reads thousands commas, decimals, signs and percent as the same digits", () => {
    expect(numberMentions("303,716 cases up 4.4% (+4.4 percent)").map((m) => m.value)).toEqual([
      303716, 4.4, 4.4,
    ]);
  });
  it("reads a scale word after the number", () => {
    const [a, b, c] = numberMentions("$3.94 billion, 12 million and 5K");
    expect(a).toMatchObject({ value: 3.94, scale: 1e9, decimals: 2 });
    expect(b).toMatchObject({ value: 12, scale: 1e6 });
    expect(c).toMatchObject({ value: 5, scale: 1e3 });
  });
  it("does not take a month or a unit for a scale", () => {
    expect(numberMentions("12 months and 3 metres")[0]!.scale).toBe(1);
    expect(numberMentions("12 months and 3 metres")[1]!.scale).toBe(1);
  });
  it("reads digits inside a label or a period", () => {
    expect(numberMentions("FY2025 and 2014-2025").map((m) => m.value)).toEqual([2025, 2014, 2025]);
  });
});

describe("supported", () => {
  it("accepts numbers the context states, however they are punctuated", () => {
    expect(ok("Filings reached 303,716 in FY2025.")).toBe(true);
    expect(ok("Filings reached 303716 in FY2025.")).toBe(true);
    expect(ok("Filings rose 4.4% on FY2024.")).toBe(true);
    expect(ok("Filings rose 4.4 percent.")).toBe(true);
    expect(ok("The rate was 617.9 per 100,000 residents.")).toBe(true);
  });
  it("accepts a correctly rounded scaled restatement, not a rounded plain number", () => {
    expect(ok("About 303.7 thousand cases were filed.")).toBe(true);
    expect(ok("About 0.3 million cases were filed.")).toBe(true);
    expect(ok("The largest settlement was $3.9 billion.")).toBe(true);
    expect(ok("The largest settlement was 3,940,000,000.")).toBe(true);
    expect(ok("About 304,000 cases were filed.")).toBe(false);
    expect(ok("About 303.8 thousand cases were filed.")).toBe(false);
  });
  it("rejects a figure the context does not hold", () => {
    expect(ok("Filings reached 310,000.")).toBe(false);
    expect(ok("Filings rose 5.1%.")).toBe(false);
    expect(ok("That is 12,736 more than FY2024.")).toBe(false);
  });
  it("accepts text with no number", () => {
    expect(ok("Filings rose, and the figures do not show why.")).toBe(true);
  });
});

describe("splitSentences", () => {
  it("does not cut a decimal or an abbreviation", () => {
    expect(splitSentences("Filings rose 4.4% in the U.S. Courts. It was the highest.")).toEqual([
      "Filings rose 4.4% in the U.S. Courts.",
      "It was the highest.",
    ]);
  });
});

describe("checkSummary", () => {
  it("keeps bullets whose numbers are all in the context", () => {
    const out = checkSummary(
      "- Cases filed reached 303,716 in FY2025.\n- That is up 4.4% on FY2024.",
      CONTEXT,
    );
    expect(out.bullets).toEqual([
      "Cases filed reached 303,716 in FY2025.",
      "That is up 4.4% on FY2024.",
    ]);
    expect(out.omitted).toBe(0);
    expect(out.thin).toBe(false);
  });

  it("drops a sentence with a fabricated number and counts it as omitted", () => {
    const out = checkSummary(
      [
        "- Cases filed reached 303,716 in FY2025.",
        "- Filings rose by 12,736 cases, a 9.7% jump.",
        "- The rate was 617.9 per 100,000 residents.",
      ].join("\n"),
      CONTEXT,
    );
    expect(out.bullets).toEqual([
      "Cases filed reached 303,716 in FY2025.",
      "The rate was 617.9 per 100,000 residents.",
    ]);
    expect(out.omitted).toBe(1);
  });

  it("drops only the offending sentence inside a bullet", () => {
    const out = checkSummary(
      "- Filings reached 303,716 in FY2025. They then hit 999,999 in FY2030.",
      CONTEXT,
    );
    expect(out.bullets).toEqual(["Filings reached 303,716 in FY2025."]);
    expect(out.omitted).toBe(1);
  });

  it("returns no bullets when every sentence is unsupported", () => {
    const out = checkSummary("- Filings were 1,234.\n- Filings were 5,678.", CONTEXT);
    expect(out.bullets).toEqual([]);
    expect(out.omitted).toBe(2);
  });

  it("recognises the thin-context sentence", () => {
    expect(checkSummary(THIN_SENTENCE, CONTEXT)).toEqual({ bullets: [], omitted: 0, thin: true });
    expect(checkSummary("Not enough figures here to summarize", CONTEXT).thin).toBe(true);
  });

  it("reads plain prose as one bullet per sentence and strips markdown", () => {
    const out = checkSummary("**Filings** rose 4.4%. They stood at 303,716 cases.", CONTEXT);
    expect(out.bullets).toEqual(["Filings rose 4.4%.", "They stood at 303,716 cases."]);
  });

  it("keeps at most four bullets and about 110 words", () => {
    const line = (i: string) => `- Point ${i} says filings rose 4.4% and stayed at 303,716 cases.`;
    expect(
      checkSummary(["A", "B", "C", "D", "E", "F"].map(line).join("\n"), CONTEXT).bullets,
    ).toHaveLength(4);
    const long = `- ${"word ".repeat(70)}end.\n- ${"word ".repeat(70)}end.`;
    expect(checkSummary(long, CONTEXT).bullets).toHaveLength(1);
  });

  it("does not count sentences beyond the bullet limit as omitted", () => {
    const text =
      ["A", "B", "C", "D", "E"].map((i) => `- Point ${i} is clear.`).join("\n") +
      "\n- It hit 777,777.";
    expect(checkSummary(text, CONTEXT).omitted).toBe(0);
  });
});
