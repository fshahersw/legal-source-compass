/**
 * Scatter of two metrics across entities, with the least-squares line and a statistics box: n, Pearson r and Spearman ρ
 * with 95% intervals and p-values, a small-sample warning and the reminder that a group-level association is neither an
 * individual-level finding nor evidence of cause. Points are labelled on hover and focus; the three points farthest
 * from the line (and any selected entity) carry a direct label.
 */
import { useId, useMemo, useState } from "react";
import { ChartCanvas, axisText, localPoint, textWidth, type TipSpec } from "./canvas";
import type { ValueFormatter } from "./format";
import { linearScale, niceDomain } from "./scale";
import { correlationTest, ols, type CorrelationTest, type OlsFit } from "./stats";

export type ScatterPoint = { id: string; label: string; x: number; y: number };

export type ScatterStats = {
  n: number;
  pearson: CorrelationTest | null;
  spearman: CorrelationTest | null;
  fit: OlsFit | null;
  /** Scale the statistics were computed on (log10 when an axis is logarithmic). */
  logX: boolean;
  logY: boolean;
};

/** Below this many pairs the box warns that a coefficient is unstable. */
export const SMALL_N = 10;

/** Statistics on the plotted scale. Points with non-positive values are dropped from a log axis by the caller. */
export function scatterStats(
  points: readonly ScatterPoint[],
  logX = false,
  logY = false,
): ScatterStats {
  const xs = points.map((p) => (logX ? Math.log10(p.x) : p.x));
  const ys = points.map((p) => (logY ? Math.log10(p.y) : p.y));
  return {
    n: points.length,
    pearson: correlationTest(xs, ys, "pearson"),
    spearman: correlationTest(xs, ys, "spearman"),
    fit: ols(xs, ys),
    logX,
    logY,
  };
}

/** "p < 0.001", "p = 0.032". */
export function formatP(p: number): string {
  if (p < 0.001) return "p < 0.001";
  return `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`;
}

export function formatCoef(t: CorrelationTest | null): string {
  if (!t) return "Not computed";
  const ci = t.ci ? ` (95% CI ${t.ci[0].toFixed(2)} to ${t.ci[1].toFixed(2)})` : "";
  return `${t.coefficient.toFixed(2)}${ci}, ${formatP(t.p)}`;
}

/** Plain words for the size of a coefficient (Cohen's conventional bands), never a claim of cause. */
export function strengthWords(r: number): string {
  const a = Math.abs(r);
  const dir = r > 0 ? "positive" : r < 0 ? "negative" : "no";
  if (a < 0.1) return "little or no linear association";
  if (a < 0.3) return `a weak ${dir} association`;
  if (a < 0.5) return `a moderate ${dir} association`;
  return `a strong ${dir} association`;
}

export function StatsBox({
  stats,
  entityNoun,
  adjusted,
}: {
  stats: ScatterStats;
  /** Plural noun for the units compared ("states", "district courts"). */
  entityNoun: string;
  /** Benjamini–Hochberg q for this comparison among m comparisons, when several were run. */
  adjusted?: { q: number; m: number } | null | undefined;
}) {
  const small = stats.n < SMALL_N;
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-4">
      <p className="text-xs font-semibold">Statistics</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        <dt className="text-muted-foreground">n</dt>
        <dd className="tabular-nums">
          {stats.n.toLocaleString("en-US")} {entityNoun} with both values
        </dd>
        <dt className="text-muted-foreground">Pearson r</dt>
        <dd className="tabular-nums">{formatCoef(stats.pearson)}</dd>
        <dt className="text-muted-foreground">Spearman ρ</dt>
        <dd className="tabular-nums">{formatCoef(stats.spearman)}</dd>
        {stats.fit ? (
          <>
            <dt className="text-muted-foreground">Fitted line</dt>
            <dd className="tabular-nums">
              R² = {stats.fit.r2.toFixed(2)}
              {stats.logX || stats.logY ? " (on the log scale shown)" : ""}
            </dd>
          </>
        ) : null}
        {adjusted ? (
          <>
            <dt className="text-muted-foreground">Adjusted</dt>
            <dd className="tabular-nums">
              q = {adjusted.q < 0.001 ? "< 0.001" : adjusted.q.toFixed(3)} (Benjamini–Hochberg
              across {adjusted.m} comparisons run)
            </dd>
          </>
        ) : null}
      </dl>
      {small ? (
        <p role="note" className="rounded border border-warning/40 bg-warning/10 px-2 py-1">
          Small sample: fewer than {SMALL_N} pairs. A coefficient this sample gives can change a lot
          with one point; read it as descriptive only.
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {stats.spearman
          ? `Across these ${entityNoun}, the ranks show ${strengthWords(stats.spearman.coefficient)}. `
          : ""}
        This is a group-level association: it describes {entityNoun}, not the people or cases in
        them, and does not show that one measure causes the other. p-values come from the t
        approximation; intervals from Fisher’s z.
      </p>
    </div>
  );
}

export function ScatterCorrelation({
  points,
  xFormatter,
  yFormatter,
  xLabel,
  yLabel,
  ariaLabel,
  logX = false,
  logY = false,
  selected = null,
  height = 340,
  width,
  showFit = true,
  onSelect,
}: {
  points: readonly ScatterPoint[];
  xFormatter: ValueFormatter;
  yFormatter: ValueFormatter;
  xLabel: string;
  yLabel: string;
  ariaLabel: string;
  logX?: boolean;
  logY?: boolean;
  selected?: string | null;
  height?: number;
  width?: number | undefined;
  showFit?: boolean;
  onSelect?: ((id: string) => void) | undefined;
}) {
  const [active, setActive] = useState<number | null>(null);
  const clipId = `scatter-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const sorted = useMemo(() => [...points].sort((a, b) => a.x - b.x || a.y - b.y), [points]);
  const tx = (v: number) => (logX ? Math.log10(v) : v);
  const ty = (v: number) => (logY ? Math.log10(v) : v);
  const stats = useMemo(() => scatterStats(sorted, logX, logY), [sorted, logX, logY]);
  // A scatter compares positions, not lengths, so its axes need not start at zero.
  const xd = niceDomain(
    sorted.map((p) => tx(p.x)),
    { zero: false, count: 5 },
  );
  const yd = niceDomain(
    sorted.map((p) => ty(p.y)),
    { zero: false, count: 5 },
  );
  const labelled = useMemo(() => {
    const ids = new Set<string>();
    if (stats.fit) {
      const res = sorted
        .map((p, i) => ({ id: p.id, r: Math.abs(stats.fit!.residuals[i]!) }))
        .sort((a, b) => b.r - a.r)
        .slice(0, 3);
      for (const r of res) ids.add(r.id);
    }
    if (selected) ids.add(selected);
    return ids;
  }, [sorted, stats.fit, selected]);
  const fmtTick = (f: ValueFormatter, log: boolean) => (t: number) =>
    log ? f.tick(10 ** t) : f.tick(t);
  const leftMargin = Math.max(
    36,
    ...yd.ticks.map((t) => textWidth(fmtTick(yFormatter, logY)(t)) + 10),
  );
  const describe = (i: number) => {
    const p = sorted[i]!;
    return `${p.label}: ${xLabel} ${xFormatter.full(p.x)}, ${yLabel} ${yFormatter.full(p.y)}.`;
  };
  return (
    <ChartCanvas
      width={width}
      height={height}
      ariaLabel={ariaLabel}
      count={sorted.length}
      active={active}
      onActive={setActive}
      describe={describe}
    >
      {(w) => {
        const x = linearScale(xd.domain, [leftMargin, w - 12]);
        const y = linearScale(yd.domain, [height - 34, 24]);
        const nearest = (px: number, py: number) => {
          let best: number | null = null;
          let bestD = 24;
          sorted.forEach((p, i) => {
            const d = Math.hypot(x(tx(p.x)) - px, y(ty(p.y)) - py);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          return best;
        };
        const fit = stats.fit;
        const fitLine =
          fit && showFit
            ? (() => {
                // drawn over the observed X range only: no extrapolation beyond the data
                const a = tx(sorted[0]!.x);
                const b = tx(sorted[sorted.length - 1]!.x);
                const ya = fit.intercept + fit.slope * a;
                const yb = fit.intercept + fit.slope * b;
                return { x1: x(a), y1: y(ya), x2: x(b), y2: y(yb) };
              })()
            : null;
        const marks = (
          <>
            <defs>
              <clipPath id={clipId}>
                <rect
                  x={leftMargin}
                  y={24}
                  width={Math.max(0, w - 12 - leftMargin)}
                  height={height - 58}
                />
              </clipPath>
            </defs>
            {yd.ticks.map((t) => (
              <g key={`y${t}`}>
                <line
                  x1={leftMargin}
                  x2={w - 12}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--chart-grid)"
                  shapeRendering="crispEdges"
                />
                <text x={leftMargin - 6} y={y(t)} dy="0.32em" textAnchor="end" {...axisText}>
                  {fmtTick(yFormatter, logY)(t)}
                </text>
              </g>
            ))}
            {xd.ticks.map((t) => (
              <g key={`x${t}`}>
                <line
                  x1={x(t)}
                  x2={x(t)}
                  y1={24}
                  y2={height - 34}
                  stroke="var(--chart-grid)"
                  strokeOpacity={0.6}
                  shapeRendering="crispEdges"
                />
                <text x={x(t)} y={height - 20} textAnchor="middle" {...axisText}>
                  {fmtTick(xFormatter, logX)(t)}
                </text>
              </g>
            ))}
            <text
              x={(leftMargin + w - 12) / 2}
              y={height - 4}
              textAnchor="middle"
              fontSize={10.5}
              fill="var(--chart-ink)"
            >
              {`${xLabel}${logX ? " (log scale)" : ""}`}
            </text>
            <text x={leftMargin} y={12} fontSize={10.5} fill="var(--chart-ink)">
              {`${yLabel}${logY ? " (log scale)" : ""}`}
            </text>
            {fitLine ? (
              <line
                {...fitLine}
                stroke="var(--chart-ink)"
                strokeOpacity={0.55}
                strokeWidth={1.25}
                strokeDasharray="5 4"
                clipPath={`url(#${clipId})`}
              />
            ) : null}
            {sorted.map((p, i) => {
              const isSel = selected === p.id;
              return (
                <circle
                  key={p.id}
                  cx={x(tx(p.x))}
                  cy={y(ty(p.y))}
                  r={active === i || isSel ? 5.5 : 4}
                  fill={isSel ? "var(--chart-2)" : "var(--chart-1)"}
                  fillOpacity={active === null || active === i || isSel ? 0.85 : 0.55}
                  stroke="var(--chart-surface)"
                  strokeWidth={1.5}
                />
              );
            })}
            {sorted.map((p) =>
              labelled.has(p.id) ? (
                <text
                  key={`l-${p.id}`}
                  x={x(tx(p.x)) + (x(tx(p.x)) > w - 90 ? -7 : 7)}
                  y={y(ty(p.y)) - 6}
                  textAnchor={x(tx(p.x)) > w - 90 ? "end" : "start"}
                  fontSize={10}
                  fill="var(--chart-ink)"
                  stroke="var(--chart-surface)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {p.label}
                </text>
              ) : null,
            )}
            <rect
              x={0}
              y={0}
              width={w}
              height={height}
              fill="transparent"
              onPointerMove={(e) => {
                const pt = localPoint(e);
                setActive(nearest(pt.x, pt.y));
              }}
              onPointerLeave={() => setActive(null)}
              onClick={(e) => {
                const pt = localPoint(e);
                const i = nearest(pt.x, pt.y);
                if (i !== null && onSelect) onSelect(sorted[i]!.id);
              }}
              style={onSelect ? { cursor: "pointer" } : undefined}
            />
          </>
        );
        const p = active !== null ? sorted[active] : undefined;
        const residual = p && fit ? fit.residuals[active!] : undefined;
        const tooltip: TipSpec | null = p
          ? {
              x: x(tx(p.x)),
              y: y(ty(p.y)),
              content: {
                title: p.label,
                rows: [
                  { key: "x", label: xLabel, value: xFormatter.full(p.x) },
                  { key: "y", label: yLabel, value: yFormatter.full(p.y) },
                ],
                footer:
                  residual !== undefined
                    ? residual > 0
                      ? "Above the fitted line"
                      : residual < 0
                        ? "Below the fitted line"
                        : "On the fitted line"
                    : undefined,
              },
            }
          : null;
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}
