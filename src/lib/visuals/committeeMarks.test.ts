import { describe, expect, it } from "vitest";
import { hostOf, isWideMark } from "./common";
import { parseCommitteeMark } from "./committeeMarks";
import { committee_marks } from "./fixtures/rows";

const mark = committee_marks[0]!.item["mark"] as Record<string, unknown>;

describe("parseCommitteeMark", () => {
  it("keeps the fixture mark from the committee's own House site", () => {
    const m = parseCommitteeMark("hsru00", mark)!;
    expect(m.url).toContain("https://rules.house.gov/");
    expect(m.background).toBe("light");
    expect(m.policyQuote).toContain("work of the Federal government");
    expect(hostOf(m.sourcePage)).toBe("rules.house.gov");
    expect(isWideMark(m)).toBe(false);
    expect(isWideMark({ width: 360, height: 79 })).toBe(true);
  });

  it("accepts the mark only on the registry's image hosts over https", () => {
    for (const url of [
      "https://rules.house.gov.example.com/logo.png",
      "http://rules.house.gov/logo.png",
      "https://example.org/logo.png",
    ])
      expect(parseCommitteeMark("hsru00", { ...mark, url })).toBeNull();
    expect(
      parseCommitteeMark("hsru00", { ...mark, url: "https://d1dth6e84htgma.cloudfront.net/x.png" }),
    ).not.toBeNull();
    expect(parseCommitteeMark("hsru00", { ...mark, policy_url: "http://x" })).toBeNull();
  });

  it("keeps a mark without a policy statement; a quote is kept only with its page", () => {
    const m = parseCommitteeMark("hsru00", { ...mark, policy_url: null, policy_quote: null })!;
    expect(m.policyUrl).toBeNull();
    expect(parseCommitteeMark("hsru00", { ...mark, policy_url: null })!.policyQuote).toBeNull();
    // A review status in the licence field is not a licence; a recorded one is kept.
    expect(
      parseCommitteeMark("hsru00", { ...mark, license: "Pending review" })!.license,
    ).toBeNull();
    expect(
      parseCommitteeMark("hsru00", {
        ...mark,
        license: "U.S. government work under official committee copyright policy",
      })!.license,
    ).toBe("U.S. government work under official committee copyright policy");
  });

  it("requires integer sizes, a known type, a source page and a valid committee code", () => {
    expect(parseCommitteeMark("hsru00", { ...mark, source_page: "" })).toBeNull();
    expect(parseCommitteeMark("hsru00", { ...mark, width: 1162.5 })).toBeNull();
    expect(parseCommitteeMark("hsru00", { ...mark, mime: "text/html" })).toBeNull();
    expect(parseCommitteeMark("House RU00", mark)).toBeNull();
  });

  it("reads an optional dark plate and rejects any other value", () => {
    expect(parseCommitteeMark("hsru00", { ...mark, background: "dark" })?.background).toBe("dark");
    expect(parseCommitteeMark("hsru00", { ...mark, background: "navy" })).toBeNull();
  });
});
