import { describe, expect, it } from "vitest";
import { buildSectionContext } from "@/components/kit";
import type { JudgeCrossProfile } from "@/lib/external/judgeCross.functions";
import type { JudgeActivity } from "@/lib/external/judgeCourtListener.functions";
import type { JudgeCjra } from "@/lib/external/judgeCjra.functions";
import {
  cjraSeries,
  civil3yIncludesMdl,
  glanceFigures,
  glanceHasData,
  glanceKpis,
  glanceScope,
  mdlEvents,
  shortDate,
} from "./judgeGlanceView";
import { benchMedian, benchModel } from "./judgeBenchView";

const PERIODS = ["2015-09-30", "2016-03-31", "2016-09-30", "2017-03-31", "2026-03-31"];
const cjra = (over: Partial<JudgeCjra> = {}): JudgeCjra => ({
  recordId: "njd-shipp-michael-a",
  name: "Michael Andre Shipp",
  courtId: "njd",
  court: "U.S. District Court, D. New Jersey",
  roles: ["district"],
  printedNames: ["SHIPP, MICHAEL A."],
  periods: PERIODS,
  series: {
    motions_6m: [null, 2, null, 0, 0],
    civil_3y: [null, 10, 20, null, 35696],
    bench_trials_6m: [null, 0, 0, 0, 0],
    ss_appeals_6m: [null, 0, 0, 0, 0],
    bankruptcy_appeals_6m: [null, 0, 0, 0, 0],
  },
  notes: [],
  latestPeriod: "2026-03-31",
  lastListed: "2026-03-31",
  sourceUrl: null,
  ...over,
});
const cross = (pending: JudgeCrossProfile["pending"]): JudgeCrossProfile => ({
  nid: "1394031",
  name: "Michael A. Shipp",
  asOf: "2026-10-01",
  status: "active",
  years: 14,
  pending,
  pendingActions: pending.reduce((a, m) => a + m.pending, 0),
  sharePct: null,
  rank: null,
  historical: [],
  historicalActions: 0,
  totalActions: 0,
  coverage: null,
  matches: [],
});
const TALC = {
  mdl: 2738,
  title: "IN RE: Johnson & Johnson Talcum Powder",
  type: "Products Liability",
  pending: 69340,
  total: 72024,
  change12m: 2136,
  dateTransferred: "2016-10-04",
};
const dockets = (over: Partial<NonNullable<JudgeActivity["dockets"]>> = {}) => ({
  assigned: 7707,
  terminatedPct: 90,
  firstYear: 2012,
  lastYear: 2026,
  civil: 7000,
  criminal: 700,
  medianDaysCivil: 249,
  medianDaysN: 55,
  courts: [],
  byYear: [],
  nosRecorded: 5461,
  nosGroups: [{ key: "product", label: "Product liability", n: 230 }],
  nosOther: 5231,
  productCount: 230,
  productShare: 4.2,
  nosCoveragePct: 70.9,
  ...over,
});

describe("glanceKpis", () => {
  it("shows the latest listed CJRA values with their report date, and flags MDL member cases", () => {
    const k = glanceKpis({
      cross: cross([TALC]),
      cjra: cjra(),
      activity: { dockets: dockets(), referred: null, opinions: null },
      clPersonId: 1234,
      rulings: null,
    });
    expect(k.map((x) => x.id)).toEqual(["mdls", "motions", "civil3y", "dockets", "days"]);
    expect(k[1]).toMatchObject({ value: "0", period: "Mar 31, 2026" });
    expect(k[2]!.value).toBe("35,696");
    expect(k[2]!.meta).toMatch(/includes MDL member cases/);
    expect(k[4]!.meta).toMatch(/n = 55/);
  });

  it("states the product share with its own base and that base's coverage of assigned dockets", () => {
    const k = glanceKpis({
      cross: null,
      cjra: null,
      activity: { dockets: dockets(), referred: null, opinions: null },
      clPersonId: 1234,
      rulings: null,
    });
    expect(k[3]!.value).toBe("7,707");
    expect(k[3]!.meta).toMatch(
      /^4\.2% of 5,461 with a recorded nature of suit \(70\.9% of assigned\) are product liability/,
    );
    expect(k[3]!.meta.length).toBeLessThanOrEqual(140);
    expect(k[3]!.source.label).not.toMatch(/collection/i);
  });

  it("suppresses the product share when its base covers less than half of assigned dockets", () => {
    // Shipp: 59,460 assigned, 6,716 with a recorded nature of suit (11.3%)
    const d = dockets({
      assigned: 59460,
      nosRecorded: 6716,
      productCount: 3264,
      productShare: 48.6,
      nosCoveragePct: 11.3,
    });
    const input = {
      cross: null,
      cjra: null,
      activity: { dockets: d, referred: null, opinions: null },
      clPersonId: 2955,
      rulings: null,
    };
    const k = glanceKpis(input);
    expect(k[3]!.meta).not.toMatch(/48\.6/);
    expect(k[3]!.meta).toMatch(/only 11\.3% of assigned; no product share shown/);
    const figs = glanceFigures(k, input);
    expect(figs.some((f) => f.value === 48.6)).toBe(false);
    expect(figs.find((f) => /base of the product share/.test(f.label))?.value).toBe(11.3);
  });

  it("reads Not recorded (null) for a missing source, never 0, and leaves out a rulings tile of 0", () => {
    const k = glanceKpis({ cross: null, cjra: null, activity: null, clPersonId: null, rulings: 0 });
    expect(k.every((x) => x.value === null)).toBe(true);
    expect(k.some((x) => x.id === "rulings")).toBe(false);
    expect(k.find((x) => x.id === "dockets")!.meta).not.toMatch(/CourtListener/);
    expect(
      glanceHasData({ cross: null, cjra: null, activity: null, clPersonId: null, rulings: 0 }),
    ).toBe(false);
    const r = glanceKpis({
      cross: null,
      cjra: null,
      activity: null,
      clPersonId: null,
      rulings: 3,
      rulingsNote: "Opinions in the selected MDL courts, 2015-2026",
    }).at(-1)!;
    expect(r).toMatchObject({ id: "rulings", value: "3" });
    expect(r.meta).toBe("Opinions in the selected MDL courts, 2015-2026; not every ruling");
  });

  it("says when the last listed report is not the latest edition, for both CJRA tiles", () => {
    const c = cjra({
      series: {
        ...cjra().series,
        motions_6m: [null, 2, 1, 3, null],
        civil_3y: [null, 10, 20, 30, null],
      },
    });
    const k = glanceKpis({ cross: null, cjra: c, activity: null, clPersonId: null, rulings: null });
    expect(k[1]).toMatchObject({ value: "3", period: "Mar 31, 2017" });
    expect(k[1]!.meta).toMatch(/not listed in the latest report/);
    expect(k[2]).toMatchObject({ value: "30", period: "Mar 31, 2017" });
    expect(k[2]!.meta).toMatch(/not listed in the latest report/);
    expect(glanceKpis({ cross: null, cjra: cjra(), activity: null, clPersonId: null, rulings: null })[2]!.meta).not.toMatch(
      /not listed/,
    );
  });
});

describe("CJRA trend", () => {
  it("starts at the first listed report and keeps inner gaps null", () => {
    const s = cjraSeries(cjra(), "civil_3y")!;
    expect(s.axis.keys[0]).toBe("2016-03-31");
    expect(s.series.points.map((p) => p.value)).toEqual([10, 20, null, 35696]);
    expect(
      cjraSeries(
        cjra({ series: { ...cjra().series, civil_3y: [null, null, null, null, 5] } }),
        "civil_3y",
      ),
    ).toBeNull();
  });

  it("marks MDL transfers on the next report inside the window only", () => {
    const keys = cjraSeries(cjra(), "civil_3y")!.axis.keys;
    expect(mdlEvents(cross([TALC]), keys)).toEqual([
      { key: "2017-03-31", label: "MDL 2738 transferred" },
    ]);
    expect(mdlEvents(cross([{ ...TALC, dateTransferred: "2001-01-01" }]), keys)).toEqual([]);
    expect(mdlEvents(null, keys)).toEqual([]);
  });

  it("detects MDL inventory from pending MDLs or the report footnote", () => {
    expect(civil3yIncludesMdl(cjra(), null)).toBe(false);
    expect(
      civil3yIncludesMdl(
        cjra({
          notes: [
            {
              period: "2026-03-31",
              column: "civil_3y",
              text: "Three-year-old caseload consists mostly of cases related to multidistrict litigation.",
            },
          ],
        }),
        null,
      ),
    ).toBe(true);
    expect(civil3yIncludesMdl(cjra(), cross([TALC]))).toBe(true);
  });
});

describe("AI context", () => {
  it("carries only shown figures and a scope that rules out prediction", () => {
    const input = {
      cross: cross([TALC]),
      cjra: cjra(),
      activity: { dockets: dockets(), referred: null, opinions: null },
      clPersonId: 1234,
      rulings: null,
    };
    const ctx = buildSectionContext({
      title: "t",
      scope: glanceScope("Michael Andre Shipp"),
      figures: glanceFigures(glanceKpis(input), input),
    });
    expect(ctx.scope).toMatch(/not a prediction/);
    expect(ctx.figures.map((f) => f.value)).toContain("35,696");
    expect(
      ctx.figures.some((f) => f.label === "MDL 2738 actions pending" && f.value === "69,340"),
    ).toBe(true);
    expect(ctx.figures.some((f) => /share of the 5,461 dockets/.test(f.label))).toBe(true);
  });

  it("keeps the no-prediction clause whole when the name is long", () => {
    const long = "The Honorable Bartholomew Fitzgerald Montgomery-Worthington Vanderbilt III";
    const ctx = buildSectionContext({ title: "t", scope: glanceScope(long), figures: [] });
    expect(ctx.scope).toMatch(/^Recorded figures only, not a prediction of how the judge will rule/);
  });

  it("writes report dates plainly", () => {
    expect(shortDate("2026-03-31")).toBe("Mar 31, 2026");
    expect(shortDate("bad")).toBe("bad");
  });
});

describe("same-court bench", () => {
  it("needs three values for a median and never leads a row", () => {
    expect(benchMedian([1, null, 3])).toBeNull();
    expect(benchMedian([1, 2, 3, 10])).toBe(2.5);
    const judge = (i: number, visiting: "VJ" | null = null) => ({
      recordId: `j${i}`,
      name: `Judge ${i}`,
      profileId: null,
      visiting,
      motions6m: i,
      civil3y: i * 10,
      medianDaysCivil: null,
      medianDaysN: null,
      productShare: null,
      nosCoveragePct: null,
      clLinked: false,
    });
    const bench = {
      courtId: "njd",
      court: "D.N.J.",
      period: "2026-03-31",
      sourceUrl: null,
      judges: [judge(1), judge(2), judge(3), judge(100, "VJ")],
    };
    const m = benchModel(bench, "Mar 31, 2026")!;
    expect(m.columns[0]!.label).toBe("Court median");
    expect(m.columns[0]!.sub).toBe("of 3 judges of the court");
    // the visiting judge is neither a column nor part of the median
    expect(m.medians.motions6m.value).toBe(2);
    expect(m.medians.motions6m.n).toBe(3);
    expect(m.own).toBe(3);
    expect(m.visiting).toBe(1);
    expect(m.medians.medianDaysCivil.value).toBeNull();
    expect(m.groups.flatMap((g) => g.rows).every((r) => r.lead === "none")).toBe(true);
    expect(m.columns.slice(1).map((c) => c.id)).toEqual(["j1", "j2", "j3"]);
    // civil > 3 years and the product share are not compared across judges
    expect(m.groups.flatMap((g) => g.rows).map((r) => r.label)).toEqual([
      "Motions pending > 6 months",
      "Median days to termination, civil",
    ]);
    expect(benchModel({ ...bench, judges: [judge(100, "VJ")] }, null)).toBeNull();
  });
});
