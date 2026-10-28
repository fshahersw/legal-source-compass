/**
 * Every MDL's life in one picture: a canvas heatmap with one row per MDL in the captured JPML reports and one evenly
 * spaced column per report (year marks fall at each year's first report). Shade is actions pending on a
 * log scale; a blank cell is a report the MDL is not listed in. Hover a row to read it and to draw its full line in
 * the focus strip below; click to open the MDL. The vertical line is the race's playhead.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scaleLinear } from "d3-scale";
import { ChartTooltip, useMeasuredWidth, type TooltipContent } from "@/components/charts/canvas";
import { chartTokens } from "@/components/charts/palette";
import { Segmented } from "@/components/enforcement/parts";
import { pendingAt, strandOrder, type Atlas, type AtlasMdl, type StrandSort } from "./atlasModel";
import { reportLabel } from "./storiesColors";
import { CATEGORY_LABEL } from "./storiesModel";
import { useCanvasTheme } from "./useCanvasTheme";

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const SORTS: { id: StrandSort; label: string }[] = [
  { id: "start", label: "First listed" },
  { id: "peak", label: "Largest" },
  { id: "category", label: "Type" },
];
const AXIS_H = 22;
const STRIP = 7;

export function DocketStrands({
  atlas,
  t,
  height = 620,
}: {
  atlas: Atlas;
  t: number;
  height?: number;
}) {
  const navigate = useNavigate();
  const theme = useCanvasTheme();
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [sort, setSort] = useState<StrandSort>("start");
  const [hover, setHover] = useState<{ row: number; col: number; x: number; y: number } | null>(
    null,
  );
  const rows = useMemo(() => strandOrder(atlas.mdls, sort), [atlas, sort]);
  const times = useMemo(() => atlas.dates.map((d) => Date.parse(`${d}T00:00:00Z`)), [atlas]);
  const max = useMemo(
    () => Math.max(1, ...atlas.mdls.flatMap((m) => m.values.map((v) => v ?? 0))),
    [atlas],
  );
  const w = width ?? 0;
  const plotH = height - AXIS_H;
  const rh = plotH / Math.max(1, rows.length);
  // one evenly spaced column per report, so the sparse early years do not dominate the width
  const x = useMemo(
    () =>
      scaleLinear()
        .domain([0, Math.max(1, times.length)])
        .range([STRIP + 4, Math.max(STRIP + 5, w - 2)]),
    [times, w],
  );
  const colX = (i: number) => x(i);
  const colW = (i: number) => x(i + 1) - x(i);
  /** First report index of each year after the first. */
  const yearTicks = useMemo(() => {
    const out: { year: number; i: number }[] = [];
    atlas.dates.forEach((d, i) => {
      const y = Number(d.slice(0, 4));
      if (i === 0 || y !== Number(atlas.dates[i - 1]!.slice(0, 4))) out.push({ year: y, i });
    });
    return out;
  }, [atlas]);
  const shade = (v: number) => theme.seq(0.18 + 0.82 * (Math.log10(v + 1) / Math.log10(max + 1)));

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !w) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(height * dpr);
    cv.style.width = `${w}px`;
    cv.style.height = `${height}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    const font = getComputedStyle(cv).fontFamily || "sans-serif";
    // year ticks at each year's first report
    ctx.font = `400 11px ${font}`;
    ctx.textAlign = "center";
    let lastLabel = -Infinity;
    for (const tk of yearTicks) {
      const xx = colX(tk.i);
      ctx.fillStyle = theme.grid;
      ctx.fillRect(xx, AXIS_H - 4, 1, plotH + 4);
      if (xx - lastLabel < 34) continue;
      lastLabel = xx;
      ctx.fillStyle = theme.axis;
      ctx.fillText(String(tk.year), xx, 12);
    }
    // cells
    rows.forEach((m, r) => {
      const top = AXIS_H + r * rh;
      ctx.fillStyle = theme.category[m.category];
      ctx.fillRect(0, top, STRIP, Math.max(rh, 0.6));
      m.values.forEach((v, k) => {
        if (v === null) return;
        const i = m.start + k;
        ctx.fillStyle = v > 0 ? shade(v) : theme.grid;
        ctx.fillRect(colX(i), top, Math.max(0.8, colW(i) + 0.3), Math.max(rh, 0.6));
      });
    });
    // hovered row
    if (hover) {
      const top = AXIS_H + hover.row * rh;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(STRIP + 2, top - 1.5, w - STRIP - 3, rh + 3);
      ctx.fillStyle = theme.ink;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(colX(hover.col), AXIS_H, 1, plotH);
      ctx.globalAlpha = 1;
    }
    // playhead
    ctx.fillStyle = theme.ink;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x(Math.min(times.length, t + 0.5)) - 0.75, AXIS_H - 6, 1.5, plotH + 6);
    ctx.globalAlpha = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, w, height, theme, hover, t, x, yearTicks]);

  const hm: AtlasMdl | undefined = hover ? rows[hover.row] : undefined;
  const tip: TooltipContent | null =
    hm && hover
      ? {
          title: `MDL ${hm.mdl}`,
          subtitle: hm.short,
          rows: [
            {
              key: "p",
              label: reportLabel(atlas.dates[hover.col] ?? ""),
              value:
                hover.col < hm.start ||
                hover.col >= hm.start + hm.values.length ||
                hm.values[hover.col - hm.start] === null
                  ? "Not listed"
                  : n(pendingAt(hm, hover.col)),
            },
            {
              key: "k",
              label: "Peak in these reports",
              value: n(Math.max(0, ...hm.values.map((v) => v ?? 0))),
            },
            {
              key: "f",
              label: "Listed",
              value: `${reportLabel(atlas.dates[hm.start] ?? "")} – ${reportLabel(atlas.dates[hm.start + hm.values.length - 1] ?? "")}`,
            },
            { key: "c", label: "Type", value: CATEGORY_LABEL[hm.category] },
          ],
          footer: "Click to open the MDL",
        }
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-muted-foreground">Order rows by</span>
        <Segmented label="Order the rows by" value={sort} options={SORTS} onChange={setSort} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {n(rows.length)} MDLs × {n(atlas.dates.length)} reports
        </span>
        <ShadeKey max={max} shade={shade} />
      </div>
      <div ref={ref} className="relative w-full min-w-0" style={{ ...chartTokens, height }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Heatmap of ${rows.length} MDLs across ${atlas.dates.length} JPML reports, shaded by actions pending. The table view lists every MDL.`}
          className="block cursor-crosshair font-sans"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left;
            const py = e.clientY - r.top;
            if (py < AXIS_H) return setHover(null);
            const row = Math.min(rows.length - 1, Math.max(0, Math.floor((py - AXIS_H) / rh)));
            const col = Math.min(times.length - 1, Math.max(0, Math.floor(x.invert(px))));
            setHover({ row, col, x: px, y: py });
          }}
          onPointerLeave={() => setHover(null)}
          onClick={() => {
            if (hm) void navigate({ to: "/matters/lens/$mdl", params: { mdl: String(hm.mdl) } });
          }}
        />
        {tip && hover && w ? (
          <ChartTooltip content={tip} x={hover.x} y={hover.y} containerWidth={w} />
        ) : null}
      </div>
      <FocusStrip
        atlas={atlas}
        mdl={hm ?? rows.find((m) => m.inLatest) ?? rows[0]}
        x={x}
        width={w}
        hovered={!!hm}
      />
    </div>
  );
}

function ShadeKey({ max, shade }: { max: number; shade: (v: number) => string }) {
  const stops = [1, 10, 100, 1000, 10000, 100000].filter((v) => v <= max);
  return (
    <div
      className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground"
      aria-hidden
    >
      <span>Actions pending</span>
      {stops.map((v) => (
        <span key={v} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ background: shade(v) }} />
          {v >= 1000 ? `${v / 1000}K` : v}
        </span>
      ))}
    </div>
  );
}

function FocusStrip({
  atlas,
  mdl,
  x,
  width,
  hovered,
}: {
  atlas: Atlas;
  mdl: AtlasMdl | undefined;
  x: ReturnType<typeof scaleLinear<number, number>>;
  width: number;
  hovered: boolean;
}) {
  if (!mdl || !width) return null;
  const h = 86;
  const pts = mdl.values
    .map((v, k) => ({ v, t: mdl.start + k + 0.5 }))
    .filter((p): p is { v: number; t: number } => p.v !== null);
  const peak = Math.max(1, ...pts.map((p) => p.v));
  const y = scaleLinear()
    .domain([0, peak])
    .range([h - 14, 14]);
  const path = pts
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join("");
  const area = pts.length
    ? `${path}L${x(pts.at(-1)!.t).toFixed(1)},${h - 14}L${x(pts[0]!.t).toFixed(1)},${h - 14}Z`
    : "";
  const top = pts.reduce((b, p) => (p.v > b.v ? p : b), pts[0] ?? { v: 0, t: 0 });
  return (
    <div className="rounded-md border pt-1" style={chartTokens}>
      <p className="px-3 text-xs">
        <span className="font-semibold">
          MDL {mdl.mdl} {mdl.short}
        </span>
        <span className="text-muted-foreground">
          {" "}
          · peak {n(top.v)} · {hovered ? "hovered row" : "hover a row to swap"}
        </span>
      </p>
      <svg width={Math.max(0, width - 2)} height={h} aria-hidden className="block overflow-visible">
        <path d={area} fill="var(--chart-1)" opacity={0.15} />
        <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth={1.8} />
        {pts.length ? (
          <circle
            cx={x(top.t)}
            cy={y(top.v)}
            r={3.5}
            fill="var(--chart-1)"
            stroke="var(--chart-surface)"
            strokeWidth={1.5}
          />
        ) : null}
        <line
          x1={x.range()[0]}
          x2={x.range()[1]}
          y1={h - 14}
          y2={h - 14}
          stroke="var(--chart-baseline)"
        />
      </svg>
    </div>
  );
}
