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
    expect(k[3]!.meta).toMatch(/4\.2% product liability/);
    expect(k[4]!.meta).toMatch(/n = 55/);
  });

  it("reads Not recorded (null) for a missing source, never 0, and adds the rulings tile only when published", () => {
    const k = glanceKpis({ cross: null, cjra: null, activity: null, clPersonId: null, rulings: 0 });
    expect(k.slice(0, 5).every((x) => x.value === null)).toBe(true);
    expect(k.at(-1)).toMatchObject({ id: "rulings", value: "0" });
    expect(
      glanceHasData({ cross: null, cjra: null, activity: null, clPersonId: null, rulings: 0 }),
    ).toBe(false);
  });

  it("says when the last listed report is not the latest edition", () => {
    const c = cjra({
      series: { ...cjra().series, motions_6m: [null, 2, 1, 3, null] },
    });
    const k = glanceKpis({ cross: null, cjra: c, activity: null, clPersonId: null, rulings: null });
    expect(k[1]).toMatchObject({ value: "3", period: "Mar 31, 2017" });
    expect(k[1]!.meta).toMatch(/not listed in the latest report/);
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
    const m = benchModel(
      {
        courtId: "njd",
        court: "D.N.J.",
        period: "2026-03-31",
        sourceUrl: null,
        judges: [1, 2, 3].map((i) => ({
          recordId: `j${i}`,
          name: `Judge ${i}`,
          profileId: null,
          motions6m: i,
          civil3y: i * 10,
          medianDaysCivil: null,
          medianDaysN: null,
          productShare: null,
          clLinked: false,
        })),
      },
      "Mar 31, 2026",
    );
    expect(m.columns[0]!.label).toBe("Court median");
    expect(m.medians.motions6m.value).toBe(2);
    expect(m.medians.medianDaysCivil.value).toBeNull();
    expect(m.groups.flatMap((g) => g.rows).every((r) => r.lead === "none")).toBe(true);
    expect(m.columns.slice(1).map((c) => c.id)).toEqual(["j1", "j2", "j3"]);
  });
});
