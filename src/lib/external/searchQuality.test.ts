import { describe, expect, it } from "vitest";
import {
  canonicalSourceUrl,
  rankSearchMatches,
  searchDisplayTitle,
  searchIntent,
  searchKindLabel,
  searchQueryFilters,
  searchState,
  type SearchMatch,
} from "./searchQuality";
import type { SearchRecord } from "./searchIdentity";

function match(
  dataset: string,
  id: string,
  title: string,
  item: Record<string, unknown>,
  source_url: string | null = null,
): SearchMatch {
  const record: SearchRecord = {
    dataset,
    id,
    title,
    item,
    source_url,
    category: null,
    state: null,
  };
  return { record, item };
}

// Minimal actual published-row projections, independently read from the ready corpus on 2026-10-02.
const talcMdl = match(
  "mdls",
  "2738",
  "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation",
  {
    id: "mdl:2738",
    title:
      "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation",
    mdl_number: 2738,
    cl_court_id: "njd",
    as_of: "2026-09-01",
  },
);
const talcSection = match(
  "federal_regulations_sections",
  "cfr:21:73.1550",
  "Talc.",
  {
    id: "cfr:21:73.1550",
    title: "21",
    heading: "Talc.",
    citation: "21 C.F.R. § 73.1550",
  },
  "https://www.ecfr.gov/current/title-21/section-73.1550",
);

describe("published search quality", () => {
  it("displays the actual CFR citation and heading instead of the numeric title field", () => {
    expect(searchDisplayTitle(talcSection)).toBe("21 C.F.R. § 73.1550 — Talc.");
    expect(
      searchDisplayTitle(
        match("federal_regulations_sections", "cfr:21:82.1051", "Lakes (D&amp;C).", {
          title: "21",
          heading: "Lakes (D&amp;C).",
          citation: "21 C.F.R. § 82.1051",
        }),
      ),
    ).toBe("21 C.F.R. § 82.1051 — Lakes (D&C).");
  });

  it("places the existing talc MDL in the first five ahead of body-only science matches", () => {
    const science = [
      "tp125-a.pdf",
      "tp125-c1.pdf",
      "tp125-c2.pdf",
      "tp125-c3.pdf",
      "tp125-c4.pdf",
      "tp125-c5.pdf",
    ].map((file, index) => {
      const id = String(3542 + index);
      return match(
        "agency_science_documents",
        id,
        "Toxicological Profile for Acrylonitrile",
        { id, title: "Toxicological Profile for Acrylonitrile" },
        `https://www.atsdr.cdc.gov/ToxProfiles/${file}`,
      );
    });
    const result = rankSearchMatches([...science, talcSection, talcMdl], "talc");
    expect(result.ranked.slice(0, 5).map((row) => row.record.id)).toContain("2738");
    expect(result.ranked[0]!.record.id).toBe("2738");
    expect(
      result.ranked.filter((row) => row.record.dataset === "agency_science_documents"),
    ).toHaveLength(6);
    expect(result.ranked.find((row) => row.record.id === "3543")!.sourceFileLabel).toBe(
      "tp125-c1.pdf",
    );
  });

  it("deduplicates native identity and exact source cards while preserving each original record link", () => {
    const a = match(
      "agency_science_documents",
      "a",
      "Same source",
      { id: "a", title: "Same source", effective_date: "2026-01-01" },
      "https://EXAMPLE.com:443/a.pdf#page=1",
    );
    const b = match(
      "agency_science_documents",
      "b",
      "Same source",
      { title: "Same source", effective_date: "2026-01-01", id: "b" },
      "https://example.com/a.pdf#page=2",
    );
    const nextVersion = match(
      "agency_science_documents",
      "c",
      "Same source",
      { id: "c", title: "Same source", effective_date: "2026-02-01" },
      "https://example.com/a.pdf",
    );
    const result = rankSearchMatches([a, a, b, nextVersion], "source");
    expect(result.nativeRecords).toBe(3);
    expect(result.ranked).toHaveLength(2);
    expect(result.groupedSourceRecords).toBe(1);
    expect(result.ranked[0]!.alsoIndexedAs).toEqual([
      { dataset: "agency_science_documents", id: "b" },
    ]);
  });

  it("never groups same-title chapters, payload/provenance differences, native cases or cross-dataset rows", () => {
    const a = match(
      "agency_science_documents",
      "a",
      "Profile",
      { id: "a", qualification: "first capture" },
      "https://example.com/c1.pdf",
    );
    const b = match(
      "agency_science_documents",
      "b",
      "Profile",
      { id: "b", qualification: "second capture" },
      "https://example.com/c1.pdf",
    );
    const c = match(
      "agency_science_documents",
      "c",
      "Profile",
      { id: "c", qualification: "first capture" },
      "https://example.com/c2.pdf",
    );
    const cases = ["1", "2"].map((id) =>
      match("cl_dockets", id, "Profile", { id }, "https://example.com/c1.pdf"),
    );
    const other = match(
      "source_documents",
      "a",
      "Profile",
      { id: "a", qualification: "first capture" },
      "https://example.com/c1.pdf",
    );
    expect(rankSearchMatches([a, b, c, ...cases, other], "profile").ranked).toHaveLength(6);
  });

  it("retains meaningful URL query values and rejects credentialed/unsupported URLs", () => {
    expect(canonicalSourceUrl("https://example.com/a?z=1&b=2#part")).toBe(
      "https://example.com/a?b=2&z=1",
    );
    expect(canonicalSourceUrl("https://example.com/a?version=1")).not.toBe(
      canonicalSourceUrl("https://example.com/a?version=2"),
    );
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
    expect(searchState(talcMdl, new Map([["njd", "NJ"]]))).toEqual({
      state: "NJ",
      stateBasis: "exact_court_location",
    });
    expect(searchState(talcMdl, new Map())).toEqual({ state: null, stateBasis: null });
    const nameOnly = match("mdls", "no-court-id", "D. New Jersey talc", {
      court_name: "D. New Jersey",
    });
    expect(searchState(nameOnly, new Map([["njd", "NJ"]]))).toEqual({
      state: null,
      stateBasis: null,
    });
  });
});

// Rows as read from the published corpus on 2026-10-03 (ids and titles only).
const rodgersPerson = match("cl_people", "2755", "Margaret Catharine Rodgers", {
  id: "2755",
  title: "Margaret Catharine Rodgers",
});
const otherRodgers = match("cl_people", "4903", "Henry Lee Rodgers", {
  id: "4903",
  title: "Henry Lee Rodgers",
});
const peopleVRodgers = match(
  "saved_pages",
  "6880",
  "5100140, People v. Rodgers",
  { id: "6880", title: "5100140, People v. Rodgers" },
  "https://example.test/6880",
);
const carlos = match(
  "focused",
  "1c9b7c7e",
  "Carlos Rodgers |",
  { id: "1c9b7c7e", title: "Carlos Rodgers |" },
  "https://example.test/carlos",
);
const depoMdl = match(
  "mdls",
  "3140",
  "IN RE: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation",
  { id: "mdl:3140", mdl_number: 3140 },
);
const depoRegistry = match(
  "sw_matters_v1",
  "sw-matter:3140",
  "IN RE: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation",
  {
    id: "sw-matter:3140",
    cells: { mdl_number: 3140, tier: "tier1" },
  },
);

describe("person-intent search", () => {
  it("treats a leading honorific plus a short name as a search for a person and drops the honorific from the query", () => {
    expect(searchIntent("Judge Rodgers")).toEqual({ honorific: true, query: "Rodgers" });
    expect(searchIntent("  hon. Casey Rodgers ")).toEqual({
      honorific: true,
      query: "Casey Rodgers",
    });
    expect(searchIntent("Honorable Yvonne Gonzalez Rogers")).toEqual({
      honorific: true,
      query: "Yvonne Gonzalez Rogers",
    });
    expect(searchIntent("Magistrate Judge Cannon")).toEqual({ honorific: true, query: "Cannon" });
    expect(searchIntent("Justice Kagan")).toEqual({ honorific: true, query: "Kagan" });
  });

  it("leaves everything else exactly as typed", () => {
    for (const q of [
      "Rodgers",
      "judge",
      "Judge",
      "Justice for victims act",
      "judge and jury trial rules",
      "Judge Rodgers order granting motion to dismiss",
      'Judge "Rodgers"',
      "talc",
      "Judgement Rodgers",
    ])
      expect(searchIntent(q)).toEqual({ honorific: false, query: q.trim() });
  });

  it("ranks the person who presides over an MDL first, then other people, then same-surname documents", () => {
    const mdlJudges = new Set(["2755"]);
    const result = rankSearchMatches(
      [peopleVRodgers, carlos, otherRodgers, rodgersPerson],
      "Judge Rodgers",
      { mdlJudgePersonIds: mdlJudges },
    );
    expect(result.ranked.map((m) => m.record.id)).toEqual(["2755", "4903", "6880", "1c9b7c7e"]);
  });

  it("does not boost people when the query has no honorific, and does not need the MDL-judge set to rank people above documents", () => {
    const plain = rankSearchMatches(
      [peopleVRodgers, carlos, otherRodgers, rodgersPerson],
      "Rodgers",
    );
    expect(
      plain.ranked
        .slice(0, 2)
        .map((m) => m.record.dataset)
        .sort(),
    ).not.toEqual(["cl_people", "cl_people"]);
    const withoutSet = rankSearchMatches(
      [peopleVRodgers, carlos, otherRodgers, rodgersPerson],
      "Judge Rodgers",
    );
    expect(withoutSet.ranked.slice(0, 2).map((m) => m.record.dataset)).toEqual([
      "cl_people",
      "cl_people",
    ]);
  });

  it("labels a matter-registry record with its MDL number", () => {
    expect(searchDisplayTitle(depoRegistry)).toBe(
      "MDL 3140 — IN RE: Depo-Provera (Depot Medroxyprogesterone Acetate) Products Liability Litigation",
    );
    expect(searchDisplayTitle(match("sw_matters_v1", "x", "Caption", { cells: {} }))).toBe(
      "Caption",
    );
    const ranked = rankSearchMatches([depoRegistry, depoMdl], "Depo-Provera").ranked;
    expect(ranked[0]!.record.dataset).toBe("mdls");
    expect(ranked.map((m) => m.record.dataset)).toContain("sw_matters_v1");
  });
});

describe("person-intent search: judge-directory records are joined by native id only", () => {
  const directory = (id: string, name: string, entity: string) =>
    match("judges", id, name, { id, name, role: "Judicial profile", entity_id: entity });
  const presiding = directory(
    "b7f3af1c913d",
    "Margaret Catharine Rodgers",
    "judge-entity-24222174cb13b7162bfcfcbc",
  );
  const namesake = directory(
    "0aa11bb22cc3",
    "Margaret Catharine Rodgers",
    "judge-entity-ffffffffffffffffffff",
  );
  const aSurname = directory("0000aaaabbbb", "Edward Rodgers", "judge-entity-eeeeeeeeeeeeeeeeeeee");

  it("lifts the directory profile whose entity id the MDL record links, not a namesake or another surname", () => {
    const context = { mdlJudgeEntityIds: new Set(["judge-entity-24222174cb13b7162bfcfcbc"]) };
    const ranked = rankSearchMatches(
      [aSurname, namesake, presiding],
      "Judge Rodgers",
      context,
    ).ranked;
    expect(ranked[0]!.record.id).toBe("b7f3af1c913d");
    // Without the MDL link all three are equally people-intent hits and order falls back to the title.
    const flat = rankSearchMatches([aSurname, namesake, presiding], "Judge Rodgers").ranked;
    expect(flat[0]!.record.id).toBe("0000aaaabbbb");
  });
});

describe("entity-name queries", () => {
  const firm = match("counsel_directory", "firm:3f24b0b7635a81a8", "Seeger Weiss LLP", {
    id: "firm:3f24b0b7635a81a8",
  });
  const orderText =
    "CASE MANAGEMENT ORDER NO. 5. THE FOLLOWING THREE COUNSEL ARE APPOINTED AS CO-LEAD COUNSEL FOR PLAINTIFFS: PARVIN AMINOLROAYA OF SEEGER WEISS LLP, JONATHAN D. ORENT OF MOTLEY RICE LLC";
  const order = match("mdl_docket_documents", "doc:68222905:56:56:6962", orderText, {
    id: "doc:68222905:56:56:6962",
  });
  const attorney = match("mdl_appearances", "02fa9016", "Christopher A Seeger", { id: "02fa9016" });

  it("puts the record named by the query ahead of a long title that merely contains the name", () => {
    expect(rankSearchMatches([order, attorney, firm], "Seeger Weiss").ranked[0]!.record.id).toBe(
      "firm:3f24b0b7635a81a8",
    );
    expect(rankSearchMatches([order, firm], "seeger weiss llp").ranked[0]!.record.id).toBe(
      "firm:3f24b0b7635a81a8",
    );
  });

  it("does not reward a partial or reordered name", () => {
    const partial = match("cl_people", "9", "Seeger", { id: "9" });
    const ranked = rankSearchMatches([partial, firm], "Seeger Weiss").ranked;
    expect(ranked[0]!.record.id).toBe("firm:3f24b0b7635a81a8");
    const reordered = match("cl_people", "10", "Weiss Seeger", { id: "10" });
    const r2 = rankSearchMatches([reordered, firm], "Seeger Weiss").ranked;
    expect(r2[0]!.record.id).toBe("firm:3f24b0b7635a81a8");
  });
});

describe("result kind labels", () => {
  it("drops a kind that only repeats the dataset", () => {
    expect(searchKindLabel("counsel_directory", "counsel_directory")).toBeNull();
    expect(searchKindLabel("mdl_docket_documents", "mdl_docket_documents")).toBeNull();
    // The matter registry's kinds are singular forms of its versioned dataset ids.
    expect(searchKindLabel("sw_matter", "sw_matters_v1")).toBeNull();
    expect(searchKindLabel("sw_matter_docket", "sw_matter_dockets_v1")).toBeNull();
    expect(searchKindLabel(null, "judges")).toBeNull();
    expect(searchKindLabel("  ", "judges")).toBeNull();
  });

  it("keeps a kind that says something the dataset does not", () => {
    expect(searchKindLabel("order", "mdl_docket_documents")).toBe("order");
    expect(searchKindLabel("expert_ruling", "mdl_docket_documents")).toBe("expert ruling");
    expect(searchKindLabel("sw_matter", "mdl_docket_documents")).toBe("sw matter");
  });
});
