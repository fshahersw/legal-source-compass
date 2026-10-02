import { describe, expect, it } from "vitest";
import { classify, classifySource, headingIdentity, TAXONOMY_VERSION } from "./taxonomy";

describe("recorded resource crosswalk", () => {
  it("maps the observed content vocabularies without interpreting publisher identity", () => {
    expect(classifySource(["court_forms", "court-form"])).toEqual(["forms"]);
    expect(classifySource(["court-rule", "court_rules"])).toEqual(["rules"]);
    expect(classifySource(["official-primary", "nonprofit", "unlisted future type"])).toEqual([
      "other",
    ]);
    expect(classifySource(["opinions_decisions", "administrative-decision"])).toEqual(["opinions"]);
    expect(TAXONOMY_VERSION).toBe("2026-10-02.1");
  });
  it("deduplicates harmless heading spelling differences without broad keyword guesses", () => {
    expect(headingIdentity("  COURT   Rules ")).toBe(headingIdentity("court rules"));
    expect(classifySource(["REGULATIONS & RULEMAKING", " regulations & rulemaking "])).toEqual([
      "regulations",
    ]);
    expect(classifySource(["Medical regulation gaps"])).toEqual(["other"]);
  });
  it("keeps mixed publisher histories and third-party summaries distinct from operative law", () => {
    expect(classify("federal_register_history")).toBe("mixed");
    expect(classify("limitation_periods")).toBe("guidance");
    expect(classify("verdict_reports")).toBe("data");
    expect(classify("indiana_code")).toBe("statutes");
    expect(classify("future_regulation_review_note")).toBe("other");
    expect(classify("dockets")).toBe("dockets");
    expect(classify("opinions")).toBe("opinions");
  });
});
