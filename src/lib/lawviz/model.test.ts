import { describe, expect, it } from "vitest";
import {
  fullName,
  isNodeId,
  linkHref,
  nodeLink,
  parseAtlasTuple,
  parseAtlasView,
  recencyBin,
  shortName,
  type AtlasNode,
} from "./atlas";
import {
  congressTable,
  layoutFlow,
  parseBillFlow,
  stageFlow,
  stagePath,
  type BillRow,
} from "./billFlow";
import { breakLabels, classOf, countBreaks, monthPoints, parseCalendar, yearGrid, type Series } from "./calendar";
import { frLane, parseAuthorityLine, parseLineage, safeUrl, uniqueIds } from "./lineage";

const t = (id: string, parent: string | null, kind: string, extra: unknown[] = []) => [
  id,
  parent,
  kind,
  ...(extra.length ? extra : ["CHAPTER 21", "CIVIL RIGHTS", 10, 1000, 4, "2020-01-02", 2001, 10, null, 5]),
];

describe("atlas tuples", () => {
  it("parses a node and rejects malformed tuples", () => {
    const n = parseAtlasTuple(t("usc/42/c21", "usc/42", "chapter"))!;
    expect(n).toMatchObject({ kind: "chapter", sections: 10, recorded: 4, lastChange: "2020-01-02", medianYear: 2001 });
    // recorded without a date is inconsistent
    expect(parseAtlasTuple(t("usc/42/c21", "usc/42", "chapter", ["C", "X", 10, 1, 4, null, null, 1, null, 5]))).toBeNull();
    expect(parseAtlasTuple(t("usc/42/c21", "usc/42", "bogus"))).toBeNull();
    expect(parseAtlasTuple(t("../etc", "usc/42", "chapter"))).toBeNull();
    expect(parseAtlasTuple(["usc"])).toBeNull();
    // more recorded than sections
    expect(parseAtlasTuple(t("usc/42/c21", "usc/42", "chapter", ["C", "X", 1, 1, 4, "2020-01-01", 2020, 1, null, 5]))).toBeNull();
  });

  it("parses a range bin only when its id, parent and bounds agree", () => {
    const ok = ["usc/26/c2#10-20", "usc/26/c2", "range", "§ 1", "§ 11", 11, 50, 0, null, null, 11, null, 10, 20];
    expect(parseAtlasTuple(ok)).toMatchObject({ kind: "range", range: { lo: 10, hi: 20, lastNum: "§ 11" } });
    expect(parseAtlasTuple([...ok.slice(0, 13), 21])).toBeNull();
    expect(parseAtlasTuple(["usc/26/c3#10-20", ...ok.slice(1)])).toBeNull();
  });

  it("keeps only children of the focus and grandchildren of those children", () => {
    const v = parseAtlasView(
      {
        status: "ok",
        corpus: "usc",
        focus: t("usc/1", "usc", "title", ["Title 1", "General", 3, 30, 1, "2001-01-01", 2001, 2, null, 10]),
        path: [t("usc", null, "root", [null, "United States Code", 3, 30, 1, "2001-01-01", 2001, 1, null, 0])],
        children: [
          t("usc/1/c1", "usc/1", "chapter"),
          t("usc/1/c9", "usc/2", "chapter"),
        ],
        grandchildren: [
          t("1:1", "usc/1/c1", "section", ["§ 1", "Words", 1, 10, 1, "2001-01-01", 2001, 0, null, 3]),
          t("1:9", "usc/1/c9", "section", ["§ 9", "Other", 1, 10, 1, "2001-01-01", 2001, 0, null, 4]),
        ],
        grandchildren_included: true,
        built: { finished_at: "2026-10-23T23:47:00Z" },
      },
      "usc",
    );
    if (v.status !== "ok") throw new Error(v.status);
    expect(v.children.map((c) => c.id)).toEqual(["usc/1/c1"]);
    expect(v.grandchildren.map((c) => c.id)).toEqual(["1:1"]);
    expect(v.dropped).toBe(2);
    expect(v.builtAt).toBe("2026-10-23T23:47:00Z");
    expect(parseAtlasView(null, "usc").status).toBe("unavailable");
    expect(parseAtlasView({ status: "empty" }, "cfr").status).toBe("empty");
    expect(parseAtlasView({ status: "ok", corpus: "cfr" }, "usc").status).toBe("unavailable");
  });

  it("links every node kind to its existing page", () => {
    const node = (id: string, kind: string, num: string | null = null) =>
      parseAtlasTuple([id, null, kind, num, "Label", 1, 1, 0, null, null, 0, null, 1]) as AtlasNode;
    const href = (c: "usc" | "cfr", n: AtlasNode) => linkHref(nodeLink(c, n));
    expect(href("usc", node("usc/42", "title"))).toBe("/law/uscode/42");
    expect(href("usc", node("usc/42/c21", "chapter"))).toBe("/law/uscode/42?c=21");
    expect(href("usc", node("usc/42/c_", "group"))).toBe("/law/uscode/42");
    expect(href("usc", node("42:1983", "section"))).toBe("/law/uscode/42/1983");
    expect(href("usc", node("5a:app-1", "section"))).toBe("/law/uscode/5a/app-1");
    expect(href("cfr", node("cfr/21", "title"))).toBe("/law/cfr/21");
    expect(href("cfr", node("cfr/21/c/I", "chapter"))).toBe("/law/cfr/21");
    expect(href("cfr", node("cfr/21/p/101", "part"))).toBe("/law/cfr/21/part/101");
    expect(href("cfr", node("cfr:21:101.9", "section"))).toBe("/law/cfr/21/101.9");
    expect(href("cfr", node("cfr:21:Appendix A to Part 101", "appendix"))).toBe(
      "/law/cfr/21/Appendix%20A%20to%20Part%20101",
    );
    expect(href("cfr", node("cfr:40:52.21@part-52", "section"))).toBe("/law/cfr/40/52.21?part=52");
    expect(href("usc", node("usc", "root"))).toBeNull();
    expect(isNodeId("usc/42/c21")).toBe(true);
    expect(isNodeId("usc/42/c21#1-2")).toBe(false);
  });

  it("names nodes: OLRC capitals title-cased, dashes trimmed", () => {
    const ch = parseAtlasTuple(t("usc/42/c21", "usc/42", "chapter"))!;
    expect(shortName("usc", ch)).toBe("Chapter 21");
    expect(fullName("usc", ch)).toBe("Chapter 21 · Civil Rights");
    const app = parseAtlasTuple(["cfr:21:Appendix B to Part 101", "cfr/21/p/101", "appendix", "Appendix B to Part 101", "—Graphic Enhancements", 1, 9, 0, null, null, 0, null, 7])!;
    expect(fullName("cfr", app)).toBe("Appendix B to Part 101 · Graphic Enhancements");
  });

  it("bins recency by corpus", () => {
    expect(recencyBin("usc", 1969)).toBe(0);
    expect(recencyBin("usc", 2021)).toBe(5);
    expect(recencyBin("cfr", 2016)).toBe(0);
    expect(recencyBin("cfr", 2017)).toBe(1);
    expect(recencyBin("cfr", null)).toBeNull();
  });
});

describe("authority line", () => {
  it("resolves only exact single-section citations", () => {
    const c = parseAuthorityLine(
      "Authority: 15 U.S.C. 1453, 1454, 1455; 21 U.S.C. 321, 331, 342, 343, 348, 371; 42 U.S.C. 243, 264, 271.",
    );
    expect(c.map((x) => x.id)).toEqual([
      "15:1453",
      "15:1454",
      "15:1455",
      "21:321",
      "21:331",
      "21:342",
      "21:343",
      "21:348",
      "21:371",
      "42:243",
      "42:264",
      "42:271",
    ]);
    expect(c[0]!.printed).toBe("15 U.S.C. 1453");
  });

  it("keeps et seq., notes, ranges and appendix citations as printed", () => {
    const c = parseAuthorityLine(
      "Authority: 5 U.S.C. 301; 21 U.S.C. 301 et seq., 321 note, 360bbb-3; 42 U.S.C. 1395hh(a)(2), 1451-1461, 2000e-2 and 3001–3005; 5 U.S.C. App. 3; Pub. L. 104-4, 109 Stat. 48.",
    );
    expect(c.map((x) => [x.printed, x.id, x.reason])).toEqual([
      ["5 U.S.C. 301", "5:301", "exact"],
      ["21 U.S.C. 301 et seq.", null, "et_seq"],
      ["21 U.S.C. 321 note", null, "note"],
      ["21 U.S.C. 360bbb-3", "21:360bbb-3", "exact"],
      ["42 U.S.C. 1395hh(a)(2)", "42:1395hh", "exact"],
      ["42 U.S.C. 1451-1461", null, "range"],
      ["42 U.S.C. 2000e-2", "42:2000e-2", "exact"],
      ["42 U.S.C. 3001–3005", null, "range"],
      ["5 U.S.C. App. 3", null, "appendix"],
    ]);
  });

  it("splits a clause that carries a second title", () => {
    const c = parseAuthorityLine("Authority: 42 U.S.C. 264, 21 U.S.C. 393.");
    expect(c.map((x) => x.id)).toEqual(["42:264", "21:393"]);
    expect(uniqueIds(["42:264", "42:264", null, "x", "21:393"], 24)).toEqual(["42:264", "21:393"]);
  });
});

describe("lineage payload", () => {
  it("drops malformed rows and unsafe links", () => {
    const v = parseLineage({
      status: "ok",
      title: "21",
      part: "101",
      part_record: { title: "21 CFR Part 101—Food Labeling", as_of: "2026-10-21" },
      fr: {
        total: 3,
        undated: 0,
        months: [["2023-03", "Rule", 1], ["bad", "Rule", 1]],
        docs: [
          ["1", "2023-03-24", "Rule", "88 FR 1", "T", "https://www.federalregister.gov/d/1"],
          ["2", "2023-03-25", "Rule", "88 FR 2", "T", "http://evil.example/x"],
          ["3", "not a date", "Rule", null, "T", null],
        ],
        complete: true,
      },
      versions: { sections: 1, removed: 0, dates: [["2023-03-24", 1]], lanes: [], selection: "all" },
      statutes: [["21:371", "21 U.S.C. 371", "Regulations", null, "https://uscode.house.gov/x", [["pl-75-717", "Pub. L. 75–717", "1938-06-25", ["source_credit"], "FDCA"], ["bad id", "x", null, [], null]], 2]],
      missing: ["9:999", "bad"],
      empty: false,
    });
    if (v.status !== "ok") throw new Error(v.status);
    expect(v.fr.months).toHaveLength(1);
    expect(v.fr.docs.map((d) => d.url)).toEqual(["https://www.federalregister.gov/d/1", null]);
    expect(v.statutes[0]!.laws.map((l) => l.id)).toEqual(["pl-75-717"]);
    expect(v.missing).toEqual(["9:999"]);
    expect(v.dropped).toBe(3);
    expect(safeUrl("javascript:alert(1)", new Set(["x"]))).toBeNull();
    expect(frLane("Presidential Document")).toBe("other");
  });
});

const row = (p: Partial<BillRow>): BillRow => ({
  congress: 117,
  type: "hr",
  policy: "Health",
  introduced: true,
  reported: false,
  chambers: 0,
  law: false,
  n: 1,
  withLawNumber: 0,
  ...p,
});

describe("bill flow", () => {
  it("follows recorded milestones only", () => {
    expect(stagePath(row({}))).toEqual(["intro", "not_reported", "no_passage"]);
    expect(stagePath(row({ reported: true, chambers: 2, law: true }))).toEqual([
      "intro",
      "reported",
      "passed",
      "both",
      "law",
    ]);
    expect(stagePath(row({ chambers: 1, law: true }))).toEqual(["intro", "not_reported", "passed", "one_only", "law"]);
    expect(stagePath(row({ introduced: false, chambers: 1 }))).toEqual(["intro_nr", "not_reported", "passed", "one_only"]);
  });

  it("conserves bills through every node and lays out without overlap", () => {
    const rows = [
      row({ n: 100 }),
      row({ n: 20, reported: true }),
      row({ n: 8, reported: true, chambers: 1 }),
      row({ n: 5, reported: true, chambers: 2, law: true, withLawNumber: 5 }),
      row({ n: 2, chambers: 2 }),
      row({ n: 1, chambers: 1, law: true }),
      row({ n: 3, introduced: false }),
    ];
    const f = stageFlow(rows);
    expect(f.total).toBe(139);
    for (const n of f.nodes) {
      const inflow = f.links.filter((l) => l.target === n.id).reduce((a, l) => a + l.value, 0);
      const outflow = f.links.filter((l) => l.source === n.id).reduce((a, l) => a + l.value, 0);
      if (n.column > 0) expect(inflow).toBe(n.value);
      expect(outflow).toBeLessThanOrEqual(n.value);
      if (["intro", "reported", "not_reported", "passed", "both"].includes(n.id)) expect(outflow).toBe(n.value);
    }
    expect(f.nodes.find((n) => n.id === "law")!.value).toBe(6);
    expect(f.withLawNumber).toBe(5);
    const lay = layoutFlow(f, { width: 500, height: 300 });
    for (const c of [0, 1, 2, 3, 4]) {
      const col = lay.nodes.filter((n) => n.column === c);
      for (let i = 1; i < col.length; i++) expect(col[i]!.y0).toBeGreaterThan(col[i - 1]!.y1);
      for (const n of col) expect(n.y1).toBeLessThanOrEqual(300.0001);
    }
    // "reached" stays on top of each column
    expect(lay.nodes.find((n) => n.id === "reported")!.y0).toBe(0);
  });

  it("parses rows and builds the per-Congress table", () => {
    const d = parseBillFlow({
      status: "ok",
      rows: [
        [117, "hr", "Health", true, true, 2, true, 3, 3],
        [117, "hres", "Health", true, false, 1, false, 9, 0],
        [107, "hr", "Health", true, false, 0, false, 9, 0],
        [118, "s", "", true, false, 0, false, 4, 0],
      ],
      public_laws: { "117": 362, "200": 1 },
    });
    if (d.status !== "ok") throw new Error(d.status);
    expect(d.rows).toHaveLength(3);
    expect(d.dropped).toBe(1);
    expect(d.policies).toEqual(["Health", ""]);
    expect(d.publicLaws).toEqual({ 117: 362 });
    const tab = congressTable(d.rows, d.publicLaws, "all");
    expect(tab.find((x) => x.congress === 117)).toMatchObject({ total: 3, law: 3, publicLaws: 362 });
    expect(tab.find((x) => x.congress === 118)).toMatchObject({ total: 4, law: 0 });
  });
});

describe("calendar", () => {
  const s: Series = {
    id: "cpsc_recalls",
    label: "CPSC recalls",
    unit: "recalls",
    first: "2024-01-03",
    last: "2024-12-30",
    total: 3,
    undated: 0,
    sourceLabel: "CPSC",
    sourceUrl: "https://www.cpsc.gov/Recalls",
    datasets: [],
  };

  it("separates zero days from days outside coverage", () => {
    const g = yearGrid(2024, s, { "2024-01-03": 2 });
    expect(g).toHaveLength(366);
    expect(g[0]).toMatchObject({ date: "2024-01-01", weekday: 0, week: 0, value: null });
    expect(g[2]!.value).toBe(2);
    expect(g[3]!.value).toBe(0);
    expect(g[365]).toMatchObject({ date: "2024-12-31", value: null });
    expect(Math.max(...g.map((c) => c.week))).toBe(52);
    const g25 = yearGrid(2025, s, {});
    expect(g25.every((c) => c.value === null)).toBe(true);
    expect(g25[0]).toMatchObject({ date: "2025-01-01", weekday: 2, week: 0 });
  });

  it("makes integer classes from the non-zero days", () => {
    const b = countBreaks([0, 1, 1, 1, 2, 3, 5, 8, 13, 40]);
    expect(b).toEqual([1, 2, 5, 13, 40]);
    expect(classOf(4, b)).toBe(2);
    expect(breakLabels(b)).toEqual(["1", "2", "3–5", "6–13", "14–40"]);
    expect(countBreaks([0, 0])).toEqual([]);
    expect(countBreaks([7, 7, 7])).toEqual([7]);
  });

  it("fills months inside coverage and marks partial edges", () => {
    const pts = monthPoints(s, { "2024-01": 2, "2024-03": 1 });
    expect(pts).toHaveLength(12);
    expect(pts[0]).toEqual({ key: "2024-01", value: 2, partial: true });
    expect(pts[1]).toEqual({ key: "2024-02", value: 0, partial: false });
    expect(pts[11]!.partial).toBe(true);
  });

  it("parses the payload and rejects unknown series", () => {
    const c = parseCalendar({
      status: "ok",
      agency: "cpsc",
      year: 2024,
      series: [["cpsc_recalls", "CPSC recalls", "recalls", "2024-01-03", "2024-12-30", 3, 0, "CPSC", "https://www.cpsc.gov/Recalls", ["agency_safety_cpsc_recalls_api"]]],
      days: [["cpsc_recalls", "2024-01-03", 2], ["other", "2024-01-03", 1]],
      months: [["cpsc_recalls", "2024-01", 2]],
    });
    if (c.status !== "ok") throw new Error(c.status);
    expect(c.days).toEqual({ cpsc_recalls: { "2024-01-03": 2 } });
    expect(c.dropped).toBe(1);
    expect(parseCalendar({ status: "ok", agency: "nasa", year: 2024 }).status).toBe("unavailable");
  });
});
