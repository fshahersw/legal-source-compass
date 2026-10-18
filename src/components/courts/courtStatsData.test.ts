import { describe, expect, it } from "vitest";
import {
  change,
  dominanceNote,
  fmtCell,
  fmtRatio,
  isDash,
  parseDash,
  flagDetail,
  fmtNum,
  fmtPct,
  heat,
  median,
  parseCircuit,
  parseDistrictPanel,
  parseFlag,
  parseMatrix,
  parseNational,
  parseYears,
  series,
  sortRows,
  type DistrictRow,
} from "./courtStatsData";

const YEARS = [2023, 2024, 2025];

function row(id: string, pl: (number | null)[], extra: Record<string, unknown> = {}) {
  return { id, name: id.toUpperCase(), circuit: "ca3", pl, civil: [100, 100, 100], ...extra };
}

describe("court stats parsers", () => {
  it("accepts only consecutive plausible fiscal years", () => {
    expect(parseYears([2023, 2024, 2025])).toEqual(YEARS);
    expect(parseYears([2023, 2025])).toBeNull();
    expect(parseYears(["2023"])).toBeNull();
    expect(parseYears([])).toBeNull();
  });

  it("pads and cleans series to the year axis", () => {
    expect(series([1, "2", null, Number.NaN], 3)).toEqual([1, null, null]);
    expect(series(undefined, 2)).toEqual([null, null]);
  });

  it("rejects flags with unknown rules or years", () => {
    expect(
      parseFlag({ year: 2025, rule: "pl_surge", value: 300, baseline: 100, ratio: 3 }),
    ).toMatchObject({ year: 2025, rule: "pl_surge", value: 300, baseline: 100 });
    expect(parseFlag({ year: 2025, rule: "made_up" })).toBeNull();
    expect(parseFlag({ rule: "pl_surge" })).toBeNull();
  });

  it("drops malformed matrix rows and keeps valid ones", () => {
    const m = parseMatrix({
      years: YEARS,
      rows: [
        row("njd", [1, 2, 3]),
        { id: "Bad Id", name: "x", pl: [], civil: [] },
        { id: "paed" },
        null,
      ],
    });
    expect(m?.rows.map((r) => r.id)).toEqual(["njd"]);
    expect(m?.rows[0]?.pl).toEqual([1, 2, 3]);
    expect(parseMatrix({ years: [2025, 2023], rows: [] })).toBeNull();
  });

  it("keeps only official uscourts.gov source links", () => {
    const n = parseNational({
      years: YEARS,
      latest: 2025,
      series: { civil_filed: [1, 2, 3], pl_parts: { asbestos_368: [1, 1, 1] } },
      sources: {
        "C-11": {
          "2025": {
            page: "https://www.uscourts.gov/data-news/x",
            url: "https://evil.example/x.xlsx",
          },
          "2024": { page: "https://evil.example/page" },
        },
      },
      rules: { pl_surge: "rule text", bogus: "x" },
      checks: { total: 10, passed: 9, failed: [{ check: "c-3 2017 row sums", detail: "8th" }] },
    });
    expect(n?.sources["C-11"]?.["2025"]).toEqual({
      page: "https://www.uscourts.gov/data-news/x",
      url: null,
      format: null,
    });
    expect(n?.sources["C-11"]?.["2024"]).toBeUndefined();
    expect(n?.rules).toEqual({ pl_surge: "rule text" });
    expect(n?.plParts["asbestos_368"]).toEqual([1, 1, 1]);
    expect(n?.checks.failed).toHaveLength(1);
  });

  it("validates circuit ids", () => {
    expect(parseCircuit({ circuit_id: "ca3", name: "Third Circuit", years: YEARS })?.id).toBe(
      "ca3",
    );
    expect(parseCircuit({ circuit_id: "cafc", name: "Federal Circuit", years: YEARS })).toBeNull();
  });

  it("ignores time-to-disposition data that belongs to another court", () => {
    const stats = { court_id: "njd", name: "D. New Jersey", years: YEARS, pl_total: [1, 2, 3] };
    const own = parseDistrictPanel(stats, {
      court_id: "njd",
      years: YEARS,
      median_total: [7, 8, 9],
    });
    expect(own?.times?.median).toEqual([7, 8, 9]);
    const other = parseDistrictPanel(stats, {
      court_id: "paed",
      years: YEARS,
      median_total: [7, 8, 9],
    });
    expect(other?.times).toBeNull();
    expect(parseDistrictPanel({ ...stats, pl_total: "x" }, null)).toBeNull();
  });
});

describe("court stats view helpers", () => {
  it("formats missing values as Not recorded", () => {
    expect(fmtNum(null)).toBe("Not recorded");
    expect(fmtNum(11215)).toBe("11,215");
    expect(fmtPct(55.62)).toBe("55.6%");
    expect(fmtPct(undefined)).toBe("Not recorded");
  });

  it("computes change only from two published values", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(150, 0)).toBeNull();
    expect(change(null, 100)).toBeNull();
  });

  it("medians and heat scale", () => {
    expect(median([3, null, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([null])).toBeNull();
    expect(heat(25, 100)).toBe(0.5);
    expect(heat(null, 100)).toBe(0);
  });

  it("sorts with missing values last in either direction", () => {
    const rows = parseMatrix({
      years: YEARS,
      rows: [row("aad", [1, 2, null]), row("bbd", [1, 2, 5]), row("ccd", [1, 2, 9])],
    })!.rows as DistrictRow[];
    expect(sortRows(rows, "pl", 2, 2025, true).map((r) => r.id)).toEqual(["ccd", "bbd", "aad"]);
    expect(sortRows(rows, "pl", 2, 2025, false).map((r) => r.id)).toEqual(["bbd", "ccd", "aad"]);
  });

  it("states the evidence behind each flag", () => {
    const f = parseFlag({ year: 2025, rule: "pl_surge", value: 1959, baseline: 944, ratio: 2.1 })!;
    expect(flagDetail(f)).toBe("1,959 filings vs prior five-year median 944 (2.1x)");
    const s = parseFlag({
      year: 2025,
      rule: "pl_share_cluster",
      share_pct: 76,
      national_share_pct: 15.1,
    })!;
    expect(flagDetail(s)).toBe("76.0% of civil filings vs 15.1% nationally");
  });

  it("benchmarks time flags against the median district and reports the pooled figure", () => {
    const f = parseFlag({
      year: 2025,
      rule: "slow_disposition",
      value: 13.6,
      district_median: 7.9,
      national: 15.6,
      ratio: 1.7215,
    })!;
    expect(flagDetail(f)).toBe("13.6 months vs median district 7.9 (pooled national 15.6)");
  });

  it("prints ratios with three significant digits", () => {
    expect(fmtRatio(0.4975)).toBe("0.497x");
    expect(fmtRatio(17.1234)).toBe("17.1x");
    expect(fmtRatio(2.0638)).toBe("2.06x");
    expect(fmtRatio(null)).toBe("Not recorded");
  });

  it("renders published dashes as printed and keeps Not recorded for missing cells", () => {
    const dash = parseDash({ median: [2024, 1999, "x"], pl: "bad" }, YEARS);
    expect(dash).toEqual({ median: [2024] });
    expect(isDash(dash, "median", 2024)).toBe(true);
    expect(fmtCell(null, isDash(dash, "median", 2024), 1)).toBe("–");
    expect(fmtCell(null, isDash(dash, "median", 2025), 1)).toBe("Not recorded");
    expect(fmtCell(0, true)).toBe("0");
  });

  it("names a district that dominates a pooled benchmark only above the threshold", () => {
    const top = {
      courtId: "flnd",
      name: "N.D. Florida",
      count: 148428,
      total: 355243,
      sharePct: 41.8,
    };
    expect(dominanceNote(top, "FY2025 civil terminations")).toBe(
      "N.D. Florida accounts for 41.8% of FY2025 civil terminations (148,428 of 355,243), so the pooled national figure largely reflects that docket.",
    );
    expect(dominanceNote({ ...top, sharePct: 12 }, "x")).toBeNull();
    expect(dominanceNote(null, "x")).toBeNull();
  });
});
