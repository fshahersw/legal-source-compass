/**
 * The shape of the docket: actions pending in every MDL across the captured JPML reports as a streamgraph (d3-shape
 * stack, wiggle offset, inside-out order), the twelve largest MDLs as their own layers and every other MDL folded into
 * one, so the layers always sum to each report's total. Hover a layer to isolate it and read every layer at that
 * report; the playhead follows the race above.
 */
import { useMemo, useState } from "react";
import { scaleLinear, scaleUtc } from "d3-scale";
import { area, curveMonotoneX, stack, stackOffsetWiggle, stackOrderInsideOut } from "d3-shape";
import { ChartCanvas, axisText, localPoint, type TipSpec } from "@/components/charts/canvas";
import { CATEGORY_COLOR, reportLabel } from "./storiesColors";
import { shortTitle, streamLayers, type Docket } from "./storiesModel";

const n = (v: number) => Math.round(v).toLocaleString("en-US");

export function DocketStream({
  docket,
  t,
  height = 380,
}: {
  docket: Docket;
  t: number;
  height?: number;
}) {
  const [hover, setHover] = useState<{ key: string | null; i: number } | null>(null);
  const { named, keys, rows } = useMemo(() => streamLayers(docket, 12), [docket]);
  const series = useMemo(
    () =>
      stack<Record<string, number>>()
        .keys(keys)
        .offset(stackOffsetWiggle)
        .order(stackOrderInsideOut)(rows as Record<string, number>[]),
    [keys, rows],
  );
  const lo = Math.min(...series.flatMap((s) => s.map((p) => p[0])));
  const hi = Math.max(...series.flatMap((s) => s.map((p) => p[1])));
  const nameOf = (key: string) =>
    key === "other"
      ? "All other MDLs"
      : shortTitle(named.find((m) => `m${m.mdl}` === key)?.title ?? key);
  const colorOf = (key: string) => {
    if (key === "other") return "var(--chart-base)";
    const m = named.find((x) => `m${x.mdl}` === key);
    return m ? CATEGORY_COLOR[m.category] : "var(--chart-base)";
  };
  return (
    <ChartCanvas
      height={height}
      ariaLabel="Actions pending in every MDL by JPML report, the twelve largest MDLs as their own layers."
      count={rows.length}
      active={hover && hover.key === null ? hover.i : null}
      onActive={(i) => setHover(i === null ? null : { key: null, i })}
      describe={(i) => {
        const r = rows[i];
        if (!r) return "";
        const top = keys
          .filter((k) => k !== "other")
          .map((k) => ({ k, v: r[k] ?? 0 }))
          .sort((a, b) => b.v - a.v)
          .slice(0, 3);
        return `${reportLabel(docket.dates[i] ?? "")}: ${n(docket.totals[i] ?? 0)} actions pending. Largest: ${top
          .map((x) => `${nameOf(x.k)} ${n(x.v)}`)
          .join(", ")}.`;
      }}
    >
      {(w) => {
        const x = scaleUtc()
          .domain([new Date(rows[0]!.date), new Date(rows.at(-1)!.date)])
          .range([10, w - 10]);
        const y = scaleLinear()
          .domain([lo, hi])
          .range([height - 26, 8]);
        const gen = area<[number, number] & { data: Record<string, number> }>()
          .x((p) => x(new Date(p.data["date"]!)))
          .y0((p) => y(p[0]))
          .y1((p) => y(p[1]))
          .curve(curveMonotoneX);
        const row = hover ? rows[hover.i] : undefined;
        const k = Math.max(0, Math.min(rows.length - 1, Math.floor(t)));
        const k2 = Math.min(rows.length - 1, k + 1);
        const playX =
          x(new Date(rows[k]!.date)) +
          (x(new Date(rows[k2]!.date)) - x(new Date(rows[k]!.date))) * (t - k);
        const tooltip: TipSpec | null =
          hover && row
            ? {
                x: x(new Date(row.date)),
                y: 20,
                content: {
                  title: reportLabel(docket.dates[hover.i] ?? ""),
                  subtitle: `${n(docket.totals[hover.i] ?? 0)} actions pending`,
                  rows: [...keys]
                    .map((key) => ({ key, v: row[key] ?? 0 }))
                    .filter((r) => r.v > 0)
                    .sort((a, b) => b.v - a.v)
                    .slice(0, 7)
                    .map((r) => ({
                      key: r.key,
                      label: nameOf(r.key),
                      value: n(r.v),
                      color: colorOf(r.key),
                    })),
                },
              }
            : null;
        const years: number[] = [];
        for (
          let yv = new Date(rows[0]!.date).getUTCFullYear() + 1;
          yv <= new Date(rows.at(-1)!.date).getUTCFullYear();
          yv++
        )
          years.push(yv);
        // label the widest layers where they are widest
        const labels = series
          .map((s, si) => {
            let best = 0;
            let bi = 0;
            s.forEach((p, pi) => {
              if (p[1] - p[0] > best) {
                best = p[1] - p[0];
                bi = pi;
              }
            });
            const p = s[bi]!;
            return {
              key: s.key,
              x: x(new Date(rows[bi]!.date)),
              y: y((p[0] + p[1]) / 2),
              h: y(p[0]) - y(p[1]),
              si,
            };
          })
          .filter((l) => l.h > 20);
        const marks = (
          <g>
            {years.map((yv) =>
              w < 560 && yv % 2 ? null : (
                <g key={yv}>
                  <line
                    x1={x(new Date(Date.UTC(yv, 0, 1)))}
                    x2={x(new Date(Date.UTC(yv, 0, 1)))}
                    y1={6}
                    y2={height - 24}
                    stroke="var(--chart-gridline)"
                  />
                  <text
                    x={x(new Date(Date.UTC(yv, 0, 1)))}
                    y={height - 8}
                    textAnchor="middle"
                    {...axisText}
                  >
                    {yv}
                  </text>
                </g>
              ),
            )}
            {series.map((s, si) => {
              const on = hover?.key === s.key;
              const dim = hover?.key && !on;
              return (
                <path
                  key={s.key}
                  d={gen(s as never) ?? ""}
                  fill={colorOf(s.key)}
                  fillOpacity={dim ? 0.18 : s.key === "other" ? 0.55 : 0.55 + (si % 3) * 0.13}
                  stroke="var(--chart-surface)"
                  strokeWidth={0.8}
                  style={{ transition: "fill-opacity 180ms" }}
                  onPointerMove={(e) => {
                    const { x: px } = localPoint(e);
                    const time = x.invert(px).getTime();
                    let best = 0;
                    rows.forEach((r, ri) => {
                      if (Math.abs(r.date - time) < Math.abs(rows[best]!.date - time)) best = ri;
                    });
                    setHover({ key: s.key, i: best });
                  }}
                  onPointerLeave={() => setHover(null)}
                />
              );
            })}
            {labels.map((l) => (
              <text
                key={l.key}
                x={Math.min(w - 80, Math.max(80, l.x))}
                y={l.y + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="var(--chart-ink)"
                stroke="var(--chart-surface)"
                strokeWidth={3}
                paintOrder="stroke"
                pointerEvents="none"
                opacity={hover?.key && hover.key !== l.key ? 0.3 : 1}
              >
                {nameOf(l.key).length > 28 ? `${nameOf(l.key).slice(0, 27)}…` : nameOf(l.key)}
              </text>
            ))}
            <line
              x1={playX}
              x2={playX}
              y1={4}
              y2={height - 24}
              stroke="var(--chart-ink)"
              strokeWidth={1.5}
              opacity={0.7}
            />
            {hover ? (
              <line
                x1={x(new Date(rows[hover.i]!.date))}
                x2={x(new Date(rows[hover.i]!.date))}
                y1={4}
                y2={height - 24}
                stroke="var(--chart-ink)"
                strokeDasharray="3 3"
                opacity={0.45}
                pointerEvents="none"
              />
            ) : null}
          </g>
        );
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}
