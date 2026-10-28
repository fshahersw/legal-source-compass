/**
 * MDL momentum scatter: every MDL in the latest JPML report placed by size (actions pending now, log scale) and by its
 * signed net change over exactly twelve monthly reports (symmetric log scale, zero line marked). MDLs with no actions
 * pending and MDLs without a report twelve months earlier are listed under the chart, never plotted at a made-up
 * position. Dots are one size: the reports carry no verified member counts to scale them by.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChartCanvas, axisText, localPoint, type TipSpec } from "@/components/charts/canvas";
import { ChartCard } from "@/components/charts/ChartCard";
import { linearScale } from "@/components/charts/scale";
import { mdlAnalyticsQuery } from "@/components/matters/MdlAnalytics";
import { mdlName } from "@/lib/insights/generators/mdl";
import { productLabel } from "./LitigationHeadline";
import {
  log10Ticks,
  mdlMomentum,
  momentumSplit,
  symlog,
  symlogTicks,
  type MomentumPoint,
} from "./mdlMomentum";

const SOURCES = [
  {
    label: "JPML pending MDL reports",
    url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
  },
];
const int = (v: number) => v.toLocaleString("en-US");
const signed = (v: number) => (v > 0 ? `+${int(v)}` : v < 0 ? `−${int(-v)}` : "0");
const compact = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${a / 1000}K` : String(a);
  return v < 0 ? `−${s}` : v > 0 ? `+${s}` : "0";
};
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const HEIGHT = 340;
const TOP = 18;
const BOTTOM = 36;
const RIGHT = 14;

export function MomentumPlot({
  points,
  width,
  onOpen,
}: {
  points: readonly MomentumPoint[];
  width?: number;
  onOpen?: (mdl: number) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const sorted = useMemo(
    () => [...points].sort((a, b) => a.pending - b.pending || a.mdl - b.mdl),
    [points],
  );
  const maxPending = Math.max(1, ...sorted.map((p) => p.pending));
  const changes = sorted.map((p) => p.change ?? 0);
  const lo = Math.min(0, ...changes);
  const hi = Math.max(0, ...changes);
  const xTicks = log10Ticks(maxPending);
  const yTicks = symlogTicks(lo, hi);
  const yLo = symlog(Math.min(lo, yTicks[0]!)) - 0.35;
  const yHi = symlog(Math.max(hi, yTicks[yTicks.length - 1]!)) + 0.35;
  // the three largest moves either way carry a direct label
  const labelled = useMemo(() => {
    const ids = new Set<number>();
    const byMove = [...sorted].sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
    for (const p of byMove.slice(0, 3)) if ((p.change ?? 0) > 0) ids.add(p.mdl);
    for (const p of byMove.slice(-3)) if ((p.change ?? 0) < 0) ids.add(p.mdl);
    return ids;
  }, [sorted]);
  const describe = (i: number) => {
    const p = sorted[i]!;
    return `${mdlName(p.mdl, p.title)}: ${int(p.pending)} actions pending, ${signed(p.change ?? 0)} in 12 months.`;
  };
  const left = 52;

  return (
    <ChartCanvas
      width={width}
      height={HEIGHT}
      ariaLabel="MDLs by actions pending now (log scale) and change in pending actions over 12 months (symmetric log scale)."
      count={sorted.length}
      active={active}
      onActive={setActive}
      describe={describe}
    >
      {(w) => {
        const x = linearScale([0, Math.log10(xTicks[xTicks.length - 1]!)], [left, w - RIGHT]);
        const y = linearScale([yLo, yHi], [HEIGHT - BOTTOM, TOP]);
        const px = (p: MomentumPoint) => x(Math.log10(p.pending));
        const py = (p: MomentumPoint) => y(symlog(p.change ?? 0));
        const nearest = (mx: number, my: number) => {
          let best: number | null = null;
          let bestD = 18;
          sorted.forEach((p, i) => {
            const d = Math.hypot(px(p) - mx, py(p) - my);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          return best;
        };
        // direct labels, nudged apart: each label is a box; a box that overlaps one already placed moves away from
        // the zero line (up for rises, down for falls) until it is clear
        const placed: { x0: number; x1: number; y: number }[] = [];
        const labelPos = new Map<number, { x: number; y: number; anchor: "start" | "end" }>();
        const chars = w < 480 ? 10 : 16;
        for (const p of [...sorted]
          .filter((q) => labelled.has(q.mdl))
          .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))) {
          const cx = px(p);
          const up = (p.change ?? 0) >= 0;
          const anchor = cx > w - 120 ? "end" : "start";
          const text = productLabel(p, chars);
          const width = text.length * 5.9;
          const x0 = anchor === "end" ? cx - 7 - width : cx + 7;
          const x1 = x0 + width;
          let y = py(p) + (up ? -7 : 14);
          for (let guard = 0; guard < 8; guard++) {
            const hit = placed.some((b) => x0 < b.x1 && x1 > b.x0 && Math.abs(b.y - y) < 12);
            if (!hit) break;
            y += up ? -12 : 12;
          }
          y = Math.max(TOP + 10, Math.min(HEIGHT - BOTTOM - 3, y));
          placed.push({ x0, x1, y });
          labelPos.set(p.mdl, { x: anchor === "end" ? cx - 7 : cx + 7, y, anchor });
        }
        const tone = (c: number) =>
          c > 0 ? "var(--chart-2)" : c < 0 ? "var(--chart-1)" : "var(--chart-axis)";
        const marks = (
          <>
            {/* rise / fall bands */}
            <rect
              x={left}
              y={TOP}
              width={Math.max(0, w - RIGHT - left)}
              height={Math.max(0, y(0) - TOP)}
              fill="var(--chart-2)"
              fillOpacity={0.04}
            />
            <rect
              x={left}
              y={y(0)}
              width={Math.max(0, w - RIGHT - left)}
              height={Math.max(0, HEIGHT - BOTTOM - y(0))}
              fill="var(--chart-1)"
              fillOpacity={0.04}
            />
            {yTicks.map((t) => (
              <g key={`y${t}`}>
                <line
                  x1={left}
                  x2={w - RIGHT}
                  y1={y(symlog(t))}
                  y2={y(symlog(t))}
                  stroke={t === 0 ? "var(--chart-reference)" : "var(--chart-grid)"}
                  strokeWidth={t === 0 ? 1.25 : 1}
                  strokeOpacity={t === 0 ? 0.7 : 1}
                  shapeRendering="crispEdges"
                />
                <text x={left - 6} y={y(symlog(t))} dy="0.32em" textAnchor="end" {...axisText}>
                  {compact(t)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <g key={`x${t}`}>
                <line
                  x1={x(Math.log10(t))}
                  x2={x(Math.log10(t))}
                  y1={TOP}
                  y2={HEIGHT - BOTTOM}
                  stroke="var(--chart-grid)"
                  strokeOpacity={0.6}
                  shapeRendering="crispEdges"
                />
                <text x={x(Math.log10(t))} y={HEIGHT - BOTTOM + 15} textAnchor="middle" {...axisText}>
                  {t >= 1000 ? `${t / 1000}K` : t}
                </text>
              </g>
            ))}
            <text
              x={w - RIGHT - 4}
              y={y(0) - 6}
              textAnchor="end"
              fontSize={10.5}
              fill="var(--chart-axis)"
            >
              ↑ Grew
            </text>
            <text
              x={w - RIGHT - 4}
              y={y(0) + 14}
              textAnchor="end"
              fontSize={10.5}
              fill="var(--chart-axis)"
            >
              ↓ Shrank
            </text>
            <text
              x={(left + w - RIGHT) / 2}
              y={HEIGHT - 4}
              textAnchor="middle"
              fontSize={10.5}
              fill="var(--chart-ink)"
            >
              Actions pending now (log scale)
            </text>
            {sorted.map((p, i) => (
              <circle
                key={p.mdl}
                cx={px(p)}
                cy={py(p)}
                r={active === i ? 6 : 4.25}
                fill={tone(p.change ?? 0)}
                fillOpacity={active === null || active === i ? 0.82 : 0.4}
                stroke="var(--chart-surface)"
                strokeWidth={1.25}
              />
            ))}
            {sorted.map((p) => {
              const l = labelPos.get(p.mdl);
              return l ? (
                <text
                  key={`l${p.mdl}`}
                  x={l.x}
                  y={l.y}
                  textAnchor={l.anchor}
                  fontSize={10.5}
                  fill="var(--chart-ink)"
                  stroke="var(--chart-surface)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {productLabel(p, chars)}
                </text>
              ) : null;
            })}
            <rect
              x={0}
              y={0}
              width={w}
              height={HEIGHT}
              fill="transparent"
              style={onOpen ? { cursor: "pointer" } : undefined}
              onPointerMove={(e) => {
                const pt = localPoint(e);
                setActive(nearest(pt.x, pt.y));
              }}
              onPointerLeave={() => setActive(null)}
              onClick={(e) => {
                const pt = localPoint(e);
                const i = nearest(pt.x, pt.y);
                if (i !== null && onOpen) onOpen(sorted[i]!.mdl);
              }}
            />
          </>
        );
        const p = active !== null ? sorted[active] : undefined;
        const tooltip: TipSpec | null = p
          ? {
              x: px(p),
              y: py(p),
              content: {
                title: mdlName(p.mdl, p.title),
                rows: [
                  { key: "p", label: "pending now", value: int(p.pending) },
                  {
                    key: "c",
                    label: p.priorDate ? `since ${monthLabel(p.priorDate)}` : "12 months",
                    value: signed(p.change ?? 0),
                  },
                  ...(p.judge ? [{ key: "j", label: "judge", value: p.judge }] : []),
                  ...(p.district ? [{ key: "d", label: "district", value: p.district }] : []),
                  ...(p.dateTransferred
                    ? [{ key: "t", label: "transferred", value: dayLabel(p.dateTransferred) }]
                    : []),
                ],
                footer: onOpen ? "Click to open the MDL page" : undefined,
              },
            }
          : null;
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}

function SideList({ title, rows, empty }: { title: string; rows: MomentumPoint[]; empty: string }) {
  return (
    <div className="min-w-0">
      <p className="text-meta font-medium text-foreground">
        {title} <span className="text-muted-foreground">({rows.length})</span>
      </p>
      {rows.length ? (
        <ul className="mt-1 space-y-0.5 text-[12px]">
          {rows.map((r) => (
            <li key={r.mdl} className="flex min-w-0 items-baseline gap-2">
              <Link
                to="/matters/$id"
                params={{ id: String(r.mdl) }}
                className="min-w-0 truncate text-primary hover:underline"
                title={mdlName(r.mdl, r.title)}
              >
                {productLabel(r, 28)}
              </Link>
              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                {int(r.pending)} pending
                {r.change != null ? ` · ${signed(r.change)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[12px] text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function MdlMomentumScatter() {
  const q = useQuery(mdlAnalyticsQuery);
  const navigate = useNavigate();
  const data = q.data ?? null;
  const m = useMemo(
    () => (data ? mdlMomentum(data.mdls, data.overview.as_of) : null),
    [data],
  );
  const split = m ? momentumSplit(m.plotted) : null;
  const status = q.isLoading
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({
          kind: "error",
          message: "The JPML report figures could not be loaded.",
          onRetry: () => void q.refetch(),
        } as const)
      : !m
        ? ({ kind: "empty", reason: "The JPML report figures have not been published yet." } as const)
        : !m.plotted.length
          ? ({ kind: "empty", reason: "No MDL has a report exactly 12 months earlier." } as const)
          : ({ kind: "ready" } as const);
  const asOf = m ? monthLabel(m.asOf) : undefined;
  const title =
    m && split
      ? `${int(split.rose)} MDLs grew and ${int(split.fell)} shrank over 12 months; ${int(split.held)} held steady`
      : "MDL size against 12-month change";

  return (
    <ChartCard
      variant="editorial"
      title={title}
      subtitle={`Each dot is one pending MDL · actions pending now vs net change since the same month a year earlier${asOf ? ` · ${asOf} report` : ""}`}
      status={status}
      sources={SOURCES}
      period={m ? `${monthLabel(m.plotted[0]?.priorDate ?? m.asOf)} – ${asOf}` : undefined}
      asOf={asOf}
      about={
        <>
          <p>
            Change is actions pending in the latest monthly report minus the report printed in the
            same calendar month a year earlier. When that month&apos;s report is missing, no other
            month is substituted and the MDL is listed under the chart instead.
          </p>
          <p className="mt-1.5">
            Both axes are logarithmic so small and very large MDLs fit together; the vertical axis
            keeps zero at the marked line. A fall means actions were closed, remanded or transferred
            out; the report does not say which.
          </p>
        </>
      }
      table={
        m
          ? {
              caption: "MDLs in the latest report: actions pending and 12-month change",
              columns: [
                { label: "MDL" },
                { label: "Pending now" },
                { label: "Change, 12 months" },
                { label: "Compared with report" },
              ],
              rows: [...m.plotted, ...m.noExactHistory, ...m.zeroPending].map((p) => ({
                key: String(p.mdl),
                cells: [
                  mdlName(p.mdl, p.title),
                  p.pending,
                  p.change ?? "Not recorded",
                  p.priorDate ?? "Not recorded",
                ],
              })),
            }
          : undefined
      }
      minHeight={HEIGHT}
    >
      {m && m.plotted.length ? (
        <div className="space-y-3">
          <MomentumPlot
            points={m.plotted}
            onOpen={(mdl) => void navigate({ to: "/matters/$id", params: { id: String(mdl) } })}
          />
          {m.zeroPending.length || m.noExactHistory.length ? (
            <details className="group rounded-md border border-border bg-muted/30 px-3 py-2">
              <summary className="cursor-pointer select-none text-meta text-muted-foreground group-open:mb-2">
                Not plotted: {m.zeroPending.length} with no actions pending,{" "}
                {m.noExactHistory.length} without a report 12 months earlier
              </summary>
              <div className="grid gap-3 sm:grid-cols-2">
                <SideList
                  title="No actions pending"
                  rows={m.zeroPending}
                  empty="Every listed MDL has actions pending."
                />
                <SideList
                  title="No report 12 months earlier"
                  rows={m.noExactHistory}
                  empty="Every listed MDL has a report 12 months earlier."
                />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </ChartCard>
  );
}
