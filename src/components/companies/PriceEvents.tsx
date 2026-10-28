/**
 * Share price and litigation events on a company page (the Courtline "share price and litigation events" form):
 *   PriceEvents     daily closes of the listed stock with a faint area, a hover crosshair, event markers above the line
 *                   (MDL centralized and closed from the JPML records of the company's MDL links; SEC, FTC and DOJ
 *                   actions linked to the company by CIK) and a lower strip of the whole history where a drag sets the
 *                   window shown; presets for 6M to 10Y.
 *   EventReactions  close-to-close moves around each event: the close before the event date against the first and
 *                   the fifth close on or after it. Measured, never attributed to the event.
 * Prices come from company_price_history (split-adjusted closes; the row links the exchange quote page).
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChartFrame, type ChartSource, type TableSpec } from "@/components/charts";
import {
  ChartCanvas,
  localPoint,
  textWidth,
  type TipSpec,
  type TooltipContent,
} from "@/components/charts/canvas";
import { niceDomain, linearScale } from "@/components/charts/scale";
import { ChartLegend } from "@/components/charts/ChartFrame";
import { queryStatus } from "@/components/console/ConsoleGrid";
import { companyEnforcementQuery } from "@/components/enforcement/actions/actionsView";
import { cn } from "@/lib/utils";
import { companyPricesQuery } from "./companyQueries";
import {
  EVENT_KIND_LABEL,
  PRESETS,
  eventsInRange,
  firstOnOrAfter,
  moneyText,
  presetWindow,
  reaction,
  shiftDate,
  signedPct,
  windowChange,
  windowPoints,
  type EventKind,
  type PriceEvent,
  type PricePoint,
  type PriceSeries,
} from "./companyPrices";

const JPML: ChartSource = {
  label: "JPML pending MDL reports (MDL dates)",
  url: "https://www.jpml.uscourts.gov/pending-mdls-0",
};

/** Marker colour per event kind: identity only (categorical slots 2-6), never good or bad. */
const KIND_COLOR: Record<EventKind, string> = {
  mdl_centralized: "var(--chart-2)",
  mdl_closed: "var(--chart-3)",
  sec: "var(--chart-4)",
  ftc: "var(--chart-5)",
  doj: "var(--chart-6)",
};

const dateLong = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Month, quarter or year ticks for a span, as dates and their labels. */
function timeTicks(from: string, to: string, width: number): { date: string; label: string }[] {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  const room = Math.max(2, Math.floor(width / 78));
  const steps = [1, 2, 3, 6, 12, 24, 36, 60];
  const step = steps.find((s) => months / s <= room) ?? 60;
  const out: { date: string; label: string }[] = [];
  const cur = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1));
  if (step >= 12) cur.setUTCMonth(0);
  if (step >= 12 && cur < a) cur.setUTCFullYear(cur.getUTCFullYear() + 1);
  while (cur <= b) {
    const m = cur.getUTCMonth();
    if (m % Math.min(step, 12) === 0 && (step < 12 || cur.getUTCFullYear() % (step / 12) === 0)) {
      const date = cur.toISOString().slice(0, 10);
      const label =
        step >= 12
          ? String(cur.getUTCFullYear())
          : m === 0
            ? String(cur.getUTCFullYear())
            : cur.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
      if (date >= from) out.push({ date, label });
    }
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

/** Enforcement actions linked to the company by CIK, as dated events. */
function useEnforcementEvents(cik: string): PriceEvent[] {
  const q = useQuery(companyEnforcementQuery(cik));
  return useMemo(() => {
    const d = q.data;
    if (!d) return [];
    const iso = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    return [
      ...d.sec.flatMap((a) => {
        const date = iso(a.date);
        return date
          ? [
              {
                id: `sec-${a.id}`,
                date,
                kind: "sec" as const,
                label: `SEC ${a.type.toLowerCase()} ${a.releaseNumber}: ${a.respondents}`.slice(
                  0,
                  160,
                ),
                url: a.url,
              },
            ]
          : [];
      }),
      ...d.ftcActions.flatMap((a) => {
        const date = iso(a.date);
        return date
          ? [
              {
                id: `ftc-${a.id}`,
                date,
                kind: "ftc" as const,
                label: `FTC ${(a.actionType ?? "action").toLowerCase()}: ${a.name}`.slice(0, 160),
                url: a.page,
              },
            ]
          : [];
      }),
      ...d.doj.flatMap((r) => {
        const date = iso(r.date);
        return date
          ? [
              {
                id: `doj-${r.id}`,
                date,
                kind: "doj" as const,
                label: `DOJ: ${r.title}`.slice(0, 160),
                url: r.url,
              },
            ]
          : [];
      }),
    ];
  }, [q.data]);
}

function usePriceData(cik: string) {
  const q = useQuery(companyPricesQuery(cik));
  const enforcement = useEnforcementEvents(cik);
  const series = q.data?.series ?? null;
  const events = useMemo(
    () =>
      series
        ? eventsInRange([...(q.data?.mdlEvents ?? []), ...enforcement], series.first, series.last)
        : [],
    [series, q.data?.mdlEvents, enforcement],
  );
  return { q, series, events };
}

type Win = { from: string; to: string; preset: string | null };

export function PriceEvents({ cik, company }: { cik: string; company: string }) {
  const { q, series, events } = usePriceData(cik);
  const [win, setWin] = useState<Win | null>(null);
  const status = queryStatus(
    q,
    !!series,
    "No daily price history is stored for this company yet (no listed ticker, or the next scheduled read has not run).",
  );
  const current: Win | null = series
    ? (win ?? { ...rangeOf(presetWindow(series, PRESETS[1]!)), preset: "1y" })
    : null;
  const visible = series && current ? windowPoints(series.points, current.from, current.to) : [];
  const change = windowChange(visible);
  const last = series?.points[series.points.length - 1] ?? null;
  const year = series && last ? windowPoints(series.points, shiftDate(last[0], -365), last[0]) : [];
  const hi = year.reduce<PricePoint | null>((m, p) => (!m || p[1] > m[1] ? p : m), null);
  const lo = year.reduce<PricePoint | null>((m, p) => (!m || p[1] < m[1] ? p : m), null);
  const cur = series?.currency ?? "USD";
  const span = current?.preset ? PRESET_PHRASE[current.preset] : "the window shown";
  const title =
    series && last
      ? `${series.ticker} closed at ${moneyText(last[1], cur)} on ${dateLong(last[0])}${
          change !== null ? `, ${signedPct(change)} over ${span}` : ""
        }`
      : `Share price of ${company}`;
  const kinds = [...new Set(events.map((e) => e.kind))];
  const table: TableSpec | undefined = series
    ? {
        caption: `${series.ticker} daily closes, ${current ? `${current.from} to ${current.to}` : ""} (split-adjusted)`,
        columns: [{ label: "Date", align: "left" }, { label: `Close (${cur})` }],
        rows: [...visible].reverse().map((p) => ({ key: p[0], cells: [p[0], p[1]] })),
      }
    : undefined;
  return (
    <ChartFrame
      title={title}
      subtitle={
        series
          ? `Daily close, ${cur}, adjusted for splits · ${series.ticker} on ${series.exchange} · events above the line`
          : "Daily close · events above the line"
      }
      sources={[JPML]}
      status={status}
      table={table}
      kpis={
        series && last
          ? [
              { label: "Latest close", value: moneyText(last[1], cur), detail: dateLong(last[0]) },
              {
                label: "Window change",
                value: change === null ? "Not recorded" : signedPct(change),
                detail: current
                  ? `${dateLong(visible[0]?.[0] ?? current.from)} to ${dateLong(current.to)}`
                  : undefined,
              },
              {
                label: "52-week range",
                value:
                  lo && hi ? `${moneyText(lo[1], cur)} – ${moneyText(hi[1], cur)}` : "Not recorded",
                detail: lo && hi ? `low ${dateLong(lo[0])} · high ${dateLong(hi[0])}` : undefined,
              },
              {
                label: "Events in history",
                value: String(events.length),
                detail: kinds.map((k) => EVENT_KIND_LABEL[k]).join(" · ") || "None linked",
              },
            ]
          : undefined
      }
      notes={[
        "Each point is a finished daily close of the listed common stock, adjusted for stock splits; dividends are not added back.",
        "Markers sit at the first close on or after the event date. MDL dates are the JPML transfer order and, for closed MDLs, the closing date; a hollow marker is an MDL whose link names the company only by the MDL's subject.",
        "SEC, FTC and DOJ markers are actions the corpus links to this company by its SEC CIK.",
        "Drag across the lower strip to choose the window, or use the presets.",
        ...(series
          ? [`Any close can be checked on the ${series.exchange} quote page: ${series.listingUrl}`]
          : []),
      ]}
      footnotes={
        series?.splits.length
          ? [
              `Stock splits in the period: ${series.splits.map((s) => `${s.ratio} on ${s.date}`).join("; ")}.`,
            ]
          : undefined
      }
      asOf={last ? `Close of ${dateLong(last[0])}` : undefined}
      actions={
        series ? (
          <div
            role="group"
            aria-label="Window"
            className="flex items-center gap-0.5 rounded-md bg-muted p-0.5"
          >
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={current?.preset === p.id}
                onClick={() => setWin({ ...rangeOf(presetWindow(series, p)), preset: p.id })}
                className={cn(
                  "rounded px-2 py-0.5 text-[11.5px] font-medium tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  current?.preset === p.id && "bg-card text-foreground shadow-xs",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null
      }
      minHeight={340}
    >
      {series && current ? (
        <>
          {kinds.length ? (
            <ChartLegend
              mark="swatch"
              items={[
                { id: "price", label: `${series.ticker} close`, color: "var(--chart-1)" },
                ...kinds.map((k) => ({ id: k, label: EVENT_KIND_LABEL[k], color: KIND_COLOR[k] })),
              ]}
            />
          ) : null}
          <PricePlot
            series={series}
            visible={visible}
            events={events}
            win={current}
            onWindow={(from, to) => setWin({ from, to, preset: null })}
          />
        </>
      ) : null}
    </ChartFrame>
  );
}

const PRESET_PHRASE: Record<string, string> = {
  "6m": "the last 6 months",
  "1y": "the last year",
  "3y": "the last 3 years",
  "5y": "the last 5 years",
  max: "the last 10 years",
};

const rangeOf = ([from, to]: [string, string]) => ({ from, to });

const MAIN_H = 236;
const STRIP_H = 40;
const GAP = 30;
const TOP = 30;
const HEIGHT = TOP + MAIN_H + GAP + STRIP_H + 20;

function PricePlot({
  series,
  visible,
  events,
  win,
  onWindow,
}: {
  series: PriceSeries;
  visible: PricePoint[];
  events: PriceEvent[];
  win: Win;
  onWindow: (from: string, to: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [hoverEvent, setHoverEvent] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const cur = series.currency;
  const { domain, ticks } = useMemo(
    () =>
      niceDomain(
        visible.map((p) => p[1]),
        { zero: false, count: 4 },
      ),
    [visible],
  );
  const fmtTick = (v: number) =>
    cur === "USD"
      ? `$${v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(v < 10 ? 1 : 0)}`
      : String(v);
  const left = Math.max(36, ...ticks.map((t) => textWidth(fmtTick(t)) + 12));
  const shownEvents = events.filter((e) => e.date >= win.from && e.date <= win.to);
  const eventIndex = (e: PriceEvent) =>
    Math.min(visible.length - 1, firstOnOrAfter(visible, e.date));
  const describe = (i: number) => {
    const p = visible[i]!;
    return `${dateLong(p[0])}: close ${moneyText(p[1], cur)}.`;
  };
  return (
    <ChartCanvas
      height={HEIGHT}
      ariaLabel={`${series.ticker} daily closing price with litigation and enforcement events.`}
      count={visible.length}
      active={active}
      onActive={setActive}
      describe={describe}
    >
      {(w) => {
        const right = w - 12;
        const x = linearScale([ms(win.from), ms(win.to)], [left, right]);
        const y = linearScale(domain, [TOP + MAIN_H, TOP]);
        const x0 = linearScale([ms(series.first), ms(series.last)], [left, right]);
        const all = series.points;
        const sMax = Math.max(...all.map((p) => p[1]));
        const ys = linearScale(
          [0, sMax * 1.05],
          [TOP + MAIN_H + GAP + STRIP_H, TOP + MAIN_H + GAP + 4],
        );
        const line = visible
          .map((p) => `${x(ms(p[0])).toFixed(1)},${y(p[1]).toFixed(1)}`)
          .join(" ");
        const area = visible.length
          ? `M${x(ms(visible[0]![0])).toFixed(1)},${TOP + MAIN_H} L${line.replace(/ /g, " L")} L${x(ms(visible[visible.length - 1]![0])).toFixed(1)},${TOP + MAIN_H} Z`
          : "";
        const stripLine = all
          .map((p) => `${x0(ms(p[0])).toFixed(1)},${ys(p[1]).toFixed(1)}`)
          .join(" ");
        const selA = drag ? Math.min(drag.a, drag.b) : x0(ms(win.from));
        const selB = drag ? Math.max(drag.a, drag.b) : x0(ms(win.to));
        const tickList = timeTicks(win.from, win.to, right - left);
        const stripTicks = timeTicks(series.first, series.last, right - left);
        const gid = `pxg-${series.id.replace(/[^a-z0-9]/gi, "")}`;
        const toDate = (px: number) =>
          new Date(x0.invert(Math.max(left, Math.min(right, px)))).toISOString().slice(0, 10);
        const onDown = (e: ReactPointerEvent<SVGRectElement>) => {
          const p = localPoint(e);
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          setDrag({ a: p.x, b: p.x });
        };
        const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
          if (!drag) return;
          const p = localPoint(e);
          setDrag({ a: drag.a, b: p.x });
        };
        const onUp = () => {
          if (!drag) return;
          const a = Math.min(drag.a, drag.b);
          const b = Math.max(drag.a, drag.b);
          setDrag(null);
          if (b - a < 6) {
            // a click centres the current window's length on the clicked date
            const span = ms(win.to) - ms(win.from);
            const mid = x0.invert(a);
            let from = mid - span / 2;
            let to = mid + span / 2;
            if (from < ms(series.first)) {
              to += ms(series.first) - from;
              from = ms(series.first);
            }
            if (to > ms(series.last)) {
              from -= to - ms(series.last);
              to = ms(series.last);
            }
            onWindow(
              new Date(Math.max(from, ms(series.first))).toISOString().slice(0, 10),
              new Date(to).toISOString().slice(0, 10),
            );
            return;
          }
          const from = toDate(a);
          const to = toDate(b);
          if (windowPoints(series.points, from, to).length >= 5) onWindow(from, to);
        };
        const hoverEv = shownEvents.find((e) => e.id === hoverEvent) ?? null;
        let tooltip: TipSpec | null = null;
        if (hoverEv) {
          const i = eventIndex(hoverEv);
          const p = visible[i];
          const r = reaction(series.points, hoverEv.date);
          tooltip = p
            ? {
                x: x(ms(p[0])),
                y: Math.max(0, y(p[1]) - 60),
                content: eventTip(hoverEv, r, cur),
              }
            : null;
        } else if (active !== null && visible[active]) {
          const p = visible[active]!;
          const base = visible[0]!;
          const prev = active > 0 ? visible[active - 1]! : null;
          const dayEvents = shownEvents.filter(
            (e) => e.date <= p[0] && (!prev || e.date > prev[0]),
          );
          tooltip = {
            x: x(ms(p[0])),
            y: TOP,
            content: {
              title: `${series.ticker} · ${dateLong(p[0])}`,
              rows: [
                { key: "close", label: "Close", value: moneyText(p[1], cur) },
                {
                  key: "since",
                  label: `Since ${dateLong(base[0])}`,
                  value: signedPct(p[1] / base[1] - 1),
                },
                ...(prev
                  ? [{ key: "day", label: "Day change", value: signedPct(p[1] / prev[1] - 1, 2) }]
                  : []),
              ],
              footer: dayEvents.length ? dayEvents.map((e) => e.label).join("; ") : undefined,
            },
          };
        }
        const marks = (
          <>
            <defs>
              <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.01} />
              </linearGradient>
              <clipPath id={`${gid}-clip`}>
                <rect x={left} y={0} width={Math.max(0, right - left)} height={TOP + MAIN_H + 1} />
              </clipPath>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--chart-grid)"
                  strokeOpacity={0.55}
                  shapeRendering="crispEdges"
                />
                <text
                  x={left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--chart-axis)"
                  className="tabular-nums"
                >
                  {fmtTick(t)}
                </text>
              </g>
            ))}
            <line
              x1={left}
              x2={right}
              y1={TOP + MAIN_H}
              y2={TOP + MAIN_H}
              stroke="var(--chart-baseline)"
              shapeRendering="crispEdges"
            />
            {tickList.map((t) => (
              <text
                key={t.date}
                x={x(ms(t.date))}
                y={TOP + MAIN_H + 15}
                textAnchor="middle"
                fontSize={11}
                fill="var(--chart-axis)"
              >
                {t.label}
              </text>
            ))}
            <g clipPath={`url(#${gid}-clip)`}>
              <path d={area} fill={`url(#${gid})`} />
              <polyline
                points={line}
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth={1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
            {visible.length ? (
              <circle
                cx={x(ms(visible[visible.length - 1]![0]))}
                cy={y(visible[visible.length - 1]![1])}
                r={3.5}
                fill="var(--chart-1)"
                stroke="var(--chart-surface)"
                strokeWidth={1.5}
              />
            ) : null}
            {/* hover column */}
            {active !== null && visible[active] && !hoverEv ? (
              <g pointerEvents="none">
                <line
                  x1={x(ms(visible[active]![0]))}
                  x2={x(ms(visible[active]![0]))}
                  y1={TOP}
                  y2={TOP + MAIN_H}
                  stroke="var(--chart-axis)"
                  strokeOpacity={0.6}
                />
                <circle
                  cx={x(ms(visible[active]![0]))}
                  cy={y(visible[active]![1])}
                  r={4}
                  fill="var(--chart-1)"
                  stroke="var(--chart-surface)"
                  strokeWidth={1.5}
                />
              </g>
            ) : null}
            <rect
              x={left}
              y={TOP}
              width={Math.max(0, right - left)}
              height={MAIN_H}
              fill="transparent"
              onPointerMove={(e) => {
                const p = localPoint(e);
                const d = x.invert(p.x);
                let i = firstOnOrAfter(visible, new Date(d).toISOString().slice(0, 10));
                if (i >= visible.length) i = visible.length - 1;
                if (
                  i > 0 &&
                  Math.abs(ms(visible[i - 1]![0]) - d) < Math.abs(ms(visible[i]![0]) - d)
                )
                  i--;
                setHoverEvent(null);
                setActive(i);
              }}
              onPointerLeave={() => setActive(null)}
            />
            {/* event markers above the line */}
            {shownEvents.map((e) => {
              const i = eventIndex(e);
              const p = visible[i];
              if (!p) return null;
              const ex = x(ms(p[0]));
              const ey = Math.max(TOP + 2, y(p[1]) - 8);
              const top = Math.max(10, ey - 18);
              const c = KIND_COLOR[e.kind];
              const mdl = e.kind === "mdl_centralized" || e.kind === "mdl_closed";
              const hollow = mdl && e.tier === "C";
              const hot = hoverEvent === e.id;
              return (
                <g
                  key={e.id}
                  onPointerEnter={() => setHoverEvent(e.id)}
                  onPointerLeave={() => setHoverEvent(null)}
                  style={{ cursor: e.url ? "pointer" : "default" }}
                  onClick={() => {
                    if (e.url) window.open(e.url, "_blank", "noopener,noreferrer");
                  }}
                >
                  <line
                    x1={ex}
                    x2={ex}
                    y1={top + 6}
                    y2={ey}
                    stroke="var(--chart-axis)"
                    strokeOpacity={0.55}
                    strokeDasharray="2 2"
                  />
                  {mdl ? (
                    <path
                      d={`M${ex} ${top - 7}l7 7-7 7-7-7Z`}
                      fill={hollow ? "var(--chart-surface)" : c}
                      stroke={hollow ? c : "var(--chart-surface)"}
                      strokeWidth={hollow ? 2 : 1.5}
                      transform={
                        hot
                          ? `translate(${ex} ${top}) scale(1.2) translate(${-ex} ${-top})`
                          : undefined
                      }
                    />
                  ) : (
                    <circle
                      cx={ex}
                      cy={top}
                      r={hot ? 7 : 5.5}
                      fill={c}
                      stroke="var(--chart-surface)"
                      strokeWidth={1.5}
                    />
                  )}
                  <rect x={ex - 9} y={top - 10} width={18} height={20} fill="transparent" />
                </g>
              );
            })}
            {/* context strip: whole history, drag to choose the window */}
            <rect
              x={left}
              y={TOP + MAIN_H + GAP}
              width={Math.max(0, right - left)}
              height={STRIP_H}
              rx={3}
              fill="var(--muted)"
            />
            <polyline points={stripLine} fill="none" stroke="var(--chart-base)" strokeWidth={1} />
            {events.map((e) => (
              <line
                key={`s-${e.id}`}
                x1={x0(ms(e.date))}
                x2={x0(ms(e.date))}
                y1={TOP + MAIN_H + GAP + STRIP_H - 6}
                y2={TOP + MAIN_H + GAP + STRIP_H}
                stroke={KIND_COLOR[e.kind]}
                strokeWidth={1.5}
              />
            ))}
            <rect
              x={selA}
              y={TOP + MAIN_H + GAP}
              width={Math.max(2, selB - selA)}
              height={STRIP_H}
              rx={2}
              fill="var(--chart-1)"
              fillOpacity={0.14}
              stroke="var(--chart-1)"
              strokeWidth={1}
              pointerEvents="none"
            />
            {stripTicks.map((t) => (
              <text
                key={`st-${t.date}`}
                x={x0(ms(t.date))}
                y={TOP + MAIN_H + GAP + STRIP_H + 14}
                textAnchor="middle"
                fontSize={10.5}
                fill="var(--chart-axis)"
              >
                {t.label}
              </text>
            ))}
            <text
              x={left - 8}
              y={TOP + MAIN_H + GAP + STRIP_H / 2}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              fill="var(--chart-axis)"
            >
              Drag
            </text>
            <rect
              x={left}
              y={TOP + MAIN_H + GAP}
              width={Math.max(0, right - left)}
              height={STRIP_H}
              fill="transparent"
              style={{ cursor: "ew-resize", touchAction: "none" }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={() => setDrag(null)}
            />
          </>
        );
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}

function eventTip(e: PriceEvent, r: ReturnType<typeof reaction>, cur: string): TooltipContent {
  const tierNote =
    e.tier === "C"
      ? "Link names the company by the MDL's subject only"
      : e.tier
        ? `MDL link tier ${e.tier}`
        : undefined;
  return {
    title: e.label,
    subtitle: `${EVENT_KIND_LABEL[e.kind]} · ${dateLong(e.date)}`,
    rows: r
      ? [
          {
            key: "b",
            label: `Close before (${dateLong(r.base[0])})`,
            value: moneyText(r.base[1], cur),
          },
          { key: "1", label: "First close on or after", value: signedPct(r.change1) },
          {
            key: "5",
            label: "Fifth close on or after",
            value: r.change5 === null ? "Not yet traded" : signedPct(r.change5),
          },
        ]
      : [],
    footer:
      [tierNote, e.url ? "Click the marker to open the source" : undefined]
        .filter(Boolean)
        .join(" · ") || undefined,
  };
}

/** Close-to-close moves around each event in the price history, newest first. */
export function EventReactions({ cik }: { cik: string }) {
  const { q, series, events } = usePriceData(cik);
  const rows = useMemo(
    () =>
      series
        ? [...events]
            .reverse()
            .map((e) => ({ e, r: reaction(series.points, e.date) }))
            .filter((x) => x.r !== null)
        : [],
    [series, events],
  );
  const status = queryStatus(
    q,
    !!series && rows.length > 0,
    series
      ? "No MDL date or enforcement action linked to this company falls inside its price history."
      : "No daily price history is stored for this company yet.",
  );
  const table: TableSpec = {
    caption: "Close-to-close moves around each event",
    columns: [
      { label: "Event", align: "left" },
      { label: "Date", align: "left" },
      { label: "Kind", align: "left" },
      { label: "Close before" },
      { label: "First close on or after (%)" },
      { label: "Fifth close on or after (%)" },
    ],
    rows: rows.map(({ e, r }) => ({
      key: e.id,
      cells: [
        e.label,
        e.date,
        EVENT_KIND_LABEL[e.kind],
        r!.base[1],
        Math.round(r!.change1 * 10000) / 100,
        r!.change5 === null ? "Not recorded" : Math.round(r!.change5 * 10000) / 100,
      ],
    })),
  };
  return (
    <ChartFrame
      title="Price moves around events"
      subtitle="Close before the event against the first and fifth close on or after it"
      sources={[JPML]}
      status={status}
      table={table}
      notes={[
        "A move is measured from the last close before the event date; it is not attributed to the event. Markets move for many reasons on any day.",
        "Hover a marker on the price chart for the same figures.",
      ]}
      minHeight={340}
    >
      <div className="-mx-1 max-h-[360px] overflow-y-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-card">
            <tr className="text-[10.5px] uppercase tracking-[0.05em] text-muted-foreground">
              <th className="w-6 px-1 py-1.5 text-left font-medium" aria-label="Kind" />
              <th className="px-1 py-1.5 text-left font-medium">Event</th>
              <th className="whitespace-nowrap px-1 py-1.5 text-right font-medium">1 day</th>
              <th className="whitespace-nowrap px-1 py-1.5 text-right font-medium">5 days</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map(({ e, r }) => {
              const mdl = e.kind === "mdl_centralized" || e.kind === "mdl_closed";
              return (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="px-1 py-1.5">
                    <svg width="14" height="14" aria-hidden className="mt-0.5">
                      {mdl ? (
                        <path
                          d="M7 1l6 6-6 6-6-6Z"
                          fill={
                            e.tier === "C"
                              ? "var(--chart-surface, var(--card))"
                              : KIND_COLOR[e.kind]
                          }
                          stroke={KIND_COLOR[e.kind]}
                          strokeWidth={e.tier === "C" ? 1.8 : 0}
                        />
                      ) : (
                        <circle cx="7" cy="7" r="5" fill={KIND_COLOR[e.kind]} />
                      )}
                    </svg>
                  </td>
                  <td className="px-1 py-1.5">
                    {e.url ? (
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="leading-[1.3] text-foreground underline-offset-2 hover:underline"
                      >
                        {e.label}
                      </a>
                    ) : (
                      <span className="leading-[1.3] text-foreground">{e.label}</span>
                    )}
                    <span className="block text-[11px] text-muted-foreground">
                      {dateLong(e.date)} · {EVENT_KIND_LABEL[e.kind]}
                      {e.tier === "C" ? " · subject-only link" : ""}
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-right font-semibold tabular-nums">
                    {signedPct(r!.change1)}
                  </td>
                  <td
                    className={cn(
                      "px-1 py-1.5 text-right font-semibold tabular-nums",
                      r!.change5 === null && "font-normal text-muted-foreground",
                    )}
                  >
                    {r!.change5 === null ? "Not yet" : signedPct(r!.change5)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 30 ? (
          <p className="pt-1 text-[11px] text-muted-foreground">
            The 30 most recent of {rows.length} events; View data lists every one.
          </p>
        ) : null}
      </div>
    </ChartFrame>
  );
}
