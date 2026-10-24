import { describe, expect, it } from "vitest";
import {
  benchmarkTakeaway,
  changeBetween,
  medianOf,
  rankRows,
  foldSeries,
  foldTail,
  lastChange,
  latestOf,
  lowOf,
  peakOf,
  rankTakeaway,
  shareTakeaway,
  summarizeTrend,
  trendTakeaway,
} from "./takeaway";

const fmt = (v: number) => v.toLocaleString("en-US");
const pts = (vals: (number | null)[], start = 2014) =>
  vals.map((v, i) => ({ label: String(start + i), value: v }));

describe("trend summary", () => {
  it("finds peak, low, first and latest, skipping gaps and partial periods", () => {
    const p = [...pts([10, null, 40, 25]), { label: "2018", value: 1, partial: true }];
    expect(peakOf(p)).toEqual({ label: "2016", value: 40, index: 2 });
    expect(lowOf(p)).toEqual({ label: "2014", value: 10, index: 0 });
    expect(latestOf(p)?.label).toBe("2017");
    const s = summarizeTrend(p)!;
    expect(s.n).toBe(3);
    expect(s.change).toEqual({ absolute: 15, percent: 150 });
    expect(s.latestIsPeak).toBe(false);
  });

  it("returns null with fewer than two recorded complete values", () => {
    expect(summarizeTrend(pts([null, 5]))).toBeNull();
    expect(trendTakeaway("Filings", pts([5]), fmt)).toBeNull();
  });

  it("breaks peak ties to the earliest and does not call a tied latest the high", () => {
    expect(peakOf(pts([5, 9, 9]))?.label).toBe("2015");
    expect(summarizeTrend(pts([5, 9, 9]))?.latestIsPeak).toBe(false);
  });

  it("measures change, with no percent from a zero base", () => {
    expect(changeBetween(0, 5)).toEqual({ absolute: 5, percent: null });
    expect(changeBetween(200, 150).percent).toBe(-25);
    expect(lastChange(pts([1, 2, null, 4]))).toMatchObject({ absolute: 2, percent: 100 });
  });
});

describe("trendTakeaway", () => {
  it("names a new high", () => {
    expect(trendTakeaway("Filings", pts([10, 20, 30]), fmt)).toBe(
      "Filings reached a high of 30 in 2016",
    );
  });

  it("names a new low", () => {
    expect(trendTakeaway("Filings", pts([30, 20, 10]), fmt)).toBe(
      "Filings fell to a low of 10 in 2016",
    );
  });

  it("names an interior peak when the latest value is well below it", () => {
    expect(trendTakeaway("Filings", pts([10, 236_431, 50, 45_713]), fmt)).toBe(
      "Filings peaked at 236,431 in 2015; 45,713 in 2017",
    );
  });

  it("states the change first to latest otherwise", () => {
    expect(trendTakeaway("Filings", pts([100, 150, 120, 140]), fmt)).toBe(
      "Filings rose 40% from 2014 to 2017, to 140",
    );
    expect(trendTakeaway("Filings", pts([100, 102]), fmt)).toBe(
      "Filings changed little from 2014 to 2015 (100 to 102)",
    );
    expect(trendTakeaway("Filings", pts([0, 0]), fmt)).toBe("Filings stood at 0 in 2014 and 2015");
    expect(trendTakeaway("Filings", pts([0, 3]), fmt)).toBe(
      "Filings rose from 0 in 2014 to 3 in 2015",
    );
  });
});

describe("rank and share takeaways", () => {
  const items = [
    { label: "D. New Jersey", value: 659.7 },
    { label: "D. South Carolina", value: 1130.7 },
    { label: "N.D. Florida", value: null },
  ];
  it("names the leader and the runner-up", () => {
    expect(rankTakeaway(items, (v) => v.toFixed(1))).toBe(
      "D. South Carolina leads with 1130.7; D. New Jersey next at 659.7",
    );
    expect(
      rankTakeaway(items, (v) => v.toFixed(1), {
        ascending: true,
        verb: "is lowest at",
        withRunnerUp: false,
      }),
    ).toBe("D. New Jersey is lowest at 659.7");
  });
  it("reports ties instead of picking one", () => {
    expect(
      rankTakeaway(
        [
          { label: "A", value: 2 },
          { label: "B", value: 2 },
        ],
        fmt,
      ),
    ).toBe("A and B tie at 2");
    expect(rankTakeaway([{ label: "A", value: null }], fmt)).toBeNull();
  });
  it("states the largest share of a total", () => {
    expect(
      shareTakeaway(
        [
          { label: "Drug", value: 50 },
          { label: "Device", value: 30 },
          { label: "Food", value: 20 },
        ],
        { totalLabel: (t) => `${t} entries` },
      ),
    ).toBe("Drug accounts for 50% of 100 entries");
    expect(
      shareTakeaway([
        { label: "A", value: 1 },
        { label: "B", value: 1 },
      ]),
    ).toBeNull();
  });
});

describe("folding a tail into Other", () => {
  it("keeps the top n and sums the rest, never summing missing values", () => {
    const parts = [
      { id: "a", value: 50 },
      { id: "b", value: 5 },
      { id: "c", value: 30 },
      { id: "d", value: 1 },
      { id: "e", value: null },
    ];
    const f = foldTail(parts, 2);
    expect(f.shown.map((p) => p.id)).toEqual(["a", "c"]);
    expect(f.other).toEqual({ label: "Other", value: 6, count: 2 });
    expect(f.missing.map((p) => p.id)).toEqual(["e"]);
    expect(foldTail(parts.slice(0, 3), 2).other).toBeNull();
  });

  it("folds stacked series by total, per row, keeping gaps as gaps", () => {
    const rows = [
      { y: "2020", a: 10, b: 1, c: 2, d: null },
      { y: "2021", a: 12, b: null, c: null, d: null },
    ];
    const f = foldSeries(rows, ["a", "b", "c", "d"], 1);
    expect(f.kept).toEqual(["a"]);
    expect(f.folded).toEqual(["c", "b", "d"]);
    expect(f.rows[0]!["__other"]).toBe(3);
    expect(f.rows[1]!["__other"]).toBeNull();
    expect(rows[0]).not.toHaveProperty("__other");
  });
});

describe("ranking and benchmark helpers", () => {
  const items = [
    { id: "a", label: "A", value: 5 },
    { id: "b", label: "B", value: 9 },
    { id: "c", label: "C", value: 9 },
    { id: "d", label: "D", value: 1 },
    { id: "e", label: "E", value: null },
  ];
  it("ranks with ties sharing a rank and keeps the focus row visible under a limit", () => {
    const r = rankRows(items, { limit: 2, focusId: "d" });
    expect(r.rows.map((x) => [x.id, x.rank])).toEqual([
      ["b", 1],
      ["d", 4],
    ]);
    expect(r.rows[1]!.focus).toBe(true);
    expect(r.total).toBe(4);
    expect(r.focusRank).toBe(4);
    expect(r.missing.map((m) => m.id)).toEqual(["e"]);
    expect(rankRows(items, { ascending: true }).rows[0]!.id).toBe("d");
  });
  it("takes the median of recorded values", () => {
    expect(medianOf([3, null, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([null])).toBeNull();
  });
  it("places a value against a benchmark", () => {
    const f = (v: number) => `${v.toFixed(1)} months`;
    expect(benchmarkTakeaway("D. Minnesota", 8.2, 7.9, "the median district", f)).toBe(
      "D. Minnesota: 8.2 months, 0.3 months above the median district (7.9 months)",
    );
    expect(benchmarkTakeaway("X", null, 1, "y", f)).toBeNull();
  });
});
