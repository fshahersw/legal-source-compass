import { describe, expect, it } from "vitest";
import type { TrendBlockData } from "@/lib/analytics/trend";
import { blockChart, PARTIAL_KEY, subjectOf } from "./blocks";

const block: TrendBlockData = {
  id: "cpsc-recalls",
  xKind: "year",
  chart: "bar",
  stacked: false,
  format: "count",
  unit: "recalls",
  series: [
    {
      id: "recalls",
      label: "Recalls",
      points: [
        { x: "2022", value: 300 },
        { x: "2023", value: null },
        { x: "2024", value: 420 },
        { x: "2025", value: 100, partial: true },
      ],
    },
  ],
  primary: 0,
  latest: null,
  period: "2022–2025*",
  source: { label: "CPSC", url: "https://www.cpsc.gov" },
  asOf: "2025-10-01",
  notes: [],
  gaps: 1,
  markers: [],
};

describe("blockChart", () => {
  it("turns a block into rows, a takeaway that ignores the partial period, and a table", () => {
    const c = blockChart(block, { title: "Consumer product recalls", measure: "recalls" });
    expect(c.rows.map((r) => r["x"])).toEqual(["2022", "2023", "2024", "2025"]);
    expect(c.rows[1]!["recalls"]).toBeNull();
    expect(c.rows[3]![PARTIAL_KEY]).toBe(true);
    expect(c.title).toBe("Recalls rose 40% from 2022 to 2024, to 420");
    expect(blockChart(block, { title: "T", measure: "CPSC recalls" }).title).toBe(
      "CPSC recalls rose 40% from 2022 to 2024, to 420",
    );
    expect(c.latest?.value).toBe("420");
    expect(c.subtitle).toContain("partial period");
    expect(c.table.rows[0]!.cells[0]).toBe("2025 (partial)");
    expect(c.table.rows[2]!.cells[1]).toBe("Not recorded");
    expect(c.tick(50000)).toBe("50K");
  });
});

describe("takeaway subject of a block", () => {
  it("names the measure, the measure and a verb label, or the primary label", () => {
    const two = { series: [block.series[0]!, block.series[0]!], stacked: false };
    expect(subjectOf("civil cases", "Filed", two)).toBe("Civil cases filed");
    expect(subjectOf("Federal Register rules", "Proposed rules", two)).toBe("Proposed rules");
    expect(subjectOf("CPSC recalls", "Recalls", { ...two, stacked: true })).toBe("CPSC recalls");
  });

  it("reads a stack by its totals", () => {
    const stacked: TrendBlockData = {
      ...block,
      stacked: true,
      series: [
        {
          id: "a",
          label: "Drug",
          points: [
            { x: "2023", value: 10 },
            { x: "2024", value: 5 },
          ],
        },
        {
          id: "b",
          label: "Food",
          points: [
            { x: "2023", value: 10 },
            { x: "2024", value: 25 },
          ],
        },
      ],
    };
    const c = blockChart(stacked, { title: "T", measure: "FDA entries" });
    expect(c.title).toBe("FDA entries rose 50% from 2023 to 2024, to 30");
    expect(c.latest?.value).toBe("30");
  });
});
