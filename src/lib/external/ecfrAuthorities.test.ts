import { describe, expect, it } from "vitest";
import {
  inList,
  linkStateLabel,
  mergeAuthorities,
  mergeByCfrTitle,
  parseAuthorityLink,
  parseAuthorityRow,
  parseAuthorityRows,
  parseTableMeta,
  partHeading,
  partIds,
  PART_TOKEN,
  sectionAuthorities,
  sectionKeyId,
} from "./ecfrAuthorities";
import { stored } from "./ecfrAuthorities.fixtures";

describe("parseAuthorityRow", () => {
  it("reads a stored row", () => {
    const r = parseAuthorityRow(stored())!;
    expect(r.citation).toBe("42 U.S.C. 1395hh");
    expect(r.link.state).toBe("resolved");
    expect(r.link.id).toBe("42:1395hh");
    expect(r.cfr.title).toBe(42);
    expect(r.cfr.partsStored).toEqual(["400", "405"]);
    expect(r.page).toBe(1034);
    expect(r.sourceUrl).toContain("govinfo.gov");
  });

  it("drops malformed rows instead of repairing them", () => {
    expect(parseAuthorityRow(null)).toBeNull();
    expect(parseAuthorityRow({ id: "x" })).toBeNull();
    expect(parseAuthorityRow(stored({ category: "regulation" }))).toBeNull();
    expect(parseAuthorityRow(stored({ authority: "" }))).toBeNull();
    expect(parseAuthorityRow(stored({}, { title: 51 }))).toBeNull();
    expect(parseAuthorityRow(stored({}, { title: "42" }))).toBeNull();
    expect(parseAuthorityRow(stored({}, { parts: ["400", "../x"] }))).toBeNull();
    expect(parseAuthorityRow(stored({}, { parts_stored: ["999"] }))).toBeNull(); // stored parts must be listed parts
    expect(parseAuthorityRow(stored({}, { parts_text: "" }))).toBeNull();
  });

  it("trusts a link only when its id is exactly title:key", () => {
    expect(parseAuthorityRow(stored({}, {}, { id: "42:1395" }))).toBeNull();
    expect(parseAuthorityRow(stored({}, {}, { key: "13 95" }))).toBeNull();
    expect(parseAuthorityRow(stored({}, {}, { state: "linked" }))).toBeNull();
    const nl = parseAuthorityRow(
      stored({}, {}, { state: "not_in_stored_code", id: null, reason: "No section" }),
    )!;
    expect(nl.link.id).toBeNull();
    expect(nl.link.reason).toBe("No section");
  });

  it("only keeps GovInfo source addresses", () => {
    const r = stored() as { source_url: string };
    r.source_url = "https://example.com/x.pdf";
    expect(parseAuthorityRow(r)!.sourceUrl).toBeNull();
  });

  it("counts the rows it drops", () => {
    const out = parseAuthorityRows([
      stored(),
      { id: "bad" },
      stored({}, {}, {}, "usc:42:1395hh:cfr45"),
    ]);
    expect(out.rows).toHaveLength(2);
    expect(out.dropped).toBe(1);
    expect(parseAuthorityRows("nope")).toEqual({ rows: [], dropped: 0 });
  });

  it("reads a range with its end flags and an et seq. row", () => {
    const l = parseAuthorityLink({
      state: "range",
      start: "301",
      end: "303",
      start_stored: true,
      end_stored: false,
    })!;
    expect([l.start, l.end, l.startStored, l.endStored, l.id]).toEqual([
      "301",
      "303",
      true,
      false,
      null,
    ]);
    expect(linkStateLabel(l)).toMatch(/Range/);
    expect(linkStateLabel(parseAuthorityLink({ state: "et_seq", start: "1395" })!)).toMatch(
      /et seq/,
    );
  });
});

describe("part tokens and ids", () => {
  it("accepts the designations the eCFR prints and nothing path-like", () => {
    for (const t of ["314", "15F", "101-6", "10201", "1a", "302-12", "60-4"])
      expect(PART_TOKEN.test(t)).toBe(true);
    for (const t of ["", "../1", "a1", "1 2", "1--2", "1/2", "-1"])
      expect(PART_TOKEN.test(t)).toBe(false);
  });

  it("builds exact part ids, skipping duplicates and invalid keys", () => {
    expect(partIds(["21:314", "21:314", "40:63", "51:1", "21:../x", "x"])).toEqual([
      "cfr:21:part-314",
      "cfr:40:part-63",
    ]);
  });

  it("quotes every id of an in() list", () => {
    expect(inList(["cfr:21:part-314", 'a"b'])).toBe('in.("cfr:21:part-314","ab")');
  });

  it("derives a part heading by removing the citation the title repeats", () => {
    expect(partHeading("21 CFR Part 314—Applications for FDA Approval to Market a New Drug")).toBe(
      "Applications for FDA Approval to Market a New Drug",
    );
    expect(partHeading("41 CFR Part 101-6—Federal Property")).toBe("Federal Property");
    expect(partHeading("Something else")).toBe("Something else");
    expect(partHeading(null)).toBeNull();
  });

  it("validates a section key before it becomes an id", () => {
    expect(sectionKeyId("42", "1395hh")).toBe("42:1395hh");
    expect(sectionKeyId("5a", "c1-1")).toBe("5a:c1-1");
    expect(sectionKeyId("55", "1")).toBeNull();
    expect(sectionKeyId("42", "../x")).toBeNull();
  });
});

describe("merging", () => {
  const a = parseAuthorityRow(stored())!;
  const b = parseAuthorityRow(
    stored(
      { page: 1035 },
      { title: 42, parts_text: "405, 410", parts: ["405", "410"], parts_stored: ["405", "410"] },
      {},
      "usc:42:1395hh:cfr42~2",
    ),
  )!;
  const c = parseAuthorityRow(
    stored(
      {},
      {
        title: 45,
        parts_text: "5",
        parts: ["5"],
        parts_stored: [],
        part_ranges: ["1301--1309"],
        unparsed: ["152 153"],
      },
      {},
      "usc:42:1395hh:cfr45",
    ),
  )!;

  it("lists each CFR title once with its parts in first-printed order", () => {
    const g = mergeByCfrTitle([c, a, b]);
    expect(g.map((x) => x.cfrTitle)).toEqual([42, 45]);
    expect(g[0]!.parts).toEqual([
      { part: "400", stored: true },
      { part: "405", stored: true },
      { part: "9999", stored: false },
      { part: "410", stored: true },
    ]);
    expect(g[0]!.pages).toEqual([1034, 1035]);
    expect(g[1]!.ranges).toEqual(["1301--1309"]);
    expect(g[1]!.unparsed).toEqual(["152 153"]);
  });

  it("merges one printed authority across its CFR title groups", () => {
    const m = mergeAuthorities([a, b, c]);
    expect(m).toHaveLength(1);
    expect(m[0]!.cfrTitles).toEqual([42, 45]);
    expect(m[0]!.pages).toEqual([1034, 1035]);
  });

  it("sorts authorities into the sections the part page shows", () => {
    const rows = [
      a,
      parseAuthorityRow(
        stored(
          { authority: "301 et seq.", citation: "5 U.S.C. 301 et seq.", heading: "5 U.S.C." },
          {},
          { state: "et_seq", id: null, key: null, title: "5", start: "301" },
          "usc:5:301_et_seq.:cfr42",
        ),
      )!,
      parseAuthorityRow(
        stored(
          { authority: "1", citation: "5 U.S.C. 1", heading: "5 U.S.C." },
          {},
          { state: "not_in_stored_code", id: null, title: "5", key: "1" },
          "usc:5:1:cfr42",
        ),
      )!,
      parseAuthorityRow(
        stored(
          { category: "stat", heading: "106 Stat.", authority: "606", citation: "106 Stat. 606" },
          {},
          { state: "not_applicable", id: null, title: null, key: null },
          "stat:106:606:cfr42",
        ),
      )!,
      parseAuthorityRow(
        stored(
          {
            category: "publaw",
            heading: "Public Laws",
            authority: "87-328",
            citation: "Pub. L. 87-328",
          },
          {},
          { state: "not_applicable", id: null, title: null, key: null },
          "publaw:87-328:cfr42",
        ),
      )!,
      parseAuthorityRow(
        stored(
          {
            category: "presidential",
            sub: "Executive Orders",
            heading: "Executive Orders:",
            authority: "1209",
            citation: "Executive Orders: 1209",
          },
          {},
          { state: "not_applicable", id: null, title: null, key: null },
          "pres:EO:1209:cfr42",
        ),
      )!,
    ];
    const s = sectionAuthorities(mergeAuthorities(rows));
    expect(s.statutes.map((x) => x.authority)).toEqual(["1395hh", "1"]);
    expect(s.rangesAndOther.map((x) => x.authority)).toEqual(["301 et seq."]);
    expect(s.statutesAtLarge).toHaveLength(1);
    expect(s.publicLaws).toHaveLength(1);
    expect(s.presidential).toHaveLength(1);
  });
});

describe("parseTableMeta", () => {
  it("reads edition and revision date from the catalog summary", () => {
    expect(
      parseTableMeta({
        summary: {
          edition: "2025",
          table_revised_as_of: "January 1, 2025",
          retrieved_at: "2026-10-23T04:52:20Z",
        },
      }),
    ).toEqual({
      edition: "2025",
      revisedAsOf: "January 1, 2025",
      retrievedAt: "2026-10-23T04:52:20Z",
    });
    expect(parseTableMeta(null)).toEqual({ edition: null, revisedAsOf: null, retrievedAt: null });
  });
});
