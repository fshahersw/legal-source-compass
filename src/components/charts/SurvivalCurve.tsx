/**
 * Kaplan–Meier curves: the share still without the event over time, as a step line with its 95% band, "+" marks where
 * a subject's observation ends without the event (censoring), a dotted 50% line and the number under observation
 * beneath the axis. A historical base rate from the records shown, never a prediction for a particular matter.
 */
import { useMemo, useState } from "react";
import { ChartCanvas, axisText, localPoint, textWidth, type TipSpec } from "./canvas";
import { seriesVar } from "./palette";
import { linearScale, niceDomain } from "./scale";
import { underObservation, type KaplanMeier, type SurvivalSubject } from "./stats";

export type SurvivalGroup = {
  id: string;
  label: string;
  km: KaplanMeier;
  subjects: readonly SurvivalSubject[];
};

/** Survival level just after time t (1 before the first event). */
export function survivalAt(
  km: KaplanMeier,
  t: number,
): { s: number; lower: number | null; upper: number | null } {
  let out: { s: number; lower: number | null; upper: number | null } = {
    s: 1,
    lower: null,
    upper: null,
  };
  for (const st of km.steps)
    if (st.time <= t) out = { s: st.survival, lower: st.lower, upper: st.upper };
  return out;
}

/** Step path through (time, survival) from t = 0 to `end`. */
export function stepPoints(km: KaplanMeier, end: number): [number, number][] {
  const pts: [number, number][] = [[0, 1]];
  let s = 1;
  for (const st of km.steps) {
    if (st.time > end) break;
    pts.push([st.time, s], [st.time, st.survival]);
    s = st.survival;
  }
  pts.push([end, s]);
  return pts;
}

export function SurvivalCurve({
  groups,
  timeUnit,
  eventLabel,
  ariaLabel,
  height = 280,
  width,
  atRiskTimes,
}: {
  groups: readonly SurvivalGroup[];
  /** "years", "months". */
  timeUnit: string;
  /** What the curve counts down to ("termination"). */
  eventLabel: string;
  ariaLabel: string;
  height?: number;
  width?: number | undefined;
  atRiskTimes?: readonly number[] | undefined;
}) {
  const [active, setActive] = useState<number | null>(null);
  const maxT = Math.max(1, ...groups.map((g) => g.km.maxTime));
  const xd = useMemo(() => niceDomain([0, maxT], { zero: true, count: 6 }), [maxT]);
  const times = atRiskTimes ?? xd.ticks;
  const tableH = 16 + groups.length * 14;
  const plotBottom = height - 24 - tableH;
  const steps = xd.ticks.length > 1 ? xd.ticks : [0, maxT];
  const describe = (i: number) => {
    const t = steps[i]!;
    return `${t} ${timeUnit}: ${groups
      .map((g) => {
        const v = survivalAt(g.km, t);
        return `${g.label} ${(v.s * 100).toFixed(0)}% without ${eventLabel}, ${underObservation(g.subjects, t)} under observation`;
      })
      .join("; ")}.`;
  };
  // room for the group names of the "under observation" rows (left-aligned), then the first centred count
  const leftMargin = Math.max(
    36,
    ...(groups.length > 1 ? groups.map((g) => textWidth(g.label, 10) + 30) : []),
  );
  return (
    <ChartCanvas
      width={width}
      height={height}
      ariaLabel={ariaLabel}
      count={steps.length}
      active={active}
      onActive={setActive}
      describe={describe}
    >
      {(w) => {
        const x = linearScale(xd.domain, [leftMargin, w - 14]);
        const y = linearScale([0, 1], [plotBottom, 10]);
        const hoverT = active !== null ? steps[active]! : null;
        const marks = (
          <>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line
                  x1={leftMargin}
                  x2={w - 14}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--chart-grid)"
                  strokeDasharray={t === 0.5 ? "2 3" : undefined}
                  shapeRendering="crispEdges"
                />
                <text x={leftMargin - 6} y={y(t)} dy="0.32em" textAnchor="end" {...axisText}>
                  {`${Math.round(t * 100)}%`}
                </text>
              </g>
            ))}
            {xd.ticks.map((t) => (
              <text key={t} x={x(t)} y={plotBottom + 14} textAnchor="middle" {...axisText}>
                {t}
              </text>
            ))}
            <text x={w - 14} y={plotBottom + 14} dy="1.2em" textAnchor="end" {...axisText}>
              {timeUnit}
            </text>
            {groups.map((g, gi) => {
              const color = seriesVar(gi);
              const end = g.km.maxTime;
              const band: string[] = [];
              const lower: string[] = [];
              let prev: { time: number; lower: number | null; upper: number | null } | null = null;
              for (const st of g.km.steps) {
                if (prev && prev.lower !== null && prev.upper !== null) {
                  band.push(`${x(prev.time)},${y(prev.upper)} ${x(st.time)},${y(prev.upper)}`);
                  lower.unshift(`${x(st.time)},${y(prev.lower)} ${x(prev.time)},${y(prev.lower)}`);
                }
                prev = st;
              }
              if (prev && prev.lower !== null && prev.upper !== null) {
                band.push(`${x(prev.time)},${y(prev.upper)} ${x(end)},${y(prev.upper)}`);
                lower.unshift(`${x(end)},${y(prev.lower)} ${x(prev.time)},${y(prev.lower)}`);
              }
              return (
                <g key={g.id}>
                  {band.length ? (
                    <polygon
                      points={[...band, ...lower].join(" ")}
                      fill={color}
                      fillOpacity={0.1}
                    />
                  ) : null}
                  <polyline
                    points={stepPoints(g.km, end)
                      .map(([t, s]) => `${x(t)},${y(s)}`)
                      .join(" ")}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  {g.km.censorMarks.map((c, ci) => (
                    <line
                      key={ci}
                      x1={x(c.time)}
                      x2={x(c.time)}
                      y1={y(c.survival) - 3.5}
                      y2={y(c.survival) + 3.5}
                      stroke={color}
                      strokeWidth={1}
                      strokeOpacity={0.8}
                    />
                  ))}
                </g>
              );
            })}
            {hoverT !== null ? (
              <line
                x1={x(hoverT)}
                x2={x(hoverT)}
                y1={10}
                y2={plotBottom}
                stroke="var(--border-strong)"
              />
            ) : null}
            {/* number under observation */}
            <text x={4} y={plotBottom + 34} fontSize={10} fontWeight={600} fill="var(--chart-ink)">
              Under observation
            </text>
            {groups.map((g, gi) => (
              <g key={`risk-${g.id}`}>
                <text
                  x={4}
                  y={plotBottom + 48 + gi * 14}
                  fontSize={10}
                  fill="var(--chart-axis)"
                >
                  {groups.length > 1 ? g.label : ""}
                </text>
                {times.map((t) =>
                  t <= xd.domain[1] ? (
                    <text
                      key={t}
                      x={x(t)}
                      y={plotBottom + 48 + gi * 14}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--chart-ink)"
                      className="tabular-nums"
                    >
                      {underObservation(g.subjects, t)}
                    </text>
                  ) : null,
                )}
              </g>
            ))}
            <rect
              x={leftMargin}
              y={0}
              width={Math.max(0, w - 14 - leftMargin)}
              height={plotBottom}
              fill="transparent"
              onPointerMove={(e) => {
                const p = localPoint(e);
                const t = x.invert(p.x);
                let best = 0;
                steps.forEach((s, i) => {
                  if (Math.abs(s - t) < Math.abs(steps[best]! - t)) best = i;
                });
                setActive(best);
              }}
              onPointerLeave={() => setActive(null)}
            />
          </>
        );
        const tooltip: TipSpec | null =
          hoverT !== null
            ? {
                x: x(hoverT),
                y: 14,
                content: {
                  title: `${hoverT} ${timeUnit}`,
                  rows: groups.map((g, gi) => {
                    const v = survivalAt(g.km, hoverT);
                    const ci =
                      v.lower !== null && v.upper !== null
                        ? ` (95% CI ${(v.lower * 100).toFixed(0)}–${(v.upper * 100).toFixed(0)}%)`
                        : "";
                    return {
                      key: g.id,
                      label: `${g.label}${ci}`,
                      value: `${(v.s * 100).toFixed(0)}%`,
                      color: groups.length > 1 ? seriesVar(gi) : undefined,
                    };
                  }),
                  footer: `Share without ${eventLabel} by this time`,
                },
              }
            : null;
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}
