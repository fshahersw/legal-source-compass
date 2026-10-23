import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/regulatoryRecords.functions", () => ({
  getCompanyRegulatory: vi.fn(),
  getFrbOverview: vi.fn(),
  getRegistrationTrends: vi.fn(),
}));

import type {
  AdviserTable,
  BdOverview,
  FrbOverview,
} from "@/lib/external/regulatoryRecords.functions";
import {
  adviserCountSeries,
  bdAxis,
  bdMonthlySeries,
  chartGroupOf,
  dayLabel,
  firstNonZeroYear,
  frbYearRows,
  frbYears,
  monthLabel,
  raumSeries,
  usdLabel,
} from "./regulatoryView";

const OVERVIEW: FrbOverview = {
  firstEffectiveDate: "1989-09-25",
  latestEffectiveDate: "1992-03-01",
  actions: 9,
  byYearFamily: {
    "1989": { "Civil money penalties": 3 },
    // 1990 deliberately absent: a year with no rows is a row of zeros, not a missing bar
    "1991": { "Written agreements": 2, "Prompt corrective action": 1, "Notices of intent": 2 },
    "1992": { "Section 19 letters": 1 },
  },
  subjects: { organization: 6, individual: 3 },
  countDefinition: "",
  partialYear: "1992",
};

describe("frbYearRows", () => {
  const rows = frbYearRows(OVERVIEW);
  it("has one row per year from the first to the latest year", () => {
    expect(rows.map((r) => r.year)).toEqual(["1989", "1990", "1991", "1992"]);
  });
  it("marks the partial year with an asterisk and only that year", () => {
    expect(rows.map((r) => r.label)).toEqual(["1989", "1990", "1991", "1992*"]);
    expect(rows.map((r) => r.partial)).toEqual([false, false, false, true]);
  });
  it("puts the small families in the shared group and keeps totals equal to the source", () => {
    const y1991 = rows.find((r) => r.year === "1991")!;
    expect(y1991["Written agreements"]).toBe(2);
    expect(y1991["All other families"]).toBe(3);
    expect(y1991.total).toBe(5);
    expect(rows.reduce((a, r) => a + r.total, 0)).toBe(9);
  });
  it("shows a year with no rows as zeros", () => {
    const y1990 = rows.find((r) => r.year === "1990")!;
    expect(y1990.total).toBe(0);
    expect(y1990["Civil money penalties"]).toBe(0);
  });
});

describe("chartGroupOf / frbYears", () => {
  it("groups only the four smallest families", () => {
    expect(chartGroupOf("Prompt corrective action")).toBe("All other families");
    expect(chartGroupOf("Other order types")).toBe("All other families");
    expect(chartGroupOf("Written agreements")).toBe("Written agreements");
  });
  it("lists years newest first", () => {
    expect(frbYears(OVERVIEW)).toEqual(["1992", "1991", "1989"]);
  });
});

describe("bdMonthlySeries", () => {
  const overview: BdOverview = {
    firstMonth: "2007-03",
    latestMonth: "2007-07",
    files: 3,
    missingMonths: ["2007-04", "2007-06"],
    uniqueCiks: 1,
    inLatestFile: 1,
    countDefinition: "",
    series: [
      { month: "2007-03", count: 5892 },
      { month: "2007-05", count: 5800 },
      { month: "2007-07", count: 5700 },
    ],
  };
  it("fills every month and leaves months without a file as null, never 0", () => {
    expect(bdMonthlySeries(overview)).toEqual([
      { month: "2007-03", count: 5892 },
      { month: "2007-04", count: null },
      { month: "2007-05", count: 5800 },
      { month: "2007-06", count: null },
      { month: "2007-07", count: 5700 },
    ]);
  });
  it("rolls over a year end", () => {
    const o = {
      ...overview,
      firstMonth: "2007-11",
      latestMonth: "2008-02",
      series: [
        { month: "2007-11", count: 1 },
        { month: "2008-02", count: 2 },
      ],
    };
    expect(bdMonthlySeries(o).map((p) => p.month)).toEqual([
      "2007-11",
      "2007-12",
      "2008-01",
      "2008-02",
    ]);
  });
});

describe("bdAxis", () => {
  it("rounds outward to multiples of 500 and lists every tick, ignoring gaps", () => {
    expect(bdAxis([{ count: 3271 }, { count: null }, { count: 5892 }])).toEqual({
      lo: 3000,
      hi: 6000,
      ticks: [3000, 3500, 4000, 4500, 5000, 5500, 6000],
    });
    expect(bdAxis([{ count: 3500 }, { count: 4000 }])).toEqual({
      lo: 3500,
      hi: 4000,
      ticks: [3500, 4000],
    });
  });
});

describe("adviser statistics series", () => {
  const tab11: AdviserTable = {
    tab: "Tab.1.1",
    title: "Number of advisers",
    years: [2009, 2010, 2011],
    rows: [
      { labels: ["RIA", "Large advisory firm"], values: [3, 1082, 7317] },
      { labels: ["RIA", "Subtotal"], values: [11458, 11719, 10733] },
      { labels: ["ERA", "Subtotal"], values: [0, 1, 2256] },
      { labels: ["Total", "Total"], values: [11458, 11720, 12989] },
    ],
  };
  const tab21: AdviserTable = {
    tab: "Tab.2.1",
    title: "RAUM",
    years: [2009, 2010],
    rows: [
      { labels: ["Discretionary"], values: [36, 39.1] },
      { labels: ["Total"], values: [39.4, null] },
    ],
  };
  it("reads the RIA and ERA subtotal rows by label, not position", () => {
    const s = adviserCountSeries(tab11);
    expect(s.ria?.map((p) => p.value)).toEqual([11458, 11719, 10733]);
    expect(s.era?.map((p) => p.year)).toEqual([2009, 2010, 2011]);
  });
  it("finds the first year with a value above zero", () => {
    expect(firstNonZeroYear(adviserCountSeries(tab11).era)).toBe(2010);
    expect(firstNonZeroYear(null)).toBeNull();
  });
  it("reads the total RAUM row and keeps a blank as null", () => {
    expect(raumSeries(tab21)).toEqual([
      { year: 2009, value: 39.4 },
      { year: 2010, value: null },
    ]);
    expect(raumSeries(null)).toBeNull();
  });
  it("returns null series when the rows are missing", () => {
    expect(adviserCountSeries({ ...tab11, rows: [] })).toEqual({ ria: null, era: null });
  });
});

describe("labels", () => {
  it("formats months and days, leaving anything else unchanged", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("Oct")).toBe("Oct");
    expect(dayLabel("2018-02-02")).toBe("Feb 2, 2018");
    expect(dayLabel("2018")).toBe("2018");
  });
  it("scales dollar amounts without changing magnitude and shows Not recorded for a blank", () => {
    expect(usdLabel(4091315000000)).toBe("$4.09 trillion");
    expect(usdLabel(150000000)).toBe("$150 million");
    expect(usdLabel(2500000000)).toBe("$2.5 billion");
    expect(usdLabel(12345)).toBe("$12,345");
    expect(usdLabel(null)).toBe("Not recorded");
    expect(usdLabel(Number.NaN)).toBe("Not recorded");
  });
});
