import { describe, expect, it } from "vitest";
import type { CourtTrends, UstColumn, UstTable } from "@/lib/external/uscourtsTables.functions";
import { buildCharts } from "./trendsCharts";

const PERIODS = [
  { end: "2023-09-30", months: 12, pub: "JB", src: 0 },
  { end: "2023-12-31", months: 12, pub: "STFJ", src: 1 },
  { end: "2024-09-30", months: 12, pub: "JB", src: 2 },
];
const SNAPSHOTS = PERIODS.map((p) => ({ ...p, months: 0 }));

const col = (
  key: string,
  label: string,
  unit: UstColumn["unit"] = "count",
  decimals: number | null = 0,
): UstColumn => ({
  key,
  label,
  unit,
  decimals,
});

function table(
  over: Partial<UstTable> & Pick<UstTable, "tableKey" | "table" | "columns" | "data">,
): UstTable {
  return {
    scope: "district",
    court: "nysd",
    courtLabel: "NY,S",
    title: `Table ${over.table}`,
    periods: PERIODS,
    dash: {},
    national: {},
    nationalDash: {},
    circuitId: "ca2",
    circuit: null,
    notes: [{ at: [2], lines: ["NOTE: Land condemnation cases omitted."] }],
    marks: [],
    county: null,
    breaks: [],
    sources: PERIODS.map((p) => ({
      pub: p.pub,
      end: p.end,
      page: `https://www.uscourts.gov/data-tables/${p.end}`,
      url: `https://www.uscourts.gov/f/${p.end}.xlsx`,
      sha256: null,
      format: "xlsx",
      sheet: null,
    })),
    ...over,
  };
}

const civil = table({
  tableKey: "c",
  table: "C",
  columns: [
    col("filed/y0", "Filed / 2024"),
    col("filed/percent_change", "Filed / Percent Change", "percent", 1),
    col("terminated/y0", "Terminated / 2024"),
    col("pending/y0", "Pending / 2024"),
  ],
  data: {
    "filed/y0": [100, 110, 120],
    "filed/percent_change": [1, 2, 3],
    "terminated/y0": [90, 95, null],
    "pending/y0": [50, 52, 54],
  },
  national: {
    "filed/y0": [1000, 1100, 1200],
    "terminated/y0": [900, 950, 1000],
    "pending/y0": [500, 520, 540],
  },
});
const median = table({
  tableKey: "c-5",
  table: "C-5",
  columns: [
    col("total_cases/number_of_cases", "Total Cases / Number of Cases"),
    col(
      "total_cases/median_time_interval_in_months",
      "Total Cases / Median Time Interval in Months",
      "months",
      1,
    ),
  ],
  data: {
    "total_cases/number_of_cases": [10, 11, 12],
    "total_cases/median_time_interval_in_months": [6.5, 6.6, 6.7],
  },
  national: { "total_cases/median_time_interval_in_months": [8.1, 8.2, 8.3] },
  circuit: { "total_cases/median_time_interval_in_months": [7.1, 7.2, 7.3] },
});
const pending3 = table({
  tableKey: "c-6",
  table: "C-6",
  periods: SNAPSHOTS,
  columns: [
    col("3_years_or_more/number", "3 Years or More / Number"),
    col("3_years_or_more/percent", "3 Years or More / Percent", "percent", 1),
  ],
  data: { "3_years_or_more/number": [5, 6, 7], "3_years_or_more/percent": [10, 11, 12] },
  national: { "3_years_or_more/percent": [15, 16, 17] },
});

// The Total column is first among the weighted columns in recent editions and last in older ones; it is found by its heading.
const weighted = table({
  tableKey: "x-1a",
  table: "X-1A",
  columns: [
    col("judgeships", "Judgeships"),
    col(
      "unweighted_filings_per_judgeship/total",
      "Unweighted Filings per Judgeship / Total",
      "ratio",
    ),
    col("weighted_filings_per_judgeship/civil", "Weighted Filings per Judgeship / Civil", "ratio"),
    col("weighted_filings_per_judgeship/total", "Weighted Filings per Judgeship / Total", "ratio"),
  ],
  data: {
    judgeships: [28, 28, 28],
    "unweighted_filings_per_judgeship/total": [500, 510, 520],
    "weighted_filings_per_judgeship/civil": [300, 310, 320],
    "weighted_filings_per_judgeship/total": [650, 660, 670],
  },
  national: { "weighted_filings_per_judgeship/total": [530, 540, 550] },
});

const bankruptcyF2 = table({
  scope: "bankruptcy",
  tableKey: "f-2",
  table: "F-2",
  columns: [
    col("total_all_chapters", "Total All Chapters"),
    col("total_chapter_7", "Total Chapter 7"),
    col("total_chapter_11", "Total Chapter 11"),
    col("total_chapter_13", "Total Chapter 13"),
    col("total_other_chapters", "Total Other Chapters"),
  ],
  data: {
    total_all_chapters: [1000, 1100, 1200],
    total_chapter_7: [600, 650, 700],
    total_chapter_11: [10, 11, 12],
    total_chapter_13: [380, 430, 460],
    total_other_chapters: [10, 9, 28],
  },
});

const district: CourtTrends = {
  courtId: "nysd",
  kind: "district",
  keyId: "nysd",
  tables: [civil, median, pending3],
  bankruptcy: [],
};

describe("buildCharts for a district", () => {
  const charts = buildCharts({ trends: district, mode: "rolling", courtName: "This court (NY,S)" });
  const byId = (id: string) => charts.find((c) => c.id === id)!;

  it("draws civil volume, its national share, the median and the three-year share, each from its own table", () => {
    expect(charts.map((c) => c.id)).toEqual(["civil", "civil-share", "median-civil", "pending-3y"]);
    expect(byId("civil").series.map((s) => s.label)).toEqual([
      "Filed",
      "Terminated",
      "Pending at period end",
    ]);
    expect(byId("civil").sources[0]).toEqual({
      label: "U.S. Courts, Table C",
      href: "https://www.uscourts.gov/data-tables/2024-09-30",
    });
  });

  it("names the court in lower case inside a sentence", () => {
    expect(byId("civil").howToRead).toContain("Counts are totals for this court (NY,S) only;");
  });

  it("never charts a percent-change column as the filed count", () => {
    const filed = byId("civil").series[0]!;
    expect(filed.points.map((p) => p.value)).toEqual([100, 110, 120]);
  });

  it("leaves a gap, not zero, where a value is not recorded", () => {
    const terminated = byId("civil").series[1]!;
    expect(terminated.points.map((p) => p.value)).toEqual([90, 95, null]);
  });

  it("computes the share of the national total only from published figures", () => {
    const share = byId("civil-share").series[0]!;
    expect(share.points.map((p) => (p.value == null ? null : Number(p.value.toFixed(2))))).toEqual([
      10, 10, 10,
    ]);
    expect(byId("civil-share").unit).toBe("percent");
  });

  it("adds the circuit and national lines to a rate chart, national dashed", () => {
    const m = byId("median-civil");
    expect(m.series.map((s) => s.label)).toEqual([
      "This court (NY,S)",
      "Second Circuit (all its districts)",
      "All U.S. district courts",
    ]);
    expect(m.series[2]!.dashed).toBe(true);
    expect(m.unit).toBe("months");
  });

  it("charts counts as of a date on their own period length and carries the table notes", () => {
    const p = byId("pending-3y");
    expect(p.months).toBe(0);
    expect(p.series[0]!.points.map((x) => x.value)).toEqual([10, 11, 12]);
    expect(p.tableNotes).toEqual(["NOTE: Land condemnation cases omitted."]);
    expect(byId("civil").tableNotes).toEqual(["NOTE: Land condemnation cases omitted."]);
  });

  it("omits a chart whose table is not stored instead of pointing it at another table", () => {
    const none = buildCharts({
      trends: { ...district, tables: [civil] },
      mode: "rolling",
      courtName: "x",
    });
    expect(none.map((c) => c.id)).toEqual(["civil", "civil-share"]);
    expect(
      buildCharts({ trends: { ...district, tables: [] }, mode: "rolling", courtName: "x" }),
    ).toEqual([]);
  });

  it("charts the weighted TOTAL per judgeship, never the unweighted or the civil-only column", () => {
    const withX = buildCharts({
      trends: { ...district, tables: [weighted] },
      mode: "rolling",
      courtName: "This court (NY,S)",
    });
    const chart = withX.find((c) => c.id === "weighted")!;
    expect(chart.series[0]!.points.map((p) => p.value)).toEqual([650, 660, 670]);
    expect(chart.series.map((s) => s.label)).toEqual([
      "This court (NY,S)",
      "All U.S. district courts",
    ]);
    expect(chart.series[1]!.points.map((p) => p.value)).toEqual([530, 540, 550]);
  });

  it("draws the bankruptcy court's filings by chapter in its own chart, without the 'other chapters' column", () => {
    const withF = buildCharts({
      trends: { ...district, tables: [], bankruptcy: [bankruptcyF2] },
      mode: "rolling",
      courtName: "x",
    });
    expect(withF.map((c) => c.id)).toEqual(["bankruptcy"]);
    expect(withF[0]!.series.map((s) => s.label)).toEqual([
      "All chapters",
      "Chapter 7",
      "Chapter 11",
      "Chapter 13",
    ]);
    expect(withF[0]!.series[0]!.points.map((p) => p.value)).toEqual([1000, 1100, 1200]);
  });

  it("joins 'Total Filings' (to 2018) and 'Total All Chapters' (from 2019) into one all-chapters line and says so", () => {
    const joined = table({
      scope: "bankruptcy",
      tableKey: "f-2",
      table: "F-2",
      columns: [
        col("total_filings", "Total Filings"),
        col("total_all_chapters", "Total All Chapters"),
        col("total_chapter_7", "Total Chapter 7"),
      ],
      data: {
        total_filings: [900, 950, null],
        total_all_chapters: [null, null, 1000],
        total_chapter_7: [500, 550, 600],
      },
    });
    const out = buildCharts({
      trends: { ...district, tables: [], bankruptcy: [joined] },
      mode: "rolling",
      courtName: "x",
    });
    expect(out[0]!.series[0]!.points.map((p) => p.value)).toEqual([900, 950, 1000]);
    expect(out[0]!.howToRead).toContain("joins two headings");
    // no join sentence when only one heading is stored
    const single = buildCharts({
      trends: { ...district, tables: [], bankruptcy: [bankruptcyF2] },
      mode: "rolling",
      courtName: "x",
    });
    expect(single[0]!.howToRead).not.toContain("joins two headings");
  });

  it("draws the quarterly bankruptcy chart from the three-month table, whatever the period toggle", () => {
    const quarters = table({
      scope: "bankruptcy",
      tableKey: "f-2-three-months",
      table: "F-2 (Three Months)",
      periods: [
        { end: "2025-03-31", months: 3, pub: "BF", src: 0 },
        { end: "2025-06-30", months: 3, pub: "BF", src: 1 },
        { end: "2025-09-30", months: 3, pub: "BF", src: 2 },
      ],
      columns: [col("total_all_chapters", "Total All Chapters")],
      data: { total_all_chapters: [300, 310, 320] },
    });
    for (const mode of ["fy", "rolling"] as const) {
      const out = buildCharts({
        trends: { ...district, tables: [], bankruptcy: [bankruptcyF2, quarters] },
        mode,
        courtName: "x",
      });
      const q = out.find((c) => c.id === "bankruptcy-quarterly")!;
      expect(q.months).toBe(3);
      expect(q.series[0]!.points.map((p) => p.value)).toEqual([300, 310, 320]);
    }
  });

  it("names the publication of every period and marks the ones read from a PDF", () => {
    const withPdf = table({
      ...civil,
      sources: civil.sources.map((s, i) => (i === 0 ? { ...s, format: "pdf" } : s)),
    });
    const out = buildCharts({
      trends: { ...district, tables: [withPdf] },
      mode: "rolling",
      courtName: "x",
    });
    expect(out[0]!.periodSources).toEqual({
      "2023-09-30": "JB · PDF",
      "2023-12-31": "STFJ",
      "2024-09-30": "JB",
    });
  });

  it("fiscal-year mode keeps only the September 30 periods", () => {
    const fy = buildCharts({ trends: district, mode: "fy", courtName: "x" });
    expect(fy[0]!.series[0]!.points.map((p) => p.end)).toEqual(["2023-09-30", "2024-09-30"]);
  });
});

describe("buildCharts for a circuit", () => {
  const appeals = table({
    scope: "appeals",
    court: "ca9",
    courtLabel: "9th",
    circuitId: "ca9",
    tableKey: "b",
    table: "B",
    columns: [
      col("filed/y0", "Filed / 2024"),
      col("terminated/y0", "Terminated / 2024"),
      col("pending/y0", "Pending / 2024"),
    ],
    data: { "filed/y0": [10, 11, 12], "terminated/y0": [9, 10, 11], "pending/y0": [20, 21, 22] },
    national: {
      "filed/y0": [100, 110, 120],
      "terminated/y0": [90, 100, 110],
      "pending/y0": [200, 210, 220],
    },
  });
  const b4 = table({
    scope: "appeals",
    court: "ca9",
    courtLabel: "9th",
    circuitId: "ca9",
    tableKey: "b-4",
    table: "B-4",
    columns: [
      col(
        "m/cases",
        "Terminated on the Merits / Median Time Intervals From / Filing of Notice of Appeal or Docket Date to Last Opinion or Final Order / Cases",
      ),
      col(
        "m/interval",
        "Terminated on the Merits / Median Time Intervals From / Filing of Notice of Appeal or Docket Date to Last Opinion or Final Order / Interval",
        "months",
        1,
      ),
    ],
    data: { "m/cases": [5, 6, 7], "m/interval": [12.1, 12.2, 12.3] },
    national: { "m/interval": [9.1, 9.2, 9.3] },
  });
  it("draws appeals volume, share and the notice-of-appeal-to-disposition median against all circuits", () => {
    const charts = buildCharts({
      trends: {
        courtId: "ca9",
        kind: "circuit",
        keyId: "ca9",
        tables: [appeals, b4],
        bankruptcy: [],
      },
      mode: "fy",
      courtName: "Ninth Circuit",
    });
    expect(charts.map((c) => c.id)).toEqual(["appeals", "appeals-share", "appeals-median"]);
    const m = charts[2]!;
    expect(m.series.map((s) => s.label)).toEqual(["Ninth Circuit", "All circuits"]);
    expect(m.series[0]!.points.map((p) => p.value)).toEqual([12.1, 12.3]);
  });
});
