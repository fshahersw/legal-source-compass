/**
 * Distribution of one metric across entities: every entity as a dot on one axis (stacked where dots would overlap),
 * with a Tukey box (quartiles, whiskers at 1.5 × IQR) and reference markers such as the national value. Entities
 * without a value are counted, not drawn.
 */
import { useMemo, useState } from "react";
import { ChartCanvas, axisText, localPoint, type TipSpec } from "./canvas";
import type { ValueFormatter } from "./format";
import { linearScale, niceDomain } from "./scale";
import { boxStats } from "./stats";
import type { RankedItem, ReferenceLine } from "./RankedBars";

/** Vertical offsets (in dot rows) that keep dots `minGap` px apart along the axis: a simple deterministic beeswarm. */
export function stackDots(xs: readonly number[], minGap: number): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x || a.i - b.i);
  const rows: number[][] = [];
  const out = new Array<number>(xs.length).fill(0);
  for (const o of order) {
    let level = 0;
    for (;;) {
      const candidates = level === 0 ? [0] : [level, -level];
      let placed = false;
      for (const lv of candidates) {
        const key = lv + 1000;
        const row = (rows[key] ??= []);
        if (row.every((x) => Math.abs(x - o.x) >= minGap)) {
          row.push(o.x);
          out[o.i] = lv;
          placed = true;
          break;
        }
      }
      if (placed) break;
      level++;
    }
  }
  return out;
}

export function DistributionStrip({
  items,
  formatter,
  unit,
  ariaLabel,
  references = [],
  selected = null,
  height = 120,
  width,
  zero = true,
}: {
  items: readonly RankedItem[];
  formatter: ValueFormatter;
  unit?: string | undefined;
  ariaLabel: string;
  references?: readonly ReferenceLine[];
  selected?: string | null;
  height?: number;
  width?: number | undefined;
  zero?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const valued = useMemo(
    () =>
      items
        .filter(
          (i): i is RankedItem & { value: number } =>
            typeof i.value === "number" && Number.isFinite(i.value),
        )
        .sort((a, b) => a.value - b.value),
    [items],
  );
  const box = useMemo(() => boxStats(valued.map((v) => v.value)), [valued]);
  const missing = items.length - valued.length;
  const nd = niceDomain([...valued.map((v) => v.value), ...references.map((r) => r.value)], {
    zero,
    count: 5,
  });
  const describe = (i: number) => {
    const v = valued[i]!;
    return `${v.label}: ${formatter.full(v.value)}${unit ? ` ${unit}` : ""}.`;
  };
  return (
    <div className="min-w-0">
      <ChartCanvas
        width={width}
        height={height}
        ariaLabel={ariaLabel}
        count={valued.length}
        active={active}
        onActive={setActive}
        describe={describe}
      >
        {(w) => {
          const x = linearScale(nd.domain, [12, w - 12]);
          const mid = (height - 34) / 2 + 16;
          const levels = stackDots(
            valued.map((v) => x(v.value)),
            7,
          );
          const maxLevel = Math.max(1, ...levels.map(Math.abs));
          const dy = Math.min(6, (height - 50) / 2 / maxLevel);
          const marks = (
            <>
              {nd.ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={x(t)}
                    x2={x(t)}
                    y1={14}
                    y2={height - 20}
                    stroke="var(--chart-grid)"
                    shapeRendering="crispEdges"
                  />
                  <text x={x(t)} y={height - 6} textAnchor="middle" {...axisText}>
                    {formatter.tick(t)}
                  </text>
                </g>
              ))}
              {box ? (
                <g>
                  <line
                    x1={x(box.lowWhisker)}
                    x2={x(box.highWhisker)}
                    y1={mid}
                    y2={mid}
                    stroke="var(--chart-axis)"
                  />
                  <rect
                    x={x(box.q1)}
                    y={mid - 12}
                    width={Math.max(1, x(box.q3) - x(box.q1))}
                    height={24}
                    rx={3}
                    fill="var(--chart-1)"
                    fillOpacity={0.1}
                    stroke="var(--chart-1)"
                    strokeOpacity={0.5}
                  />
                  <line
                    x1={x(box.median)}
                    x2={x(box.median)}
                    y1={mid - 12}
                    y2={mid + 12}
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                  />
                </g>
              ) : null}
              {valued.map((v, i) => (
                <circle
                  key={v.id}
                  cx={x(v.value)}
                  cy={mid + levels[i]! * dy}
                  r={active === i || selected === v.id ? 4.5 : 3}
                  fill={selected === v.id ? "var(--chart-2)" : "var(--chart-1)"}
                  fillOpacity={0.8}
                  stroke="var(--chart-surface)"
                  strokeWidth={1}
                />
              ))}
              {references.map((r, ri) => (
                <g key={r.label}>
                  <line
                    x1={x(r.value)}
                    x2={x(r.value)}
                    y1={12}
                    y2={height - 20}
                    stroke="var(--chart-reference)"
                    strokeWidth={1.25}
                    strokeDasharray={ri ? "4 3" : undefined}
                  />
                  <text
                    x={x(r.value)}
                    y={9}
                    textAnchor={
                      x(r.value) > w - 100 ? "end" : x(r.value) < 100 ? "start" : "middle"
                    }
                    fontSize={10}
                    fill="var(--chart-ink)"
                  >
                    {`${r.label}: ${formatter.full(r.value)}`}
                  </text>
                </g>
              ))}
              <rect
                x={0}
                y={0}
                width={w}
                height={height}
                fill="transparent"
                onPointerMove={(e) => {
                  const p = localPoint(e);
                  let best: number | null = null;
                  let bestD = 14;
                  valued.forEach((v, i) => {
                    const d = Math.hypot(x(v.value) - p.x, mid + levels[i]! * dy - p.y);
                    if (d < bestD) {
                      bestD = d;
                      best = i;
                    }
                  });
                  setActive(best);
                }}
                onPointerLeave={() => setActive(null)}
              />
            </>
          );
          const v = active !== null ? valued[active] : undefined;
          const tooltip: TipSpec | null = v
            ? {
                x: x(v.value),
                y: mid + 8,
                content: {
                  title: v.label,
                  rows: [{ key: "v", label: unit ?? "", value: formatter.full(v.value) }],
                },
              }
            : null;
          return { marks, tooltip };
        }}
      </ChartCanvas>
      <p className="pt-1 text-[11px] leading-4 text-muted-foreground">
        {box
          ? `Median ${formatter.full(box.median)}; middle half ${formatter.full(box.q1)} to ${formatter.full(box.q3)}; n = ${box.n}.`
          : "No values recorded."}
        {missing ? ` ${missing} not recorded.` : ""}
        {box?.outliers.length
          ? ` ${box.outliers.length} beyond 1.5 × the interquartile range.`
          : ""}
      </p>
    </div>
  );
}
