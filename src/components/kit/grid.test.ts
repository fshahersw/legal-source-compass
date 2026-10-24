import { describe, expect, it } from "vitest";
import { balancedColumns, gridMaxima, kpiGridClass } from "./grid";

/** Cards in the last row for a grid of `columns`; 0 means a full last row. */
const lastRow = (count: number, columns: number) => count % columns;

describe("balancedColumns", () => {
  it("fills one row when there are no more cards than columns", () => {
    expect(balancedColumns(3, 3)).toBe(3);
    expect(balancedColumns(3, 4)).toBe(3);
    expect(balancedColumns(2, 4)).toBe(2);
    expect(balancedColumns(4, 4)).toBe(4);
  });

  it("never leaves a lone card in the last row when a column count avoids it", () => {
    for (let max = 2; max <= 6; max++)
      for (let n = max + 1; n <= 24; n++) {
        const c = balancedColumns(n, max);
        const avoidable = Array.from({ length: max - 1 }, (_, i) => i + 2).some(
          (k) => lastRow(n, k) !== 1,
        );
        if (avoidable) expect(lastRow(n, c), `${n} cards, max ${max} → ${c}`).not.toBe(1);
      }
  });

  it("prefers a perfect rectangle, and on equal gaps the wider grid", () => {
    expect(balancedColumns(4, 3)).toBe(2); // 2 × 2, not 3 + 1
    expect(balancedColumns(6, 4)).toBe(3); // 3 × 2, not 4 + 2
    expect(balancedColumns(8, 4)).toBe(4);
    expect(balancedColumns(10, 3)).toBe(2);
    expect(balancedColumns(12, 6)).toBe(6);
    expect(balancedColumns(5, 3)).toBe(3); // 3 + 2: a gap, but no lone card
  });

  it("stacks a short list when nothing balances (three cards in two columns), else keeps the widest grid", () => {
    expect(balancedColumns(3, 2)).toBe(1);
    expect(balancedColumns(5, 2)).toBe(2);
    expect(balancedColumns(7, 2)).toBe(2);
  });

  it("is safe for empty, single and nonsensical inputs", () => {
    expect(balancedColumns(0, 4)).toBe(1);
    expect(balancedColumns(1, 4)).toBe(1);
    expect(balancedColumns(5, 1)).toBe(1);
    expect(balancedColumns(5, 0)).toBe(1);
    expect(balancedColumns(Number.NaN, 3)).toBe(1);
  });
});

describe("kpiGridClass", () => {
  it("lays three tiles in a row from lg and stacks them below it (the Insights topic grid)", () => {
    expect(kpiGridClass(3, 3)).toBe("grid-cols-1 sm:grid-cols-1 lg:grid-cols-3 xl:grid-cols-3");
  });
  it("keeps four headline tiles as 2 × 2 until xl, then one row", () => {
    expect(kpiGridClass(4, 4)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4");
  });
  it("balances the expanded Insights grids (8 tiles: two columns, never 3 + 3 + 2 with a lone tile)", () => {
    expect(kpiGridClass(8, 3)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2");
    expect(kpiGridClass(6, 3)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3");
  });
  it("keeps the hub strips two-up on a phone and three-up from sm", () => {
    expect(kpiGridClass(6, 6)).toBe("grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6");
    expect(kpiGridClass(5, 5)).toBe("grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5");
  });
  it("only emits classes for the breakpoints it knows", () => {
    for (const columns of [2, 3, 4, 5, 6] as const)
      for (let n = 0; n <= 20; n++)
        expect(kpiGridClass(n, columns)).toMatch(
          /^grid-cols-[123] sm:grid-cols-[1-4] lg:grid-cols-[1-4] xl:grid-cols-[1-6]$/,
        );
  });
  it("never asks for more columns than the page allows at a breakpoint", () => {
    for (const columns of [2, 3, 4, 5, 6] as const) {
      const max = gridMaxima(columns);
      for (let n = 0; n <= 20; n++) {
        const c = kpiGridClass(n, columns);
        expect(Number(/sm:grid-cols-(\d)/.exec(c)![1])).toBeLessThanOrEqual(max.sm);
        expect(Number(/lg:grid-cols-(\d)/.exec(c)![1])).toBeLessThanOrEqual(max.lg);
        expect(Number(/xl:grid-cols-(\d)/.exec(c)![1])).toBeLessThanOrEqual(max.xl);
      }
    }
  });
});
