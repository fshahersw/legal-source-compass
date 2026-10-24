// @ts-nocheck -- vendored component, kept as supplied
"use client";

import * as React from "react";

export interface ActivityDatum {
  /** Local calendar date, YYYY-MM-DD. Duplicate dates use the last value. */
  date: string;
  value: number;
}

export type ActivityHeatmapView = "calendar" | "weekdays" | "months";
export type ActivityHeatmapProps = React.ComponentProps<"div"> & {
  data: ActivityDatum[];
  /** Number of calendar days ending at endDate; no extra padded dates. */
  days?: number;
  /** Defaults to the browser's local date after mount. */
  endDate?: string | Date;
  /** Maximum square edge. At least 6px; spacing is responsive. */
  cellSize?: number;
  /** CSS color for the squares. Defaults to the theme primary, whether it is a full color (Tailwind v4) or bare HSL channels (Tailwind v3). */
  color?: string;
  unit?: string;
  formatValue?: (value: number) => string;
  showMonths?: boolean;
  showWeekdays?: boolean;
  showLegend?: boolean;
  view?: ActivityHeatmapView;
  defaultView?: ActivityHeatmapView;
  onViewChange?: (view: ActivityHeatmapView) => void;
  autoPlay?: boolean;
  /** Time between changes; at least 900ms so a transition can finish. */
  interval?: number;
};

type Cell = {
  date: string;
  value: number;
  day: number;
  week: number;
  month: string;
  label: string;
};
type Month = { key: string; label: string; cells: Cell[]; firstWeek: number };
type Tip = { cell: Cell; left: number; top: number; right: number; bottom: number };
const VIEWS: ActivityHeatmapView[] = ["calendar", "weekdays", "months"];
const VIEW_NAMES = { calendar: "Calendar", weekdays: "Weekdays", months: "Months" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LEVEL_MIX = [0, 28, 48, 72, 100];
const THEME_PRIMARY = "var(--color-primary, currentColor)";

// shadcn stores --primary either as a full color (Tailwind v4: oklch) or as bare HSL channels
// (Tailwind v3: "0 0% 9%"); read the live value and build whichever form is a valid color.
function resolveThemeColor(node: HTMLElement, color: string | undefined) {
  const token = color === undefined ? "--primary" : /^hsl\(var\((--[\w-]+)\)\)$/.exec(color)?.[1];
  if (!token) return color ?? THEME_PRIMARY;
  const value = getComputedStyle(node).getPropertyValue(token).trim();
  if (value && CSS.supports("color", value)) return `var(${token})`;
  const channels = `hsl(${value})`;
  return value && CSS.supports("color", channels) ? channels : (color ?? THEME_PRIMARY);
}
const PLOT_HEIGHT = 256;
const LEFT = 58;
const BASELINE = 230;
const DATE_LABEL = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const END_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short" });

function toKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromKey(key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year = 0, month = 0, day = 0] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return toKey(date) === key ? date : null;
}

export function formatCompact(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

function buildDays(data: ActivityDatum[], days: number, endKey: string | null) {
  const end = endKey ? fromKey(endKey) : null;
  if (!end) return [] as Cell[];
  const count = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 365;
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - count + 1);
  const offset = start.getDay();
  const byDate = new Map(
    data.map(
      (entry) => [entry.date, Number.isFinite(entry.value) ? Math.max(0, entry.value) : 0] as const,
    ),
  );
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = toKey(date);
    return {
      date: key,
      value: byDate.get(key) ?? 0,
      day: date.getDay(),
      week: Math.floor((index + offset) / 7),
      month: key.slice(0, 7),
      label: DATE_LABEL.format(date),
    };
  });
}

function strongestFirst(a: Cell, b: Cell) {
  return b.value - a.value || a.date.localeCompare(b.date);
}

function arrange(cells: Cell[], width: number, maxCell: number) {
  const usable = Math.max(7, width - LEFT - 8);
  const totalWeeks = (cells.at(-1)?.week ?? 0) + 1;
  const capacity = Math.max(1, Math.floor((usable + 1) / 7));
  const firstWeek = Math.max(0, totalWeeks - capacity);
  const shown = cells.filter((cell) => cell.week >= firstWeek);
  const weeks = Math.max(1, totalWeeks - firstWeek);
  const weekdays = Array.from({ length: 7 }, () => [] as Cell[]);
  const months: Month[] = [];
  for (const cell of shown) {
    let month = months.find((entry) => entry.key === cell.month);
    if (!month) {
      month = {
        key: cell.month,
        label: MONTH_LABEL.format(fromKey(cell.date)!),
        cells: [],
        firstWeek: cell.week,
      };
      months.push(month);
    }
    if (cell.value > 0) {
      weekdays[cell.day]!.push(cell);
      month.cells.push(cell);
    }
  }
  weekdays.forEach((group) => group.sort(strongestFirst));
  months.forEach((month) => month.cells.sort(strongestFirst));
  const weekdayRanks = new Map(
    weekdays.flatMap((group) => group.map((cell, rank) => [cell.date, rank] as const)),
  );
  const monthRanks = new Map(
    months.flatMap((month, column) =>
      month.cells.map((cell, rank) => [cell.date, { rank, column }] as const),
    ),
  );
  const maxMonth = Math.max(1, ...months.map((month) => month.cells.length));
  const maxWeekday = Math.max(1, ...weekdays.map((group) => group.length));
  const edge = Math.max(
    6,
    Math.min(maxCell, 16, usable / weeks - 1, (BASELINE - 24) / maxMonth - 0.5),
  );
  const weekdayStep = Math.min(edge + 2, (usable - edge) / Math.max(1, maxWeekday - 1));
  const monthStep = Math.min(edge + 1, (BASELINE - 24) / maxMonth);
  const calendarStep = usable / weeks;
  const monthColumn = usable / Math.max(1, months.length);
  let total = 0;
  let active = 0;
  let longest = 0;
  let current = 0;
  for (const cell of shown) {
    total += cell.value;
    if (cell.value > 0) {
      active += 1;
      current += 1;
      longest = Math.max(longest, current);
    } else current = 0;
  }
  const bestWeekday = weekdays.findIndex((group) => group.length === maxWeekday);
  const bestMonth = months.findIndex((month) => month.cells.length === maxMonth);
  return {
    shown,
    weeks,
    firstWeek,
    weekdays,
    months,
    weekdayRanks,
    monthRanks,
    edge,
    weekdayStep,
    monthStep,
    calendarStep,
    monthColumn,
    total,
    active,
    longest,
    current,
    bestWeekday,
    bestMonth,
  };
}

const EMPTY_LAYOUT = arrange([], 660, 10);
type Layout = typeof EMPTY_LAYOUT;

function position(cell: Cell, view: ActivityHeatmapView, layout: Layout) {
  const calendar = {
    x: LEFT + (cell.week - layout.firstWeek) * layout.calendarStep,
    y: 52 + cell.day * 24,
  };
  if (view === "calendar" || cell.value <= 0) return calendar;
  if (view === "weekdays")
    return {
      x: LEFT + (layout.weekdayRanks.get(cell.date) ?? 0) * layout.weekdayStep,
      y: calendar.y,
    };
  const at = layout.monthRanks.get(cell.date)!;
  return {
    x: LEFT + (at.column + 0.5) * layout.monthColumn - layout.edge / 2,
    y: BASELINE - layout.edge - at.rank * layout.monthStep,
  };
}

function ViewIcon({ view }: { view: ActivityHeatmapView }) {
  return (
    <svg
      aria-hidden="true"
      className="hidden shrink-0 min-[480px]:block"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    >
      {view === "calendar" ? (
        <>
          <rect x="2" y="3" width="12" height="11" rx="2" />
          <path d="M5 2v3m6-3v3M2 7h12M5 10h1m4 0h1" />
        </>
      ) : view === "weekdays" ? (
        <path d="M2 4h12M2 8h8M2 12h10" />
      ) : (
        <path d="M4 14V7m4 7V2m4 12V5" />
      )}
    </svg>
  );
}

export function ActivityHeatmap({
  data,
  days = 365,
  endDate,
  cellSize = 10,
  color,
  unit = "",
  formatValue = formatCompact,
  showMonths = true,
  showWeekdays = true,
  showLegend = true,
  view,
  defaultView = "calendar",
  onViewChange,
  autoPlay = false,
  interval = 3200,
  ref,
  className = "",
  style,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onPointerDown,
  ...rest
}: ActivityHeatmapProps) {
  const [today, setToday] = React.useState(null as string | null);
  const [internalView, setInternalView] = React.useState(defaultView);
  const [width, setWidth] = React.useState(0);
  const [reduced, setReduced] = React.useState(true);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [stopped, setStopped] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const [focusedDate, setFocusedDate] = React.useState("");
  const [tooltip, setTooltip] = React.useState(null as Tip | null);
  const [resolvedColor, setResolvedColor] = React.useState(color ?? THEME_PRIMARY);
  const host = React.useRef(null as HTMLDivElement | null);
  const tipRef = React.useRef(null as HTMLDivElement | null);
  const plotRef = React.useRef(null as HTMLDivElement | null);
  const descriptionId = React.useId();
  const tooltipId = React.useId();
  const currentView = view ?? internalView;
  const endKey =
    endDate instanceof Date
      ? Number.isNaN(endDate.getTime())
        ? null
        : toKey(endDate)
      : (endDate ?? today);
  const cells = React.useMemo(() => buildDays(data, days, endKey), [data, days, endKey]);
  const maxCell = Number.isFinite(cellSize) ? Math.max(6, cellSize) : 10;
  const layout = React.useMemo(
    () => (cells.length ? arrange(cells, width || 660, maxCell) : EMPTY_LAYOUT),
    [cells, width, maxCell],
  );
  const ready = width > 0 && !!endKey;
  const truncated = layout.shown.length < cells.length;
  const visibleCells =
    currentView === "calendar" ? layout.shown : layout.shown.filter((cell) => cell.value > 0);
  const tabDate = visibleCells.some((cell) => cell.date === focusedDate)
    ? focusedDate
    : visibleCells[0]?.date;
  const maxValue = Math.max(1, ...layout.shown.map((cell) => cell.value));
  const bestDay = layout.weekdays[layout.bestWeekday];
  const bestMonth = layout.months[layout.bestMonth];
  const running = autoPlay && !reduced && !hovered && !focused && !stopped && !hidden && ready;
  const levelOf = (value: number) =>
    value <= 0 ? 0 : Math.min(4, Math.ceil((value / maxValue) * 4));
  const levelColor = (level: number) =>
    level === 0
      ? undefined
      : `color-mix(in srgb, var(--heatmap-color) ${LEVEL_MIX[level]}%, transparent)`;
  const valueLabel = (value: number) => `${formatValue(value)}${unit ? ` ${unit}` : ""}`;

  React.useEffect(() => {
    setToday(toKey(new Date()));
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    update();
    visibility();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  React.useEffect(() => {
    const node = host.current;
    if (!node) return;
    const resize = () => {
      setWidth(node.getBoundingClientRect().width);
      setTooltip(null);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const node = host.current;
    if (!node) return;
    const update = () => setResolvedColor(resolveThemeColor(node, color));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, [color]);

  const changeView = React.useCallback(
    (next: ActivityHeatmapView, manual = false) => {
      if (manual) setStopped(true);
      setTooltip(null);
      if (next === currentView) return;
      if (view === undefined) setInternalView(next);
      onViewChange?.(next);
    },
    [currentView, view, onViewChange],
  );

  React.useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => changeView(VIEWS[(VIEWS.indexOf(currentView) + 1) % VIEWS.length]!),
      Number.isFinite(interval) ? Math.max(900, interval) : 3200,
    );
    return () => window.clearTimeout(timer);
  }, [running, interval, currentView, changeView]);

  React.useEffect(() => {
    const clear = () => setTooltip(null);
    window.addEventListener("scroll", clear, true);
    return () => window.removeEventListener("scroll", clear, true);
  }, []);

  React.useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !tooltip) return;
    const bounds = tip.getBoundingClientRect();
    const left = (tooltip.left + tooltip.right - bounds.width) / 2;
    const top =
      tooltip.top - bounds.height - 8 >= 8 ? tooltip.top - bounds.height - 8 : tooltip.bottom + 8;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, left))}px`;
    tip.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, top))}px`;
  }, [tooltip]);

  const showTooltip = (cell: Cell, target: HTMLElement) => {
    const { left, top, right, bottom } = target.getBoundingClientRect();
    setTooltip({ cell, left, top, right, bottom });
  };
  const navigateDay = (event: React.KeyboardEvent, cell: Cell) => {
    if (event.key === "Escape") {
      setTooltip(null);
      return;
    }
    const directions = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1],
    };
    const direction = directions[event.key as keyof typeof directions];
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    setStopped(true);
    let next =
      event.key === "Home"
        ? visibleCells[0]
        : event.key === "End"
          ? visibleCells.at(-1)
          : undefined;
    if (direction) {
      const here = position(cell, currentView, layout);
      const candidates = visibleCells
        .map((candidate) => {
          const at = position(candidate, currentView, layout);
          const dx = at.x - here.x;
          const dy = at.y - here.y;
          const forward = dx * direction[0]! + dy * direction[1]!;
          const sideways = Math.abs(dx * direction[1]! - dy * direction[0]!);
          return { cell: candidate, forward, distance: forward + sideways * 20 };
        })
        .filter((candidate) => candidate.forward > 0.5)
        .sort((a, b) => a.distance - b.distance);
      next = candidates[0]?.cell;
    }
    if (next)
      (
        plotRef.current?.querySelector(`[data-date="${next.date}"]`) as HTMLButtonElement | null
      )?.focus();
  };
  const first = layout.shown[0];
  const last = layout.shown.at(-1);
  const rangeLabel =
    first && last
      ? `${SHORT_DATE.format(fromKey(first.date)!)} – ${END_DATE.format(fromKey(last.date)!)}`
      : "Preparing calendar";
  const insight = !layout.active
    ? "No active days in this range"
    : currentView === "weekdays" && bestDay
      ? `${WEEKDAYS[layout.bestWeekday]} leads with ${bestDay.length} active days`
      : currentView === "months" && bestMonth
        ? `${bestMonth.label} leads with ${bestMonth.cells.length} active days`
        : "A little each day adds up.";

  return (
    <div
      {...rest}
      ref={ref}
      data-slot="activity-heatmap"
      data-view={currentView}
      data-ready={ready}
      data-autoplay={autoPlay}
      data-running={running}
      data-reduced={reduced}
      className={`w-full min-w-0 font-sans text-foreground ${className}`}
      style={{ "--heatmap-color": resolvedColor, ...style } as React.CSSProperties}
      onMouseEnter={(event) => {
        setHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        setTooltip(null);
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        onBlur?.(event);
      }}
      onPointerDown={(event) => {
        if (!(event.target as Element).closest("[data-autoplay-toggle]")) setStopped(true);
        onPointerDown?.(event);
      }}
    >
      <div ref={host} className="w-full min-w-0">
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 min-[480px]:grid-cols-4">
          {[
            { key: "total", label: "Total", value: valueLabel(layout.total) },
            { key: "active", label: "Active days", value: String(layout.active) },
            { key: "longest", label: "Longest streak", value: `${layout.longest} days` },
            { key: "current", label: "Current streak", value: `${layout.current} days` },
          ].map((stat) => (
            <div key={stat.key} className="min-w-0">
              <p className="text-[10px] leading-4 text-muted-foreground">{stat.label}</p>
              <p
                data-stat={stat.key}
                className="mt-0.5 truncate text-lg font-semibold leading-6 tracking-tight tabular-nums"
                title={stat.value}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex min-w-0 items-center justify-between gap-2 border-t border-border pt-4">
          <div
            role="radiogroup"
            aria-label="Heatmap layout"
            className="inline-flex min-w-0 gap-1 rounded-lg bg-muted/70 p-1"
            onKeyDown={(event) => {
              let next = -1;
              if (event.key === "ArrowRight" || event.key === "ArrowDown")
                next = (VIEWS.indexOf(currentView) + 1) % 3;
              if (event.key === "ArrowLeft" || event.key === "ArrowUp")
                next = (VIEWS.indexOf(currentView) + 2) % 3;
              if (event.key === "Home") next = 0;
              if (event.key === "End") next = 2;
              if (next < 0) return;
              event.preventDefault();
              changeView(VIEWS[next]!, true);
              (
                event.currentTarget.querySelector(
                  `[data-view-option="${VIEWS[next]}"]`,
                ) as HTMLButtonElement | null
              )?.focus();
            }}
          >
            {VIEWS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                data-view-option={option}
                aria-checked={currentView === option}
                tabIndex={currentView === option ? 0 : -1}
                onClick={() => changeView(option, true)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${currentView === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ViewIcon view={option} />
                {VIEW_NAMES[option]}
              </button>
            ))}
          </div>
          {autoPlay && !reduced && (
            <button
              type="button"
              data-autoplay-toggle
              aria-label={stopped ? "Resume automatic views" : "Pause automatic views"}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setStopped(!stopped)}
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="currentColor"
              >
                {stopped ? <path d="m3 1 8 5-8 5Z" /> : <path d="M2 2h3v8H2zm5 0h3v8H7z" />}
              </svg>
            </button>
          )}
        </div>

        <div className="mt-3 flex min-h-5 items-center justify-between gap-2 text-[10px] leading-4">
          <p
            data-insight
            className="font-medium text-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            {insight}
          </p>
          <span
            aria-hidden="true"
            className="hidden shrink-0 text-muted-foreground min-[480px]:inline"
          >
            One square, one day
          </span>
        </div>
        <p
          id={descriptionId}
          data-range-notice
          className={truncated ? "mt-2 text-[10px] leading-4 text-muted-foreground" : "sr-only"}
        >
          {truncated
            ? `Showing the most recent ${layout.weeks} weeks (${layout.shown.length} of ${cells.length} days). Statistics reflect these days.`
            : `${rangeLabel}. Each square is one day.`}{" "}
          Use the arrow keys to explore dates.
        </p>

        <div
          ref={plotRef}
          role="group"
          aria-label={`${VIEW_NAMES[currentView]} activity`}
          aria-describedby={descriptionId}
          aria-busy={!ready}
          data-plot
          className="relative mt-1 w-full overflow-hidden"
          style={{ height: PLOT_HEIGHT, visibility: ready ? "visible" : "hidden" }}
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {WEEKDAYS.map((day, index) => (
              <div
                key={day}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 52 + index * 24,
                  height: layout.edge,
                  opacity: currentView === "months" ? 0 : 1,
                  transition: reduced ? "none" : "opacity 180ms",
                }}
              >
                <div
                  className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/50"
                  style={{ left: LEFT }}
                />
                {showWeekdays && (
                  <span
                    data-weekday-label={index}
                    data-count={layout.weekdays[index]!.length}
                    data-peak={currentView === "weekdays" && index === layout.bestWeekday}
                    className={`absolute inset-y-0 left-0 flex w-[48px] items-center justify-between text-[10px] ${currentView === "weekdays" && index === layout.bestWeekday ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    <span>{day}</span>
                    {currentView === "weekdays" && (
                      <span className="tabular-nums">{layout.weekdays[index]!.length}</span>
                    )}
                  </span>
                )}
              </div>
            ))}
            {showMonths &&
              layout.months.map((month, index) => {
                const isBar = currentView === "months";
                const x = isBar
                  ? LEFT + (index + 0.5) * layout.monthColumn
                  : LEFT + (month.firstWeek - layout.firstWeek) * layout.calendarStep;
                const countY =
                  BASELINE -
                  (month.cells.length
                    ? layout.edge + (month.cells.length - 1) * layout.monthStep
                    : 0) -
                  17;
                return (
                  <React.Fragment key={month.key}>
                    <span
                      data-month-label={month.key}
                      data-count={month.cells.length}
                      data-peak={isBar && index === layout.bestMonth}
                      className={`absolute text-[10px] leading-3 ${isBar && index === layout.bestMonth ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                      style={{
                        left: x,
                        top: isBar ? BASELINE + 9 : 25,
                        transform: isBar ? "translateX(-50%)" : undefined,
                        opacity: currentView === "weekdays" ? 0 : 1,
                      }}
                    >
                      {month.label}
                    </span>
                    {isBar && (
                      <span
                        data-month-count={month.key}
                        className={`absolute text-[10px] leading-3 tabular-nums ${index === layout.bestMonth ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                        style={{ left: x, top: countY, transform: "translateX(-50%)" }}
                      >
                        {month.cells.length}
                      </span>
                    )}
                  </React.Fragment>
                );
              })}
          </div>
          {layout.shown.map((cell, index) => {
            const at = position(cell, currentView, layout);
            const visible = currentView === "calendar" || cell.value > 0;
            const level = levelOf(cell.value);
            return (
              <button
                key={cell.date}
                type="button"
                data-date={cell.date}
                data-value={cell.value}
                data-day={cell.day}
                data-month={cell.month}
                data-level={level}
                aria-label={`${cell.label}: ${valueLabel(cell.value)}`}
                aria-describedby={tooltip?.cell.date === cell.date ? tooltipId : undefined}
                aria-hidden={!visible}
                disabled={!visible}
                tabIndex={visible && cell.date === tabDate ? 0 : -1}
                className="absolute left-0 top-0 m-0 cursor-crosshair rounded-[1.5px] border-0 bg-muted p-0 outline-none hover:ring-2 hover:ring-ring focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                style={{
                  width: layout.edge,
                  height: layout.edge,
                  transform: `translate(${at.x}px, ${at.y}px)`,
                  opacity: visible ? 1 : 0,
                  pointerEvents: visible ? "auto" : "none",
                  backgroundColor: levelColor(level),
                  transitionProperty: "transform, opacity",
                  transitionDuration: reduced ? "0ms" : "620ms",
                  transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                  transitionDelay: reduced ? "0ms" : `${(index % 13) * 12}ms`,
                }}
                onPointerEnter={(event) => showTooltip(cell, event.currentTarget)}
                onPointerLeave={() => setTooltip(null)}
                onFocus={(event) => {
                  setFocusedDate(cell.date);
                  showTooltip(cell, event.currentTarget);
                }}
                onBlur={() => setTooltip(null)}
                onKeyDown={(event) => navigateDay(event, cell)}
              />
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] leading-4 text-muted-foreground">
          <span>{rangeLabel}</span>
          {showLegend && (
            <div
              data-legend
              className="flex items-center gap-1.5"
              aria-label="Color intensity: less to more activity"
            >
              <span>Less</span>
              {LEVEL_MIX.map((_, level) => (
                <span
                  key={level}
                  className="h-2 w-2 rounded-[1px] bg-muted"
                  style={{ backgroundColor: levelColor(level) }}
                />
              ))}
              <span>More</span>
            </div>
          )}
        </div>
      </div>
      {tooltip && (
        <div
          ref={tipRef}
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-50 w-max max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
          style={{ left: 8, top: 8 }}
        >
          <p className="text-[10px] text-muted-foreground">{tooltip.cell.label}</p>
          <p className="mt-0.5 text-xs font-semibold">
            {valueLabel(tooltip.cell.value)}
            {tooltip.cell.value === 0 ? " · No activity" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

export default ActivityHeatmap;
