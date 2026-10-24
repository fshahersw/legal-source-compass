import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/corpus/store", () => ({
  useCorpus: () => ({ status: "loading", error: null, geo: null, insights: null, retry: () => {} }),
}));

import { ChartCard } from "../ChartCard";
import { metricFormatter } from "../format";
import type { PeriodAxis } from "../series";
import { AnnotatedTrend } from "./AnnotatedTrend";
import { BenchMatrix } from "./BenchMatrix";
import { DivergingAreaTrend } from "./DivergingAreaTrend";
import { DumbbellRange } from "./DumbbellRange";
import { ScatterBand } from "./ScatterBand";
import { StackedAreaTrend } from "./StackedAreaTrend";
import { VerdictStack } from "./VerdictStack";
import { dumbbellLayout, dumbbellScale, sortDumbbell } from "./dumbbell";
import { leaderIndices } from "./bench";
import { roundShares, sortByTag, tagPaints, verdictSegments } from "./verdict";

const html = (node: ReactNode) => renderToStaticMarkup(node as never);
const count = metricFormatter("count");
const years = ["2019", "2020", "2021", "2022", "2023", "2024"];
const axis: PeriodAxis = { keys: years, label: (k) => `FY${k}`, tick: (k) => `’${k.slice(2)}` };
const pts = (vals: (number | null)[], partialLast = false) =>
  vals.map((v, i) => ({ key: years[i]!, value: v, partial: partialLast && i === vals.length - 1 }));
const s = (id: string, label: string, vals: (number | null)[], partialLast = false) => ({
  id,
  label,
  points: pts(vals, partialLast),
});

describe("StackedAreaTrend", () => {
  const series = [
    s("a", "Drug", [200, 260, 300, 280, 250, 240]),
    s("b", "Device", [120, 140, 150, 160, 170, 180]),
    s("c", "Food", [60, 80, 90, 85, 70, 65]),
  ];

  it("names the layers inside their areas, labels the latest total and draws no legend for three series", () => {
    const out = html(
      createElement(StackedAreaTrend, {
        series,
        axis,
        formatter: count,
        ariaLabel: "Recalls",
        width: 640,
      }),
    );
    expect(out).toContain(">Drug<");
    expect(out).toContain(">Device<");
    expect(out).toContain("Total 485");
    expect(out).not.toContain('aria-label="Legend"');
    expect((out.match(/<path d="M/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(out).toContain('aria-roledescription="chart"');
  });

  it("shows a legend past four series and a 100% axis in percent mode", () => {
    const many = ["a", "b", "c", "d", "e"].map((id, i) => s(id, `S${i}`, [10, 12, 14, 12, 10, 11]));
    const out = html(
      createElement(StackedAreaTrend, {
        series: many,
        axis,
        formatter: count,
        mode: "percent",
        ariaLabel: "Shares",
        width: 640,
      }),
    );
    expect(out).toContain('aria-label="Legend"');
    expect(out).toContain(">100%<");
    expect(out).not.toContain("Total ");
  });

  it("leaves a period with any series missing as a gap and hatches a partial period", () => {
    const gappy = [
      s("a", "Drug", [200, null, 300, 280, 250, 240], true),
      s("b", "Device", [120, 140, 150, 160, 170, 180], true),
    ];
    const out = html(
      createElement(StackedAreaTrend, {
        series: gappy,
        axis,
        formatter: count,
        ariaLabel: "Gap",
        width: 640,
      }),
    );
    expect(out).toContain("Not recorded");
    expect(out).toContain("url(#sa-");
  });

  it("states that smoothing is display only", () => {
    const out = html(
      createElement(StackedAreaTrend, {
        series,
        axis,
        formatter: count,
        smooth: true,
        ariaLabel: "Recalls",
        width: 640,
      }),
    );
    expect(out).toContain("smoothed for display");
    expect(out).toContain("C");
  });
});

describe("AnnotatedTrend", () => {
  const series = [s("p", "Pending actions", [100, 180, 520, 400, 380, 150], true)];

  it("draws event rules, a peak callout, a partial label and the last value", () => {
    const out = html(
      createElement(AnnotatedTrend, {
        series,
        axis,
        formatter: count,
        events: [
          { key: "2021", label: "Reports move to the first of the month" },
          { key: "1999", label: "Unknown key" },
        ],
        callouts: ["peak"],
        ariaLabel: "Pending",
        width: 700,
      }),
    );
    expect(out).toContain("Reports move to the first of the month");
    expect(out).not.toContain("Unknown key");
    expect(out).toContain("Peak 520 (FY2021)");
    expect(out).toContain("Partial period");
    expect(out).toContain(">380<");
    expect(out).not.toContain(">150<");
    expect(out).toContain('stroke-dasharray="4 4"');
  });

  it("writes name and value at the end of each of several lines and a legend past four", () => {
    const two = [
      s("a", "Filed", [10, 20, 30, 40, 50, 60]),
      s("b", "Terminated", [5, 25, 25, 45, 40, 70]),
    ];
    const out = html(
      createElement(AnnotatedTrend, {
        series: two,
        axis,
        formatter: count,
        ariaLabel: "Two",
        width: 700,
      }),
    );
    expect(out).toContain("Filed 60");
    expect(out).toContain("Terminated 70");
    const five = ["a", "b", "c", "d", "e"].map((id) => s(id, id.toUpperCase(), [1, 2, 3, 4, 5, 6]));
    expect(
      html(
        createElement(AnnotatedTrend, {
          series: five,
          axis,
          formatter: count,
          ariaLabel: "Five",
          width: 700,
        }),
      ),
    ).toContain('aria-label="Legend"');
  });
});

describe("DivergingAreaTrend", () => {
  const series = s("net", "Filed minus terminated", [300, 120, -80, -200, -150, -60]);
  it("fills above and below zero in the two tones and writes the peak, the low and the last value signed", () => {
    const out = html(
      createElement(DivergingAreaTrend, {
        series,
        axis,
        formatter: count,
        positiveLabel: "Filed more than terminated",
        negativeLabel: "Terminated more than filed",
        annotation: { key: "2021", label: "First year terminations led" },
        ariaLabel: "Net",
        width: 700,
      }),
    );
    expect(out).toContain('fill="var(--chart-1)" fill-opacity="0.22"');
    expect(out).toContain('fill="var(--chart-2)" fill-opacity="0.22"');
    expect(out).toContain("+300");
    expect(out).toContain("−200");
    expect(out).toContain("−60");
    expect(out).toContain("First year terminations led");
    expect(out).toContain('aria-label="Legend"');
  });

  it("never treats a partial period as the last value", () => {
    const partial = s("net", "Net", [300, 120, -80, -200, -150, -999], true);
    const out = html(
      createElement(DivergingAreaTrend, {
        series: partial,
        axis,
        formatter: count,
        ariaLabel: "Net",
        width: 700,
      }),
    );
    expect(out).toContain("−150");
    expect(out).not.toContain("−999</text>");
    expect(out).toContain("Partial period");
  });
});

describe("ScatterBand", () => {
  const rnd = (i: number) => ((i * 37) % 17) / 17;
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`,
    label: `District ${i}`,
    x: 20 + i * 4,
    y: 12 - i * 0.2 + (rnd(i) - 0.5) * 2 + (i === 12 ? 9 : 0),
  }));
  it("draws the ribbon, the smooth line and labels the point farthest from it", () => {
    const out = html(
      createElement(ScatterBand, {
        points: many,
        xFormatter: count,
        yFormatter: metricFormatter("months"),
        xLabel: "Filings per judgeship",
        yLabel: "Months to disposition",
        ariaLabel: "Scatter",
        width: 640,
      }),
    );
    expect(out).toContain('fill-opacity="0.16"');
    expect(out).toContain('stroke-width="2.25"');
    expect(out).toContain("District 12");
    expect(out).toContain("95% confidence interval");
    expect((out.match(/<circle/g) ?? []).length).toBe(30);
  });

  it("draws points alone and says so with too few points", () => {
    const out = html(
      createElement(ScatterBand, {
        points: many.slice(0, 5),
        xFormatter: count,
        yFormatter: count,
        xLabel: "x",
        yLabel: "y",
        ariaLabel: "Few",
        width: 640,
      }),
    );
    expect(out).toContain("Too few points for a smooth line");
    expect(out).not.toContain('fill-opacity="0.16"');
  });
});

describe("verdict stack model and view", () => {
  const taxonomy = [
    {
      group: "Closed",
      tags: [
        { key: "settled", label: "Settled" },
        { key: "dismissed", label: "Dismissed" },
      ],
    },
    { group: "Open", tags: [{ key: "pending", label: "Pending" }] },
  ];
  const subjects = [
    { label: "MDL 1", counts: { settled: 50, dismissed: 25, pending: 25 } },
    { label: "MDL 2", counts: { settled: 1, dismissed: 1, pending: 1 } },
    { label: "MDL 3", counts: { settled: null, dismissed: null, pending: null } },
  ];

  it("rounds shares to exactly 100 and keeps unrecorded tags out of the total", () => {
    expect(roundShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(roundShares([0, 0])).toEqual([0, 0]);
    const seg = verdictSegments(
      subjects[1]!,
      taxonomy.flatMap((g) => g.tags),
    );
    expect(seg.segments.reduce((a, x) => a + x.rounded, 0)).toBe(100);
    expect(
      verdictSegments(
        subjects[2]!,
        taxonomy.flatMap((g) => g.tags),
      ).total,
    ).toBe(0);
  });

  it("assigns palette slots in order and the neutral Other past the sixth", () => {
    const many = [
      { group: "g", tags: Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, label: `K${i}` })) },
    ];
    const p = tagPaints(many);
    expect(p.get("k0")!.fill).toBe("var(--chart-1)");
    expect(p.get("k5")!.ink).toBe("var(--chart-on-6)");
    expect(p.get("k6")!.fill).toBe("var(--chart-other)");
  });

  it("sorts rows by the share of one tag", () => {
    const tags = taxonomy.flatMap((g) => g.tags);
    expect(sortByTag(subjects, tags, "settled").map((x) => x.label)).toEqual([
      "MDL 1",
      "MDL 2",
      "MDL 3",
    ]);
  });

  it("renders a labelled bar per subject, a grouped legend of toggle buttons and Not recorded for an empty subject", () => {
    const out = html(createElement(VerdictStack, { subjects, taxonomy, ariaLabel: "Outcomes" }));
    expect(out).toContain(
      "MDL 1: Settled 50 (50%), Dismissed 25 (25%), Pending 25 (25%). n = 100.",
    );
    expect(out).toContain("MDL 3: no outcomes recorded");
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain(">Closed<");
    expect(out).toContain("n=100");
  });
});

describe("dumbbell model and view", () => {
  const rows = [
    { id: "a", label: "N.D. Ill.", a: 5000, b: 4000 },
    { id: "b", label: "S.D.N.Y.", a: 3000, b: null },
    { id: "c", label: "D.N.J.", a: 1000, b: 6000, highlight: true },
  ];
  it("puts every row on one zero-based scale and never draws a missing value as zero", () => {
    const { max, ticks } = dumbbellScale(rows);
    expect(max).toBeGreaterThanOrEqual(6000);
    expect(ticks[0]).toBe(0);
    const l = dumbbellLayout(rows[1]!, max);
    expect(l.a).not.toBeNull();
    expect(l.b).toBeNull();
    expect(l.connector).toBeNull();
    expect(l.gap).toBeNull();
    const both = dumbbellLayout(rows[0]!, max);
    expect(both.gap).toBe(-1000);
    expect(both.connector!.width).toBeGreaterThan(0);
  });

  it("sorts by the gap with unrecorded rows last", () => {
    expect(sortDumbbell(rows, "gap-desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortDumbbell(rows, "gap-asc").map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(sortDumbbell(rows, "a-desc").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("renders both values, the gap and Not recorded", () => {
    const out = html(
      createElement(DumbbellRange, {
        rows,
        aLabel: "Filed",
        bLabel: "Terminated",
        format: (v: number) => v.toLocaleString("en-US"),
        gapLabel: "Net change",
        ariaLabel: "Filed vs terminated",
      }),
    );
    expect(out).toContain("N.D. Ill.: Filed 5,000, Terminated 4,000, net change −1,000.");
    expect(out).toContain("S.D.N.Y.: Filed 3,000, Terminated Not recorded");
    expect(out).toContain('aria-label="Legend"');
  });
});

describe("bench matrix", () => {
  it("leads a row only with two recorded values; ties all lead; none and missing never lead", () => {
    expect(leaderIndices([3, 9, 9, null], "highest")).toEqual([1, 2]);
    expect(leaderIndices([3, 9, null], "lowest")).toEqual([0]);
    expect(leaderIndices([null, 9, null], "highest")).toEqual([]);
    expect(leaderIndices([3, 9], "none")).toEqual([]);
  });

  it("renders groups, the hero column, plates on leaders and Not recorded for a gap", () => {
    const out = html(
      createElement(BenchMatrix, {
        ariaLabel: "Courts",
        columns: [
          { id: "a", label: "N.D. Ill.", hero: true },
          { id: "b", label: "S.D.N.Y." },
          { id: "c", label: "D.N.J.", sub: "Third Circuit" },
        ],
        groups: [
          {
            label: "Workload",
            rows: [{ label: "Filings per judgeship", values: [733, 640, null], lead: "highest" }],
          },
          {
            label: "Speed",
            rows: [
              {
                label: "Months to disposition",
                note: "Table C-5",
                values: [5.9, 9.1, 8.1],
                lead: "lowest",
              },
            ],
          },
        ],
      }),
    );
    expect(out).toContain(">Workload<");
    expect(out).toContain("bg-muted font-bold");
    expect((out.match(/font-bold/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(out).toContain("Not recorded");
    expect(out).toContain("bold = lowest");
    expect(out).toContain("Third Circuit");
  });
});

describe("editorial ChartCard", () => {
  it("sets a bold headline under an accent rule and keeps the footer source and View data", () => {
    const out = html(
      createElement(
        ChartCard,
        {
          variant: "editorial",
          title: "Filings fell 81% from their peak",
          subtitle: "Cases · U.S. district courts · FY2014–FY2025",
          sources: [{ label: "Judicial Business", url: "https://www.uscourts.gov" }],
          table: {
            caption: "Filings",
            columns: [{ label: "Year" }, { label: "Filed" }],
            rows: [{ key: "1", cells: ["FY2025", "1"] }],
          },
        },
        createElement("div", null, "chart"),
      ),
    );
    expect(out).toContain("font-bold");
    expect(out).toContain("bg-brand");
    expect(out).toContain("Filings fell 81% from their peak");
    expect(out).toContain("View data");
    expect(out).toContain("Source and notes");
  });
});
