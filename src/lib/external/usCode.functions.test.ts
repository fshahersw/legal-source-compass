import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import {
  decodeBody,
  ftsTerms,
  govinfoEditionUrl,
  LAW_ID,
  officialLink,
  parseCitationQuery,
  parseLaw,
  parseLines,
  parseLink,
  parseOutline,
  parseReleasePoint,
  parseSection,
  parseTitleDetail,
  parseTitleSummary,
  parseUnitHead,
  sectionNumberQuery,
  smartTitle,
  TITLE_KEY,
  titleListPath,
  titleSearchPath,
  UNIT_KEY,
} from "./usCode.functions";

const title42 = {
  key: "42",
  number: "42",
  label: "Title 42",
  name: "The Public Health and Welfare",
  appendix: false,
  positive_law: false,
  units: 8482,
  by_status: { none: 6000, repealed: 1500, weird: 3 },
  release: "119-124",
  law_date: "2026-10-15",
  changed_in_release: false,
  official_url: "https://uscode.house.gov/us/usc/119-124/t42/",
  outline: [
    [0, null, 0, "title", "Title 42—", "THE PUBLIC HEALTH AND WELFARE", null, 8482, 0],
    [411, 0, 1, "chapter", "CHAPTER 21—", "CIVIL RIGHTS", null, 500, 0],
    ["bad"],
  ],
  govinfo_years: [1994, 2024, 1800],
  zip: {
    url: "https://uscode.house.gov/download/releasepoints/us/pl/119/124/xml_usc42@119-124.zip",
    sha256: "ab",
    bytes: 10,
  },
};

describe("encoding of stored lines", () => {
  it("decodes indents, heading lines and table rows (mirror of bodytext.py)", () => {
    const text = [
      "\x1e(a) In general",
      "\tThe Architect shall—",
      "\t\t(1) the structure;",
      "\x1cIf taxable income is:\x1fThe tax is:",
      "\x1dNot over $36,900\x1f15%",
      "",
    ].join("\n");
    expect(decodeBody(text)).toEqual([
      { indent: 0, kind: "h", text: "(a) In general" },
      { indent: 1, kind: "p", text: "The Architect shall—" },
      { indent: 2, kind: "p", text: "(1) the structure;" },
      { indent: 0, kind: "th", cells: ["If taxable income is:", "The tax is:"] },
      { indent: 0, kind: "tr", cells: ["Not over $36,900", "15%"] },
    ]);
    expect(decodeBody("")).toEqual([]);
    expect(decodeBody(null)).toEqual([]);
  });

  it("reads note lines and drops malformed ones", () => {
    expect(
      parseLines([
        [0, "1990—Pub. L. 101–552 amended"],
        [1, ["a", "b"], "tr"],
        [0, "(a) X", "h"],
        ["x"],
        [0, ""],
      ]),
    ).toEqual([
      { indent: 0, kind: "p", text: "1990—Pub. L. 101–552 amended" },
      { indent: 1, kind: "tr", cells: ["a", "b"] },
      { indent: 0, kind: "h", text: "(a) X" },
    ]);
  });
});

describe("titles", () => {
  it("parses a title summary and its outline, dropping unknown statuses and bad nodes", () => {
    const t = parseTitleSummary("42", title42)!;
    expect(t.byStatus).toEqual({ none: 6000, repealed: 1500 });
    expect(t.officialUrl).toBe("https://uscode.house.gov/us/usc/119-124/t42/");
    expect(parseTitleSummary("43", title42)).toBeNull();
    expect(parseTitleSummary("99", { ...title42, key: "99" })).toBeNull();
    const d = parseTitleDetail("42", title42)!;
    expect(d.outline.map((n) => n.index)).toEqual([0, 411]);
    expect(d.outline[1]).toMatchObject({ parent: 0, depth: 1, kind: "chapter", total: 500 });
    expect(d.govinfoYears).toEqual([1994, 2024]);
    expect(d.zip?.url).toContain("xml_usc42@119-124.zip");
    expect(parseOutline("x")).toEqual([]);
  });

  it("reads only the summary fields when listing titles", () => {
    const p = titleListPath();
    expect(p).toContain("name:detail->usc_title->name");
    expect(p).not.toContain("outline");
  });

  it("validates keys", () => {
    for (const k of ["1", "5a", "42", "54", "28a"]) expect(TITLE_KEY.test(k)).toBe(true);
    for (const k of ["0", "55", "42b", "a"]) expect(TITLE_KEY.test(k)).toBe(false);
    for (const k of ["1983", "2000e-2", "courtRules_Civil_rule4", "6~2", "3+4", "c12-1-to-3"])
      expect(UNIT_KEY.test(k)).toBe(true);
    for (const k of ["", "../x", "a b", "-1"]) expect(UNIT_KEY.test(k)).toBe(false);
  });
});

describe("sections", () => {
  const row = {
    id: "42:1983",
    source_url: "https://uscode.house.gov/us/usc/119-124/t42/s1983/",
    text: "Every person who, under color of any statute ... shall be liable.",
    u: {
      release: "119-124",
      law_date: "2026-10-15",
      title: "42",
      key: "1983",
      kind: "section",
      citation: "42 U.S.C. § 1983",
      num: "§ 1983.",
      heading: "Civil action for deprivation of rights",
      status: null,
      path: [[411, "chapter", "CHAPTER 21—", "CIVIL RIGHTS"], ["bad"]],
      footnotes: [],
      credit: "(R.S. § 1979; Pub. L. 96–170, § 1, Dec. 29, 1979, 93 Stat. 1284.)",
      notes: [
        {
          g: "Editorial Notes",
          t: "amendments",
          h: "Amendments",
          l: [[0, "1979—Pub. L. 96–170 inserted"]],
          f: [],
        },
      ],
      url: "https://uscode.house.gov/us/usc/119-124/t42/s1983/",
      url_kind: "section",
      prev: ["1982", "42 U.S.C. § 1982"],
      next: ["1984", "42 U.S.C. § 1984"],
      govinfo_years: [1994, 2024],
      govinfo_basis: "section",
    },
  };

  it("parses a section with its notes and neighbours", () => {
    const s = parseSection(row)!;
    expect(s.citation).toBe("42 U.S.C. § 1983");
    expect(s.lines).toHaveLength(1);
    expect(s.path).toEqual([
      { index: 411, kind: "chapter", num: "CHAPTER 21—", heading: "CIVIL RIGHTS" },
    ]);
    expect(s.notes[0]!.lines[0]).toEqual({
      indent: 0,
      kind: "p",
      text: "1979—Pub. L. 96–170 inserted",
    });
    expect(s.prev).toEqual({ key: "1982", citation: "42 U.S.C. § 1982" });
    expect(s.govinfoYearsBasis).toBe("section");
    expect(s.urlKind).toBe("section");
  });

  it("refuses records whose id, title or link do not agree", () => {
    expect(parseSection({ ...row, id: "42:1984" })).toBeNull();
    expect(parseSection({ ...row, u: { ...row.u, kind: "chapter" } })).toBeNull();
    expect(
      parseSection({
        ...row,
        source_url: "https://example.com/x",
        u: { ...row.u, url: "https://github.com/x" },
      }),
    ).toBeNull();
    expect(parseSection({ ...row, u: { ...row.u, status: "gone" } })!.status).toBeNull();
  });

  it("parses unit heads only for the requested title", () => {
    expect(
      parseUnitHead(
        "42:1983",
        { citation: "42 U.S.C. § 1983", heading: "Civil action" },
        ["none"],
        "42",
      ),
    ).toEqual({
      id: "42:1983",
      key: "1983",
      citation: "42 U.S.C. § 1983",
      heading: "Civil action",
      status: null,
    });
    expect(parseUnitHead("42:3", { citation: "42 U.S.C. § 3" }, ["repealed"], "42")!.status).toBe(
      "repealed",
    );
    expect(parseUnitHead("41:1", { citation: "41 U.S.C. § 1" }, [], "42")).toBeNull();
  });
});

describe("laws linked to a section", () => {
  it("keeps links of this section with known kinds", () => {
    const l = parseLink(
      {
        l: {
          section: "42:1983",
          law: "stat-93-1284",
          kinds: ["source_credit", "made_up"],
          evidence: [["source_credit", "Pub. L. 96–170, § 1"]],
        },
      },
      "42:1983",
    )!;
    expect(l.kinds).toEqual(["source_credit"]);
    expect(
      parseLink(
        { l: { section: "42:1984", law: "stat-93-1284", kinds: ["source_credit"] } },
        "42:1983",
      ),
    ).toBeNull();
    expect(
      parseLink(
        { l: { section: "42:1983", law: "drop table", kinds: ["source_credit"] } },
        "42:1983",
      ),
    ).toBeNull();
  });

  it("parses a law with official GovInfo links only", () => {
    const law = parseLaw({
      id: "stat-93-1284",
      l: {
        label: "Pub. L. 96–170",
        title: "To amend section 1979 of the Revised Statutes",
        enacted: "1979-12-29",
        stat: { volume: 93, page: 1284 },
        govinfo: [
          {
            label: "93 Stat. 1284 on GovInfo",
            url: "https://www.govinfo.gov/link/statute/93/1284",
          },
          { label: "mirror", url: "https://example.org/x" },
        ],
      },
    })!;
    expect(law.statutes).toBe("93 Stat. 1284");
    expect(law.govinfo).toEqual([
      { label: "93 Stat. 1284 on GovInfo", url: "https://www.govinfo.gov/link/statute/93/1284" },
    ]);
    for (const id of ["stat-93-1284", "stat-32-735-2", "stat-18-doc12", "pl-119-124"])
      expect(LAW_ID.test(id)).toBe(true);
    expect(LAW_ID.test("stat-93")).toBe(false);
  });
});

describe("release points", () => {
  it("parses a release point with its change counts", () => {
    const p = parseReleasePoint(
      "119-124",
      {
        id: "119-124",
        law_date: "2026-10-15",
        law_date_text: "October 15, 2026",
        titles_affected: ["16", "29", "<b>"],
        current: true,
        held: true,
        changes: { from: "119-121", added: 0, changed: 8, repealed: 0, removed: 0 },
      },
      "https://uscode.house.gov/download.html",
    )!;
    expect(p.titles).toEqual(["16", "29"]);
    expect(p.changes?.changed).toBe(8);
    expect(parseReleasePoint("119-102not101", { id: "119-102not101" }, null)!.changes).toBeNull();
    expect(parseReleasePoint("x", { id: "x" }, null)).toBeNull();
  });
});

describe("queries and links", () => {
  it("reads citations typed in the search box", () => {
    expect(parseCitationQuery("42 U.S.C. § 1983")).toEqual({ title: "42", key: "1983" });
    expect(parseCitationQuery("42 usc 2000e–2")).toEqual({ title: "42", key: "2000e-2" });
    expect(parseCitationQuery("26 USC 1")).toEqual({ title: "26", key: "1" });
    expect(parseCitationQuery("civil rights")).toBeNull();
    expect(parseCitationQuery("99 U.S.C. 1")).toBeNull();
    expect(sectionNumberQuery("§ 1983")).toBe("1983");
    expect(sectionNumberQuery("deprivation")).toBeNull();
  });

  it("builds full-text search paths and edition links", () => {
    expect(ftsTerms("Civil rights!")).toBe("civil:*&rights:*");
    expect(ftsTerms("  ")).toBeNull();
    const p = titleSearchPath("42", "civil action")!;
    expect(p).toContain("dataset=eq.us_code_sections");
    expect(p).toContain(encodeURIComponent(JSON.stringify({ title: ["42"] })));
    expect(govinfoEditionUrl("42", "2000e-2", 2010)).toBe(
      "https://www.govinfo.gov/link/uscode/42/2000e-2?year=2010&type=usc&link-type=html",
    );
  });

  it("links only to the official publishers and title-cases capitals", () => {
    expect(officialLink("https://uscode.house.gov/us/usc/119-124/t42/s1983/")).not.toBeNull();
    expect(officialLink("https://www.govinfo.gov/link/statute/93/1284")).not.toBeNull();
    expect(officialLink("http://uscode.house.gov/x")).toBeNull();
    expect(officialLink("https://www.law.cornell.edu/uscode/text/42/1983")).toBeNull();
    expect(smartTitle("CIVIL RIGHTS")).toBe("Civil Rights");
    expect(smartTitle("TITLE II—CHILDREN'S PROGRAMS")).toBe("Title II—Children's Programs");
    expect(smartTitle("Already mixed")).toBe("Already mixed");
  });
});
