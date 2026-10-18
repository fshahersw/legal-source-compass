import { describe, expect, it } from "vitest";
import type {
  CpscHazard,
  CpscYear,
  EpaProfile,
  EpaYear,
} from "@/lib/external/enforcement.functions";
import { parseCaseRow, parseCpsc, parseProfile } from "@/lib/external/enforcement.functions";
import {
  countryShare,
  denseYears,
  fyWindows,
  hazardCube,
  latestCompleteFy,
  latestCompleteYear,
  median,
  quantile,
  risingHazards,
  sortRows,
  stateRows,
  sumYears,
  surgeFlag,
  tukeyUpper,
  usd,
} from "./enforcementView";

const y = (fy: number, cases: number, fedPenalty = 0): EpaYear => ({
  fy,
  cases,
  judicial: 0,
  administrative: cases,
  settlements: 0,
  penaltySettlements: 0,
  fedPenalty,
  sep: 0,
  costRecovery: 0,
});

function profile(code: string, years: EpaYear[], population: number | null = null): EpaProfile {
  return {
    id: `epa-profile:${code}`,
    code,
    name: code,
    kind: "state",
    fips: null,
    totals: {
      cases: 0,
      judicial: 0,
      administrative: 0,
      penaltySettlements: 0,
      fedPenalty: 0,
      sep: 0,
      costRecovery: 0,
      multistateCases: 0,
      unattributedFedPenalty: 0,
    },
    years,
    statutes: [],
    topDefendantGroups: [],
    topDefendantGroupsRecent: [],
    topCases: [],
    nationalGroups: [],
    lookalikes: null,
    population,
    populationYear: population ? 2025 : null,
  };
}

describe("fiscal-year windows", () => {
  it("derives the latest complete FY from the file date", () => {
    expect(latestCompleteFy("2026-10-10", 2020)).toBe(2026);
    expect(latestCompleteFy("2026-09-29", 2020)).toBe(2025);
    expect(latestCompleteFy(null, 2020)).toBe(2020);
    expect(fyWindows(2026, 1971)[0]).toMatchObject({ from: 2017, to: 2026 });
  });
  it("sums and fills years", () => {
    const years = [y(2020, 3, 10), y(2022, 5, 20)];
    expect(sumYears(years, 2021, 2022)).toMatchObject({ cases: 5, fedPenalty: 20 });
    expect(denseYears(years, 2020, 2022).map((r) => r.cases)).toEqual([3, 0, 5]);
  });
});

describe("statistics", () => {
  it("computes median, quantiles and the Tukey fence", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(tukeyUpper([1, 2, 3, 4, 5])).toBe(4 + 1.5 * 2);
  });
});

describe("flags", () => {
  it("flags a state surge only with both the ratio and absolute rules", () => {
    const base = [2021, 2022, 2023, 2024, 2025].map((fy) => y(fy, 20));
    expect(surgeFlag([...base, y(2026, 40)], 2026)).toMatchObject({ latest: 40, baseline: 20 });
    expect(surgeFlag([...base, y(2026, 29)], 2026)).toBeNull();
    const small = [2021, 2022, 2023, 2024, 2025].map((fy) => y(fy, 2));
    expect(surgeFlag([...small, y(2026, 8)], 2026)).toBeNull();
  });
  it("marks per-capita outliers above the fence and ranks rows", () => {
    const profiles = ["A", "B", "C", "D", "E"].map((c, i) =>
      profile(c, [y(2025, c === "E" ? 1000 : 10 + i)], 1_000_000),
    );
    const window = fyWindows(2026, 2000)[0]!;
    const rows = stateRows(profiles, window, 2026);
    expect(rows.find((r) => r.code === "E")?.perCapitaOutlier).toBe(true);
    expect(rows.find((r) => r.code === "A")?.perCapitaOutlier).toBe(false);
    expect(sortRows(rows, "cases", true)[0]?.code).toBe("E");
    expect(rows.find((r) => r.code === "A")?.perMillion).toBe(10);
  });
  it("flags rising CPSC hazards against a three-year mean", () => {
    const hazard = (key: string, values: number[]): CpscHazard => ({
      key,
      label: key,
      rule: "",
      recalls: 0,
      deathMentions: 0,
      years: values.map((recalls, i) => ({ year: 2022 + i, recalls, deathMentions: 0 })),
      countries: {},
    });
    const out = risingHazards(
      [hazard("fire", [10, 10, 10, 20]), hazard("fall", [4, 4, 4, 9])],
      2025,
    );
    expect(out.map((h) => h.key)).toEqual(["fire"]);
    expect(latestCompleteYear("2026-10-15", 2000)).toBe(2025);
  });
});

describe("CPSC helpers", () => {
  const year: CpscYear = {
    year: 2025,
    partial: false,
    recalls: 10,
    withCountry: 8,
    hazards: {},
    countries: { China: 6 },
    hazardCountry: { fire_burn: { China: 3, "United States": 1 } },
    deathMentions: 0,
    deathBackground: 0,
    deathForeignOnly: 0,
    injuryMentions: 0,
    noneReported: 0,
    injuryTextMissing: 0,
    standardViolation: 0,
    unitsParsed: 0,
    unitsSum: 0,
  };
  it("computes shares over recalls with a recorded country", () => {
    expect(countryShare(year, "China")).toBe(0.75);
    expect(countryShare({ ...year, withCountry: 0 }, "China")).toBeNull();
    expect(hazardCube([year], 2020, 2025).get("fire_burn")?.get("China")).toBe(3);
    expect(hazardCube([year], 2026, 2026).size).toBe(0);
  });
});

describe("stored-row validation", () => {
  it("drops malformed profiles and case rows", () => {
    expect(parseProfile("x", { kind: "bogus", code: "TX", totals: {} })).toBeNull();
    const ok = parseProfile("epa-profile:TX", {
      kind: "state",
      code: "TX",
      name: "Texas",
      totals: { cases: 2 },
      years: [{ fy: 1980, cases: 1 }, { fy: 2020, cases: 1 }, { cases: 3 }],
    });
    expect(ok?.years.map((r) => r.fy)).toEqual([2020]);
    expect(
      parseCaseRow({ n: "01-2017-1001", fy: 2017, pen: {}, url: "https://echo.epa.gov/x" }),
    ).toBeNull();
    expect(
      parseCaseRow({
        id: "epa-case:1",
        n: "01-2017-1001",
        fy: 2017,
        pen: { fed_penalty: 5 },
        url: "https://evil.example/x",
      }),
    ).toBeNull();
    expect(
      parseCaseRow({
        id: "epa-case:1",
        n: "1",
        fy: 2017,
        pen: { fed_penalty: 5 },
        url: "https://echo.epa.gov/r",
      })?.fedPenalty,
    ).toBe(5);
  });
  it("parses defendant groups, settlement fields and multi-record national cases", () => {
    const p = parseProfile("epa-profile:US", {
      kind: "national",
      code: "US",
      totals: { cases: 3, fed_penalty: 10, unattributed: { fed_penalty: 2 } },
      years: [
        {
          fy: 2016,
          cases: 1,
          settlements: 2,
          penalty_settlements: 1,
          fed_penalty: 5,
          cost_recovery: 7,
        },
      ],
      top_defendant_groups: [
        { defendants: ["A Inc.", "B LLC"], cases: 1, fed_penalty: 5 },
        { defendants: [] },
      ],
      top_cases: [
        {
          case_number: "06-2011-4881",
          fed_penalty: 6.7,
          records: ["06-2011-4881", "04-2010-9036"],
          settled: "2016-04-04",
        },
      ],
      national_case_groups: [
        { lead_case_number: "06-2011-4881", records: ["06-2011-4881"], combined_fed_penalty: 1 },
      ],
    });
    expect(p?.totals.unattributedFedPenalty).toBe(2);
    expect(p?.years[0]).toMatchObject({ settlements: 2, penaltySettlements: 1, costRecovery: 7 });
    expect(p?.topDefendantGroups).toHaveLength(1);
    expect(p?.topCases[0]?.records).toHaveLength(2);
    expect(p?.nationalGroups).toHaveLength(0);
  });
  it("requires a CPSC overview record and rejects foreign recall URLs", () => {
    expect(parseCpsc([{ kind: "year", year: 2020 }], [])).toBeNull();
    const out = parseCpsc(
      [
        { kind: "overview", recalls: 3 },
        { kind: "year", year: 2020, recalls: 3 },
      ],
      [{ id: "cpsc-api:1", n: "1", u: "https://bad.example" }],
    );
    expect(out?.years[0]?.recalls).toBe(3);
    expect(out?.deathRecalls[0]?.url).toBeNull();
  });
  it("formats dollars", () => {
    expect(usd(7_191_540_097)).toBe("$7.2B");
    expect(usd(null)).toBe("Not recorded");
  });
});
