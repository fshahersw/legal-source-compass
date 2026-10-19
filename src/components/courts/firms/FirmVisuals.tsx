import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { int } from "@/components/analysis/analysisFormat";
import type { Side } from "@/lib/external/firmIntel.functions";
import { cn } from "@/lib/utils";
import { SIDE_COLOR, SIDE_LABEL } from "./firmQueries";

/** A firm name, linked to its record only when the stored link is exactly a firm record path. */
export function FirmName({
  firm,
  href,
  className,
}: {
  firm: string;
  href: string | null;
  className?: string;
}) {
  if (!href)
    return (
      <span className={className} title={firm}>
        {firm}
      </span>
    );
  const id = href.slice("/records/firm_profiles/".length);
  return (
    <Link
      to="/records/$dataset/$id"
      params={{ dataset: "firm_profiles", id }}
      title={firm}
      className={cn("text-primary hover:underline", className)}
    >
      {firm}
    </Link>
  );
}

/** Legend chips for the three sides. */
export function SideLegend({ sides = ["plaintiff", "defense", "other"] }: { sides?: Side[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[11px] text-muted-foreground">
      {sides.map((s) => (
        <li key={s} className="inline-flex items-center gap-1">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: SIDE_COLOR[s] }}
            aria-hidden
          />
          {SIDE_LABEL[s]}
        </li>
      ))}
    </ul>
  );
}

/** One horizontal bar split by side; widths are shares of `max` so rows compare on one scale. */
export function SideBar({
  parts,
  max,
  label,
}: {
  parts: Partial<Record<Side, number | null>>;
  max: number;
  label: string;
}) {
  const total = (["plaintiff", "defense", "other"] as const).reduce(
    (s, k) => s + (parts[k] ?? 0),
    0,
  );
  return (
    <span
      className="flex h-3 w-full overflow-hidden rounded-sm bg-muted"
      role="img"
      aria-label={label}
    >
      {(["plaintiff", "defense", "other"] as const).map((k) => {
        const v = parts[k] ?? 0;
        if (!(v > 0) || !(max > 0)) return null;
        return (
          <span
            key={k}
            className="block h-3 motion-safe:transition-[width] motion-safe:duration-500"
            style={{ width: `${(100 * v) / max}%`, background: SIDE_COLOR[k] }}
          />
        );
      })}
      <span className="sr-only">{int(total)}</span>
    </span>
  );
}

/** A 0-100 share bar with the number printed beside it. */
export function ShareMeter({
  value,
  color = FDA_COLORS[0]!,
  label,
}: {
  value: number | null;
  color?: string;
  label: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="h-2 min-w-12 flex-1 rounded-sm bg-muted" role="img" aria-label={label}>
        <span
          className="block h-2 rounded-sm motion-safe:transition-[width] motion-safe:duration-500"
          style={{
            width: `${value == null ? 0 : Math.max(0, Math.min(100, value))}%`,
            background: color,
          }}
        />
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-[11px]">
        {value == null ? "—" : `${value.toFixed(1)}%`}
      </span>
    </span>
  );
}

/** A small rank scatter (each point an MDL); axes are ranks so one large MDL does not flatten the rest. */
export function RankScatter({
  points,
  xLabel,
  yLabel,
  label,
}: {
  points: readonly { mdl: number; x: number; y: number }[];
  xLabel: string;
  yLabel: string;
  label: string;
}) {
  const rank = (vals: number[]) => {
    const sorted = [...vals].sort((a, b) => a - b);
    return vals.map((v) => {
      const first = sorted.indexOf(v);
      const last = sorted.lastIndexOf(v);
      return (first + last) / 2;
    });
  };
  const rx = rank(points.map((p) => p.x));
  const ry = rank(points.map((p) => p.y));
  const n = Math.max(points.length - 1, 1);
  const W = 120;
  const H = 72;
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={label}
        className="overflow-visible"
      >
        <rect x="0.5" y="0.5" width={W - 1} height={H - 1} fill="none" stroke="var(--border)" />
        {points.map((p, i) => (
          <circle
            key={p.mdl}
            cx={6 + (rx[i]! / n) * (W - 12)}
            cy={H - 6 - (ry[i]! / n) * (H - 12)}
            r="2.4"
            fill={FDA_COLORS[0]}
            fillOpacity="0.75"
          >
            <title>{`MDL ${p.mdl}: ${xLabel} ${int(p.x)}, ${yLabel} ${int(p.y)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
        Rank of {xLabel} → · ↑ rank of {yLabel}
      </figcaption>
    </figure>
  );
}

/** Label and value pairs in a compact definition list. */
export function Facts({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="m-0 min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
