import { describe, expect, it } from "vitest";
import type { CourtBench } from "@/lib/external/judgeCjra.functions";
import type { JudgeHistoricalMdl } from "@/lib/external/judgeCross.functions";
import type { ExpertRuling } from "@/lib/external/judgeRulings.functions";
import {
  benchSeriesRow,
  counselFirms,
  endingTotals,
  baselineRuling,
} from "@/lib/external/judgeConsole.functions";
import {
  benchMapRows,
  benchScatter,
  benchSelf,
  commissionYear,
  endingsModel,
  initials,
  judgeEndings,
  layoutSpans,
  mainDistrict,
  priorRole,
  rulingRows,
  wilson,
} from "./judgeConsoleView";

const P = "dbd3b16a5816cbc8aeccdf0875a2e973";
const Q = "6ca23c07a492db6bb3e5b1fec2022d2d";

const ruling = (over: Partial<ExpertRuling>): ExpertRuling => ({
  id: Math.random().toString(36).slice(2),
  date: null,
  courtId: null,
  docket: null,
  caption: null,
  expert: null,
  movant: "defendant",
  movantPrinted: null,
  outcome: "denied",
  basis: null,
  sourceUrl: null,
  ...over,
});

const hist = (over: Partial<JudgeHistoricalMdl>): JudgeHistoricalMdl => ({
  mdl: "1",
  caption: "X",
  district: "California Northern",
  year: 2020,
  actions: 10,
  remanded: 0,
  basis: "strict",
  shared: false,
  source: "jpml_terminated_fy2025",
  dateClosed: null,
  ...over,
});

const benchJudge = (recordId: string, over: Partial<CourtBench["judges"][number]> = {}) => ({
  recordId,
  name: recordId,
  profileId: null,
  visiting: null,
  motions6m: null,
  civil3y: null,
  medianDaysCivil: null,
  medianDaysN: null,
  productShare: null,
  nosCoveragePct: null,
  clLinked: false,
  ...over,
});

describe("wilson", () => {
  it("matches the textbook interval and refuses n = 0", () => {
    const w = wilson(5, 10)!;
    expect(w.p).toBe(0.5);
    expect(w.lo).toBeCloseTo(0.2366, 3);
    expect(w.hi).toBeCloseTo(0.7634, 3);
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(0, 4)!.lo).toBe(0);
    expect(wilson(4, 4)!.hi).toBe(1);
  });
});

describe("header helpers", () => {
  it("takes the last printed career position and the current commission year", () => {
    expect(priorRole("Law clerk, X, 2008; Private practice, Columbus, 2013-2015")).toBe(
      "Private practice, Columbus, 2013-2015",
    );
    expect(priorRole(null)).toBeNull();
    const fjc = {
      services: [
        { commission: "1999-01-02", terminationDate: "2011-01-01" },
        { commission: "2011-11-21", terminationDate: null },
      ],
    } as never;
    expect(commissionYear(fjc)).toBe("2011");
    expect(initials("Yvonne Gonzalez Rogers")).toBe("YR");
    expect(initials("Thomas W. Thrash, Jr.")).toBe("TT");
  });
});

describe("expert admissibility rows", () => {
  it("counts granted in full or part over decided rulings and keeps the judge out of the baseline", () => {
    const mine = [
      ruling({ outcome: "granted" }),
      ruling({ outcome: "granted_in_part" }),
      ruling({ outcome: "denied" }),
      ruling({ outcome: "denied_as_moot" }),
      ruling({ outcome: "denied", movant: "plaintiff" }),
    ];
    const base = [
      { profile: P, movant: "defendant" as const, outcome: "granted" as const, courtId: null },
      { profile: Q, movant: "defendant" as const, outcome: "denied" as const, courtId: null },
      { profile: Q, movant: "defendant" as const, outcome: "granted" as const, courtId: null },
    ];
    const rows = rulingRows(mine, base, P);
    const all = rows.find((r) => r.id === "all")!;
    expect(all.judge).toMatchObject({ k: 2, n: 4, shown: true });
    expect(all.excluded).toBe(1);
    expect(all.others).toMatchObject({ k: 1, n: 2, shown: false });
    const pl = rows.find((r) => r.id === "plaintiff")!;
    expect(pl.judge).toMatchObject({ k: 0, n: 1, shown: false });
  });
});

describe("MDL endings", () => {
  it("sums closed as actions minus remanded and skips rows without a remand count", () => {
    const h = [
      hist({ mdl: "1", actions: 27, remanded: 1 }),
      hist({ mdl: "2", actions: 10, remanded: null }),
      hist({ mdl: "3", actions: 5, remanded: 0, district: "Texas Eastern" }),
    ];
    expect(judgeEndings(h)).toEqual({ mdls: 2, closed: 31, remanded: 1 });
    expect(mainDistrict(h)).toBe("California Northern");
    const m = endingsModel(
      h,
      {
        all: { mdls: 100, closed: 900, remanded: 100 },
        byDistrict: { "California Northern": { mdls: 9, closed: 90, remanded: 10 } },
      },
      "Judge X",
    )!;
    expect(m.rows.map((r) => r.id)).toEqual(["judge", "district", "all"]);
    expect(m.rows[2]!.remandedPct).toBeCloseTo(10);
    expect(m.perMdl).toHaveLength(2);
    expect(endingsModel([hist({ remanded: null })], null, "J")).toBeNull();
  });
  it("totals the JPML history and skips rows without both counts", () => {
    const t = endingTotals([
      { c: 26, r: 1, d: "Pennsylvania Western" },
      { c: 10, r: 0, d: "Pennsylvania Western" },
      { c: "x", r: 0, d: "A" },
    ]);
    expect(t.all).toEqual({ mdls: 2, closed: 36, remanded: 1 });
    expect(t.byDistrict["Pennsylvania Western"]!.mdls).toBe(2);
  });
});

describe("bench", () => {
  const bench = {
    courtId: "cand",
    court: "N.D. Cal.",
    period: "2026-03-31",
    sourceUrl: null,
    judges: [
      benchJudge("a", { profileId: P, motions6m: 4, medianDaysCivil: 300 }),
      benchJudge("b", { motions6m: 10, medianDaysCivil: 500 }),
      benchJudge("c", { motions6m: 2 }),
      benchJudge("v", { visiting: "VJ", motions6m: 50, medianDaysCivil: 900 }),
    ],
  } as unknown as CourtBench;
  it("draws only the court's own judges with both measures", () => {
    const s = benchScatter(bench)!;
    expect(s.points.map((p) => p.id)).toEqual(["a", "b"]);
    expect(s.own).toBe(3);
    expect(s.missing).toBe(1);
    expect(s.medianMotions).toBe(4);
    expect(benchSelf(bench, P)?.recordId).toBe("a");
  });
  it("puts this judge first, drops visiting and empty rows", () => {
    const rows = benchMapRows(
      {
        court: "cand",
        periods: ["2025-09-30", "2026-03-31"],
        judges: [
          { recordId: "b", name: "Bea Zed", motions6m: [1, 2] },
          { recordId: "a", name: "Al Young", motions6m: [null, 3] },
          { recordId: "v", name: "Vis Iting", motions6m: [9, 9] },
          { recordId: "e", name: "Em Pty", motions6m: [null, null] },
        ],
      },
      bench,
      "b",
    );
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows[0]!.self).toBe(true);
  });
  it("lines a CJRA row up with the court's periods and rejects misaligned series", () => {
    expect(
      benchSeriesRow({ id: "x", title: "X", ps: ["2025-09-30", "2026-03-31"], m: [3, 4] }, [
        "2026-03-31",
        "2026-09-30",
      ])?.motions6m,
    ).toEqual([4, null]);
    expect(benchSeriesRow({ id: "x", title: "X", ps: ["2026-03-31"], m: [1, 2] }, [])).toBeNull();
  });
});

describe("counsel", () => {
  it("sums appearances on the asked MDLs by recorded side and drops firms with none", () => {
    const firms = counselFirms(
      [
        {
          id: "firm:a",
          firm: "A LLP",
          per: [
            { mdl: 3047, side: "plaintiff", appearances: 10 },
            { mdl: 2804, side: "plaintiff", appearances: 99 },
          ],
        },
        { id: "firm:b", firm: "B LLP", per: [{ mdl: 3047, side: "defense", appearances: 30 }] },
        { id: "firm:c", firm: "C LLP", per: [{ mdl: 1, side: "defense", appearances: 3 }] },
        { id: "firm:a", firm: "A LLP", per: [{ mdl: 3047, side: "plaintiff", appearances: 10 }] },
      ],
      ["3047"],
    );
    expect(firms.map((f) => [f.id, f.plaintiff, f.defense])).toEqual([
      ["firm:b", 0, 30],
      ["firm:a", 10, 0],
    ]);
  });
  it("counts unattributed rulings apart and skips per-judge rollups", () => {
    expect(baselineRuling({ id: "1", filters: { judge_profile: [] }, item: { cells: {} } })).toBe(
      "unattributed",
    );
    expect(baselineRuling({ id: "1", filters: {}, item: { kind: "judge" } })).toBeNull();
    expect(
      baselineRuling({
        id: "1",
        filters: { judge_profile: [P], outcome: ["granted"], movant: ["plaintiff"] },
        item: { cells: {} },
      }),
    ).toMatchObject({ profile: P, outcome: "granted", movant: "plaintiff" });
  });
});

describe("layoutSpans", () => {
  it("stretches a panel left alone on its row", () => {
    expect(layoutSpans([7, 5, 8, 4])).toEqual([7, 5, 8, 4]);
    expect(layoutSpans([7, 8, 4])).toEqual([12, 8, 4]);
    expect(layoutSpans([8, 7])).toEqual([12, 12]);
    expect(layoutSpans([7, 4])).toEqual([7, 5]);
  });
});
