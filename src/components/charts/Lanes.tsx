/**
 * Lanes on one time axis: a compact list (one row per entity: a line scaled to the row's own peak, a shaded strip of
 * yearly counts on a shared scale, event ticks) that expands a row in place, and a detailed lane (several tracks, each
 * in its own band with its own scale, events ruled across every band, a crosshair that reads every track at once).
 *
 * Time is in month units (year × 12 + month − 1; fractions place a day inside its month). Nothing is interpolated: a
 * line segment joins two points only when the caller marks them as neighbours, a bin exists only where the source
 * records a value, and a period it does not record is left empty (the table says "Not recorded").
 *
 * Keyboard: the list is one tab stop (roving focus) — ↑/↓ move between rows, Enter or Space opens a row, ←/→ move the
 * year read out for the focused row, Home/End jump. The detailed lane is one tab stop — ←/→ move a month, Shift+←/→ a
 * year, Home/End the ends, Escape clears. Hover and keyboard show the same details.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { columnPath } from "./BarTrend";
import {
  ChartTooltip,
  localPoint,
  textWidth,
  useMeasuredWidth,
  type TooltipContent,
} from "./canvas";
import type { ValueFormatter } from "./format";
import { chartTokens, sequentialFill, seriesVar } from "./palette";
import { linearScale, niceDomain } from "./scale";

// ------------------------------------------------------------------------------------------------ types

export type LanePoint = {
  t: number;
  v: number;
  /** Joined to the previous point by the line. */
  link: boolean;
  /** Tooltip / table period ("Mar 2021", "FY2021, September 30"). */
  label: string;
  note?: string | undefined;
};

export type LaneBin = {
  t0: number;
  t1: number;
  v: number;
  label: string;
  partial?: boolean | undefined;
  note?: string | undefined;
};

export type LaneMarker = { t: number; label: string; kind: "start" | "end" | "mark" };

export type LaneTrack =
  | {
      kind: "line";
      id: string;
      label: string;
      unit: string;
      formatter: ValueFormatter;
      points: readonly LanePoint[];
      /** Categorical slot (0-based) for the mark colour; default 0. */
      slot?: number | undefined;
      /** Readable distance (months) within which the crosshair reads a point. */
      reach?: number | undefined;
    }
  | {
      kind: "bins";
      id: string;
      label: string;
      unit: string;
      formatter: ValueFormatter;
      bins: readonly LaneBin[];
      slot?: number | undefined;
    }
  | { kind: "note"; id: string; label: string; text: string };

// ------------------------------------------------------------------------------------------------ time axis

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthText = (t: number) => {
  const i = Math.floor(t);
  return `${MONTHS[((i % 12) + 12) % 12]} ${Math.floor(i / 12)}`;
};

/** Axis ticks for a month-unit domain: years at a step that keeps ~`spacing` px between labels (quarters for short
 * spans). Pure. */
export function laneTicks(
  domain: readonly [number, number],
  width: number,
  spacing = 64,
): { t: number; label: string }[] {
  const [a, b] = domain;
  const span = Math.max(1, b - a);
  const fit = Math.max(1, Math.floor(width / spacing));
  if (span <= 30) {
    const step = [1, 3, 6, 12].find((s) => span / s <= fit) ?? 12;
    const out: { t: number; label: string }[] = [];
    for (let t = Math.ceil(a / step) * step; t <= b; t += step)
      out.push({ t, label: step >= 12 ? String(t / 12) : monthText(t) });
    return out;
  }
  const years = span / 12;
  const step = [1, 2, 5, 10, 20, 25, 50].find((s) => years / s <= fit) ?? 50;
  const out: { t: number; label: string }[] = [];
  for (let y = Math.ceil(a / 12 / step) * step; y * 12 <= b; y += step)
    out.push({ t: y * 12, label: String(y) });
  return out;
}

/** Domain (month units) covering every point, bin and marker, padded to whole years, ending no earlier than `until`. */
export function laneDomain(
  tracks: readonly {
    points?: readonly { t: number }[];
    bins?: readonly { t0: number; t1: number }[];
  }[],
  markers: readonly { t: number }[] = [],
  until?: number,
): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const tr of tracks) {
    for (const p of tr.points ?? []) {
      lo = Math.min(lo, p.t);
      hi = Math.max(hi, p.t);
    }
    for (const b of tr.bins ?? []) {
      lo = Math.min(lo, b.t0);
      hi = Math.max(hi, b.t1);
    }
  }
  for (const m of markers) {
    lo = Math.min(lo, m.t);
    hi = Math.max(hi, m.t);
  }
  if (until !== undefined && Number.isFinite(lo)) hi = Math.max(hi, until);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return [Math.floor(lo / 12) * 12, Math.ceil((hi + 0.001) / 12) * 12];
}

const AXIS_FONT = 10;

export function LaneAxis({
  domain,
  width,
  left,
  right,
  className,
}: {
  domain: readonly [number, number];
  /** Width of the plot area in px. */
  width: number;
  /** Offset of the plot area from the left of the row. */
  left: number;
  right: number;
  className?: string | undefined;
}) {
  const x = linearScale([domain[0], domain[1]], [0, width]);
  const ticks = laneTicks(domain, width);
  return (
    <div
      aria-hidden
      className={cn("relative h-5", className)}
      style={{ paddingLeft: left, paddingRight: right }}
    >
      <svg width={width} height={20} className="block overflow-visible">
        {ticks.map((tk) => (
          <g key={tk.t} transform={`translate(${x(tk.t)},0)`}>
            <line y1={14} y2={20} stroke="var(--chart-grid)" />
            <text y={10} textAnchor="middle" fontSize={AXIS_FONT} fill="var(--chart-axis)">
              {tk.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ compact rows

export type LaneRowSpec = {
  id: string;
  /** First line (bold): "MDL 2738". */
  label: string;
  /** Second part of the first line (title). */
  title: string;
  /** Second line (muted): court · judge. */
  sublabel?: string | undefined;
  /** Right-hand value ("69,340") and its note ("pending, Oct 2026"). */
  aside?: string | undefined;
  asideNote?: string | undefined;
  line?: readonly LanePoint[] | undefined;
  strip?: readonly LaneBin[] | undefined;
  markers?: readonly LaneMarker[] | undefined;
  /** Screen-reader sentence for the row. */
  summary: string;
};

export type LaneRowsProps = {
  rows: readonly LaneRowSpec[];
  domain: readonly [number, number];
  ariaLabel: string;
  /** Shared scale for the strips: value → 0..1 (e.g. a log scale over every row's counts). */
  stripScale: (v: number) => number;
  /** Text read for a row at a year (keyboard ←/→ and hover). */
  readout: (rowId: string, t: number) => TooltipContent | null;
  expanded: string | null;
  onToggle: (rowId: string) => void;
  renderExpanded?: ((rowId: string) => ReactNode) | undefined;
  /** Width of the label column at full width (narrower below 1100 px). */
  labelWidth?: number | undefined;
  /** Fixed width (tests); measured from the container when omitted. */
  width?: number | undefined;
  className?: string | undefined;
};

const ROW_SVG_H = 30;
const LINE_H = 19;

function rowPaths(points: readonly LanePoint[], x: (t: number) => number, max: number) {
  const y = (v: number) => 1 + LINE_H - (max > 0 ? (v / max) * (LINE_H - 1) : 0);
  const segs: LanePoint[][] = [];
  for (const p of points) {
    if (p.link && segs.length) segs[segs.length - 1]!.push(p);
    else segs.push([p]);
  }
  const lines: string[] = [];
  const areas: string[] = [];
  const dots: { cx: number; cy: number }[] = [];
  for (const s of segs) {
    if (s.length === 1) {
      dots.push({ cx: x(s[0]!.t), cy: y(s[0]!.v) });
      continue;
    }
    const d = s.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    lines.push(d);
    areas.push(
      `${d}L${x(s[s.length - 1]!.t).toFixed(1)},${LINE_H + 1}L${x(s[0]!.t).toFixed(1)},${LINE_H + 1}Z`,
    );
  }
  return { lines, areas, dots };
}

export function LaneRows({
  rows,
  domain,
  ariaLabel,
  stripScale,
  readout,
  expanded,
  onToggle,
  renderExpanded,
  labelWidth = 260,
  width: fixedWidth,
  className,
}: LaneRowsProps) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const hatch = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [focus, setFocus] = useState(0);
  const [cursor, setCursor] = useState<{ row: string; t: number; x: number; y: number } | null>(
    null,
  );
  const [announce, setAnnounce] = useState("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const width = fixedWidth ?? measured ?? 0;
  const lw =
    width < 760 ? Math.min(labelWidth, 150) : width < 1000 ? Math.min(labelWidth, 210) : labelWidth;
  const aw = width < 760 ? 64 : 92;
  const plotW = Math.max(40, width - lw - aw - 16);
  const x = useMemo(() => linearScale([domain[0], domain[1]], [0, plotW]), [domain, plotW]);
  const focusIndex = Math.min(focus, Math.max(0, rows.length - 1));

  const move = (i: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, i));
    setFocus(next);
    const id = rows[next]?.id;
    if (id) buttons.current.get(id)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    // keys pressed inside an opened row's detail belong to that detail
    if (!(e.target instanceof HTMLElement) || e.target.dataset["laneRow"] === undefined) return;
    const row = rows[focusIndex];
    if (!row) return;
    if (e.key === "ArrowDown") move(focusIndex + 1);
    else if (e.key === "ArrowUp") move(focusIndex - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(rows.length - 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const prevT = cursor?.row === row.id ? cursor.t : domain[1] - 6;
      const t = Math.max(
        domain[0] + 6,
        Math.min(domain[1] - 6, prevT + (e.key === "ArrowLeft" ? -12 : 12)),
      );
      const yr = Math.floor(t / 12) * 12 + 6;
      setCursor({ row: row.id, t: yr, x: lw + 8 + x(yr), y: 8 });
      const r = readout(row.id, yr);
      if (r)
        setAnnounce(
          `${r.title}, ${r.subtitle ?? ""}: ${r.rows.map((z) => `${z.label} ${z.value}`).join("; ")}`,
        );
    } else if (e.key === "Escape") setCursor(null);
    else return;
    e.preventDefault();
  };

  const tip = cursor ? readout(cursor.row, cursor.t) : null;

  return (
    <div ref={ref} className={cn("relative min-w-0", className)} style={chartTokens}>
      <svg width={0} height={0} aria-hidden className="absolute">
        <defs>
          <pattern
            id={hatch}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--chart-surface)" strokeWidth="1.5" />
          </pattern>
        </defs>
      </svg>
      {width ? (
        <>
          <LaneAxis
            domain={domain}
            width={plotW}
            left={lw + 8}
            right={aw + 8}
            className="sticky top-0 z-10 bg-surface"
          />
          <ul
            role="list"
            aria-label={ariaLabel}
            onKeyDown={onKeyDown}
            className="divide-y divide-border/60"
          >
            {rows.map((r, i) => {
              const max = Math.max(0, ...(r.line ?? []).map((p) => p.v));
              const paths = rowPaths(r.line ?? [], x, max);
              const open = expanded === r.id;
              const panelId = `${hatch}-panel-${r.id}`;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) buttons.current.set(r.id, el);
                      else buttons.current.delete(r.id);
                    }}
                    data-lane-row=""
                    tabIndex={i === focusIndex ? 0 : -1}
                    aria-expanded={open}
                    aria-controls={open ? panelId : undefined}
                    onFocus={() => setFocus(i)}
                    onClick={() => onToggle(r.id)}
                    onBlur={() => setCursor((c) => (c?.row === r.id ? null : c))}
                    className={cn(
                      "flex w-full items-center gap-2 px-0 py-0.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      open && "bg-muted/40",
                    )}
                  >
                    <span className="min-w-0 shrink-0 pl-1" style={{ width: lw }}>
                      <span className="flex min-w-0 items-baseline gap-1.5 text-[12px] leading-4">
                        <span className="shrink-0 font-semibold tabular-nums">{r.label}</span>
                        <span className="truncate">{r.title}</span>
                      </span>
                      {r.sublabel ? (
                        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                          {r.sublabel}
                        </span>
                      ) : null}
                    </span>
                    <svg
                      width={plotW}
                      height={ROW_SVG_H}
                      aria-hidden
                      className="block shrink-0 overflow-visible"
                      onPointerMove={(e) => {
                        const p = localPoint(e);
                        setCursor({ row: r.id, t: x.invert(p.x), x: lw + 8 + p.x, y: 0 });
                      }}
                      onPointerLeave={() => setCursor(null)}
                    >
                      <line
                        x1={0}
                        x2={plotW}
                        y1={LINE_H + 1}
                        y2={LINE_H + 1}
                        stroke="var(--chart-grid)"
                        shapeRendering="crispEdges"
                      />
                      {(r.strip ?? []).map((b) => {
                        const x0 = x(b.t0);
                        const w = Math.max(1, x(b.t1) - x0 - (x(b.t1) - x0 > 4 ? 1 : 0));
                        return (
                          <g key={`${b.t0}`}>
                            <rect
                              x={x0}
                              y={23}
                              width={w}
                              height={6}
                              fill={sequentialFill(stripScale(b.v))}
                            />
                            {b.partial ? (
                              <rect x={x0} y={23} width={w} height={6} fill={`url(#${hatch})`} />
                            ) : null}
                          </g>
                        );
                      })}
                      {paths.areas.map((d) => (
                        <path key={`a${d}`} d={d} fill="var(--chart-1)" fillOpacity={0.1} />
                      ))}
                      {paths.lines.map((d) => (
                        <path
                          key={`l${d}`}
                          d={d}
                          fill="none"
                          stroke="var(--chart-1)"
                          strokeWidth={1.75}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      ))}
                      {paths.dots.map((dt) => (
                        <circle
                          key={`${dt.cx},${dt.cy}`}
                          cx={dt.cx}
                          cy={dt.cy}
                          r={2.5}
                          fill="var(--chart-1)"
                          stroke="var(--chart-surface)"
                          strokeWidth={1}
                        />
                      ))}
                      {(r.markers ?? []).map((m) => (
                        <line
                          key={`${m.kind}${m.t}`}
                          x1={x(m.t)}
                          x2={x(m.t)}
                          y1={m.kind === "start" ? 0 : 4}
                          y2={ROW_SVG_H}
                          stroke="var(--chart-ink)"
                          strokeOpacity={m.kind === "start" ? 0.7 : 0.55}
                          strokeWidth={m.kind === "end" ? 2 : 1}
                        />
                      ))}
                      {cursor?.row === r.id ? (
                        <line
                          x1={x(cursor.t)}
                          x2={x(cursor.t)}
                          y1={0}
                          y2={ROW_SVG_H}
                          stroke="var(--chart-axis)"
                          strokeOpacity={0.6}
                        />
                      ) : null}
                    </svg>
                    <span className="shrink-0 pr-1 text-right" style={{ width: aw }}>
                      <span className="block text-[12px] font-semibold leading-4 tabular-nums">
                        {r.aside ?? "Not recorded"}
                      </span>
                      {r.asideNote ? (
                        <span className="block truncate text-[10.5px] leading-4 text-muted-foreground">
                          {r.asideNote}
                        </span>
                      ) : null}
                    </span>
                    <span className="sr-only">{r.summary}</span>
                  </button>
                  {open && renderExpanded ? (
                    <div
                      id={panelId}
                      role="region"
                      aria-label={`${r.label} detail`}
                      className="border-t border-border/60 bg-surface px-1 py-2"
                    >
                      {renderExpanded(r.id)}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {tip && cursor ? (
            <ChartTooltip
              content={tip}
              x={Math.min(cursor.x, width - 8)}
              y={cursorTop(cursor.row, buttons.current)}
              containerWidth={width}
            />
          ) : null}
        </>
      ) : (
        <div style={{ height: 120 }} />
      )}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}

/** Top of the tooltip for a row: just under the row's button (offsets are relative to the list root, which is the
 * nearest positioned ancestor). */
function cursorTop(rowId: string, buttons: Map<string, HTMLButtonElement>): number {
  const b = buttons.get(rowId);
  return b ? b.offsetTop + b.offsetHeight + 2 : 0;
}

// ------------------------------------------------------------------------------------------------ detailed lane

const BAND = { line: 76, bins: 46, note: 24 } as const;
const GAP = 10;
const TOP = 30;
const BOTTOM = 22;

export type LaneTracksProps = {
  tracks: readonly LaneTrack[];
  markers?: readonly LaneMarker[] | undefined;
  domain: readonly [number, number];
  ariaLabel: string;
  width?: number | undefined;
  /** Label column width at full width. */
  labelWidth?: number | undefined;
};

function bandOf(tr: LaneTrack) {
  return tr.kind === "line" ? BAND.line : tr.kind === "bins" ? BAND.bins : BAND.note;
}

/** Marker labels placed left to right on up to two rows so they never overlap. Pure. */
export function placeMarkerLabels(
  markers: readonly LaneMarker[],
  x: (t: number) => number,
  width: number,
): { m: LaneMarker; x: number; row: 0 | 1; anchor: "start" | "end" }[] {
  const ends: [number, number] = [-Infinity, -Infinity];
  return [...markers]
    .sort((a, b) => a.t - b.t)
    .map((m) => {
      const px = x(m.t);
      const w = textWidth(m.label, AXIS_FONT) + 6;
      const anchor: "start" | "end" = px + w > width ? "end" : "start";
      const left = anchor === "start" ? px : px - w;
      const row: 0 | 1 = left > ends[0] ? 0 : 1;
      ends[row] = Math.max(ends[row], left + w);
      return { m, x: px, row, anchor };
    });
}

/** Value a track shows at month `t` (the crosshair), or null when the source records none there. */
export function readTrack(
  tr: LaneTrack,
  t: number,
): {
  value: number;
  label: string;
  note?: string | undefined;
  partial?: boolean | undefined;
} | null {
  if (tr.kind === "line") {
    const reach = tr.reach ?? 0.75;
    let best: LanePoint | null = null;
    for (const p of tr.points)
      if (Math.abs(p.t - t) <= reach && (!best || Math.abs(p.t - t) < Math.abs(best.t - t)))
        best = p;
    return best ? { value: best.v, label: best.label, note: best.note } : null;
  }
  if (tr.kind === "bins") {
    const b = tr.bins.find((x) => t >= x.t0 && t < x.t1);
    return b ? { value: b.v, label: b.label, note: b.note, partial: b.partial } : null;
  }
  return null;
}

export function LaneTracks({
  tracks,
  markers = [],
  domain,
  ariaLabel,
  width: fixed,
  labelWidth = 176,
}: LaneTracksProps) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const width = fixed ?? measured;
  const hatch = useId().replace(/[^a-zA-Z0-9]/g, "");
  const liveId = useId();
  const [t, setT] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const height = TOP + tracks.reduce((s, tr) => s + bandOf(tr) + GAP, 0) - GAP + BOTTOM;
  const lw = width && width < 700 ? Math.min(labelWidth, 116) : labelWidth;
  const plotL = lw + 8;
  const plotW = Math.max(40, (width ?? 0) - plotL - 6);
  const x = useMemo(
    () => linearScale([domain[0], domain[1]], [plotL, plotL + plotW]),
    [domain, plotL, plotW],
  );

  const readAll = useCallback(
    (at: number): TooltipContent => ({
      title: monthText(at),
      rows: tracks
        .filter((tr) => tr.kind !== "note")
        .map((tr) => {
          const r = readTrack(tr, at);
          return {
            key: tr.id,
            label: `${tr.label}${r ? ` (${r.label}${r.partial ? ", partial" : ""})` : ""}`,
            value: r
              ? `${tr.formatter.full(r.value)}${tr.unit && !/[%$]/.test(tr.formatter.full(r.value)) ? ` ${tr.unit}` : ""}`
              : "Not recorded",
            color: seriesVar(tr.slot ?? 0),
          };
        }),
      footer:
        markers
          .filter((m) => Math.floor(m.t) === Math.floor(at))
          .map((m) => m.label)
          .join(" · ") || undefined,
    }),
    [tracks, markers],
  );

  useEffect(() => {
    if (t === null) return;
    const c = readAll(t);
    setAnnounce(
      `${c.title}: ${c.rows.map((r) => `${r.label} ${r.value}`).join("; ")}${c.footer ? `. ${c.footer}` : ""}`,
    );
  }, [t, readAll]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 12 : 1;
    const lo = Math.ceil(domain[0]);
    const hi = Math.floor(domain[1]) - 1;
    const cur = t ?? hi;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(hi, (t === null ? lo - step : cur) + step);
    else if (e.key === "ArrowLeft") next = Math.max(lo, cur - step);
    else if (e.key === "Home") next = lo;
    else if (e.key === "End") next = hi;
    else if (e.key === "Escape") {
      setT(null);
      return;
    } else return;
    e.preventDefault();
    setPointer(null);
    setT(next);
  };

  let y0 = TOP;
  const bands = tracks.map((tr) => {
    const top = y0;
    y0 += bandOf(tr) + GAP;
    return { tr, top, h: bandOf(tr) };
  });
  const placed = width ? placeMarkerLabels(markers, x, plotL + plotW) : [];
  const ticks = width ? laneTicks(domain, plotW) : [];

  return (
    <div ref={ref} className="relative w-full min-w-0" style={{ ...chartTokens, height }}>
      <div
        role="group"
        aria-roledescription="timeline"
        aria-label={`${ariaLabel} Use the left and right arrow keys to read each month; hold Shift to move by a year.`}
        aria-describedby={liveId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setT(null)}
        className="h-full w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {width ? (
          <svg
            width={width}
            height={height}
            aria-hidden
            className="block overflow-visible font-sans"
          >
            <defs>
              <pattern
                id={hatch}
                width="4"
                height="4"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="4" stroke="var(--chart-surface)" strokeWidth="1.5" />
              </pattern>
            </defs>
            {ticks.map((tk) => (
              <g key={tk.t}>
                <line
                  x1={x(tk.t)}
                  x2={x(tk.t)}
                  y1={TOP - 4}
                  y2={height - BOTTOM}
                  stroke="var(--chart-grid)"
                  strokeOpacity={0.6}
                  shapeRendering="crispEdges"
                />
                <text
                  x={x(tk.t)}
                  y={height - 7}
                  textAnchor="middle"
                  fontSize={AXIS_FONT}
                  fill="var(--chart-axis)"
                >
                  {tk.label}
                </text>
              </g>
            ))}
            {bands.map(({ tr, top, h }) => (
              <Fragment key={tr.id}>
                <foreignObject x={0} y={top} width={lw} height={h}>
                  <div className="pr-1 text-[11px] leading-[14px] text-foreground">
                    <span className="line-clamp-3">{tr.label}</span>
                  </div>
                </foreignObject>
                <Band tr={tr} top={top} h={h} x={x} plotL={plotL} plotW={plotW} hatch={hatch} />
              </Fragment>
            ))}
            {placed.map(({ m, x: px, row, anchor }) => (
              <g key={`${m.kind}${m.t}`}>
                <line
                  x1={px}
                  x2={px}
                  y1={TOP - 14 + row * 12 + 2}
                  y2={height - BOTTOM}
                  stroke="var(--chart-ink)"
                  strokeOpacity={m.kind === "mark" ? 0.4 : 0.65}
                  strokeWidth={m.kind === "end" ? 1.5 : 1}
                />
                <text
                  x={anchor === "start" ? px + 3 : px - 3}
                  y={TOP - 18 + row * 12}
                  textAnchor={anchor}
                  fontSize={AXIS_FONT}
                  fill="var(--chart-ink)"
                  stroke="var(--chart-surface)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {m.label}
                </text>
              </g>
            ))}
            {t !== null ? (
              <line
                x1={x(t + 0.5)}
                x2={x(t + 0.5)}
                y1={TOP - 4}
                y2={height - BOTTOM}
                stroke="var(--chart-axis)"
                strokeWidth={1}
              />
            ) : null}
            <rect
              x={plotL}
              y={TOP - 4}
              width={plotW}
              height={height - BOTTOM - TOP + 4}
              fill="transparent"
              onPointerMove={(e) => {
                const p = localPoint(e);
                setPointer(p);
                setT(Math.floor(x.invert(p.x)));
              }}
              onPointerLeave={() => {
                setPointer(null);
                setT(null);
              }}
            />
          </svg>
        ) : null}
      </div>
      <p id={liveId} aria-live="polite" className="sr-only">
        {announce}
      </p>
      {t !== null && width ? (
        <ChartTooltip
          content={readAll(t)}
          x={pointer?.x ?? x(t + 0.5)}
          y={pointer?.y ?? TOP}
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}

function Band({
  tr,
  top,
  h,
  x,
  plotL,
  plotW,
  hatch,
}: {
  tr: LaneTrack;
  top: number;
  h: number;
  x: (t: number) => number;
  plotL: number;
  plotW: number;
  hatch: string;
}) {
  if (tr.kind === "note")
    return (
      <text x={plotL + 2} y={top + h / 2} dy="0.32em" fontSize={11} fill="var(--chart-axis)">
        {tr.text}
      </text>
    );
  const color = seriesVar(tr.slot ?? 0);
  const values = tr.kind === "line" ? tr.points.map((p) => p.v) : tr.bins.map((b) => b.v);
  const { domain: yd, ticks } = niceDomain(values, { zero: true, count: 2 });
  const y = linearScale(yd, [top + h, top + 2]);
  const maxTick = ticks[ticks.length - 1]!;
  const base = (
    <>
      <line
        x1={plotL}
        x2={plotL + plotW}
        y1={top + h}
        y2={top + h}
        stroke="var(--border-strong)"
        shapeRendering="crispEdges"
      />
      <line
        x1={plotL}
        x2={plotL + plotW}
        y1={y(maxTick)}
        y2={y(maxTick)}
        stroke="var(--chart-grid)"
        shapeRendering="crispEdges"
      />
      <text
        x={plotL + plotW}
        y={y(maxTick) - 3}
        textAnchor="end"
        fontSize={AXIS_FONT}
        fill="var(--chart-axis)"
      >
        {tr.formatter.tick(maxTick)}
      </text>
    </>
  );
  if (tr.kind === "line") {
    const segs: LanePoint[][] = [];
    for (const p of tr.points) {
      if (p.link && segs.length) segs[segs.length - 1]!.push(p);
      else segs.push([p]);
    }
    return (
      <g>
        {base}
        {segs.map((s) =>
          s.length === 1 ? (
            <circle
              key={`d${s[0]!.t}`}
              cx={x(s[0]!.t)}
              cy={y(s[0]!.v)}
              r={4}
              fill={color}
              stroke="var(--chart-surface)"
              strokeWidth={2}
            />
          ) : (
            <g key={`s${s[0]!.t}`}>
              <path
                d={`${s.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}L${x(s[s.length - 1]!.t).toFixed(1)},${top + h}L${x(s[0]!.t).toFixed(1)},${top + h}Z`}
                fill={color}
                fillOpacity={0.1}
              />
              <path
                d={s
                  .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
                  .join("")}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          ),
        )}
      </g>
    );
  }
  // bins: a hairline under the span the source covers; a column per recorded period
  const lo = Math.min(...tr.bins.map((b) => b.t0));
  const hi = Math.max(...tr.bins.map((b) => b.t1));
  return (
    <g>
      {base}
      {tr.bins.length ? (
        <line
          x1={x(lo)}
          x2={x(hi)}
          y1={top + h}
          y2={top + h}
          stroke={color}
          strokeOpacity={0.5}
          strokeWidth={2}
        />
      ) : null}
      {tr.bins.map((b) => {
        const x0 = x(b.t0);
        const full = x(b.t1) - x0;
        const gap = full >= 5 ? 1 : 0;
        const w = Math.max(0.75, full - gap);
        const d = columnPath(x0 + gap / 2, w, y(0), y(b.v), Math.min(4, w / 2));
        return d ? (
          <g key={`${b.t0}`}>
            <path d={d} fill={color} />
            {b.partial ? <path d={d} fill={`url(#${hatch})`} /> : null}
          </g>
        ) : null;
      })}
    </g>
  );
}
