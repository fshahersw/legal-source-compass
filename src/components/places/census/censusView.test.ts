import { describe, expect, it } from "vitest";
import { parseCensusGeo, type CensusGeo, type CensusMeasureDef } from "@/lib/external/censusModel";
import {
  changeText,
  chartRows,
  compareLatest,
  keyFigures,
  measureRows,
  verdictText,
} from "./censusView";

const defs: CensusMeasureDef[] = [
  {
    key: "poverty_rate",
    label: "People below the poverty level",
    unit: "% of people",
    format: "pct",
    group: "Economy",
    kind: "share",
    table: "B17001",
    cells: [],
    cellsSubtracted: [],
    denominatorCell: null,
    universe: null,
    note: null,
  },
  {
    key: "median_hh_income",
    label: "Median household income",
    unit: "dollars",
    format: "dollars",
    group: "Economy",
    kind: "value",
    table: "B19013",
    cells: [],
    cellsSubtracted: [],
    denominatorCell: null,
    universe: null,
    note: null,
  },
];
const defMap = new Map(defs.map((d) => [d.key, d]));

function geo(
  id: string,
  name: string,
  level: "us" | "state" | "county",
  poverty: Record<string, [number | null, number | null]>,
  income: Record<string, [number | null, number | null]> = {},
): CensusGeo {
  const years = Object.keys(poverty).map(Number);
  const latestYear = Math.max(...years);
  return parseCensusGeo({
    geoid: id,
    level,
    name,
    usps: "WY",
    survey: "acs5",
    years,
    latest_year: latestYear,
    period: `${latestYear - 4}-${latestYear}`,
    series: {
      poverty_rate: poverty,
      ...(Object.keys(income).length ? { median_hh_income: income } : {}),
    },
    latest: Object.fromEntries(
      [["poverty_rate", poverty] as const, ["median_hh_income", income] as const].flatMap(
        ([k, s]) => {
          const ys = Object.keys(s)
            .filter((y) => s[y]![0] != null)
            .sort();
          const y = ys.at(-1);
          return y ? [[k, [s[y]![0], s[y]![1], Number(y)]]] : [];
        },
      ),
    ),
    rank: { poverty_rate: [38, 51] },
  })!;
}

const wy = geo(
  "56",
  "Wyoming",
  "state",
  { "2013": [11.6, 0.9], "2019": [10.9, 0.8], "2024": [10.5, 0.55] },
  { "2013": [57406, 841], "2024": [null, null] },
);
const us = geo("US", "United States", "us", {
  "2013": [15.4, 0.1],
  "2019": [13.4, 0.1],
  "2024": [12.1, 0.1],
});

describe("verdictText", () => {
  it("says higher or lower only outside the combined margin", () => {
    expect(
      verdictText("the U.S.", { diff: -1.6, moe: 0.56, distinguishable: true }, defs[0]!),
    ).toBe("Lower than the U.S. by more than the margin of error");
    expect(verdictText("the U.S.", { diff: 2, moe: 3, distinguishable: false }, defs[0]!)).toBe(
      "Within the margin of error of the U.S.",
    );
    expect(
      verdictText("the U.S.", { diff: 2, moe: null, distinguishable: null }, defs[0]!),
    ).toContain("margin not available");
    expect(verdictText("the U.S.", null, defs[0]!)).toBe("Not recorded for the U.S.");
  });
});

describe("compareLatest", () => {
  it("compares only the same release", () => {
    const [c] = compareLatest(wy, defs[0]!, [{ id: "us", label: "the U.S.", geo: us }]);
    expect(c!.diff?.diff).toBeCloseTo(-1.6);
    expect(c!.verdict).toBe("Lower than the U.S. by more than the margin of error");
    const older = geo("US", "United States", "us", { "2023": [12.4, 0.1] });
    expect(
      compareLatest(wy, defs[0]!, [{ id: "us", label: "the U.S.", geo: older }])[0]!.verdict,
    ).toBe("Not recorded for the U.S.");
  });
  it("shows a count beside the comparator without ranking one area's size against another's", () => {
    const people: CensusMeasureDef = {
      ...defs[0]!,
      key: "poverty_rate",
      label: "Total population",
      unit: "people",
      format: "int",
      kind: "value",
    };
    const [c] = compareLatest(wy, people, [{ id: "us", label: "the U.S.", geo: us }]);
    expect(c!.diff).toBeNull();
    expect(c!.verdict).toBe("A count of people; not compared by size");
    expect(c!.latest?.value).toBe(12.1);
  });
  it("reports a missing comparator as Not recorded", () => {
    expect(
      compareLatest(wy, defs[0]!, [{ id: "us", label: "the U.S.", geo: null }])[0]!.verdict,
    ).toBe("Not recorded for the U.S.");
  });
});

describe("keyFigures", () => {
  it("builds tiles with value, margin, rank, trend and comparisons", () => {
    const [k] = keyFigures(
      wy,
      defMap,
      ["poverty_rate", "unknown_key"],
      [{ id: "us", label: "the U.S.", geo: us }],
    );
    expect(k!.valueText).toBe("10.5%");
    expect(k!.moeText).toBe("± 0.6 pts");
    expect(k!.rank).toEqual({ rank: 38, of: 51 });
    expect(k!.trend.map((p) => p.value)).toEqual([11.6, 10.9, 10.5]);
    expect(keyFigures(wy, defMap, ["unknown_key"], [])).toEqual([]);
  });
  it("shows a measure with no published latest value as Not recorded", () => {
    const [k] = keyFigures(wy, defMap, ["median_hh_income"], []);
    expect(k!.valueText).toBe("$57,406"); // the latest PUBLISHED release, labelled by its own year
    expect(k!.latest?.year).toBe(2013);
  });
});

describe("chartRows", () => {
  it("lists every release year with nulls for unpublished values and no zeros", () => {
    const rows = chartRows(
      [
        { id: "area", label: "Wyoming", geo: wy },
        { id: "us", label: "United States", geo: us },
      ],
      "median_hh_income",
    );
    const last = rows.at(-1)!;
    expect(last["area"]).toBeNull();
    expect(rows[0]!["area"]).toBe(57406);
    expect(rows[0]!["area_moe"]).toBe(841);
    expect(rows[0]!["us"]).toBeNull();
  });
});

describe("changeText", () => {
  it("states the change and when a significance statement is allowed", () => {
    const c = changeText(wy, defs[0]!)!;
    expect(c.text).toBe("−1.1 pts");
    expect(c.note).toBe("2013 to 2024 release: larger than the margin of error");
  });
  it("gives no change for a single release", () => {
    const one = geo("56", "Wyoming", "state", { "2024": [10.5, 0.55] });
    expect(changeText(one, defs[0]!)).toBeNull();
  });
});

describe("measureRows", () => {
  it("builds one row per definition", () => {
    const rows = measureRows(wy, defs, [{ id: "us", label: "the U.S.", geo: us }]);
    expect(rows.map((r) => r.def.key)).toEqual(["poverty_rate", "median_hh_income"]);
    expect(rows[0]!.year).toBe(2024);
    expect(rows[1]!.comparisons[0]!.verdict).toBe("Not recorded for the U.S.");
  });
});
