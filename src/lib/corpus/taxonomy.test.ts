import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classify, classifySource, headingIdentity, TAXONOMY_VERSION } from "./taxonomy";

const reviewedCatalog = JSON.parse(readFileSync("private/data/quality/category-schema-followup-2026-10-02.json", "utf8")) as {
  categoryCrosswalk: { native_category: string; canonical_category: string }[];
  categoryCoverage: { unmappedNativeCategories: string[] };
};

describe("recorded resource crosswalk", () => {
  it("keeps inherited object property names unmatched instead of treating them as categories", () => {
    expect(classify("constructor")).toBe("other");
    expect(classify("__proto__")).toBe("other");
    expect(classifySource(["constructor", "__proto__", "toString"])).toEqual(["other"]);
  });
  it("agrees with all 88 exact native mappings in the independent public catalog audit", () => {
    expect(reviewedCatalog.categoryCrosswalk).toHaveLength(88);
    expect(reviewedCatalog.categoryCoverage.unmappedNativeCategories).toEqual([]);
    for (const mapping of reviewedCatalog.categoryCrosswalk) {
      expect(classify(mapping.native_category), mapping.native_category).toBe(
        mapping.canonical_category,
      );
    }
  });
  it("maps the observed content vocabularies without interpreting publisher identity", () => {
    expect(classifySource(["court_forms", "court-form"])).toEqual(["forms"]);
    expect(classifySource(["court-rule", "court_rules"])).toEqual(["rules"]);
    expect(classifySource(["official-primary", "nonprofit", "unlisted future type"])).toEqual([
      "other",
    ]);
    expect(classifySource(["opinions_decisions", "administrative-decision"])).toEqual(["opinions"]);
    expect(TAXONOMY_VERSION).toBe("2026-10-02.4");
  });
  it("deduplicates harmless heading spelling differences without broad keyword guesses", () => {
    expect(headingIdentity("  COURT   Rules ")).toBe(headingIdentity("court rules"));
    expect(classifySource(["REGULATIONS & RULEMAKING", " regulations & rulemaking "])).toEqual([
      "regulations",
    ]);
    expect(classifySource(["Medical regulation gaps"])).toEqual(["other"]);
  });
  it("keeps mixed publisher histories and third-party summaries distinct from operative law", () => {
    expect(classify("openfda_device_classification_metadata")).toBe("data");
    expect(classify("openfda_device_enforcement_metadata")).toBe("enforcement");
    expect(classify("openfda_drug_enforcement_metadata")).toBe("enforcement");
    expect(classify("openfda_device_recall_metadata")).toBe("safety");
    expect(classify("mass_tort_authority_evidence")).toBe("mixed");
    expect(classify("jpml_html_reference")).toBe("mixed");
    expect(classify("federal_register_history")).toBe("mixed");
    expect(classify("limitation_periods")).toBe("guidance");
    expect(classify("verdict_reports")).toBe("data");
    expect(classify("indiana_code")).toBe("statutes");
    expect(classify("future_regulation_review_note")).toBe("other");
    expect(classify("ecfr_hierarchy")).toBe("data");
    expect(classify("ecfr_authority_notes")).toBe("data");
    expect(classify("dockets")).toBe("dockets");
    expect(classify("master_docket_entry")).toBe("dockets");
    expect(classify("opinions")).toBe("opinions");
  });
});
