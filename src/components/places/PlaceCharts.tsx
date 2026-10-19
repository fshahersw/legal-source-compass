import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { cn } from "@/lib/utils";
import {
  formatPlaceValue,
  NOT_RECORDED,
  residenceShares,
  type Bin,
  type PlaceFormat,
} from "./placeMetrics";

/** Compact equal-width histogram with the state's median marked. */
export function MiniHistogram({
  bins,
  median,
  format,
  label,
}: {
  bins: Bin[];
  median: number | null;
  format: PlaceFormat;
  label: string;
}) {
  if (!bins.length) return <p className="text-[11px] text-muted-foreground">{NOT_RECORDED}</p>;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const lo = bins[0]!.lo,
    hi = bins[bins.length - 1]!.hi;
  // bars are equal-width from the first bin's lower bound; the last bin may hold an open-ended tail up to the maximum
  const width = bins[0]!.hi - bins[0]!.lo;
  const medX =
    median != null && width > 0
      ? Math.min(100, ((median - lo) / (width * bins.length)) * 100)
      : null;
  return (
    <figure className="m-0" aria-label={label}>
      <svg
        viewBox="0 0 100 34"
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label={label}
      >
        {bins.map((b, i) => {
          const w = 100 / bins.length;
          const h = (b.count / max) * 30;
          return (
            <rect
              key={i}
              x={i * w + 0.4}
              y={32 - h}
              width={Math.max(w - 0.8, 0.4)}
              height={h}
              fill={FDA_COLORS[1]}
              opacity={0.75}
            >
              <title>{`${formatPlaceValue(b.lo, format)} to ${formatPlaceValue(b.hi, format)}: ${b.count}`}</title>
            </rect>
          );
        })}
        {medX != null ? (
          <line
            x1={medX}
            x2={medX}
            y1={0}
            y2={33}
            stroke="var(--foreground)"
            strokeWidth={0.6}
            strokeDasharray="1.5 1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <line
          x1={0}
          x2={100}
          y1={32.5}
          y2={32.5}
          stroke="var(--border-strong)"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
        <span>{formatPlaceValue(lo, format)}</span>
        {median != null ? <span>median {formatPlaceValue(median, format)}</span> : null}
        <span>{formatPlaceValue(hi, format)}</span>
      </figcaption>
    </figure>
  );
}

const CLASS_COLOR: Record<string, string> = {
  own_counties: FDA_COLORS[0]!,
  other_in_state: FDA_COLORS[3]!,
  in_state_no_district: FDA_COLORS[5]!,
  screened_code: FDA_COLORS[4]!,
  out_of_state: FDA_COLORS[2]!,
  outside_us: FDA_COLORS[1]!,
  unmatched_code: "var(--border-strong)",
  missing: "var(--muted)",
};

/** One horizontal stacked bar of where a district's filers live (FJC residence codes). */
export function ResidenceBar({
  counts,
  className,
}: {
  counts: Record<string, number>;
  className?: string;
}) {
  const shares = residenceShares(counts);
  if (!shares.length)
    return <span className="text-[11px] text-muted-foreground">{NOT_RECORDED}</span>;
  return (
    <div
      className={cn("flex h-2.5 w-full min-w-24 overflow-hidden rounded-sm bg-muted", className)}
      role="img"
      aria-label={shares.map((s) => `${s.label} ${s.pct.toFixed(1)}%`).join("; ")}
    >
      {shares.map((s) => (
        <span
          key={s.key}
          style={{ width: `${s.pct}%`, background: CLASS_COLOR[s.key] }}
          title={`${s.label}: ${s.pct.toFixed(1)}% (${s.count.toLocaleString("en-US")})`}
        />
      ))}
    </div>
  );
}

export function ResidenceLegend({ counts }: { counts: Record<string, number> }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[11px] text-muted-foreground">
      {residenceShares(counts).map((s) => (
        <li key={s.key} className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-sm"
            style={{ background: CLASS_COLOR[s.key] }}
          />
          {s.label}{" "}
          <span className="font-mono tabular-nums text-foreground">{s.pct.toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars for a short yearly series (values labelled on hover; missing years are gaps). */
export function YearBars({
  series,
  years,
  format = "int",
  label,
  color = FDA_COLORS[0]!,
}: {
  series: Record<string, number>;
  years: string[];
  format?: PlaceFormat;
  label: string;
  color?: string;
}) {
  const vals = years.map((y) => series[y]);
  const nums = vals.filter((v): v is number => typeof v === "number");
  if (!nums.length) return <p className="text-[11px] text-muted-foreground">{NOT_RECORDED}</p>;
  const max = Math.max(...nums, 1);
  return (
    <figure className="m-0" aria-label={label}>
      <div
        className="flex h-20 items-end gap-0.5"
        role="img"
        aria-label={`${label}: ${years.map((y, i) => `${y} ${formatPlaceValue(vals[i] ?? null, format)}`).join(", ")}`}
      >
        {years.map((y, i) => {
          const v = vals[i];
          return (
            <span
              key={y}
              className="min-w-0 flex-1 rounded-t-sm"
              style={{
                height: v == null ? 0 : `${Math.max(2, (v / max) * 100)}%`,
                background: color,
                opacity: 0.85,
              }}
              title={`${y}: ${formatPlaceValue(v ?? null, format)}`}
            />
          );
        })}
      </div>
      <figcaption className="mt-0.5 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
        <span>{years[0]}</span>
        <span>{years[years.length - 1]}</span>
      </figcaption>
    </figure>
  );
}

/** Horizontal share bars (label, value, percent of the largest). */
export function ShareList({
  items,
  format = "int",
}: {
  items: { label: string; value: number }[];
  format?: PlaceFormat;
}) {
  if (!items.length) return <p className="text-[11px] text-muted-foreground">{NOT_RECORDED}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="m-0 list-none space-y-1 p-0 text-[11.5px]">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
          <span className="truncate" title={i.label}>
            {i.label}
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {formatPlaceValue(i.value, format)}
          </span>
          <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{ width: `${(i.value / max) * 100}%`, background: FDA_COLORS[0] }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
