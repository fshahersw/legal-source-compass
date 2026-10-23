import { describe, expect, it } from "vitest";
import {
  codePointMapper,
  courtListenerCaseUrl,
  coveringRange,
  orderOpinions,
  parseAuthorities,
  parseCaseHit,
  parseCaseRow,
  parseCitator,
  parseLiveHit,
  parseReadingRecord,
  segmentOpinion,
  snippetText,
  type OpinionRef,
} from "./caselaw";

const KEY = "caselaw/read/2026-09-30/t1/scotus/scotus-1960s-0003-0123456789ab.jsonl.gz";
const CKEY = "caselaw/citator/2026-09-30/c12-0000-0123456789ab.jsonl.gz";

const row = {
  cluster_id: 107252,
  tier: 1,
  court_id: "scotus",
  court: { full_name: "Supreme Court of the United States", short_name: "SCOTUS" },
  date_filed: "1966-06-13",
  date_approx: false,
  case_name: "Miranda v. Arizona",
  case_name_full: "Miranda v. Arizona",
  docket_number: "759",
  precedential_status: "Published",
  citation_count: 58593,
  cited_by: 1200,
  cited_by_cases: 1100,
  parentheticals: 40,
  authorities: 3,
  citations: ["384 U.S. 436", "86 S. Ct. 1602", 7],
  judges: "Warren, Black",
  panel: null,
  disposition: null,
  scdb: { id: "1965-120", decision_direction: 2, votes_majority: 5, votes_minority: 4 },
  opinions: [
    {
      id: 9423233,
      type: "020lead",
      author: "Warren",
      per_curiam: false,
      o: 4,
      s: 100,
      n: 50,
      key: KEY,
    },
    {
      id: 9423235,
      type: "040dissent",
      author: "Harlan",
      per_curiam: false,
      o: 4,
      s: 150,
      n: 30,
      key: KEY,
    },
    {
      id: 107252,
      type: "010combined",
      author: null,
      per_curiam: false,
      o: 4,
      s: 0,
      n: 100,
      key: KEY,
    },
    {
      id: 9423234,
      type: "035concurrenceinpart",
      author: "Clark",
      key: "elsewhere/x.gz",
      s: 1,
      n: 1,
    },
  ],
  citator: { key: CKEY, offset: 10, length: 20 },
  authorities_ref: null,
};

describe("parseCaseRow", () => {
  it("parses a row, drops malformed values and unknown keys", () => {
    const r = parseCaseRow(row, 107252)!;
    expect(r.caseName).toBe("Miranda v. Arizona");
    expect(r.caseNameFull).toBeNull();
    expect(r.court).toBe("Supreme Court of the United States");
    expect(r.citations).toEqual(["384 U.S. 436", "86 S. Ct. 1602"]);
    expect(r.scdb).toEqual({
      id: "1965-120",
      decisionDirection: 2,
      votesMajority: 5,
      votesMinority: 4,
    });
    expect(r.opinions.map((o) => [o.id, o.label, !!o.pointer])).toEqual([
      [9423233, "Majority opinion", true],
      [9423235, "Dissent", true],
      [107252, "Combined opinion", true],
      [9423234, "Concurrence in part", false],
    ]);
    expect(r.citator).toEqual({ key: CKEY, offset: 10, length: 20 });
    expect(r.authoritiesRef).toBeNull();
    expect(r.courtListenerUrl).toBe(
      "https://www.courtlistener.com/opinion/107252/miranda-v-arizona/",
    );
  });
  it("rejects another id or a row without a name", () => {
    expect(parseCaseRow(row, 1)).toBeNull();
    expect(parseCaseRow({ ...row, case_name: " " }, 107252)).toBeNull();
    expect(parseCaseRow(null, 107252)).toBeNull();
  });
  it("puts a combined text after the split opinions", () => {
    const r = parseCaseRow(row, 107252)!;
    expect(orderOpinions(r.opinions).map((o) => o.id)).toEqual([9423233, 9423235, 9423234, 107252]);
    const only: OpinionRef[] = [{ ...r.opinions[2]! }];
    expect(orderOpinions(only).map((o) => o.id)).toEqual([107252]);
  });
  it("covers all pointers with one range, or none when keys differ", () => {
    const r = parseCaseRow(row, 107252)!;
    const ptrs = r.opinions.filter((o) => o.pointer).map((o) => o.pointer!);
    expect(coveringRange(ptrs)).toEqual({ key: KEY, start: 0, end: 180 });
    expect(coveringRange([...ptrs, { key: CKEY, offset: 0, length: 1 }])).toBeNull();
    expect(coveringRange([])).toBeNull();
  });
});

describe("reading records", () => {
  it("maps code-point offsets to UTF-16 indexes", () => {
    const t = "a😀b*12c";
    const m = codePointMapper(t);
    expect(m(0)).toBe(0);
    expect(m(1)).toBe(1);
    expect(m(2)).toBe(3);
    expect(t.slice(m(3), m(6))).toBe("*12");
    expect(codePointMapper("plain")(3)).toBe(3);
  });

  it("parses pages and citations with astral characters before them", () => {
    const text = "😀 See 1 U.S. 1 *5 more";
    const rec = parseReadingRecord(
      {
        format: "caselaw-read/1",
        opinion_id: 5,
        cluster_id: 7,
        text,
        pages: [["5", 1, 15], ["bad"]],
        citations: [
          [6, 14, 100, 11, 1],
          [3, 2, 1, 1, 0],
        ],
        pages_source: "chosen_markup",
        source_url: "javascript:alert(1)",
      },
      5,
    )!;
    expect(rec.pages).toEqual([{ label: "5", index: 1, offset: 16 }]);
    expect(text.slice(rec.citations[0]!.start, rec.citations[0]!.end)).toBe("1 U.S. 1");
    expect(rec.citations).toHaveLength(1);
    expect(rec.sourceUrl).toBeNull();
    expect(
      parseReadingRecord({ format: "caselaw-read/1", opinion_id: 6, cluster_id: 7, text }, 5),
    ).toBeNull();
  });

  it("segments text: markers become labels, citations split around them, nothing lost", () => {
    const text = "Held *437 that. See Escobedo v. *438 Illinois, 378 U.S. 478.";
    const pages = [
      { label: "437", index: 1, offset: 5 },
      { label: "438", index: 1, offset: 32 },
      { label: "439", index: 1, offset: text.length },
    ];
    const cites = [{ start: 20, end: 45, clusterId: 1, opinionId: 2, held: true }];
    const segs = segmentOpinion(text, pages, cites);
    expect(segs).toEqual([
      { kind: "text", text: "Held " },
      { kind: "page", label: "437", index: 1 },
      { kind: "text", text: " that. See " },
      { kind: "cite", text: "Escobedo v. ", clusterId: 1, held: true },
      { kind: "page", label: "438", index: 1 },
      { kind: "cite", text: " Illinois", clusterId: 1, held: true },
      { kind: "text", text: ", 378 U.S. 478." },
      { kind: "page", label: "439", index: 1 },
    ]);
    const rebuilt = segs
      .map((s) => (s.kind === "page" ? (s.label === "439" ? "" : `*${s.label}`) : s.text))
      .join("");
    expect(rebuilt).toBe(text);
  });

  it("inserts a label where the marker text is absent (aligned pagination)", () => {
    expect(segmentOpinion("abcdef", [{ label: "9", index: null, offset: 3 }], [])).toEqual([
      { kind: "text", text: "abc" },
      { kind: "page", label: "9", index: null },
      { kind: "text", text: "def" },
    ]);
  });
});

describe("citator and authorities", () => {
  it("parses the cited-by member", () => {
    const c = parseCitator(
      {
        format: "caselaw-citator/1",
        cluster_id: 7,
        cited_by: { opinions: 4, cases: 3 },
        by_court: [
          ["ca1", 3],
          ["cal", 1],
          ["BAD ID", 2],
        ],
        by_decade: [
          [1990, 2],
          [null, 1],
        ],
        by_court_decade: [["ca1", 1990, 2]],
        citing: [
          {
            cluster_id: 2000,
            name: "Citing A",
            court_id: "ca1",
            date: "1999-05-01",
            citation: "5 F.3d 1",
            citation_count: 50,
            depth: 3,
            opinions: 2,
            held: 0,
          },
          { name: "no id" },
        ],
        parentheticals: [
          {
            text: "holding x",
            score: 0.5,
            cluster_id: 3,
            name: "P",
            court_id: "cal",
            date: "2001-01-01",
            held: 1,
          },
        ],
        parentheticals_total: 9,
        courts: { ca1: "1st Cir.", "x y": "bad" },
      },
      7,
    )!;
    expect(c.byCourt).toEqual([
      { courtId: "ca1", n: 3 },
      { courtId: "cal", n: 1 },
    ]);
    expect(c.byDecade).toEqual([
      { decade: 1990, n: 2 },
      { decade: null, n: 1 },
    ]);
    expect(c.citing).toHaveLength(1);
    expect(c.parentheticals[0]!.held).toBe(true);
    expect(c.parentheticalsTotal).toBe(9);
    expect(c.courts).toEqual({ ca1: "1st Cir." });
    expect(parseCitator({ format: "caselaw-citator/1", cluster_id: 8 }, 7)).toBeNull();
  });
  it("parses the authorities member", () => {
    const a = parseAuthorities(
      {
        format: "caselaw-authorities/1",
        cluster_id: 7,
        authorities: [
          { cluster_id: 9, name: "A", anchors: 2, held: 1 },
          { cluster_id: null, first_text: "1 F. 2", anchors: 1 },
        ],
        courts: {},
      },
      7,
    )!;
    expect(a.authorities.map((x) => [x.clusterId, x.anchors, x.held])).toEqual([
      [9, 2, true],
      [null, 1, false],
    ]);
    expect(parseAuthorities({ format: "caselaw-citator/1", cluster_id: 7 }, 7)).toBeNull();
  });
});

describe("search rows", () => {
  it("parses our search hits", () => {
    const h = parseCaseHit({
      cluster_id: 1,
      tier: 2,
      court_id: "ca9",
      court: "9th Cir.",
      date_filed: "2001-02-30",
      case_name: "A v. B",
      citations: ["1 F.3d 2"],
      has_text: true,
      matched: [{ opinion_id: 5, type: "040dissent" }],
    })!;
    expect(h.dateFiled).toBeNull();
    expect(h.matched).toEqual([{ opinionId: 5, type: "040dissent", label: "Dissent" }]);
    expect(parseCaseHit({ cluster_id: 1, tier: 4, court_id: "ca9", case_name: "x" })).toBeNull();
  });
  it("parses CourtListener live hits and their snippets", () => {
    const h = parseLiveHit({
      cluster_id: 6613686,
      caseName: "Foo v. Foo",
      court_id: "hawapp",
      court: "Hawaii Intermediate Court of Appeals",
      dateFiled: "2003-01-10",
      citation: ["101 Haw. 235", "65 P.3d 182"],
      absolute_url: "/opinion/6613686/foo-v-foo/",
      status: "Published",
      citeCount: 0,
      opinions: [{ snippet: "the <mark>foo</mark> rule &amp; <b>bar</b>" }],
    })!;
    expect(h.courtListenerUrl).toBe("https://www.courtlistener.com/opinion/6613686/foo-v-foo/");
    expect(h.snippet).toBe("the ⟦foo⟧ rule & bar");
    expect(
      parseLiveHit({ cluster_id: 1, caseName: "x", absolute_url: "https://evil.example/" })!
        .courtListenerUrl,
    ).toBe(courtListenerCaseUrl(1, "x"));
    expect(snippetText("  ")).toBeNull();
  });
});
