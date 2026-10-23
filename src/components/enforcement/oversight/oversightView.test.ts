import { describe, expect, it } from "vitest";
import type { OversightTrend } from "@/lib/external/oversight.functions";
import {
  ALL_OTHER,
  coverageLine,
  fmtDate,
  fmtInt,
  fmtUsd,
  groupDocuments,
  moneyYearRows,
  rangeLabel,
  recsLabel,
  recsYearRows,
  reportYearRows,
  topTypes,
} from "./oversightView";

function trend(over: Partial<OversightTrend> = {}): OversightTrend {
  return {
    scope: "oig",
    name: "Department of Justice OIG",
    oigSlug: "department-justice-oig",
    agencyId: "268",
    agencyTitle: "Justice Department",
    asOf: "2026-10-19",
    totals: {
      reports: 9,
      dated: 8,
      undated: 1,
      firstDate: "2024-02-01",
      lastDate: "2026-10-19",
      recs: 12,
      recsReports: 5,
      types: { Audit: 5, Investigation: 2, Other: 1, "Inspection / Evaluation": 1 },
    },
    years: [
      { year: 2024, reports: 3, types: { Audit: 2, Investigation: 1 }, recs: 7, recsReports: 2 },
      {
        year: 2026,
        reports: 5,
        types: { Audit: 3, Other: 1, "Inspection / Evaluation": 1 },
        recs: 5,
        recsReports: 3,
      },
    ],
    money: null,
    oigs: [],
    ...over,
  };
}

describe("formatters", () => {
  it("shows Not recorded for missing numbers and dates", () => {
    expect(fmtInt(null)).toBe("Not recorded");
    expect(fmtInt(36309)).toBe("36,309");
    expect(fmtInt(0)).toBe("0");
    expect(fmtDate("2026-10-19")).toBe("19 Oct 2026");
    expect(fmtDate(null)).toBe("Not recorded");
    expect(fmtDate("2026-13-01")).toBe("Not recorded");
    expect(recsLabel(null)).toBe("Not recorded");
    expect(recsLabel(0)).toBe("0");
  });

  it("prints dollars as stated below $10 million and spells out larger sums", () => {
    expect(fmtUsd(4577633)).toBe("$4,577,633");
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(25_400_000)).toBe("$25.4 million");
    expect(fmtUsd(3_200_000_000)).toBe("$3.2 billion");
    expect(fmtUsd(null)).toBe("Not recorded");
  });

  it("labels result ranges", () => {
    expect(rangeLabel(0, 25, 25, 36309)).toBe("1-25 of 36,309");
    expect(rangeLabel(2, 25, 10, 60)).toBe("51-60 of 60");
    expect(rangeLabel(0, 25, 0, 0)).toBe("No results");
    expect(rangeLabel(3, 25, 0, 40)).toBe("No more results");
    expect(rangeLabel(0, 25, 25, null)).toBe("1-25");
  });
});

describe("report-year series", () => {
  it("draws the largest types and groups the rest, with a stable order", () => {
    expect(
      topTypes(
        { Audit: 5, Investigation: 2, Other: 1, "Inspection / Evaluation": 1, Review: 1 },
        3,
      ),
    ).toEqual(["Audit", "Investigation", "Inspection / Evaluation"]);
    expect(topTypes({ "Not recorded": 9, Audit: 1 })).toEqual(["Audit"]);
  });

  it("fills years between reports with zero listed reports and marks the partial year", () => {
    const rows = reportYearRows(trend(), ["Audit", "Investigation"]);
    expect(rows.map((r) => r.label)).toEqual(["2024", "2025", "2026*"]);
    expect(rows[1]).toMatchObject({
      total: 0,
      Audit: 0,
      Investigation: 0,
      [ALL_OTHER]: 0,
      partial: false,
    });
    expect(rows[2]).toMatchObject({
      total: 5,
      Audit: 3,
      Investigation: 0,
      [ALL_OTHER]: 2,
      partial: true,
    });
  });

  it("gives no rows when no report is dated", () => {
    expect(reportYearRows(trend({ years: [] }), ["Audit"])).toEqual([]);
  });

  it("keeps recommendations beside how many reports state a count", () => {
    const rows = recsYearRows(trend());
    expect(rows[0]).toMatchObject({
      year: 2024,
      recs: 7,
      recsReports: 2,
      reports: 3,
      label: "2024",
    });
    expect(rows[1]).toMatchObject({ label: "2026*", partial: true });
  });

  it("describes coverage including undated reports", () => {
    expect(coverageLine(trend())).toBe(
      "9 listed reports, report dates 1 Feb 2024 to 19 Oct 2026; 1 without a report date are counted in the total only",
    );
  });
});

describe("money series", () => {
  const years = [
    {
      year: 2023,
      reports: 4,
      questionedReports: 0,
      questionedCosts: 0,
      betterUseReports: 0,
      fundsBetterUse: 0,
    },
    {
      year: 2024,
      reports: 6,
      questionedReports: 2,
      questionedCosts: 1500,
      betterUseReports: 0,
      fundsBetterUse: 0,
    },
    {
      year: 2026,
      reports: 1,
      questionedReports: 1,
      questionedCosts: 0,
      betterUseReports: 1,
      fundsBetterUse: 250,
    },
  ];

  it("leaves a gap, never a zero, for a year in which no report states the amount", () => {
    const rows = moneyYearRows(years, "2026-10-19");
    expect(rows[0]).toMatchObject({ questionedCosts: null, fundsBetterUse: null });
    expect(rows[1]).toMatchObject({ questionedCosts: 1500, fundsBetterUse: null });
  });

  it("keeps a stated $0 as zero and marks the partial year", () => {
    const rows = moneyYearRows(years, "2026-10-19");
    expect(rows[2]).toMatchObject({
      questionedCosts: 0,
      fundsBetterUse: 250,
      label: "2026*",
      partial: true,
    });
  });
});

describe("DOJ document grouping", () => {
  it("keeps the page's group order and puts ungrouped items under Not recorded", () => {
    const d = (id: string, group: string | null) => ({
      id,
      kind: "budget",
      group,
      title: id,
      entity: null,
      year: null,
      fileKind: null,
      url: "https://www.justice.gov/x",
    });
    const g = groupDocuments([d("a", "Reports"), d("b", "Plans"), d("c", "Reports"), d("d", null)]);
    expect(g.map((x) => [x.group, x.docs.map((y) => y.id)])).toEqual([
      ["Reports", ["a", "c"]],
      ["Plans", ["b"]],
      ["Not recorded", ["d"]],
    ]);
  });
});
