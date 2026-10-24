import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { seriesColor } from "@/components/charts/recharts/theme";
import { cn } from "@/lib/utils";
import type { Series } from "./courtStatsData";

export function Kpi({
  label,
  value,
  note,
  tone,
  detail,
  title,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  tone?: "up" | "down" | undefined;
  /** Second line shown in the warning tone (e.g. a benchmark caveat); `title` carries the full text. */
  detail?: string | undefined;
  title?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface px-3 py-2" title={title}>
      <div className="truncate text-[11px] text-muted-foreground" title={label}>
        {label}
      </div>
      <div className="mt-0.5 font-sans text-lg font-semibold leading-tight tabular-nums">
        {value}
      </div>
      {note ? (
        <div
          className={cn(
            "text-[11px] leading-snug",
            tone === "up"
              ? "text-warning-foreground"
              : tone === "down"
                ? "text-primary"
                : "text-muted-foreground",
          )}
          title={note}
        >
          {note}
        </div>
      ) : null}
      {detail ? (
        <div className="text-[11px] leading-snug text-warning-foreground" title={title ?? detail}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Horizontal scroll region for wide tables: shows an edge shadow and a "more columns" cue while
 * columns are hidden to the right, so a cut-off table is never mistaken for the whole table.
 */
export function ScrollX({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const update = useCallback(() => {
    const el = ref.current;
    if (el) setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);
  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={update}
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        {children}
      </div>
      {more ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-4"
            style={{
              boxShadow:
                "inset -12px 0 10px -10px color-mix(in srgb, var(--foreground) 35%, transparent)",
            }}
          />
          <span className="pointer-events-none absolute right-2 top-1 rounded border border-border bg-surface px-1 text-[10px] text-muted-foreground">
            More columns →
          </span>
        </>
      ) : null}
    </div>
  );
}

/** Inline SVG sparkline over a fixed fiscal-year axis; a missing value breaks the line. */
/**
 * Table-row sparkline at the kit's readable size (at least 120 × 32): the series in the de-emphasis grey on a zero
 * baseline, the selected fiscal year as an accent dot. The row's own cells carry the values.
 */
export function Spark({
  values,
  highlight,
  width = 120,
  height = 32,
  label,
}: {
  values: Series;
  highlight?: number | undefined;
  /** Kept for callers; the line is always the de-emphasis grey and the dot the accent. */
  color?: string | undefined;
  width?: number;
  height?: number;
  label?: string | undefined;
}) {
  const w = Math.max(120, width);
  const h = Math.max(32, height);
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2)
    return <span className="text-[11px] text-muted-foreground">Not recorded</span>;
  const max = Math.max(...present, 1);
  const pad = 4;
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * (w - pad * 2) + pad;
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const segments: string[] = [];
  let path = "";
  values.forEach((v, i) => {
    if (v === null) {
      if (path) segments.push(path);
      path = "";
      return;
    }
    path += `${path ? " L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (path) segments.push(path);
  const hv = highlight !== undefined ? values[highlight] : null;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label ?? "Fiscal-year trend"}
      className="shrink-0 overflow-visible"
    >
      <line
        x1={pad}
        x2={w - pad}
        y1={h - pad}
        y2={h - pad}
        stroke="var(--border)"
        strokeWidth={1}
        shapeRendering="crispEdges"
      />
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeOpacity={0.75}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {highlight !== undefined && hv !== null && hv !== undefined ? (
        <circle
          cx={x(highlight)}
          cy={y(hv)}
          r={3.5}
          fill={seriesColor(0)}
          stroke="var(--surface)"
          strokeWidth={1.5}
        />
      ) : null}
    </svg>
  );
}

export function Notice({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-4 py-5 text-sm",
        tone === "error"
          ? "border-destructive/40 text-destructive"
          : "border-border text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
      <div className="mr-auto min-w-0">
        <h3 className="font-sans text-sm font-semibold leading-5">{title}</h3>
        {subtitle ? <p className="text-xs leading-4 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
