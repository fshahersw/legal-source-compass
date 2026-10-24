import { describe, expect, it } from "vitest";
import {
  areaBetween,
  areaUnder,
  backwardPath,
  boundarySegments,
  boxesOverlap,
  edgeAnchor,
  edgeSpans,
  forwardPath,
  isolatedPeriods,
  labelSpot,
  leaderPath,
  linePath,
  logTicks,
  monotoneTangents,
  placeCallout,
  segmentHitsBox,
  signedRuns,
  stackLayers,
  staggerLevels,
} from "./geometry";

describe("curves", () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 10, y: 30 },
    { x: 20, y: 30 },
    { x: 30, y: 5 },
    { x: 40, y: 20 },
  ];

  it("monotone tangents are flat at turning points and never point against the data", () => {
    const m = monotoneTangents(pts);
    expect(m[2]).toBe(0);
    expect(m[3]).toBe(0);
    expect(m[0]!).toBeGreaterThan(0);
  });

  it("a smooth curve never leaves the y-range of the two points it joins", () => {
    for (const s of boundarySegments(pts, true)) {
      const lo = Math.min(s.a.y, s.b.y);
      const hi = Math.max(s.a.y, s.b.y);
      expect(s.c1!.y).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(s.c1!.y).toBeLessThanOrEqual(hi + 1e-9);
      expect(s.c2!.y).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(s.c2!.y).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("straight and smooth paths start on the first point and end on the last", () => {
    expect(linePath(pts)).toBe("M0,10L10,30L20,30L30,5L40,20");
    expect(linePath(pts, true).startsWith("M0,10C")).toBe(true);
    expect(linePath(pts, true).endsWith("40,20")).toBe(true);
    expect(linePath([{ x: 5, y: 5 }])).toBe("M5,5");
  });

  it("two stacked layers share their boundary exactly, smoothed or not", () => {
    for (const smooth of [false, true]) {
      const base = pts.map((p) => ({ x: p.x, y: 100 }));
      const mid = boundarySegments(pts, smooth);
      const top = boundarySegments(
        pts.map((p) => ({ x: p.x, y: p.y - 8 })),
        smooth,
      );
      const lower = areaBetween(mid, boundarySegments(base, false));
      const upper = areaBetween(top, mid);
      expect(lower).toContain(forwardPath(mid).slice(1));
      expect(upper).toContain(backwardPath(mid));
      expect(lower.endsWith("Z")).toBe(true);
    }
  });

  it("an area under a line closes on the baseline", () => {
    const d = areaUnder(pts, 100);
    expect(d.startsWith("M0,10")).toBe(true);
    expect(d).toContain("L40,100");
    expect(areaUnder([pts[0]!], 100)).toBe("");
  });
});

describe("spans of recorded periods", () => {
  it("joins recorded neighbours only and dashes edges that touch a partial period", () => {
    const rec = [true, true, false, true, true, true];
    const par = [false, false, false, false, false, true];
    expect(edgeSpans(rec, par)).toEqual([
      { from: 0, to: 1, partial: false },
      { from: 3, to: 4, partial: false },
      { from: 4, to: 5, partial: true },
    ]);
    expect(isolatedPeriods([true, false, true, true, false, true])).toEqual([0, 5]);
  });
});

describe("stacking", () => {
  it("stacks bottom to top and treats a period with any series missing as a gap, never a zero", () => {
    const s = stackLayers([
      [1, 2, null, 4],
      [3, 2, 5, 4],
    ]);
    expect(s.lower[0]).toEqual([0, 0, null, 0]);
    expect(s.upper[0]).toEqual([1, 2, null, 4]);
    expect(s.lower[1]).toEqual([1, 2, null, 4]);
    expect(s.upper[1]).toEqual([4, 4, null, 8]);
    expect(s.total).toEqual([4, 4, null, 8]);
    expect(s.drawable).toEqual([true, true, false, true]);
  });

  it("normalises to 100 and leaves a zero-total or negative period undrawn", () => {
    const s = stackLayers(
      [
        [1, 0, -1],
        [3, 0, 5],
      ],
      "percent",
    );
    expect(s.upper[1]![0]).toBe(100);
    expect(s.upper[0]![0]).toBe(25);
    expect(s.drawable).toEqual([true, false, false]);
  });
});

describe("labels inside areas", () => {
  const xs = [0, 50, 100, 150, 200];
  it("finds the thickest stretch and reports whether the label fits", () => {
    const top = [90, 40, 20, 50, 90];
    const bottom = [100, 100, 100, 100, 100];
    const spot = labelSpot(xs, top, bottom, 60, 16)!;
    expect(spot.fits).toBe(true);
    expect(spot.x).toBeGreaterThan(70);
    expect(spot.x).toBeLessThan(130);
    const thin = labelSpot(xs, [96, 96, 96, 96, 96], bottom, 60, 16)!;
    expect(thin.fits).toBe(false);
  });

  it("never puts a window across a gap", () => {
    const top = [60, 60, null, 60, 60];
    const bottom = [100, 100, null, 100, 100];
    const spot = labelSpot(xs, top, bottom, 40, 16)!;
    expect(spot.x <= 30 || spot.x >= 170).toBe(true);
    expect(labelSpot(xs, top, bottom, 60, 16)).toBeNull();
    expect(labelSpot(xs, [null, null, null, null, null], bottom, 60, 16)).toBeNull();
  });
});

describe("signed series", () => {
  it("splits at the exact zero crossing and keeps one sign per run", () => {
    const runs = signedRuns([0, 1, 2, 3], [1, 2, -1, -3]);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.sign).toBe(1);
    expect(runs[0]!.pts.at(-1)!.v).toBe(0);
    expect(runs[0]!.pts.at(-1)!.x).toBeCloseTo(1 + 2 / 3, 6);
    expect(runs[1]!.sign).toBe(-1);
    expect(runs[1]!.pts[0]).toEqual(runs[0]!.pts.at(-1));
    expect(runs[1]!.pts.at(-1)).toEqual({ x: 3, v: -3 });
  });

  it("breaks on a period that is not recorded and handles a point exactly on zero", () => {
    expect(signedRuns([0, 1, 2, 3, 4], [1, 2, null, 3, 4])).toHaveLength(2);
    const touch = signedRuns([0, 1, 2], [2, 0, -2]);
    expect(touch.map((r) => r.sign)).toEqual([1, -1]);
    expect(touch[0]!.pts.at(-1)).toEqual({ x: 1, v: 0 });
    expect(touch[1]!.pts[0]).toEqual({ x: 1, v: 0 });
    expect(signedRuns([0], [5])).toEqual([]);
  });
});

describe("callouts and event labels", () => {
  const area = { x: 0, y: 0, w: 400, h: 200 };
  it("prefers the requested side, then the other, then the sides, and skips taken space", () => {
    const up = placeCallout({ x: 200, y: 100 }, { w: 80, h: 16 }, area, [], "up")!;
    expect(up.side).toBe("up-right");
    expect(up.box.y + up.box.h).toBeLessThan(100);
    const down = placeCallout({ x: 200, y: 100 }, { w: 80, h: 16 }, area, [], "down")!;
    expect(down.box.y).toBeGreaterThan(100);
    const blocked = placeCallout({ x: 200, y: 100 }, { w: 80, h: 16 }, area, [up.box], "up")!;
    expect(blocked.side).toBe("up-left");
    const nearTop = placeCallout({ x: 200, y: 20 }, { w: 80, h: 16 }, area, [], "up")!;
    expect(nearTop.side.startsWith("down")).toBe(true);
    expect(placeCallout({ x: 5, y: 5 }, { w: 500, h: 16 }, area, [], "up")).toBeNull();
  });

  it("staggers overlapping labels onto new levels", () => {
    expect(
      staggerLevels([
        { left: 0, right: 100 },
        { left: 50, right: 150 },
        { left: 120, right: 200 },
        { left: 300, right: 340 },
      ]),
    ).toEqual([0, 1, 0, 0]);
  });

  it("anchors a leader on the nearest box edge and bends the path", () => {
    expect(edgeAnchor({ x: 10, y: 10, w: 40, h: 16 }, { x: 30, y: 100 })).toEqual({ x: 30, y: 26 });
    expect(edgeAnchor({ x: 10, y: 10, w: 40, h: 16 }, { x: 100, y: 18 })).toEqual({ x: 50, y: 18 });
    expect(leaderPath({ x: 0, y: 0 }, { x: 10, y: 10 })).toMatch(/^M0,0Q[\d.,-]+ 10,10$/);
  });
});

describe("collision helpers", () => {
  const box = { x: 100, y: 50, w: 80, h: 16 };
  it("tests segments against a box, ends inside and crossings alike", () => {
    expect(segmentHitsBox({ x: 0, y: 0 }, { x: 50, y: 10 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 0, y: 58 }, { x: 300, y: 58 }, box)).toBe(true);
    expect(segmentHitsBox({ x: 140, y: 58 }, { x: 150, y: 60 }, box)).toBe(true);
    expect(segmentHitsBox({ x: 0, y: 0 }, { x: 300, y: 300 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 100, y: 0 }, { x: 160, y: 120 }, box)).toBe(true);
    expect(segmentHitsBox({ x: 0, y: 40 }, { x: 300, y: 40 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 0, y: 47 }, { x: 300, y: 47 }, box, 4)).toBe(true);
  });

  it("treats boxes within the gap as overlapping", () => {
    const other = { x: 183, y: 50, w: 40, h: 16 };
    expect(boxesOverlap(box, other, 4)).toBe(true);
    expect(boxesOverlap(box, other, 0)).toBe(false);
    expect(boxesOverlap(box, { x: 300, y: 50, w: 10, h: 16 })).toBe(false);
  });

  it("tries beside the point first when asked, and goes to the next side when a line blocks one", () => {
    const area = { x: 0, y: 0, w: 400, h: 200 };
    const side = placeCallout({ x: 200, y: 100 }, { w: 80, h: 16 }, area, [], "side")!;
    expect(["right", "left"]).toContain(side.side);
    const wall: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 70 },
      { x: 400, y: 70 },
    ];
    const next = placeCallout({ x: 200, y: 100 }, { w: 80, h: 16 }, area, [], "up", 26, [wall])!;
    expect(next.side.startsWith("down")).toBe(true);
    expect(segmentHitsBox(wall[0], wall[1], next.box)).toBe(false);
  });

  it("moves a callout off a line that crosses its first choice", () => {
    const area = { x: 0, y: 0, w: 400, h: 200 };
    const anchor = { x: 200, y: 100 };
    const size = { w: 80, h: 16 };
    const free = placeCallout(anchor, size, area, [], "up")!;
    const line: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 150, y: free.box.y + 8 },
      { x: 400, y: free.box.y + 8 },
    ];
    const moved = placeCallout(anchor, size, area, [], "up", 26, [line])!;
    expect(moved.side).not.toBe(free.side);
    expect(segmentHitsBox(line[0], line[1], moved.box)).toBe(false);
    const wall: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 400, y: 200 },
    ];
    const everywhere = Array.from({ length: 21 }, (_, i) => i * 10).map(
      (y) =>
        [
          { x: 0, y },
          { x: 400, y },
        ] as [{ x: number; y: number }, { x: number; y: number }],
    );
    expect(placeCallout(anchor, size, area, [], "up", 26, [wall, ...everywhere])).toBeNull();
  });
});

describe("log axis ticks", () => {
  it("spans whole decades and adds 2 and 5 within three decades", () => {
    const { domain, ticks } = logTicks(Math.log10(3), Math.log10(80));
    expect(domain).toEqual([0, 2]);
    expect(ticks.map((t) => Math.round(10 ** t * 100) / 100)).toEqual([1, 2, 5, 10, 20, 50, 100]);
  });

  it("keeps only powers of ten past three decades and never collapses", () => {
    const wide = logTicks(0, 5);
    expect(wide.ticks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(logTicks(1, 1).domain).toEqual([1, 2]);
  });
});
