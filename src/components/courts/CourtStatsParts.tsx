import type { ReactNode } from "react";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { cn } from "@/lib/utils";
import type { Series } from "./courtStatsData";

export function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  tone?: "up" | "down" | undefined;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface px-3 py-2">
      <div className="truncate text-[11px] text-muted-foreground" title={label}>
        {label}
      </div>
      <div className="mt-0.5 font-sans text-lg font-semibold leading-tight tabular-nums">
        {value}
      </div>
      {note ? (
        <div
          className={cn(
            "truncate text-[11px]",
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
    </div>
  );
}

/** Inline SVG sparkline over a fixed fiscal-year axis; a missing value breaks the line. */
export function Spark({
  values,
  highlight,
  color = FDA_COLORS[0]!,
  width = 72,
  height = 18,
  label,
}: {
  values: Series;
  highlight?: number | undefined;
  color?: string | undefined;
  width?: number;
  height?: number;
  label?: string | undefined;
}) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2)
    return <span className="text-[11px] text-muted-foreground">Not recorded</span>;
  const max = Math.max(...present, 1);
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * (width - 4) + 2;
  const y = (v: number) => height - 2 - (v / max) * (height - 4);
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
  const h = highlight !== undefined ? values[highlight] : null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? "Fiscal-year trend"}
      className="shrink-0 overflow-visible"
    >
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.4} />
      ))}
      {highlight !== undefined && h !== null && h !== undefined ? (
        <circle cx={x(highlight)} cy={y(h)} r={2} fill={color} />
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
