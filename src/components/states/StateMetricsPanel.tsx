import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, BarChart3 } from "lucide-react";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  getStateMetricsPanel,
  type LatestStat,
  type MetricDef,
} from "@/lib/external/stateMetrics.functions";
import { cn } from "@/lib/utils";
import { formatChange, formatValue } from "./stateMetricsMath";

/** Short qualifiers shown beside a metric whose geography is not where people live. */
const ROW_NOTE: Record<string, string> = {
  fda_recalls: "by recalling-firm HQ state",
};
const PANEL_METRICS = [
  "population",
  "per_capita_income",
  "unemployment_rate",
  "overdose_rate",
  "synthetic_opioid_rate",
  "fars_rate",
  "nhtsa_complaint_rate",
  "fda_recalls",
];

function Spark({ series, years }: { series: Record<string, number>; years: string[] }) {
  const values = years.map((y) => series[y]);
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length < 2) return <span className="h-5 w-16" aria-hidden />;
  const max = Math.max(...nums),
    min = Math.min(...nums);
  const span = max - min || 1;
  let d = "";
  values.forEach((v, i) => {
    if (typeof v !== "number") return;
    const x = 1 + (i / Math.max(values.length - 1, 1)) * 62;
    const y = 18 - ((v - min) / span) * 16;
    d += `${d ? " L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox="0 0 64 20" className="h-5 w-16 shrink-0" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={FDA_COLORS[1]}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Compact official-metrics panel for a state page: latest value, rank, 5-year change and trend. */
export function StateMetricsPanel({
  usps,
  metrics = PANEL_METRICS,
  heading = "State metrics",
  note,
}: {
  usps: string;
  /** Metric keys to list, in order (default: the full panel). */
  metrics?: string[] | undefined;
  heading?: string | undefined;
  /** A line under the list, e.g. where the metrics left out here are shown. */
  note?: string | undefined;
}) {
  const fn = useServerFn(getStateMetricsPanel);
  const q = useQuery({
    queryKey: ["state-metrics-panel", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60 * 1000,
  });
  const defs = new Map((q.data?.metrics ?? []).map((m) => [m.key, m]));
  const profile = q.data?.profile ?? null;
  const rows = metrics.flatMap((key) => {
    const def = defs.get(key);
    const latest = profile?.latest[key];
    return def ? [{ def, latest }] : [];
  });
  return (
    <section className="resource-panel" aria-label="State metrics">
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="size-4" aria-hidden />
          {heading}
        </h2>
        <span className="text-[11px] text-[var(--navy-muted)]">rank of 50 + DC</span>
      </div>
      {q.isPending ? (
        <p role="status" className="px-3 py-6 text-xs text-muted-foreground">
          Loading metrics…
        </p>
      ) : q.error ? (
        <div role="alert" className="p-3 text-xs">
          Metrics could not load.
          <button type="button" className="ml-2 underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : !profile || !rows.length ? (
        <p className="p-3 text-xs text-muted-foreground">
          No official metrics are published for this state yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {rows.map(({ def, latest }) => (
            <MetricRow
              key={def.key}
              def={def}
              latest={latest}
              series={profile.series[def.key] ?? {}}
              usps={usps}
            />
          ))}
        </ul>
      )}
      {note ? (
        <p className="m-0 border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
          {note}
        </p>
      ) : null}
      <Link
        to="/places/analytics"
        search={{ state: usps }}
        className="flex w-full items-center justify-between border-t border-border bg-muted/30 px-3 py-2.5 text-xs font-medium text-primary hover:bg-muted"
      >
        Compare all states
        <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}

function MetricRow({
  def,
  latest,
  series,
  usps,
}: {
  def: MetricDef;
  latest: LatestStat | undefined;
  series: Record<string, number>;
  usps: string;
}) {
  const years = Object.keys(series).sort().slice(-10);
  return (
    <li>
      <Link
        to="/places/analytics"
        search={{ metric: def.key, state: usps }}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40"
        title={`${def.label}. ${def.method}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] leading-tight text-muted-foreground">
            {def.short}
            {ROW_NOTE[def.key] ? (
              <span className="text-[10.5px]"> · {ROW_NOTE[def.key]}</span>
            ) : null}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-[13px] font-semibold">
              {formatValue(latest?.value, def.format)}
            </span>
            {latest ? (
              <span className="text-[10.5px] text-muted-foreground">{latest.year}</span>
            ) : null}
            {latest?.outlier && def.format !== "int" && def.format !== "money_m" ? (
              <span
                className={cn(
                  "rounded border px-1 text-[10px]",
                  latest.outlier === "high"
                    ? "border-warning/50 bg-warning/15 text-warning-foreground"
                    : "border-border bg-muted text-muted-foreground",
                )}
                title={`z = ${latest.z}; |z| > 2 across the 50 states + DC`}
              >
                {latest.outlier}
              </span>
            ) : null}
          </span>
          <span className="block text-[10.5px] text-muted-foreground">
            {latest?.rank ? `#${latest.rank} of ${latest.of}` : "Not ranked"}
            {latest?.change5 != null
              ? ` · 5-yr ${formatChange(latest.change5, latest.change5Unit)}`
              : ""}
          </span>
        </span>
        <Spark series={series} years={years} />
      </Link>
    </li>
  );
}
