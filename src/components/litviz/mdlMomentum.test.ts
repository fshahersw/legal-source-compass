import { describe, expect, it } from "vitest";
import type { MdlRow } from "@/lib/external/mdlAnalytics.functions";
import { validSeries } from "@/lib/external/mdlSeries";
import {
  exactChange,
  log10Ticks,
  mdlMomentum,
  momentumSplit,
  monthKey,
  shiftMonth,
  symlog,
  symlogTicks,
} from "./mdlMomentum";

const row = (mdl: number, series: unknown, over: Partial<MdlRow> = {}): MdlRow => {
  const s = validSeries(series);
  return {
    mdl,
    title: `IN RE: Test ${mdl} Litigation`,
    type: "Products Liability",
    massTort: true,
    status: "pending",
    district: "NJ",
    judge: "A. Judge",
    pending: s[s.length - 1]?.pending ?? null,
    total: null,
    change1m: null,
    change3m: null,
    change12m: null,
    new12m: null,
    resolved12m: null,
    ageYears: null,
    growth: "stable",
    dateTransferred: "2020-01-02",
    dateClosed: null,
    rank: null,
    sharePct: null,
    series: s,
    ...over,
  };
};

describe("validSeries", () => {
  it("drops points without a date or a finite non-negative pending count (a gap, never a zero)", () => {
    const s = validSeries([
      { date: "2025-10-01", pending: 10, total: 20 },
      { date: "2025-11-03", pending: null, total: 20 },
      { date: "2025-12-02", total: 20 },
      { date: "not a date", pending: 4, total: 4 },
      { date: "2026-01-05", pending: -1, total: 4 },
      { date: "2026-02-02", pending: 7 },
    ]);
    expect(s).toEqual([
      { date: "2025-10-01", pending: 10, total: 20 },
      { date: "2026-02-02", pending: 7, total: null },
    ]);
  });

  it("keeps an exact repeat once and drops both copies of a date printed with different counts", () => {
    const s = validSeries([
      { date: "2026-01-05", pending: 5, total: 9 },
      { date: "2026-01-05", pending: 5, total: 9 },
      { date: "2026-02-02", pending: 6, total: 9 },
      { date: "2026-02-02", pending: 8, total: 9 },
    ]);
    expect(s).toEqual([{ date: "2026-01-05", pending: 5, total: 9 }]);
  });
});

describe("month arithmetic", () => {
  it("keys and shifts calendar months across year ends", () => {
    expect(monthKey("2026-10-01")).toBe("2026-10");
    expect(monthKey("2026-13-01")).toBeNull();
    expect(shiftMonth("2026-10", 12)).toBe("2025-10");
    expect(shiftMonth("2026-01", 1)).toBe("2025-12");
    expect(shiftMonth("2026-03", 15)).toBe("2024-12");
  });
});

describe("exactChange", () => {
  it("is N(t) − N(t−12) when the report twelve months earlier exists, with a negative delta kept signed", () => {
    const c = exactChange(
      validSeries([
        { date: "2025-10-01", pending: 4140, total: 4200 },
        { date: "2026-09-01", pending: 800, total: 4300 },
        { date: "2026-10-01", pending: 748, total: 4300 },
      ]),
    );
    expect(c).toMatchObject({ ok: true, change: 748 - 4140 });
  });

  it("matches the report by calendar month even when the print day differs (2024-12-02 vs 2025-12-02)", () => {
    const c = exactChange(
      validSeries([
        { date: "2024-12-02", pending: 10, total: 10 },
        { date: "2025-12-02", pending: 25, total: 25 },
      ]),
    );
    expect(c).toMatchObject({ ok: true, change: 15 });
  });

  it("never substitutes the nearest report when the month twelve back is missing (MDL 2885 case)", () => {
    // 3M earplug series: no 2025-10 report; the record's own change_12m of −6 came from September 2025.
    const c = exactChange(
      validSeries([
        { date: "2025-09-02", pending: 8, total: 391221 },
        { date: "2026-03-02", pending: 0, total: 391222 },
        { date: "2026-10-01", pending: 2, total: 391239 },
      ]),
    );
    expect(c).toEqual({ ok: false, reason: "no-prior-report" });
  });

  it("rejects a month that holds two different report dates", () => {
    const c = exactChange(
      validSeries([
        { date: "2025-10-01", pending: 10, total: 10 },
        { date: "2025-10-20", pending: 12, total: 12 },
        { date: "2026-10-01", pending: 20, total: 20 },
      ]),
    );
    expect(c).toEqual({ ok: false, reason: "two-reports-in-month" });
  });

  it("returns no-latest for an empty series", () => {
    expect(exactChange([])).toEqual({ ok: false, reason: "no-latest" });
  });
});

describe("mdlMomentum", () => {
  const asOf = "2026-10-01";
  const rows = [
    row(1, [
      { date: "2025-10-01", pending: 100, total: 100 },
      { date: "2026-10-01", pending: 150, total: 150 },
    ]),
    row(2, [
      { date: "2025-10-01", pending: 90, total: 90 },
      { date: "2026-10-01", pending: 0, total: 90 },
    ]),
    row(3, [
      { date: "2025-09-02", pending: 8, total: 8 },
      { date: "2026-10-01", pending: 2, total: 8 },
    ]),
    row(4, [
      { date: "2025-10-01", pending: 5, total: 5 },
      { date: "2026-09-01", pending: 5, total: 5 },
    ]),
    row(5, [{ date: "2026-10-01", pending: 9, total: 9 }], { status: "terminated" }),
    row(6, [
      { date: "2025-10-01", pending: 30, total: 30 },
      { date: "2026-10-01", pending: 30, total: 30 },
    ]),
  ];
  const m = mdlMomentum(rows, asOf);

  it("plots only pending ≥ 1 MDLs with an exact 12-month change, largest first", () => {
    expect(m.plotted.map((p) => [p.mdl, p.pending, p.change])).toEqual([
      [1, 150, 50],
      [6, 30, 0],
    ]);
    expect(m.plotted[0]!.priorDate).toBe("2025-10-01");
  });

  it("keeps zero-pending MDLs out of the log axis, in their own list", () => {
    expect(m.zeroPending.map((p) => [p.mdl, p.change])).toEqual([[2, -90]]);
  });

  it("lists MDLs without an exact prior report separately, change unrecorded", () => {
    expect(m.noExactHistory.map((p) => [p.mdl, p.change])).toEqual([[3, null]]);
  });

  it("does not place MDLs missing from the latest report, nor terminated ones", () => {
    expect(m.notInLatest).toBe(1);
    expect([...m.plotted, ...m.zeroPending, ...m.noExactHistory].some((p) => p.mdl === 5)).toBe(
      false,
    );
  });

  it("splits rises, falls and no change", () => {
    expect(momentumSplit(m.plotted)).toEqual({ rose: 1, fell: 0, held: 1 });
  });
});

describe("axis helpers", () => {
  it("symlog keeps 0 at 0 and is symmetric", () => {
    expect(symlog(0)).toBe(0);
    expect(symlog(-99)).toBeCloseTo(-2);
    expect(symlog(99)).toBeCloseTo(2);
  });
  it("symlog ticks reach the data on both sides", () => {
    expect(symlogTicks(-3392, 5190)).toEqual([-1000, -100, -10, -1, 0, 1, 10, 100, 1000, 10000]);
    expect(symlogTicks(0, 40)).toEqual([0, 1, 10, 100]);
  });
  it("log ticks start at 1", () => {
    expect(log10Ticks(69340)).toEqual([1, 10, 100, 1000, 10000, 100000]);
  });
});
