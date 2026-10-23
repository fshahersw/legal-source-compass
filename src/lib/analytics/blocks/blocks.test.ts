import { describe, expect, it } from "vitest";
import {
  buildFederalCivil,
  buildFederalCriminal,
  buildMdlPending,
  buildNominations,
  buildSecurities,
  buildVacancies,
} from "./courts";
import {
  buildDojPress,
  buildEpaCases,
  buildFtcActions,
  buildOshaInspections,
  buildSecReleases,
  findCoverageBreak,
  isPartialYear,
} from "./enforcement";
import {
  buildCaers,
  buildCpscRecalls,
  buildFaers,
  buildFdaRecalls,
  buildFsisRecalls,
  buildNhtsaRecalls,
} from "./safety";
import { buildCfpbComplaints, buildSentinel } from "./consumer";
import { buildBills, buildFederalRegister } from "./rulemaking";
import type { TrendBlockData } from "../trend";

const values = (b: TrendBlockData, i = 0) => b.series[i]!.points.map((p) => p.value);
const xs = (b: TrendBlockData, i = 0) => b.series[i]!.points.map((p) => p.x);
const partialXs = (b: TrendBlockData, i = 0) =>
  b.series[i]!.points.filter((p) => p.partial).map((p) => p.x);

describe("federal civil and criminal flows", () => {
  const rows = [
    { fy: 2024, partial: false, filed: 291016, terminated: 396635 },
    { fy: 2025, partial: false, filed: 303716, terminated: 407539 },
    { fy: 2026, partial: true, filed: 276610, terminated: 229735 },
  ];
  it("plots filed and terminated, flags the partial year and compares the last complete year", () => {
    const b = buildFederalCivil({ rows, throughDate: "2026-06-30" })!;
    expect(b.xKind).toBe("fy");
    expect(b.series.map((s) => s.label)).toEqual(["Filed", "Terminated"]);
    expect(values(b)).toEqual([291016, 303716, 276610]);
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.period).toBe("FY2025");
    expect(b.latest?.value).toBe(303716);
    expect(b.latest?.change?.absolute).toBe(12700);
    expect(b.period).toBe("FY2024–FY2026*");
    expect(b.asOf).toBe("2026-06-30");
    expect(b.notes.some((n) => n.includes("June 30, 2026"))).toBe(true);
    expect(b.source.url).toMatch(/^https:\/\/www\.fjc\.gov\//);
  });
  it("says only that the year is in progress when no through-date is stated", () => {
    const b = buildFederalCivil({ rows, throughDate: null })!;
    expect(b.notes.some((n) => n.includes("still in progress"))).toBe(true);
    expect(b.asOf).toBeNull();
  });
  it("leaves out a block with no filings at all", () => {
    expect(buildFederalCivil({ rows: [], throughDate: null })).toBeNull();
    expect(
      buildFederalCivil({
        rows: [{ fy: 2025, partial: false, filed: null, terminated: 3 }],
        throughDate: null,
      }),
    ).toBeNull();
  });
  it("counts defendants for criminal", () => {
    const b = buildFederalCriminal({ rows, throughDate: "2026-06-30" })!;
    expect(b.unit).toBe("defendants");
    expect(b.notes[0]).toContain("defendants, not cases");
  });
});

describe("MDL pending actions", () => {
  it("plots fiscal-year pending, notes a 15-month period and quotes the first and latest monthly report", () => {
    const b = buildMdlPending({
      years: [
        { fy: 1992, pending: 37253, periodMonths: 15 },
        { fy: 1993, pending: 37002, periodMonths: 12 },
        { fy: 1994, pending: 42812, periodMonths: 12 },
      ],
      monthly: [
        { date: "2026-10-01", pending: 204977, mdls: 162 },
        { date: "2024-10-01", pending: 402473, mdls: 170 },
      ],
    })!;
    expect(values(b)).toEqual([37253, 37002, 42812]);
    expect(b.latest?.period).toBe("FY1994");
    expect(b.notes.some((n) => n.includes("FY1992 prints a 15-month period"))).toBe(true);
    const monthly = b.notes.find((n) => n.includes("monthly pending-MDL report"))!;
    expect(monthly).toContain("2026-10-01");
    expect(monthly).toContain("204,977");
    expect(monthly).toContain("402,473");
  });
  it("does not quote a monthly report when only one is held", () => {
    const b = buildMdlPending({
      years: [{ fy: 2025, pending: 197118, periodMonths: 12 }],
      monthly: [{ date: "2026-10-01", pending: 1, mdls: 1 }],
    })!;
    expect(b.notes.some((n) => n.includes("monthly"))).toBe(false);
  });
});

describe("securities class actions", () => {
  it("marks the partial year and says the source publishes nothing newer", () => {
    const b = buildSecurities({
      years: [
        { year: 2024, filings: 222, partial: false },
        { year: 2025, filings: 129, partial: true },
      ],
      throughDate: "2025-07-28",
    })!;
    expect(b.latest?.period).toBe("2024");
    expect(b.notes.some((n) => n.includes("July 28, 2025") && n.includes("no newer filings"))).toBe(
      true,
    );
  });
});

describe("vacancies", () => {
  it("shows an unread month as a gap and compares with the same month a year earlier", () => {
    const months = [];
    for (let m = 1; m <= 12; m += 1)
      months.push({
        month: `2025-${String(m).padStart(2, "0")}`,
        vacanciesListed: m === 10 ? 47 : null,
      });
    months.push({ month: "2026-01", vacanciesListed: 30 });
    months.push({ month: "2026-10", vacanciesListed: 28 });
    const b = buildVacancies({ months, asOf: "2026-10-22" })!;
    expect(b.xKind).toBe("month");
    expect(xs(b)).toHaveLength(22);
    expect(b.gaps).toBeGreaterThan(10);
    expect(b.latest?.period).toBe("October 2026");
    expect(b.latest?.change?.comparedWith).toBe("October 2025");
    expect(b.latest?.change?.absolute).toBe(-19);
    expect(b.notes.some((n) => n.includes("Gaps are not zero vacancies"))).toBe(true);
  });
  it("leaves the block out when no month was read in full", () => {
    expect(
      buildVacancies({ months: [{ month: "2020-01", vacanciesListed: null }], asOf: null }),
    ).toBeNull();
  });
});

describe("nominations", () => {
  it("orders Congresses numerically and drops the open one from the latest value", () => {
    const b = buildNominations({
      congresses: [
        { congress: 119, received: 80, confirmed: 57 },
        { congress: 97, received: 92, confirmed: 89 },
        { congress: 118, received: 175, confirmed: 139 },
        { congress: 100, received: 108, confirmed: 86 },
      ],
      asOf: "2026-10-22",
    })!;
    expect(xs(b)).toEqual(["97", "100", "118", "119"]);
    expect(partialXs(b)).toEqual(["119"]);
    expect(b.latest?.period).toBe("118th Congress (2023–2024)");
    expect(b.period).toBe("97th Congress (1981–1982)–119th Congress (2025–2026)*");
    expect(b.notes.some((n) => n.includes("119th Congress is still sitting"))).toBe(true);
  });
});

describe("partial years by data date", () => {
  it("is partial when the latest date falls before the year's last day", () => {
    expect(isPartialYear(2026, "2026-10-22", "2027-01-05")).toBe(true);
    expect(isPartialYear(2025, "2026-10-22", "2027-01-05")).toBe(false);
    expect(isPartialYear(2026, "2026-12-31", "2027-01-05")).toBe(false);
  });
  it("falls back to the current year when the data states no date", () => {
    expect(isPartialYear(2026, null, "2026-10-23")).toBe(true);
    expect(isPartialYear(2025, null, "2026-10-23")).toBe(false);
  });
});

describe("DOJ press releases", () => {
  const byYear = [
    { year: 2011, count: 1501 },
    { year: 2012, count: 1351 },
    { year: 2013, count: 18266 },
    { year: 2025, count: 19449 },
    { year: 2026, count: 16682 },
  ];
  it("finds the coverage break and states it instead of smoothing it", () => {
    expect(findCoverageBreak(byYear)).toEqual({
      year: 2013,
      beforeMin: 1351,
      beforeMax: 1501,
      afterMin: 16682,
    });
    expect(
      findCoverageBreak([
        { year: 2020, count: 5 },
        { year: 2021, count: 9 },
      ]),
    ).toBeNull();
    expect(
      findCoverageBreak([
        { year: 2020, count: 0 },
        { year: 2021, count: 900 },
      ]),
    ).toBeNull();
  });
  it("plots every year, marks the break and the partial year, and gaps the missing years", () => {
    const b = buildDojPress({ byYear, latestDate: "2026-10-22", today: "2026-10-23" })!;
    expect(b.markers).toEqual([{ x: "2013", label: "Coverage changes" }]);
    expect(xs(b)).toEqual([
      "2011",
      "2012",
      "2013",
      "2014",
      "2015",
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
    expect(b.gaps).toBe(11);
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.period).toBe("2025");
    expect(b.notes.some((n) => n.includes("does not record why"))).toBe(true);
  });
});

describe("SEC releases", () => {
  it("stacks litigation releases and administrative proceedings and reads the latest from the total", () => {
    const b = buildSecReleases({
      years: [
        { year: 1995, litigation: 122, administrative: 32 },
        { year: 1996, litigation: 430, administrative: 290 },
        { year: 2024, litigation: 288, administrative: 710 },
        { year: 2025, litigation: 249, administrative: 316 },
        { year: 2026, litigation: 221, administrative: 321 },
      ],
      latestDate: "2026-10-21",
      today: "2026-10-23",
    })!;
    expect(b.stacked).toBe(true);
    expect(b.latest?.seriesLabel).toBe("All releases");
    expect(b.latest?.value).toBe(565);
    expect(b.latest?.change?.previousValue).toBe(998);
    expect(
      b.notes.some((n) =>
        n.includes("1995 lists 32 administrative proceedings against 290 in 1996"),
      ),
    ).toBe(true);
  });
});

describe("FTC actions", () => {
  it("stacks the four data files, reads the total and notes undated actions and the file that starts later", () => {
    const b = buildFtcActions({
      years: [
        { year: 1999, counts: { merger: 9, nonmerger: 2 } },
        { year: 2000, counts: { merger: 23, nonmerger: 10, bc_penalty: 1, bcp_penalty: 23 } },
        { year: 2001, counts: { bcp_penalty: 3 } },
      ],
      undated: 12,
      latestDate: "2026-08-13",
      today: "2026-10-23",
    })!;
    expect(b.series.map((s) => s.label)).toEqual([
      "Merger enforcement",
      "Nonmerger (conduct)",
      "Competition civil penalty",
      "Consumer protection civil penalty",
    ]);
    expect(b.latest?.value).toBe(3);
    expect(b.markers).toEqual([{ x: "2000", label: "Consumer penalties begin" }]);
    expect(b.notes.some((n) => n.includes("12 listed actions carry no date"))).toBe(true);
    expect(values(b, 3)).toEqual([0, 23, 3]);
  });
});

describe("EPA cases", () => {
  it("plots up to the latest complete fiscal year and mentions a later year only in a note", () => {
    const b = buildEpaCases({
      years: [
        { fy: 1971, opened: 2, judicial: 2 },
        { fy: 2025, opened: 3027, judicial: 22 },
        { fy: 2026, opened: 4021, judicial: 13 },
        { fy: 2027, opened: 12, judicial: 0 },
      ],
      latestCompleteFy: 2026,
      fileDate: "2026-10-17",
    })!;
    expect(b.series[0]!.points.at(-1)).toEqual({ x: "2026", value: 4021 });
    expect(b.latest?.period).toBe("FY2026");
    expect(b.latest?.change?.absolute).toBe(994);
    expect(b.notes.some((n) => n.includes("FY2027 holds 12 cases"))).toBe(true);
    expect(b.notes.some((n) => n.includes("2 cases in FY1971"))).toBe(true);
  });
  it("is empty when nothing was opened in the plotted years", () => {
    expect(
      buildEpaCases({
        years: [{ fy: 2027, opened: 1, judicial: 0 }],
        latestCompleteFy: 2026,
        fileDate: null,
      }),
    ).toBeNull();
  });
});

describe("OSHA inspections", () => {
  it("draws the years after the latest complete year as partial", () => {
    const b = buildOshaInspections({
      years: [
        { fy: 2024, inspections: 77273, statePlan: 39086, partial: false },
        { fy: 2025, inspections: 74123, statePlan: 40561, partial: false },
        { fy: 2026, inspections: 63022, statePlan: 39584, partial: true },
      ],
      snapshot: "2026-10-17",
    })!;
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.value).toBe(74123);
    expect(b.latest?.change?.absolute).toBe(-3150);
    expect(b.series.map((s) => s.label)).toEqual(["All inspections", "of which State Plan"]);
  });
});

describe("recalls and adverse events", () => {
  it("CPSC: uses the dataset's partial flag", () => {
    const b = buildCpscRecalls({
      years: [
        { year: 2024, recalls: 305, partial: false },
        { year: 2025, recalls: 420, partial: false },
        { year: 2026, recalls: 485, partial: true },
      ],
      asOf: "2026-10-15",
    })!;
    expect(b.latest?.value).toBe(420);
    expect(b.latest?.change?.percent).toBeCloseTo(37.7, 1);
  });
  it("NHTSA: partial year from the latest campaign date", () => {
    const b = buildNhtsaRecalls({
      byYear: [
        { year: 2024, count: 1073 },
        { year: 2025, count: 994 },
        { year: 2026, count: 715 },
      ],
      latestDate: "2026-10-09",
      today: "2026-10-23",
    })!;
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.value).toBe(994);
    expect(b.notes[0]).toContain("Part 573");
  });
  it("FSIS: recalls and alerts are separate lines", () => {
    const b = buildFsisRecalls({
      years: [
        { year: 2025, recalls: 43, alerts: 24 },
        { year: 2026, recalls: 26, alerts: 17 },
      ],
      latestDate: "2026-10-17",
      today: "2026-10-23",
    })!;
    expect(b.series.map((s) => s.label)).toEqual([
      "Recalls (Class I, II and III)",
      "Public health alerts",
    ]);
    expect(b.latest?.value).toBe(43);
  });
  it("FDA: stacks drug, device and food and reads the latest from the sum", () => {
    const b = buildFdaRecalls({
      years: [
        { year: 2024, drug: 657, device: 3394, food: 1409 },
        { year: 2025, drug: 765, device: 2908, food: 1617 },
        { year: 2026, drug: 593, device: 2088, food: 950 },
      ],
      latestDate: "2026-09-09",
      today: "2026-10-23",
    })!;
    expect(b.stacked).toBe(true);
    expect(b.latest?.value).toBe(5290);
    expect(b.latest?.change?.absolute).toBe(-170);
  });
  it("FAERS and CAERS: carry the reports-not-incidence caveat", () => {
    const years = [
      { year: 2025, reports: 1307769, partial: false },
      { year: 2026, reports: 673772, partial: true },
    ];
    for (const b of [
      buildFaers({ years, dataThrough: "2026-06-30" })!,
      buildCaers({ years, dataThrough: "2026-03-31" })!,
    ]) {
      expect(b.notes.some((n) => n.includes("reports, not incidence"))).toBe(true);
      expect(b.latest?.period).toBe("2025");
    }
  });
});

describe("consumer complaints", () => {
  it("CFPB: marks the opening and in-progress years and says why", () => {
    const b = buildCfpbComplaints({
      years: [
        { year: 2011, complaints: 2536, complete: false, creditReporting: 0 },
        { year: 2012, complaints: 72368, complete: true, creditReporting: 1873 },
        { year: 2025, complaints: 5442944, complete: true, creditReporting: 4810295 },
        { year: 2026, complaints: 5822407, complete: false, creditReporting: 5308703 },
      ],
      from: "2011-12-01",
      to: "2026-10-18",
    })!;
    expect(partialXs(b)).toEqual(["2011", "2026"]);
    expect(b.latest?.period).toBe("2025");
    expect(b.notes.some((n) => n.includes("2011* starts on December 1, 2011"))).toBe(true);
    expect(b.notes.some((n) => n.includes("2026* runs through October 18, 2026"))).toBe(true);
    expect(b.series).toHaveLength(2);
  });
  it("CFPB: drops the credit-reporting line when no year carries it", () => {
    const b = buildCfpbComplaints({
      years: [{ year: 2012, complaints: 5, complete: true, creditReporting: null }],
      from: null,
      to: null,
    })!;
    expect(b.series).toHaveLength(1);
  });
  it("Sentinel: gaps a missing edition and links the newest data book", () => {
    const b = buildSentinel({
      years: [
        { year: 2022, total: 5150368, fraud: 2369527, sourceUrl: "https://www.ftc.gov/a-2022.pdf" },
        { year: 2024, total: 6471708, fraud: 2600678, sourceUrl: "https://www.ftc.gov/a-2024.pdf" },
      ],
    })!;
    expect(xs(b)).toEqual(["2022", "2023", "2024"]);
    expect(b.gaps).toBe(2);
    expect(b.source.url).toBe("https://www.ftc.gov/a-2024.pdf");
    expect(b.latest?.change).toBeNull();
    expect(b.latest?.changeNote).toContain("2023 is not recorded");
  });
});

describe("Federal Register and bills", () => {
  it("starts in 1995, flags the year in progress and keeps rules and proposed rules apart", () => {
    const b = buildFederalRegister({
      rules: { "1994": 128, "1995": 4747, "2024": 3248, "2025": 2441, "2026": 2394 },
      proposed: { "1994": 109, "1995": 3223, "2024": 1769, "2025": 1498, "2026": 1458 },
      asOf: "2026-10-19",
    })!;
    expect(xs(b)[0]).toBe("1995");
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.value).toBe(2441);
    expect(b.latest?.change?.comparedWith).toBe("2024");
    expect(b.notes.some((n) => n.includes("1994"))).toBe(true);
    expect(values(b, 1)[0]).toBe(3223);
  });
  it("bills: orders Congresses, marks the sitting one and leaves an unread count as a gap", () => {
    const b = buildBills({
      congresses: [
        { congress: 119, introduced: 16962, becameLaw: 136 },
        { congress: 118, introduced: 16565, becameLaw: 274 },
        { congress: 117, introduced: 15242, becameLaw: null },
      ],
      retrieved: "2026-10-23",
    })!;
    expect(xs(b)).toEqual(["117", "118", "119"]);
    expect(partialXs(b)).toEqual(["119"]);
    expect(b.latest?.period).toBe("118th Congress (2023–2024)");
    expect(b.latest?.change?.absolute).toBe(1323);
    expect(b.gaps).toBe(1);
  });
});
