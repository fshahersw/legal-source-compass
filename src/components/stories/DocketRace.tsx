/**
 * The MDL docket race: the twelve largest MDLs by pending actions in each captured JPML "Pending MDL Dockets" report,
 * played as motion from the first report to the latest. Between two reports the bars glide (values and positions are
 * blended for drawing only); paused on a report, every bar, figure and rank is that report's own. Colour is the
 * litigation type. Hover a bar for its MDL; click opens the MDL.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scaleLinear } from "d3-scale";
import { ChartCanvas, axisText, type TipSpec } from "@/components/charts/canvas";
import { CATEGORY_COLOR, reportLabel } from "./storiesColors";
import { CATEGORY_LABEL, rankAt, shortTitle, type Docket } from "./storiesModel";

const TOP = 12;
const n = (v: number) => Math.round(v).toLocaleString("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function DocketRace({
  docket,
  t,
  height = 560,
}: {
  docket: Docket;
  t: number;
  height?: number;
}) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<number | null>(null);
  const last = docket.dates.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(t)));
  const j = Math.min(last, i + 1);
  const f = Math.max(0, Math.min(1, t - i));
  const near = Math.round(t);
  // rank by the drawn values themselves, so the order always matches the bar lengths; a bar that changes rank slides
  // to its new row (CSS transition), and the thirteenth row is drawn invisible so entering bars rise into view
  const ranked = rankAt(docket.mdls, t, TOP + 1);
  const bars = ranked.map((r, k) => ({ m: r.m, pos: k, v: r.v }));
  const maxV = Math.max(1, ranked[0]?.v ?? 1);
  const total = (docket.totals[i] ?? 0) * (1 - f) + (docket.totals[j] ?? 0) * f;
  const listed = docket.listed[near] ?? 0;
  const date = docket.dates[near] ?? "";
  return (
    <ChartCanvas
      height={height}
      ariaLabel={`The twelve largest MDLs by pending actions in the JPML report of ${reportLabel(date)}: ${bars
        .slice(0, 3)
        .map((b) => `${shortTitle(b.m.title)} ${n(b.m.values[near] ?? 0)}`)
        .join(", ")}.`}
      count={0}
      active={null}
      onActive={() => undefined}
      describe={() => ""}
    >
      {(w) => {
        const left = Math.min(250, Math.max(130, w * 0.24));
        const right = 70;
        const top = 34;
        const band = (height - top - 18) / TOP;
        const bh = band * 0.78;
        const x = scaleLinear()
          .domain([0, maxV * 1.04])
          .range([left, w - right]);
        const ticks = x.ticks(w < 600 ? 3 : 6).filter((v) => v > 0);
        const hb = bars.find((b) => b.m.mdl === hover);
        const tooltip: TipSpec | null = hb
          ? {
              x: x(hb.v),
              y: top + hb.pos * band,
              content: {
                title: `MDL ${hb.m.mdl}`,
                subtitle: shortTitle(hb.m.title),
                rows: [
                  {
                    key: "p",
                    label: `Pending, ${reportLabel(date)}`,
                    value: n(hb.m.values[near] ?? 0),
                  },
                  { key: "k", label: "Peak in these reports", value: n(hb.m.peak) },
                  { key: "c", label: "Type", value: CATEGORY_LABEL[hb.m.category] },
                  ...(hb.m.district
                    ? [{ key: "d", label: "Transferee district", value: hb.m.district }]
                    : []),
                ],
                footer: "Click to open the MDL",
              },
            }
          : null;
        const marks = (
          <g>
            {/* the report date, large, behind the bars */}
            <text
              x={w - 4}
              y={height - 26}
              textAnchor="end"
              fontSize={Math.min(96, w * 0.11)}
              fontWeight={800}
              fill="var(--chart-ink)"
              opacity={0.07}
              className="tabular-nums"
            >
              {date.slice(0, 4)}
            </text>
            <text x={w - 4} y={height - 10} textAnchor="end" {...axisText} fontWeight={600}>
              {w < 600
                ? `${n(total)} pending · ${listed} MDLs`
                : `JPML report of ${reportLabel(date)} · ${n(total)} actions pending in ${listed} MDLs`}
            </text>
            {ticks.map((v) => (
              <g key={v} style={{ transition: "opacity 300ms" }}>
                <line
                  x1={x(v)}
                  x2={x(v)}
                  y1={top - 8}
                  y2={height - 26}
                  stroke="var(--chart-gridline)"
                />
                <text x={x(v)} y={top - 14} textAnchor="middle" {...axisText}>
                  {compact.format(v)}
                </text>
              </g>
            ))}
            {bars.map((b) => {
              const y = top + b.pos * band;
              const wBar = Math.max(2, x(b.v) - left);
              const fade = b.pos >= TOP ? 0 : 1;
              const name = shortTitle(b.m.title);
              const on = hover === b.m.mdl;
              return (
                <g
                  key={b.m.mdl}
                  opacity={fade}
                  style={{ transform: `translateY(${y}px)` }}
                  className="cursor-pointer motion-safe:transition-[transform,opacity] motion-safe:duration-300 motion-safe:ease-out"
                  onPointerEnter={() => setHover(b.m.mdl)}
                  onPointerLeave={() => setHover((h) => (h === b.m.mdl ? null : h))}
                  onClick={() =>
                    void navigate({ to: "/matters/lens/$mdl", params: { mdl: String(b.m.mdl) } })
                  }
                >
                  <rect
                    x={left}
                    y={0}
                    width={wBar}
                    height={bh}
                    rx={4}
                    fill={CATEGORY_COLOR[b.m.category]}
                    opacity={hover !== null && !on ? 0.45 : 0.92}
                  />
                  <text
                    x={left - 8}
                    y={bh / 2 + 4}
                    textAnchor="end"
                    fontSize={12}
                    fontWeight={on ? 700 : 600}
                    fill="var(--chart-ink)"
                  >
                    {name.length > Math.floor(left / 7.2)
                      ? `${name.slice(0, Math.floor(left / 7.2) - 1)}…`
                      : name}
                  </text>
                  <text
                    x={left + wBar + 6}
                    y={bh / 2 + 4}
                    fontSize={12}
                    fontWeight={700}
                    fill="var(--chart-ink)"
                    className="tabular-nums"
                  >
                    {n(b.v)}
                  </text>
                  {wBar > 64 ? (
                    <text
                      x={left + 8}
                      y={bh / 2 + 4}
                      fontSize={10.5}
                      fontWeight={600}
                      fill="var(--chart-surface)"
                      opacity={0.9}
                    >
                      MDL {b.m.mdl}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        );
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}

/** The report total over time with a draggable playhead: click or drag anywhere to jump to a report. */
export function DocketTimeline({
  docket,
  t,
  onScrub,
  height = 92,
}: {
  docket: Docket;
  t: number;
  onScrub: (t: number) => void;
  height?: number;
}) {
  const [drag, setDrag] = useState(false);
  const times = docket.dates.map((d) => Date.parse(`${d}T00:00:00Z`));
  return (
    <ChartCanvas
      height={height}
      ariaLabel="Actions pending in all MDLs, by JPML report, with the playhead."
      count={0}
      active={null}
      onActive={() => undefined}
      describe={() => ""}
    >
      {(w) => {
        const x = scaleLinear()
          .domain([times[0] ?? 0, times.at(-1) ?? 1])
          .range([8, w - 8]);
        const max = Math.max(1, ...docket.totals);
        const y = scaleLinear()
          .domain([0, max])
          .range([height - 18, 6]);
        const path = docket.totals
          .map((v, k) => `${k ? "L" : "M"}${x(times[k]!).toFixed(1)},${y(v).toFixed(1)}`)
          .join("");
        const area = `${path}L${x(times.at(-1)!).toFixed(1)},${height - 18}L${x(times[0]!).toFixed(1)},${height - 18}Z`;
        const k = Math.max(0, Math.min(times.length - 1, Math.floor(t)));
        const k2 = Math.min(times.length - 1, k + 1);
        const tt = times[k]! + (times[k2]! - times[k]!) * (t - k);
        const toFrame = (px: number) => {
          const time = x.invert(px);
          // fractional frame from the irregular report dates
          let a = 0;
          while (a < times.length - 2 && times[a + 1]! < time) a++;
          const span = times[a + 1]! - times[a]!;
          return Math.max(
            0,
            Math.min(times.length - 1, a + (span > 0 ? (time - times[a]!) / span : 0)),
          );
        };
        const years: number[] = [];
        for (
          let yv = new Date(times[0]!).getUTCFullYear() + 1;
          yv <= new Date(times.at(-1)!).getUTCFullYear();
          yv++
        )
          years.push(yv);
        const marks = (
          <g>
            <path d={area} fill="var(--chart-1)" opacity={0.12} />
            <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth={1.6} />
            {docket.dates.map((_, idx) => (
              <circle
                key={idx}
                cx={x(times[idx]!)}
                cy={height - 12}
                r={1.4}
                fill="var(--chart-axis)"
                opacity={0.5}
              />
            ))}
            {years.map((yv) =>
              w < 560 && yv % 2 ? null : (
                <text
                  key={yv}
                  x={x(Date.UTC(yv, 0, 1))}
                  y={height - 1}
                  textAnchor="middle"
                  {...axisText}
                >
                  {yv}
                </text>
              ),
            )}
            <line
              x1={x(tt)}
              x2={x(tt)}
              y1={2}
              y2={height - 16}
              stroke="var(--chart-ink)"
              strokeWidth={2}
            />
            <circle
              cx={x(tt)}
              cy={y((docket.totals[k] ?? 0) * (1 - (t - k)) + (docket.totals[k2] ?? 0) * (t - k))}
              r={5}
              fill="var(--chart-1)"
              stroke="var(--chart-surface)"
              strokeWidth={2}
            />
            <rect
              x={0}
              y={0}
              width={w}
              height={height}
              fill="transparent"
              className="cursor-ew-resize"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => {
                (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
                setDrag(true);
                const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
                onScrub(toFrame(e.clientX - r.left));
              }}
              onPointerMove={(e) => {
                if (!drag) return;
                const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
                onScrub(toFrame(e.clientX - r.left));
              }}
              onPointerUp={() => setDrag(false)}
            />
          </g>
        );
        return { marks, tooltip: null };
      }}
    </ChartCanvas>
  );
}
