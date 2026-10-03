import { describe, expect, it } from "vitest";
import { canonicalSourceUrl, rankSearchMatches, searchDisplayTitle, searchQueryFilters, searchState, type SearchMatch } from "./searchQuality";
import type { SearchRecord } from "./searchIdentity";

function match(dataset: string, id: string, title: string, item: Record<string, unknown>, source_url: string | null = null): SearchMatch {
  const record: SearchRecord = { dataset, id, title, item, source_url, category: null, state: null };
  return { record, item };
}

// Minimal actual published-row projections, independently read from the ready corpus on 2026-10-02.
const talcMdl = match("mdls", "2738", "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation", {
  id: "mdl:2738", title: "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation", mdl_number: 2738, cl_court_id: "njd", as_of: "2026-09-01",
});
const talcSection = match("federal_regulations_sections", "cfr:21:73.1550", "Talc.", {
  id: "cfr:21:73.1550", title: "21", heading: "Talc.", citation: "21 C.F.R. § 73.1550",
}, "https://www.ecfr.gov/current/title-21/section-73.1550");

describe("published search quality", () => {
  it("displays the actual CFR citation and heading instead of the numeric title field", () => {
    expect(searchDisplayTitle(talcSection)).toBe("21 C.F.R. § 73.1550 — Talc.");
    expect(searchDisplayTitle(match("federal_regulations_sections", "cfr:21:82.1051", "Lakes (D&amp;C).", { title: "21", heading: "Lakes (D&amp;C).", citation: "21 C.F.R. § 82.1051" }))).toBe("21 C.F.R. § 82.1051 — Lakes (D&C).");
  });

  it("places the existing talc MDL in the first five ahead of body-only science matches", () => {
    const science = ["tp125-a.pdf", "tp125-c1.pdf", "tp125-c2.pdf", "tp125-c3.pdf", "tp125-c4.pdf", "tp125-c5.pdf"].map((file, index) => {
      const id = String(3542 + index);
      return match("agency_science_documents", id, "Toxicological Profile for Acrylonitrile", { id, title: "Toxicological Profile for Acrylonitrile" }, `https://www.atsdr.cdc.gov/ToxProfiles/${file}`);
    });
    const result = rankSearchMatches([...science, talcSection, talcMdl], "talc");
    expect(result.ranked.slice(0, 5).map((row) => row.record.id)).toContain("2738");
    expect(result.ranked[0]!.record.id).toBe("2738");
    expect(result.ranked.filter((row) => row.record.dataset === "agency_science_documents")).toHaveLength(6);
    expect(result.ranked.find((row) => row.record.id === "3543")!.sourceFileLabel).toBe("tp125-c1.pdf");
  });

  it("deduplicates native identity and exact source cards while preserving each original record link", () => {
    const a = match("agency_science_documents", "a", "Same source", { id: "a", title: "Same source", effective_date: "2026-01-01" }, "https://EXAMPLE.com:443/a.pdf#page=1");
    const b = match("agency_science_documents", "b", "Same source", { title: "Same source", effective_date: "2026-01-01", id: "b" }, "https://example.com/a.pdf#page=2");
    const nextVersion = match("agency_science_documents", "c", "Same source", { id: "c", title: "Same source", effective_date: "2026-02-01" }, "https://example.com/a.pdf");
    const result = rankSearchMatches([a, a, b, nextVersion], "source");
    expect(result.nativeRecords).toBe(3);
    expect(result.ranked).toHaveLength(2);
    expect(result.groupedSourceRecords).toBe(1);
    expect(result.ranked[0]!.alsoIndexedAs).toEqual([{ dataset: "agency_science_documents", id: "b" }]);
  });

  it("never groups same-title chapters, payload/provenance differences, native cases or cross-dataset rows", () => {
    const a = match("agency_science_documents", "a", "Profile", { id: "a", qualification: "first capture" }, "https://example.com/c1.pdf");
    const b = match("agency_science_documents", "b", "Profile", { id: "b", qualification: "second capture" }, "https://example.com/c1.pdf");
    const c = match("agency_science_documents", "c", "Profile", { id: "c", qualification: "first capture" }, "https://example.com/c2.pdf");
    const cases = ["1", "2"].map((id) => match("cl_dockets", id, "Profile", { id }, "https://example.com/c1.pdf"));
    const other = match("source_documents", "a", "Profile", { id: "a", qualification: "first capture" }, "https://example.com/c1.pdf");
    expect(rankSearchMatches([a, b, c, ...cases, other], "profile").ranked).toHaveLength(6);
  });

  it("retains meaningful URL query values and rejects credentialed/unsupported URLs", () => {
    expect(canonicalSourceUrl("https://example.com/a?z=1&b=2#part")).toBe("https://example.com/a?b=2&z=1");
    expect(canonicalSourceUrl("https://example.com/a?version=1")).not.toBe(canonicalSourceUrl("https://example.com/a?version=2"));
    expect(canonicalSourceUrl("https://user:secret@example.com/a")).toBeNull();
    expect(canonicalSourceUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalSourceUrl("/relative")).toBeNull();
  });

  it("restricts prefix retrieval to plain words without changing quoted or boolean query syntax", () => {
    expect(searchQueryFilters("talc")).toEqual({ __prefix: true });
    expect(searchQueryFilters("MDL 2738")).toEqual({ __prefix: true });
    expect(searchQueryFilters('"talc powder"')).toEqual({});
    expect(searchQueryFilters("talc -asbestos")).toEqual({});
    expect(searchQueryFilters("talc OR asbestos")).toEqual({});
  });

  it("tags the actual talc MDL only through its explicit native court and an exact directory location", () => {
    expect(searchState(talcMdl, new Map([["njd", "NJ"]]))).toEqual({ state: "NJ", stateBasis: "exact_court_location" });
    expect(searchState(talcMdl, new Map())).toEqual({ state: null, stateBasis: null });
    const nameOnly = match("mdls", "no-court-id", "D. New Jersey talc", { court_name: "D. New Jersey" });
    expect(searchState(nameOnly, new Map([["njd", "NJ"]]))).toEqual({ state: null, stateBasis: null });
  });
});
