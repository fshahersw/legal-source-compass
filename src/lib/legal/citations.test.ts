import { describe, expect, it } from "vitest";
import { citationSpanMatches, parsedCitation, primaryOpinion } from "./citations";
import { legalRecord } from "./schema";
import type { LegalRecord } from "./schema";

const opinion = (patch: Partial<LegalRecord> = {}): LegalRecord => legalRecord.parse({
  id: "12", type: "opinion", id_authority: "cap", title: "Lozano v. Montoya Alvarez", title_source: "api", jurisdiction: "US", court_id: "scotus",
  date: "2014-03-05", date_type: "decided", source_url: "https://static.case.law/us/572/0001-01.html", source_name: "Caselaw Access Project",
  licence: "CC0 1.0 Universal", retrieved_at: "2026-10-02T12:00:00Z", version: "original", confidence: 1, extraction_method: "bulk",
  identifiers: { cap_case_id: "12" }, attributes: {}, ...patch,
});
describe("exact reporter citation resolution", () => {
  const citation = "572 U.S. 1";
  const cl = opinion({ id: "33", id_authority: "courtlistener", identifiers: { courtlistener_opinion_id: "33" } });
  it("keeps the CourtListener ID primary only for a unique date/court match", () => {
    const result = primaryOpinion(opinion(), [citation], new Map([[citation, [cl]]]));
    expect(result.primary.id_authority).toBe("courtlistener");
    expect(result.primary.id).toBe("33");
    expect(result.requires_review).toBe(false);
    expect(primaryOpinion(cl, [], new Map()).primary.id).toBe("33");
  });
  it("retains conflicting, absent, or ambiguous citations without inventing a join", () => {
    for (const rows of [[], [{ ...cl, court_id: "ca3" }], [{ ...cl, date: "2014-03-06" }], [cl, { ...cl, id: "34" }], [cl, { ...cl, id: "34", court_id: "ca3" }]]) {
      const result = primaryOpinion(opinion(), [citation], new Map([[citation, rows]]));
      expect(result.primary.id_authority).toBe("cap");
      expect(result.requires_review).toBe(true);
    }
  });
  it("chooses the latest retained version of the same primary opinion without merging distinct IDs", () => {
    const newer = { ...cl, version: "new", retrieved_at: "2026-10-02T13:00:00Z" };
    const result = primaryOpinion(opinion(), [citation, citation], new Map([[citation, [cl, newer]]]));
    expect(result.primary.version).toBe("new");
    expect(result.candidates).toHaveLength(1);
  });
  it("verifies Unicode code-point offsets against the exact source version and URL", () => {
    const source = opinion({ attributes: { text: `😀 ${citation} later` } });
    const parsed = parsedCitation.parse({ source_record: { id: source.id, type: source.type, id_authority: source.id_authority, version: source.version },
      source_url: source.source_url, date: source.date, raw: citation, normalized: citation, evidence: { start: 2, end: 12 }, extraction_method: "eyecite",
      parser_version: "2.7.8", source_text_sha256: "a".repeat(64), parser_class: "FullCaseCitation", groups: {}, resolved_record: null });
    expect(citationSpanMatches(parsed, source)).toBe(true);
    expect(citationSpanMatches({ ...parsed, evidence: { start: 3, end: 13 } }, source)).toBe(false);
    expect(citationSpanMatches(parsed, { ...source, version: "another" })).toBe(false);
    expect(citationSpanMatches(parsed, { ...source, source_url: "https://example.com/unrelated" })).toBe(false);
  });
});
