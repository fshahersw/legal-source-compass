import { describe, expect, it } from "vitest";
import type { UstTable } from "@/lib/external/uscourtsTables.functions";
import {
  availableModes,
  breaksInWindow,
  chartRows,
  columnPoints,
  findColumn,
  hasValues,
  latest,
  latestNotes,
  marksInWindow,
  periodEndText,
  periodHeader,
  periodIndexes,
  periodLabel,
  periodShort,
  shareOfNational,
  valueText,
} from "./trendsModel";

function table(overrides: Partial<UstTable> = {}): UstTable {
  return {
    scope: "district",
    court: "nysd",
    courtLabel: "NY,S",
    table: "C",
    tableKey: "c",
    title: "Civil Cases Filed, Terminated, and Pending",
    periods: [
      { end: "2023-09-30", months: 12, pub: "JB", src: 0 },
      { end: "2023-12-31", months: 12, pub: "STFJ", src: 1 },
      { end: "2024-03-31", months: 12, pub: "FJCS", src: 2 },
      { end: "2024-09-30", months: 12, pub: "JB", src: 3 },
      { end: "2024-12-31", months: 3, pub: "BF", src: 4 },
      { end: "2025-09-30", months: null, pub: "JB", src: 5 },
    ],
    columns: [
      { key: "filed/y0", label: "Filed / 2024", unit: "count", decimals: 0 },
      { key: "median", label: "Median months", unit: "months", decimals: 1 },
    ],
    data: {
      "filed/y0": [100, 110, null, 120, 130, 140],
      median: [10.1, 10.2, 10.3, 10.4, 10.5, 10.6],
    },
    dash: { "filed/y0": [2] },
    national: { "filed/y0": [1000, 1100, 1150, 1200, 1300, 1400] },
    nationalDash: {},
    circuitId: "ca2",
    circuit: { "filed/y0": [300, 310, 320, 330, 340, 350] },
    notes: [
      { at: [0, 1, 2], lines: ["NOTE: Land condemnation cases omitted."] },
      { at: [3], lines: ["NOTE: Land condemnation cases omitted.", "Includes transfers."] },
    ],
    marks: [
      {
        at: [1, 3],
        col: null,
        text: "² The higher number of pending cases is the result of a transfer.",
      },
    ],
    county: null,
    breaks: [
      { at: 3, kind: "notes", detail: "The footnotes differ from the previous period's." },
      { at: 4, kind: "columns", detail: "columns added: x" },
    ],
    sources: [],
    ...overrides,
  };
}

describe("period selection", () => {
  it("keeps only 12-month periods and, for fiscal years, only September 30", () => {
    const t = table();
    expect(periodIndexes(t.periods, "rolling")).toEqual([0, 1, 2, 3]);
    expect(periodIndexes(t.periods, "fy")).toEqual([0, 3]);
  });
  it("selects point-in-time periods (months 0) separately from 12-month flows", () => {
    const periods = [
      { end: "2023-09-30", months: 0, pub: "JB", src: 0 },
      { end: "2024-09-30", months: 0, pub: "JB", src: 1 },
      { end: "2024-09-30", months: 12, pub: "JB", src: 2 },
    ];
    expect(periodIndexes(periods, "fy", 0)).toEqual([0, 1]);
    expect(periodIndexes(periods, "fy")).toEqual([2]);
    expect(availableModes(periods, 0)).toEqual(["fy", "rolling"]);
  });
  it("offers a mode only when it has two or more points", () => {
    expect(availableModes(table().periods)).toEqual(["fy", "rolling"]);
    expect(availableModes(table().periods.slice(0, 2))).toEqual(["rolling"]);
    expect(availableModes([])).toEqual([]);
  });
});

describe("columnPoints", () => {
  it("returns nulls as gaps and flags published dashes", () => {
    const pts = columnPoints(table(), "filed/y0", "court", "rolling");
    expect(pts.map((p) => p.value)).toEqual([100, 110, null, 120]);
    expect(pts[2]!.dash).toBe(true);
    expect(pts[0]!.dash).toBe(false);
  });
  it("reads the national and circuit rows and returns [] for an unknown column", () => {
    expect(columnPoints(table(), "filed/y0", "national", "fy").map((p) => p.value)).toEqual([
      1000, 1200,
    ]);
    expect(columnPoints(table(), "filed/y0", "circuit", "fy").map((p) => p.value)).toEqual([
      300, 330,
    ]);
    expect(columnPoints(table(), "nope", "court", "fy")).toEqual([]);
    expect(columnPoints(table({ circuit: null }), "filed/y0", "circuit", "fy")).toEqual([]);
  });
  it("latest skips trailing gaps; hasValues counts only recorded points", () => {
    const pts = columnPoints(
      table({ data: { "filed/y0": [1, 2, null, null, null, null] } }),
      "filed/y0",
      "court",
      "rolling",
    );
    expect(latest(pts)?.end).toBe("2023-12-31");
    expect(hasValues(pts, 2)).toBe(true);
    expect(hasValues(pts, 3)).toBe(false);
  });
});

describe("shareOfNational", () => {
  it("divides court by national for the same period and leaves a gap when either is unknown", () => {
    const court = columnPoints(table(), "filed/y0", "court", "rolling");
    const nat = columnPoints(table(), "filed/y0", "national", "rolling");
    const share = shareOfNational(court, nat);
    expect(share.map((p) => (p.value == null ? null : Number(p.value.toFixed(3))))).toEqual([
      10,
      10,
      null,
      10,
    ]);
    const zero = shareOfNational(
      court,
      nat.map((p) => ({ ...p, value: 0 })),
    );
    expect(zero.every((p) => p.value === null)).toBe(true);
  });
});

describe("labels and values", () => {
  it("labels fiscal years and rolling windows", () => {
    expect(periodLabel("2025-09-30", "fy")).toBe("FY2025");
    expect(periodLabel("2025-09-30", "rolling")).toBe("Sep 2025");
    expect(periodLabel("2026-06-30", "rolling")).toBe("Jun 2026");
    expect(periodEndText("2026-06-30")).toBe("12 months ending June 30, 2026");
    expect(periodEndText("bad")).toBe("bad");
  });
  it("words the period by its length: months ending, or as of a date for a count at a point in time", () => {
    expect(periodEndText("2025-09-30", 3)).toBe("3 months ending September 30, 2025");
    expect(periodEndText("2025-09-30", 0)).toBe("As of September 30, 2025");
    expect(periodEndText("2025-09-30", null)).toBe("Period ending September 30, 2025");
    expect(periodHeader(12)).toBe("12 months ending");
    expect(periodHeader(0)).toBe("As of");
    expect(periodShort("2025-09-30", 12)).toBe("to September 30, 2025");
    expect(periodShort("2025-09-30", 0)).toBe("as of September 30, 2025");
  });
  it("formats by unit and never writes zero for an unknown value", () => {
    expect(valueText(1234, "count", 0)).toBe("1,234");
    expect(valueText(10.123, "months", 1)).toBe("10.1");
    expect(valueText(0.4126, "percent", 1)).toBe("0.4%");
    expect(valueText(null, "count", 0)).toBe("Not recorded");
    expect(valueText(null, "count", 0, true)).toBe("– (dash as published)");
    expect(valueText(0, "count", 0)).toBe("0");
    expect(valueText(Number.NaN, "count", 0)).toBe("Not recorded");
  });
});

describe("chartRows", () => {
  it("merges series by period end and fills a missing point with null", () => {
    const t = table();
    const a = {
      id: "court",
      label: "Court",
      points: columnPoints(t, "filed/y0", "court", "rolling"),
    };
    const b = {
      id: "nat",
      label: "National",
      points: columnPoints(t, "filed/y0", "national", "fy"),
    };
    const rows = chartRows([a, b], "rolling");
    expect(rows.map((r) => r.end)).toEqual([
      "2023-09-30",
      "2023-12-31",
      "2024-03-31",
      "2024-09-30",
    ]);
    expect(rows[1]!["nat"]).toBeNull();
    expect(rows[0]!["nat"]).toBe(1000);
    expect(rows[2]!["court__dash"]).toBe(true);
    expect(rows[0]!.label).toBe("Sep 2023");
  });
});

describe("column lookup, notes and breaks", () => {
  it("finds a column by its published heading or returns null", () => {
    const cols = table().columns;
    expect(findColumn(cols, [/^Filed/])?.key).toBe("filed/y0");
    expect(findColumn(cols, [/median/i, /months/i])?.key).toBe("median");
    expect(findColumn(cols, [/terminated/i])).toBeNull();
  });
  it("returns the footnotes that apply to the latest plotted period", () => {
    expect(latestNotes(table(), "rolling")).toEqual([
      "NOTE: Land condemnation cases omitted.",
      "Includes transfers.",
    ]);
    expect(latestNotes(table(), "fy")).toEqual([
      "NOTE: Land condemnation cases omitted.",
      "Includes transfers.",
    ]);
    expect(latestNotes(table({ notes: [] }), "fy")).toEqual([]);
  });
  it("lists the court-row footnotes that apply inside the plotted window, merged by text", () => {
    const t = table({
      marks: [
        { at: [1, 3], col: null, text: "² Transfer." },
        { at: [0], col: null, text: "² Transfer." },
        { at: [2], col: "median", text: "¹ Median not computed." },
        { at: [4, 5], col: null, text: "outside the plotted window" },
      ],
    });
    const marks = marksInWindow(t, "rolling", ["filed/y0"]);
    expect(marks).toEqual([
      { text: "² Transfer.", col: null, ends: ["2023-09-30", "2023-12-31", "2024-09-30"] },
    ]);
    expect(marksInWindow(t, "rolling", ["median"]).find((m) => m.col === "median")).toMatchObject({
      text: "¹ Median not computed.",
    });
    expect(marksInWindow(t, "rolling", ["filed/y0", "median"]).map((m) => m.text)).toEqual([
      "² Transfer.",
      "¹ Median not computed.",
    ]);
    expect(marksInWindow(t, "fy", ["filed/y0"])[0]!.ends).toEqual(["2023-09-30", "2024-09-30"]);
  });
  it("finds notes, footnotes and breaks of a point-in-time table by its own period length", () => {
    const snapshots = table({
      periods: [
        { end: "2023-09-30", months: 0, pub: "JB", src: 0 },
        { end: "2024-09-30", months: 0, pub: "JB", src: 1 },
      ],
      notes: [{ at: [1], lines: ["NOTE: Counts are as of the date shown."] }],
      marks: [{ at: [0, 1], col: null, text: "¹ Pending count revised." }],
      breaks: [
        {
          at: 1,
          kind: "title",
          detail: "The table title is worded differently from the previous period.",
        },
      ],
    });
    expect(latestNotes(snapshots, "fy")).toEqual([]);
    expect(latestNotes(snapshots, "fy", 0)).toEqual(["NOTE: Counts are as of the date shown."]);
    expect(marksInWindow(snapshots, "fy", ["filed/y0"], 0)[0]!.ends).toEqual([
      "2023-09-30",
      "2024-09-30",
    ]);
    expect(breaksInWindow(snapshots, "fy", 0).map((b) => b.end)).toEqual(["2024-09-30"]);
  });
  it("lists only breaks inside the plotted window", () => {
    expect(breaksInWindow(table(), "rolling").map((b) => b.kind)).toEqual(["notes"]);
    expect(breaksInWindow(table(), "fy").map((b) => b.end)).toEqual(["2024-09-30"]);
  });
});
