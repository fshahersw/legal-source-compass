import { describe, expect, it } from "vitest";
import type { TrendBlockData } from "@/lib/analytics/trend";
import { alignTrends } from "./trendAlign";

const block = (
  xKind: "year" | "fy",
  pts: [string, number | null, boolean?][],
  markers: { x: string; label: string }[] = [],
): TrendBlockData =>
  ({
    id: "x",
    xKind,
    chart: "line",
    stacked: false,
    format: "count",
    unit: "n",
    series: [{ id: "s", label: "S", points: pts.map(([x, value, partial]) => ({ x, value, partial })) }],
    primary: 0,
    latest: null,
    period: "",
    source: { label: "", url: "" },
    asOf: null,
    notes: [],
    gaps: 0,
    markers,
  }) as TrendBlockData;

describe("alignTrends", () => {
  it("never mixes fiscal and calendar years", () => {
    const r = alignTrends([
      { id: "a", label: "A", block: block("year", [["2020", 1], ["2021", 2], ["2022", 3]]) },
      { id: "b", label: "B", block: block("year", [["2020", 5], ["2021", 6], ["2022", 7]]) },
      { id: "c", label: "C", block: block("fy", [["2020", 9], ["2021", 9], ["2022", 9]]) },
    ]);
    expect(r!.xKind).toBe("year");
    expect(r!.leftOut).toEqual(["c"]);
    expect(r!.series.map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("drops unfinished periods and keeps unrecorded ones as gaps", () => {
    const r = alignTrends([
      { id: "a", label: "A", block: block("year", [["2019", 4], ["2020", null], ["2021", 2], ["2022", 3], ["2023", 1, true]]) },
      { id: "b", label: "B", block: block("year", [["2019", 1], ["2020", 5], ["2021", 6], ["2022", 7], ["2023", 2, true]]) },
    ]);
    expect(r!.partialDropped).toEqual(["2023"]);
    expect(r!.series[0]!.points.map((p) => p.value)).toEqual([4, null, 2, 3]);
    expect(r!.commonStart).toBe(0);
  });
  it("starts the comparison where every series is recorded", () => {
    const r = alignTrends([
      { id: "a", label: "A", block: block("year", [["2018", 3], ["2019", 4], ["2020", 5], ["2021", 6]]) },
      { id: "b", label: "B", block: block("year", [["2019", 1], ["2020", 2], ["2021", 3]]) },
      { id: "c", label: "C", block: block("year", [["2018", 9], ["2020", 2], ["2021", 3]]) },
    ]);
    expect(r!.series[0]!.points[0]!.date).toBe("2018");
    expect(r!.commonStart).toBe(2);
  });
  it("returns null with too few shared periods", () => {
    expect(
      alignTrends([
        { id: "a", label: "A", block: block("year", [["2020", 1], ["2021", 2]]) },
        { id: "b", label: "B", block: block("year", [["2020", 1], ["2021", 2]]) },
      ]),
    ).toBeNull();
  });
  it("leaves out periods before a coverage change marker", () => {
    const r = alignTrends([
      { id: "a", label: "A", block: block("year", [["2018", 1], ["2019", 50], ["2020", 55], ["2021", 60]], [{ x: "2019", label: "Coverage changes" }]) },
      { id: "b", label: "B", block: block("year", [["2018", 5], ["2019", 6], ["2020", 7], ["2021", 8]]) },
    ]);
    expect(r!.series[0]!.points.map((p) => p.value)).toEqual([null, 50, 55, 60]);
    expect(r!.commonStart).toBe(1);
    expect(r!.cutAt).toEqual([{ id: "a", label: "A", x: "2019", marker: "Coverage changes" }]);
  });
});
