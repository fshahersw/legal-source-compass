/**
 * Pure geometry for the editorial chart forms (stacked area, annotated trend, diverging area, scatter band): curve and
 * area paths whose shared edges are identical, stacking, spans of recorded periods, label spots inside areas, the
 * zero-crossing split of a signed series, callout and event-label placement. No React, no DOM; tested in
 * geometry.test.ts.
 *
 * Smoothing is a display choice: a monotone cubic through the recorded points (it never overshoots a point), so the
 * drawn curve stays between neighbouring values. Values in tooltips and tables are always the recorded ones.
 */

export type Pt = { x: number; y: number };

/** One edge of a boundary: a straight line, or a cubic curve with control points c1 and c2. */
export type Seg = { a: Pt; b: Pt; c1?: Pt; c2?: Pt };

const r = (n: number) => Math.round(n * 100) / 100;
const fmt = (p: Pt) => `${r(p.x)},${r(p.y)}`;

/**
 * Fritsch–Carlson monotone cubic tangents (dy/dx) for points sorted by x. A turning point gets a flat tangent, so the
 * curve never goes beyond the points it joins.
 */
export function monotoneTangents(pts: readonly Pt[]): number[] {
  const n = pts.length;
  if (n < 2) return pts.map(() => 0);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = pts[i + 1]!.x - pts[i]!.x;
    dx.push(d);
    slope.push(d === 0 ? 0 : (pts[i + 1]!.y - pts[i]!.y) / d);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = slope[0]!;
  m[n - 1] = slope[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1]!;
    const s1 = slope[i]!;
    m[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const s = slope[i]!;
    if (s === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / s;
    const b = m[i + 1]! / s;
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      m[i] = t * a * s;
      m[i + 1] = t * b * s;
    }
  }
  return m;
}

/** Edges through `pts` (sorted by x): straight, or monotone cubic when `smooth`. */
export function boundarySegments(pts: readonly Pt[], smooth: boolean): Seg[] {
  const out: Seg[] = [];
  const m = smooth ? monotoneTangents(pts) : null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (!m) {
      out.push({ a, b });
      continue;
    }
    const d = (b.x - a.x) / 3;
    out.push({
      a,
      b,
      c1: { x: a.x + d, y: a.y + m[i]! * d },
      c2: { x: b.x - d, y: b.y - m[i + 1]! * d },
    });
  }
  return out;
}

/** "M a L/C …" from the first edge to the last. */
export function forwardPath(segs: readonly Seg[]): string {
  if (!segs.length) return "";
  let d = `M${fmt(segs[0]!.a)}`;
  for (const s of segs)
    d += s.c1 && s.c2 ? `C${fmt(s.c1)} ${fmt(s.c2)} ${fmt(s.b)}` : `L${fmt(s.b)}`;
  return d;
}

/** The same edges walked from the last to the first (no leading M): control points swap, so the shape is identical. */
export function backwardPath(segs: readonly Seg[]): string {
  let d = "";
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    d += s.c1 && s.c2 ? `C${fmt(s.c2)} ${fmt(s.c1)} ${fmt(s.a)}` : `L${fmt(s.a)}`;
  }
  return d;
}

/**
 * Closed area between an upper and a lower boundary that share their x positions. Two layers that touch use the same
 * edge list for the shared boundary, so they meet exactly, with no hairline gap or overlap.
 */
export function areaBetween(upper: readonly Seg[], lower: readonly Seg[]): string {
  if (!upper.length || !lower.length) return "";
  return `${forwardPath(upper)}L${fmt(lower[lower.length - 1]!.b)}${backwardPath(lower)}Z`;
}

/** Open line through `pts`. */
export function linePath(pts: readonly Pt[], smooth = false): string {
  if (pts.length === 1) return `M${fmt(pts[0]!)}`;
  return forwardPath(boundarySegments(pts, smooth));
}

/** Area under a line down to `baseline` (y in pixels). */
export function areaUnder(pts: readonly Pt[], baseline: number, smooth = false): string {
  if (pts.length < 2) return "";
  const top = boundarySegments(pts, smooth);
  const bottom = boundarySegments(
    pts.map((p) => ({ x: p.x, y: baseline })),
    false,
  );
  return areaBetween(top, bottom);
}

// ------------------------------------------------------------------ spans of recorded periods

export type Span = { from: number; to: number; partial: boolean };

/**
 * Spans of an axis over which a mark is drawn: an edge joins neighbours i and i + 1 when both are recorded, and is
 * partial when either end is partial. Consecutive edges of one style merge into one span (indices from..to).
 * Nothing is drawn across a period the source does not record.
 */
export function edgeSpans(recorded: readonly boolean[], partial: readonly boolean[]): Span[] {
  const out: Span[] = [];
  for (let i = 0; i + 1 < recorded.length; i++) {
    if (!recorded[i] || !recorded[i + 1]) continue;
    const p = Boolean(partial[i] || partial[i + 1]);
    const last = out[out.length - 1];
    if (last && last.partial === p && last.to === i) last.to = i + 1;
    else out.push({ from: i, to: i + 1, partial: p });
  }
  return out;
}

/** Recorded periods with no recorded neighbour (a line or area draws nothing for them). */
export function isolatedPeriods(recorded: readonly boolean[]): number[] {
  const out: number[] = [];
  recorded.forEach((ok, i) => {
    if (ok && !recorded[i - 1] && !recorded[i + 1]) out.push(i);
  });
  return out;
}

// ------------------------------------------------------------------ stacking

export type Stacked = {
  /** lower[s][i] and upper[s][i]: the layer's bounds at period i, null when the period is not fully recorded. */
  lower: (number | null)[][];
  upper: (number | null)[][];
  /** Sum of the layers at each period, null when not fully recorded. */
  total: (number | null)[];
  /** The period has every layer recorded, non-negative, and (in percent mode) a positive total. */
  drawable: boolean[];
};

/**
 * Stack `values[series][period]` bottom to top. A period is drawn only when every series is recorded and none is
 * negative; otherwise it is a gap (never a zero). `percent` normalises each period to 0–100; a period whose total is
 * zero has no defined share and is a gap too.
 */
export function stackLayers(
  values: readonly (readonly (number | null)[])[],
  mode: "stack" | "percent" = "stack",
): Stacked {
  const n = values[0]?.length ?? 0;
  const lower = values.map(() => new Array<number | null>(n).fill(null));
  const upper = values.map(() => new Array<number | null>(n).fill(null));
  const total = new Array<number | null>(n).fill(null);
  const drawable = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const col = values.map((v) => v[i]);
    if (!col.length || !col.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0))
      continue;
    const sum = (col as number[]).reduce((a, v) => a + v, 0);
    if (mode === "percent" && sum === 0) continue;
    total[i] = sum;
    drawable[i] = true;
    let acc = 0;
    col.forEach((v, s) => {
      const share = mode === "percent" ? ((v as number) / sum) * 100 : (v as number);
      lower[s]![i] = acc;
      acc += share;
      upper[s]![i] = acc;
    });
  }
  return { lower, upper, total, drawable };
}

// ------------------------------------------------------------------ labels inside areas

export type LabelSpot = { x: number; y: number; fits: boolean; slack: number };

/**
 * Where a label of `w` × `h` px sits best inside a layer: the x whose window [x - w/2, x + w/2] keeps the thinnest
 * part of the layer widest. `top[i]` and `bottom[i]` are pixel y of the layer at `xs[i]` (null where it is not drawn);
 * a window must lie inside one drawn run. `fits` means the label clears the layer by at least `pad` px everywhere.
 */
export function labelSpot(
  xs: readonly number[],
  top: readonly (number | null)[],
  bottom: readonly (number | null)[],
  w: number,
  h: number,
  pad = 3,
): LabelSpot | null {
  const n = xs.length;
  const thickAt = (x: number): { t: number; mid: number } | null => {
    for (let i = 0; i + 1 < n; i++) {
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      if (x < x0 || x > x1) continue;
      const t0 = top[i];
      const t1 = top[i + 1];
      const b0 = bottom[i];
      const b1 = bottom[i + 1];
      if (t0 == null || t1 == null || b0 == null || b1 == null) return null;
      const u = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      const tp = t0 + (t1 - t0) * u;
      const bt = b0 + (b1 - b0) * u;
      return { t: bt - tp, mid: (bt + tp) / 2 };
    }
    return null;
  };
  if (n < 2) return null;
  const first = xs[0]!;
  const last = xs[n - 1]!;
  let best: (LabelSpot & { tie: number }) | null = null;
  const centre = (first + last) / 2;
  for (let cx = first + w / 2; cx <= last - w / 2 + 0.001; cx += 3) {
    let min = Infinity;
    let ok = true;
    const samples = 8;
    for (let k = 0; k <= samples; k++) {
      const s = thickAt(cx - w / 2 + (w * k) / samples);
      if (!s) {
        ok = false;
        break;
      }
      min = Math.min(min, s.t);
    }
    if (!ok) continue;
    const mid = thickAt(cx)!.mid;
    const slack = min - h;
    const tie = Math.abs(cx - centre);
    if (
      !best ||
      slack > best.slack + 0.5 ||
      (Math.abs(slack - best.slack) <= 0.5 && tie < best.tie)
    )
      best = { x: cx, y: mid, fits: slack >= pad * 2, slack, tie };
  }
  return best ? { x: best.x, y: best.y, fits: best.fits, slack: best.slack } : null;
}

// ------------------------------------------------------------------ signed series

export type SignedRun = { sign: 1 | -1; pts: { x: number; v: number }[] };

/**
 * Split a signed series at zero. Each run keeps one sign and starts and ends exactly on zero where the series crosses
 * (the crossing x comes from the straight edge between the two recorded neighbours: a geometric intersection for
 * drawing, not a value). `null` breaks a run: nothing is joined across a period the source does not record.
 */
export function signedRuns(xs: readonly number[], vs: readonly (number | null)[]): SignedRun[] {
  const runs: SignedRun[] = [];
  let cur: SignedRun | null = null;
  let zero: { x: number; v: number } | null = null;
  let prev: { x: number; v: number } | null = null;
  const nodes: ({ x: number; v: number } | null)[] = [];
  for (let i = 0; i < xs.length; i++) {
    const v = vs[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      nodes.push(null);
      prev = null;
      continue;
    }
    const p = { x: xs[i]!, v };
    if (prev && prev.v * v < 0)
      nodes.push({ x: prev.x + ((0 - prev.v) * (p.x - prev.x)) / (v - prev.v), v: 0 });
    nodes.push(p);
    prev = p;
  }
  for (const n of nodes) {
    if (n === null) {
      cur = null;
      zero = null;
      continue;
    }
    if (n.v === 0) {
      cur?.pts.push(n);
      zero = n;
      continue;
    }
    const sign: 1 | -1 = n.v > 0 ? 1 : -1;
    if (!cur || cur.sign !== sign) {
      cur = { sign, pts: zero ? [zero] : [] };
      runs.push(cur);
    }
    cur.pts.push(n);
    zero = null;
  }
  return runs.filter((run) => run.pts.length >= 2);
}

// ------------------------------------------------------------------ callouts and event labels

export type Box = { x: number; y: number; w: number; h: number };
export type Placement = {
  box: Box;
  side: "up-right" | "up-left" | "down-right" | "down-left" | "right" | "left";
};

const inside = (b: Box, area: Box, pad: number) =>
  b.x >= area.x + pad &&
  b.y >= area.y + pad &&
  b.x + b.w <= area.x + area.w - pad &&
  b.y + b.h <= area.y + area.h - pad;
export const boxesOverlap = (a: Box, b: Box, gap = 4) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** True when the straight segment a–b touches `box` (grown by `pad`): an end inside it or a crossing of an edge. */
export function segmentHitsBox(a: Pt, b: Pt, box: Box, pad = 2): boolean {
  const x0 = box.x - pad;
  const y0 = box.y - pad;
  const x1 = box.x + box.w + pad;
  const y1 = box.y + box.h + pad;
  const within = (p: Pt) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  if (within(a) || within(b)) return true;
  if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1) return false;
  if (Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) return false;
  // Liang–Barsky clip of the segment against the box
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y);
}

/**
 * A label box of `w` × `h` near an anchor point: the first of the preferred sides whose box lies inside `area`, clears
 * every box already placed and is not crossed by any `avoid` segment (the plotted lines). `prefer` orders the sides
 * ("up" tries above first, "down" below first, "side" beside the point first), nearest distance first and then further out.
 * Returns null when nothing fits (the caller then
 * leaves the label to the tooltip).
 */
export function placeCallout(
  anchor: Pt,
  size: { w: number; h: number },
  area: Box,
  taken: readonly Box[],
  prefer: "up" | "down" | "side" = "up",
  distance = 26,
  avoid: readonly (readonly [Pt, Pt])[] = [],
): Placement | null {
  const { w, h } = size;
  // nearest first: every side at `distance`, then every side again further out (a leader joins label and anchor)
  for (const d of [distance, distance * 1.7, distance * 2.6]) {
    const up = [
      { side: "up-right" as const, box: { x: anchor.x + 6, y: anchor.y - d - h, w, h } },
      { side: "up-left" as const, box: { x: anchor.x - 6 - w, y: anchor.y - d - h, w, h } },
    ];
    const down = [
      { side: "down-right" as const, box: { x: anchor.x + 6, y: anchor.y + d, w, h } },
      { side: "down-left" as const, box: { x: anchor.x - 6 - w, y: anchor.y + d, w, h } },
    ];
    const level = [
      { side: "right" as const, box: { x: anchor.x + d, y: anchor.y - h / 2, w, h } },
      { side: "left" as const, box: { x: anchor.x - d - w, y: anchor.y - h / 2, w, h } },
    ];
    const order =
      prefer === "up"
        ? [...up, ...down, ...level]
        : prefer === "down"
          ? [...down, ...up, ...level]
          : [...level, ...up, ...down];
    for (const c of order)
      if (
        inside(c.box, area, 2) &&
        !taken.some((t) => boxesOverlap(c.box, t)) &&
        !avoid.some(([p, q]) => segmentHitsBox(p, q, c.box))
      )
        return c;
  }
  return null;
}

/**
 * Vertical levels (0, 1, 2 …) for labels along the top of a plot so none overlap: each label takes the first level
 * whose last label ends before it starts (plus `gap`). `items` are the labels' [left, right] pixel extents in order.
 */
export function staggerLevels(
  items: readonly { left: number; right: number }[],
  gap = 8,
): number[] {
  const ends: number[] = [];
  return items.map((it) => {
    let level = ends.findIndex((e) => e + gap <= it.left);
    if (level < 0) level = ends.length;
    ends[level] = it.right;
    return level;
  });
}

/** Curved arrow from a label edge to its anchor: a quadratic bend, for the leader of a callout. */
export function leaderPath(from: Pt, to: Pt, bend = 0.25): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const c = { x: mx - dy * bend, y: my + dx * bend };
  return `M${fmt(from)}Q${fmt(c)} ${fmt(to)}`;
}

/** The point on a box edge closest to `p` (where a leader line leaves its label). */
export function edgeAnchor(box: Box, p: Pt): Pt {
  const cx = Math.min(box.x + box.w, Math.max(box.x, p.x));
  const cy = Math.min(box.y + box.h, Math.max(box.y, p.y));
  if (p.x >= box.x && p.x <= box.x + box.w)
    return { x: cx, y: p.y < box.y ? box.y : box.y + box.h };
  if (p.y >= box.y && p.y <= box.y + box.h)
    return { x: p.x < box.x ? box.x : box.x + box.w, y: cy };
  return { x: cx, y: cy };
}

/**
 * Ticks for a log axis in log10 space: every power of ten in range and, when there are three decades or fewer, the 2
 * and 5 multiples too. The domain is the whole decades around [min, max]. Values are log10 of the tick value.
 */
export function logTicks(
  minLog: number,
  maxLog: number,
): { domain: [number, number]; ticks: number[] } {
  const lo = Math.floor(minLog);
  const hi = Math.max(lo + 1, Math.ceil(maxLog));
  const ticks: number[] = [];
  for (let k = lo; k <= hi; k++) {
    ticks.push(k);
    if (hi - lo <= 3 && k < hi) for (const m of [2, 5]) ticks.push(k + Math.log10(m));
  }
  return { domain: [lo, hi], ticks };
}
