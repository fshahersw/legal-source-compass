import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { metricFormatter } from "./format";
import {
  LaneRows,
  LaneTracks,
  laneDomain,
  laneTicks,
  placeMarkerLabels,
  readTrack,
  type LaneTrack,
} from "./Lanes";
import { linearScale } from "./scale";

const html = (n: ReactNode) => renderToStaticMarkup(n as never);
const count = metricFormatter("count");
const Y = (y: number, m = 1) => y * 12 + m - 1;

const line: LaneTrack = {
  kind: "line",
  id: "pending",
  label: "Actions pending",
  unit: "actions",
  formatter: count,
  points: [
    { t: Y(2024, 10), v: 100, link: false, label: "Oct 2024" },
    { t: Y(2024, 11), v: 120, link: true, label: "Nov 2024" },
    { t: Y(2025, 1), v: 150, link: false, label: "Jan 2025" },
  ],
};
const bins: LaneTrack = {
  kind: "bins",
  id: "docket",
  label: "Docket entries",
  unit: "entries",
  formatter: count,
  bins: [
    { t0: Y(2024, 10), t1: Y(2024, 11), v: 3, label: "Oct 2024" },
    { t0: Y(2024, 11), t1: Y(2024, 12), v: 0, label: "Nov 2024" },
    { t0: Y(2026, 10), t1: Y(2026, 11), v: 2, label: "Oct 2026", partial: true },
  ],
};

describe("lane time axis", () => {
  it("steps years to fit the width and uses months for short spans", () => {
    const long = laneTicks([Y(1990), Y(2027)], 600);
    expect(long.map((t) => t.label)).toEqual(["1990", "1995", "2000", "2005", "2010", "2015", "2020", "2025"]);
    expect(laneTicks([Y(1990), Y(2027)], 300).map((t) => t.label)).toEqual(["1990", "2000", "2010", "2020"]);
    const short = laneTicks([Y(2024, 10), Y(2025, 10)], 600);
    expect(short[0]!.label).toBe("Oct 2024");
    expect(laneTicks([Y(2000), Y(2027)], 1400).length).toBeGreaterThan(5);
  });

  it("covers every point, bin and marker, padded to whole years and running to `until`", () => {
    expect(
      laneDomain(
        [{ points: line.kind === "line" ? line.points : [] }],
        [{ t: Y(2023, 4) }],
        Y(2026, 10),
      ),
    ).toEqual([Y(2023), Y(2027)]);
    expect(laneDomain([], [])).toBeNull();
  });
});

describe("lane reading", () => {
  it("reads a line only near a recorded point and a bin only inside it", () => {
    expect(readTrack(line, Y(2024, 11))?.value).toBe(120);
    expect(readTrack(line, Y(2024, 12))).toBeNull();
    expect(readTrack(bins, Y(2024, 11) + 0.2)?.value).toBe(0);
    expect(readTrack(bins, Y(2025, 6))).toBeNull();
    expect(readTrack(bins, Y(2026, 10))?.partial).toBe(true);
  });

  it("places marker labels on two rows so they never overlap", () => {
    const x = linearScale([Y(2020), Y(2027)], [0, 700]);
    const placed = placeMarkerLabels(
      [
        { t: Y(2023, 1), label: "Motion filed", kind: "mark" },
        { t: Y(2023, 4), label: "Centralized", kind: "start" },
        { t: Y(2026, 12), label: "Closed", kind: "end" },
      ],
      x,
      700,
    );
    expect(placed.map((p) => [p.m.label, p.row, p.anchor])).toEqual([
      ["Motion filed", 0, "start"],
      ["Centralized", 1, "start"],
      ["Closed", 0, "end"],
    ]);
  });
});

describe("LaneTracks", () => {
  it("draws gaps as gaps, isolated points as dots, partial bins hatched, and is one keyboard stop", () => {
    const out = html(
      createElement(LaneTracks, {
        tracks: [line, bins, { kind: "note", id: "n", label: "Recalls", text: "Not recorded" }],
        markers: [{ t: Y(2024, 10) + 0.2, label: "Centralized", kind: "start" }],
        domain: [Y(2024), Y(2027)],
        ariaLabel: "Lifecycle",
        width: 800,
      }),
    );
    expect(out).toContain('role="group"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain("arrow keys");
    // one joined segment (Oct–Nov) and one isolated dot (Jan)
    expect((out.match(/stroke-width="2" stroke-linejoin="round"/g) ?? []).length).toBe(1);
    expect(out).toContain("<circle");
    expect(out).toContain("Centralized");
    expect(out).toContain("Not recorded");
    expect(out).toMatch(/fill="url\(#[^"]+\)"/);
  });
});

describe("LaneRows", () => {
  it("renders one button per row with its summary and the expanded panel in place", () => {
    const out = html(
      createElement(LaneRows, {
        rows: [
          {
            id: "1",
            label: "MDL 1",
            title: "Widgets",
            sublabel: "S.D.N.Y.",
            aside: "150",
            line: line.kind === "line" ? line.points : [],
            strip: bins.kind === "bins" ? bins.bins : [],
            summary: "MDL 1 summary",
          },
          { id: "2", label: "MDL 2", title: "Gadgets", summary: "MDL 2 summary" },
        ],
        domain: [Y(2020), Y(2027)],
        ariaLabel: "Lanes",
        stripScale: (v: number) => v / 3,
        readout: () => null,
        expanded: "1",
        onToggle: () => {},
        renderExpanded: (id: string) => createElement("p", null, `detail ${id}`),
        width: 900,
      }),
    );
    expect((out.match(/data-lane-row=""/g) ?? []).length).toBe(2);
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("detail 1");
    expect(out).not.toContain("detail 2");
    expect(out).toContain("MDL 1 summary");
    // a row without a recorded value says so instead of drawing nothing
    expect(out).toContain("Not recorded");
    // only the first row is in the tab order
    expect((out.match(/tabindex="0"/g) ?? []).length).toBe(1);
  });
});
