/**
 * Swimlane timeline: one horizontal lane per series of dated events, lanes grouped under headed bands, one shared time
 * axis. A lane shows either its events as dots (several events on one day merge into one larger dot with the count) or,
 * when it holds too many to draw, monthly bars whose height is the month's count within that lane. A dot lane whose
 * dots would sit on top of each other (most neighbours closer than 6 px) is drawn by month the same way, so no event is
 * hidden under another. Events outside the axis are counted at the lane's edges, never dropped silently.
 *
 * Hover snaps to the nearest mark within 12 px of the pointer (hit target larger than the dot); the same details are on
 * keyboard focus: ArrowUp/ArrowDown change lane, ArrowLeft/ArrowRight move between a lane's marks, Enter opens the
 * event's link, Escape clears. Colour carries the group (the band header names it); text stays in ink tokens.
 */
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { ChartTooltip, textWidth, useMeasuredWidth, type TooltipContent } from "./canvas";
import { chartTokens, seriesVar } from "./palette";
import { linearScale, niceStep } from "./scale";

export type SwimEvent = {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  label: string;
  detail?: string | undefined;
  href?: string | null | undefined;
  /** What the event counts for when the lane is drawn by month (default 1). */
  weight?: number | undefined;
};
export type SwimBar = { month: string; n: number };
export type SwimLane = {
  id: string;
  group: string;
  label: string;
  events?: readonly SwimEvent[] | undefined;
  /** Monthly counts drawn as bars instead of dots ("YYYY-MM"). */
  bars?: readonly SwimBar[] | undefined;
  /** Shown when the lane holds nothing in range. */
  emptyText?: string | undefined;
};
export type SwimGroup = { id: string; label: string; slot: number };

export type SwimlanesProps = {
  groups: readonly SwimGroup[];
  lanes: readonly SwimLane[];
  /** Axis start and end ("YYYY-MM-DD"). */
  domain: readonly [string, string];
  ariaLabel: string;
  laneHeight?: number;
  width?: number | undefined;
  onOpen?: ((e: SwimEvent, lane: SwimLane) => void) | undefined;
  /** Extra tooltip line for a mark. */
  note?: ((events: readonly SwimEvent[], lane: SwimLane) => string | undefined) | undefined;
  /** "3 documents" */
  unitLabel?: ((n: number, lane: SwimLane) => string) | undefined;
  className?: string | undefined;
};

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const HEAD = 18;
const AXIS = 22;

/** One drawn mark: a day of events, or a month bar (`dense` when a dot lane was too crowded to draw by day). */
export type SwimMark = {
  x: number;
  key: string;
  events: SwimEvent[];
  n: number;
  month: boolean;
  x1: number;
  dense?: boolean;
};

const monthEnd = (ym: string) => Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 1);

/** Events of a lane merged by day and placed on the scale (pure; tested). */
export function laneMarks(
  lane: Pick<SwimLane, "events" | "bars">,
  x: (ms: number) => number,
  domain: readonly [number, number],
): { marks: SwimMark[]; before: number; after: number } {
  let before = 0;
  let after = 0;
  if (lane.bars?.length) {
    const marks: SwimMark[] = [];
    for (const b of lane.bars) {
      const ms = toMs(`${b.month}-01`);
      const end = Date.UTC(Number(b.month.slice(0, 4)), Number(b.month.slice(5, 7)), 1);
      if (!Number.isFinite(ms)) continue;
      if (end <= domain[0]) {
        before += b.n;
        continue;
      }
      if (ms > domain[1]) {
        after += b.n;
        continue;
      }
      const x0 = x(Math.max(ms, domain[0]));
      marks.push({
        x: x0,
        x1: x(Math.min(end, domain[1])),
        key: b.month,
        events: [],
        n: b.n,
        month: true,
      });
    }
    marks.sort((a, b) => a.x - b.x);
    return { marks, before, after };
  }
  const byDay = new Map<string, SwimEvent[]>();
  for (const e of lane.events ?? []) {
    const ms = toMs(e.date);
    if (!Number.isFinite(ms)) continue;
    if (ms < domain[0]) before++;
    else if (ms > domain[1]) after++;
    else {
      const k = e.date.slice(0, 10);
      byDay.set(k, [...(byDay.get(k) ?? []), e]);
    }
  }
  const marks = [...byDay.entries()]
    .map(([key, evs]) => {
      const px = x(toMs(key));
      return { x: px, x1: px, key, events: evs, n: evs.length, month: false };
    })
    .sort((a, b) => a.x - b.x || a.key.localeCompare(b.key));
  const tight = marks.filter((m, i) => i > 0 && m.x - marks[i - 1]!.x < 6).length;
  if (marks.length > 12 && tight > marks.length * 0.3) {
    const byMonth = new Map<string, SwimEvent[]>();
    for (const m of marks) {
      const k = m.key.slice(0, 7);
      byMonth.set(k, [...(byMonth.get(k) ?? []), ...m.events]);
    }
    const dense: SwimMark[] = [...byMonth.entries()].map(([k, evs]) => ({
      x: x(Math.max(toMs(`${k}-01`), domain[0])),
      x1: x(Math.min(monthEnd(k), domain[1])),
      key: k,
      events: evs,
      n: evs.reduce((a, e) => a + (e.weight ?? 1), 0),
      month: true,
      dense: true,
    }));
    dense.sort((a, b) => a.x - b.x);
    return { marks: dense, before, after };
  }
  return { marks, before, after };
}

const fmtDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const fmtMonth = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });

type Row =
  { kind: "head"; group: SwimGroup; y: number } | { kind: "lane"; lane: number; y: number };

export function Swimlanes({
  groups,
  lanes,
  domain,
  ariaLabel,
  laneHeight = 22,
  width: fixedWidth,
  onOpen,
  note,
  unitLabel = (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "event" : "events"}`,
  className,
}: SwimlanesProps) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const width = fixedWidth ?? measured;
  const liveId = useId();
  const [active, setActive] = useState<{ lane: number; mark: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const slotOf = useMemo(() => new Map(groups.map((g) => [g.id, g.slot] as const)), [groups]);
  const rows = useMemo(() => {
    const out: Row[] = [];
    let y = 0;
    for (const g of groups) {
      const ls = lanes.map((l, i) => ({ l, i })).filter((v) => v.l.group === g.id);
      if (!ls.length) continue;
      out.push({ kind: "head", group: g, y });
      y += HEAD;
      for (const v of ls) {
        out.push({ kind: "lane", lane: v.i, y });
        y += laneHeight;
      }
    }
    return out;
  }, [groups, lanes, laneHeight]);
  const bodyH = rows.reduce((a, r) => a + (r.kind === "head" ? HEAD : laneHeight), 0);
  const height = bodyH + AXIS + 2;
  const laneY = useMemo(
    () =>
      new Map(
        rows
          .filter((r) => r.kind === "lane")
          .map((r) => [(r as { lane: number }).lane, r.y] as const),
      ),
    [rows],
  );
  const order = rows.filter((r) => r.kind === "lane").map((r) => (r as { lane: number }).lane);
  const labelW = Math.min(
    210,
    Math.max(96, ...lanes.map((l) => textWidth(l.label, 10.5) + 18)),
    width ? Math.max(96, width * 0.3) : 210,
  );
  const d0 = toMs(domain[0]);
  const d1 = Math.max(d0 + DAY, toMs(domain[1]));
  const plotX0 = labelW + 22;
  const plotX1 = width ? width - 8 : 0;
  const x = useMemo(
    () => (width ? linearScale([d0, d1], [plotX0, plotX1]) : null),
    [width, d0, d1, plotX0, plotX1],
  );
  const laid = useMemo(
    () => (x ? lanes.map((l) => laneMarks(l, x, [d0, d1])) : []),
    [lanes, x, d0, d1],
  );
  const label = (n: number, li: number) => unitLabel(n, lanes[li]!);
  const describe = (li: number, mi: number) => {
    const lane = lanes[li]!;
    const m = laid[li]?.marks[mi];
    if (!m) return `${lane.label}: none in this period.`;
    if (m.month) return `${lane.label}, ${fmtMonth(m.key)}: ${label(m.n, li)}.`;
    return `${lane.label}, ${fmtDay(m.key)}: ${m.n > 1 ? label(m.n, li) : m.events[0]!.label}.`;
  };
  const go = (next: { lane: number; mark: number } | null) => {
    setActive(next);
    if (next) setAnnounce(describe(next.lane, next.mark));
  };
  const markDist = (m: SwimMark, px: number) =>
    m.month
      ? px >= m.x && px <= m.x1
        ? 0
        : Math.min(Math.abs(px - m.x), Math.abs(px - m.x1))
      : Math.abs(m.x - px);
  /** Index of the mark nearest to `px` (within `within` px); the first mark when px is undefined; -1 when none. */
  const nearest = (li: number, px: number | undefined, within = Infinity) => {
    const ms = laid[li]?.marks ?? [];
    if (!ms.length) return -1;
    if (px === undefined) return 0;
    let best = -1;
    let bd = Infinity;
    ms.forEach((m, k) => {
      const d = markDist(m, px);
      if (d <= within && d < bd) {
        best = k;
        bd = d;
      }
    });
    return best;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!order.length) return;
    const cur = active ?? { lane: order[0]!, mark: 0 };
    const pos = order.indexOf(cur.lane);
    const curX = laid[cur.lane]?.marks[cur.mark]?.x;
    const count = (li: number) => laid[li]?.marks.length ?? 0;
    let next: { lane: number; mark: number } | null = null;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const li = active
          ? order[Math.max(0, Math.min(order.length - 1, pos + (e.key === "ArrowDown" ? 1 : -1)))]!
          : order[0]!;
        next = { lane: li, mark: Math.max(0, nearest(li, active ? curX : undefined)) };
        break;
      }
      case "ArrowRight":
        next = {
          lane: cur.lane,
          mark: active ? Math.min(Math.max(0, count(cur.lane) - 1), cur.mark + 1) : 0,
        };
        break;
      case "ArrowLeft":
        next = { lane: cur.lane, mark: Math.max(0, cur.mark - 1) };
        break;
      case "Home":
        next = { lane: cur.lane, mark: 0 };
        break;
      case "End":
        next = { lane: cur.lane, mark: Math.max(0, count(cur.lane) - 1) };
        break;
      case "Enter": {
        const ev = active ? laid[active.lane]?.marks[active.mark]?.events[0] : undefined;
        if (ev && onOpen) {
          e.preventDefault();
          onOpen(ev, lanes[active!.lane]!);
        }
        return;
      }
      case "Escape":
        setActive(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    go(next);
  };
  const tip: { content: TooltipContent; x: number; y: number } | null = (() => {
    if (!active || !x) return null;
    const lane = lanes[active.lane];
    const m = laid[active.lane]?.marks[active.mark];
    if (!lane || !m) return null;
    const y = (laneY.get(active.lane) ?? 0) + laneHeight;
    if (m.month)
      return {
        x: m.x,
        y,
        content: {
          title: fmtMonth(m.key),
          subtitle: lane.label,
          rows: [{ key: "n", label: "", value: label(m.n, active.lane) }],
          footer: m.dense ? "Drawn by month here: too many to show one by one" : undefined,
        },
      };
    const shown = m.events.slice(0, 5);
    const foot = [
      m.events.length > shown.length ? `and ${m.events.length - shown.length} more` : null,
      note?.(m.events, lane) ?? null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      x: m.x,
      y,
      content: {
        title: fmtDay(m.key),
        subtitle: lane.label,
        rows: shown.map((ev) => ({ key: ev.id, label: ev.detail ?? "", value: ev.label })),
        footer: foot || undefined,
      },
    };
  })();
  const y0 = new Date(d0).getUTCFullYear();
  const y1 = new Date(d1).getUTCFullYear();
  const step = Math.max(
    1,
    Math.ceil(niceStep(y0, y1, width ? Math.max(2, Math.floor((plotX1 - plotX0) / 64)) : 6)),
  );
  const ticks: number[] = [];
  for (let yv = Math.ceil(y0 / step) * step; yv <= y1; yv += step)
    if (Date.UTC(yv, 0, 1) >= d0) ticks.push(yv);
  return (
    <div
      ref={ref}
      className={cn("relative w-full min-w-0", className)}
      style={{ ...chartTokens, height }}
    >
      <div
        role="group"
        aria-roledescription="timeline"
        aria-label={`${ariaLabel} Use the arrow keys to move between lanes and events, Enter to open.`}
        aria-describedby={liveId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="h-full w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {width && x ? (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden
            className="block font-sans"
          >
            {ticks.map((yv) => {
              const tx = x(Date.UTC(yv, 0, 1));
              return (
                <g key={yv}>
                  <line x1={tx} x2={tx} y1={0} y2={bodyH} stroke="var(--chart-grid)" />
                  <text
                    x={tx}
                    y={bodyH + 14}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--chart-axis)"
                  >
                    {yv}
                  </text>
                </g>
              );
            })}
            <line
              x1={plotX0}
              x2={plotX1}
              y1={bodyH + 0.5}
              y2={bodyH + 0.5}
              stroke="var(--chart-grid)"
            />
            {rows.map((r) => {
              if (r.kind === "head")
                return (
                  <g key={`h-${r.group.id}`}>
                    <circle cx={5} cy={r.y + HEAD / 2 + 1} r={4} fill={seriesVar(r.group.slot)} />
                    <text
                      x={14}
                      y={r.y + HEAD / 2 + 1}
                      dy="0.32em"
                      fontSize={10.5}
                      fontWeight={600}
                      fill="var(--chart-ink)"
                    >
                      {r.group.label}
                    </text>
                  </g>
                );
              const li = r.lane;
              const lane = lanes[li]!;
              const cy = r.y + laneHeight / 2;
              const color = seriesVar(slotOf.get(lane.group) ?? 0);
              const info = laid[li]!;
              const maxN = Math.max(1, ...info.marks.filter((m) => m.month).map((m) => m.n));
              const room = labelW - 4;
              const shown =
                textWidth(lane.label, 10.5) > room
                  ? `${lane.label.slice(0, Math.max(3, Math.floor(room / 5.9) - 1))}…`
                  : lane.label;
              return (
                <g key={`l-${lane.id}`}>
                  <text x={14} y={cy} dy="0.32em" fontSize={10.5} fill="var(--chart-ink)">
                    {shown}
                  </text>
                  <line
                    x1={plotX0}
                    x2={plotX1}
                    y1={cy}
                    y2={cy}
                    stroke="var(--chart-grid)"
                    strokeOpacity={0.6}
                  />
                  {info.before ? (
                    <text
                      x={plotX0 - 3}
                      y={cy}
                      dy="0.32em"
                      textAnchor="end"
                      fontSize={9}
                      fill="var(--chart-axis)"
                    >
                      {`◂${info.before.toLocaleString("en-US")}`}
                    </text>
                  ) : null}
                  {!info.marks.length ? (
                    <text x={plotX0 + 6} y={cy - 4} fontSize={9.5} fill="var(--chart-axis)">
                      {info.before || info.after
                        ? "None in this period"
                        : (lane.emptyText ?? "None in this period")}
                    </text>
                  ) : null}
                  {info.marks.map((m, k) => {
                    const on = active?.lane === li && active.mark === k;
                    if (m.month) {
                      const bh = Math.max(1.5, (m.n / maxN) * (laneHeight - 6));
                      return (
                        <rect
                          key={m.key}
                          x={m.x}
                          y={r.y + laneHeight - 3 - bh}
                          width={Math.max(1, m.x1 - m.x - 0.5)}
                          height={bh}
                          fill={color}
                          stroke={on ? "var(--chart-ink)" : "none"}
                          pointerEvents="none"
                        />
                      );
                    }
                    const rr = m.n > 1 ? Math.min(7.5, 4 + Math.sqrt(m.n - 1)) : 4;
                    return (
                      <circle
                        key={m.key}
                        cx={m.x}
                        cy={cy}
                        r={rr}
                        fill={color}
                        stroke={on ? "var(--chart-ink)" : "var(--chart-surface)"}
                        strokeWidth={2}
                        pointerEvents="none"
                      />
                    );
                  })}
                  {info.marks.length ? (
                    <rect
                      x={plotX0 - 6}
                      y={r.y}
                      width={Math.max(0, plotX1 - plotX0 + 12)}
                      height={laneHeight}
                      fill="transparent"
                      style={{ cursor: onOpen ? "pointer" : "default" }}
                      onPointerMove={(e) => {
                        const box = (
                          e.currentTarget.ownerSVGElement ?? e.currentTarget
                        ).getBoundingClientRect();
                        const k = nearest(li, e.clientX - box.left, 12);
                        if (k < 0) {
                          if (active?.lane === li) setActive(null);
                        } else if (active?.lane !== li || active.mark !== k)
                          go({ lane: li, mark: k });
                      }}
                      onPointerLeave={() => setActive(null)}
                      onClick={() => {
                        if (active?.lane !== li) return;
                        const ev = info.marks[active.mark]?.events[0];
                        if (ev && onOpen) onOpen(ev, lane);
                      }}
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
      <p id={liveId} aria-live="polite" className="sr-only">
        {announce}
      </p>
      {tip && width ? (
        <ChartTooltip content={tip.content} x={tip.x} y={tip.y} containerWidth={width} />
      ) : null}
    </div>
  );
}
