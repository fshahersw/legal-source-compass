import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Info, MapPinned, X } from "lucide-react";
import { ChartCard } from "@/components/fda-analytics/FdaCharts";
import { StateMark } from "@/components/corpus/EntityArtwork";
import { UsMap } from "@/components/corpus/UsMap";
import { useCorpus } from "@/lib/corpus/store";
import {
  getStateMetrics,
  type MetricDef,
  type StateMetricsBundle,
  type StateProfile,
} from "@/lib/external/stateMetrics.functions";
import { cn } from "@/lib/utils";
import { HistogramChart, SmallMultiples, StateScatter, TrendChart } from "./StateCharts";
import { StateRankingTable } from "./StateRankingTable";
import {
  commonYear,
  correlationLabel,
  coveredYears,
  defaultYear,
  formatChange,
  formatValue,
  median,
  metricGroups,
  OUTLIER_Z,
  pearson,
  rankStates,
  type StateMetricsPatch,
  type StateMetricsSearch,
} from "./stateMetricsMath";

export const stateMetricsQuery = {
  queryKey: ["state-metrics"],
  queryFn: () => getStateMetrics(),
  staleTime: 10 * 60 * 1000,
};

const DEFAULT_METRIC = "overdose_rate";
const PRESETS: { label: string; x: string; y: string }[] = [
  { label: "Overdose vs synthetic opioids", x: "synthetic_opioid_rate", y: "overdose_rate" },
  { label: "Traffic deaths vs vehicle complaints", x: "nhtsa_complaint_rate", y: "fars_rate" },
  { label: "Overdose vs unemployment", x: "unemployment_rate", y: "overdose_rate" },
  { label: "Overdose vs income", x: "per_capita_income", y: "overdose_rate" },
];
const isTotal = (m: MetricDef) => m.format === "int" || m.format === "money_m";
const selectClass =
  "h-8 min-w-0 rounded-md border border-input bg-surface px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring";

function MetricSelect({
  id,
  label,
  value,
  metrics,
  onChange,
  className,
}: {
  id: string;
  label: string;
  value: string;
  metrics: MetricDef[];
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <label htmlFor={id} className={cn("flex min-w-0 flex-col gap-0.5 text-[11px]", className)}>
      <span className="text-muted-foreground">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
      >
        {metricGroups(metrics).map(({ group, items }) => (
          <optgroup key={group} label={group}>
            {items.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
  tone?: "warning" | undefined;
  onClick?: (() => void) | undefined;
}) {
  const body = (
    <>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate font-mono text-lg font-semibold leading-tight",
          tone === "warning" && "text-warning-foreground",
        )}
      >
        {value}
      </span>
      {detail ? <span className="truncate text-[11px] text-muted-foreground">{detail}</span> : null}
    </>
  );
  const cls = cn(
    "flex min-w-0 flex-col items-start rounded-lg border bg-surface px-3 py-2 text-left",
    tone === "warning" ? "border-warning/50" : "border-border",
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(cls, "hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring")}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function SourceLine({ def }: { def: MetricDef }) {
  const sources = def.sources.filter(
    (s, i) => def.sources.findIndex((t) => t.publisher === s.publisher) === i,
  );
  return (
    <span>
      Source:{" "}
      {sources.map((s, i) => (
        <span key={s.url}>
          {i ? "; " : ""}
          <a href={s.page ?? s.url} target="_blank" rel="noreferrer" className="underline">
            {s.publisher}
          </a>
        </span>
      ))}
      .
    </span>
  );
}

export function StateMetricsDashboard({
  search,
  onSearch,
}: {
  search: StateMetricsSearch;
  onSearch: (patch: StateMetricsPatch) => void;
}) {
  const q = useQuery(stateMetricsQuery);
  if (q.isLoading)
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading state metrics">
        <div className="h-14 animate-pulse rounded-lg border border-border bg-muted/50" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-border bg-muted/50"
            />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    );
  if (q.isError)
    return (
      <div role="alert" className="rounded-lg border border-border px-4 py-4 text-sm">
        <span className="text-destructive">State metrics could not be loaded.</span>{" "}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </div>
    );
  const data = q.data;
  if (!data || !data.metrics.length || !data.states.length)
    return (
      <p className="rounded-lg border border-border px-4 py-4 text-sm text-muted-foreground">
        No state metrics have been published yet.
      </p>
    );
  return <Dashboard data={data} search={search} onSearch={onSearch} />;
}

function Dashboard({
  data,
  search,
  onSearch,
}: {
  data: StateMetricsBundle;
  search: StateMetricsSearch;
  onSearch: (patch: StateMetricsPatch) => void;
}) {
  const corpus = useCorpus();
  const selectable = useMemo(() => data.metrics.filter((m) => m.selectable), [data.metrics]);
  const byKey = useMemo(() => new Map(data.metrics.map((m) => [m.key, m])), [data.metrics]);
  const def =
    (search.metric && byKey.get(search.metric)?.selectable
      ? byKey.get(search.metric)
      : undefined) ??
    byKey.get(DEFAULT_METRIC) ??
    selectable[0]!;
  const years = useMemo(() => coveredYears(data.states, def.key), [data.states, def.key]);
  const year =
    search.year != null && years.includes(search.year)
      ? search.year
      : (defaultYear(def, data.states) ?? years.at(-1) ?? 0);
  const ranked = useMemo(() => {
    const rows = rankStates(data.states, def.key, year);
    // A partial year against a full base year is not a like-for-like change: suppress it.
    return def.partialYears[String(year)] ? rows.map((r) => ({ ...r, change5: null })) : rows;
  }, [data.states, def.key, def.partialYears, year]);
  const selectedProfile: StateProfile | null =
    data.states.find((s) => s.usps === search.state) ?? null;
  const selectedRank = ranked.find((r) => r.usps === selectedProfile?.usps) ?? null;
  const stateMedian = median(ranked.map((r) => r.value));
  const outliers = ranked.filter((r) => r.outlier);
  const partial = def.partialYears[String(year)];
  const nationalValue = def.national[String(year)];
  const mapValues = useMemo(() => new Map(ranked.map((r) => [r.fips, r.value])), [ranked]);

  const xDef = (search.x && byKey.get(search.x)) || byKey.get(PRESETS[0]!.x) || selectable[0]!;
  const yDef = (search.y && byKey.get(search.y)) || byKey.get(PRESETS[0]!.y) || selectable[1]!;
  const scatterYear = commonYear(data.states, xDef, yDef);
  const points = useMemo(
    () =>
      scatterYear == null
        ? []
        : data.states.flatMap((s) => {
            const x = s.series[xDef.key]?.[String(scatterYear)];
            const y = s.series[yDef.key]?.[String(scatterYear)];
            return typeof x === "number" && typeof y === "number"
              ? [{ usps: s.usps, name: s.name, x, y }]
              : [];
          }),
    [data.states, xDef.key, yDef.key, scatterYear],
  );
  const r = pearson(points.map((p) => [p.x, p.y]));
  const crossOutliers = useMemo(() => {
    const rows: { usps: string; name: string; metric: MetricDef; z: number; year: number }[] = [];
    for (const s of data.states)
      for (const [key, l] of Object.entries(s.latest)) {
        const m = byKey.get(key);
        // Raw totals mostly track population size, so only normalised metrics are listed here.
        if (m?.selectable && !isTotal(m) && l.outlier && l.z != null)
          rows.push({ usps: s.usps, name: s.name, metric: m, z: l.z, year: l.year });
      }
    return rows.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  }, [data.states, byKey]);
  const select = (usps: string) => onSearch({ state: search.state === usps ? undefined : usps });
  const comparison =
    def.format === "int" || def.format === "money_m"
      ? "Totals scale with population; use a per-capita metric to compare states fairly."
      : "Per-capita or rate metric: comparable across states of different size.";

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <MetricSelect
          id="state-metric"
          label="Metric"
          value={def.key}
          metrics={data.metrics}
          onChange={(key) => onSearch({ metric: key, year: undefined })}
          className="w-full sm:w-80"
        />
        <label htmlFor="state-metric-year" className="flex flex-col gap-0.5 text-[11px]">
          <span className="text-muted-foreground">Year</span>
          <select
            id="state-metric-year"
            value={year}
            onChange={(e) => onSearch({ year: Number(e.target.value) })}
            className={selectClass}
          >
            {[...years].reverse().map((y) => (
              <option key={y} value={y}>
                {y}
                {def.partialYears[String(y)] ? " (partial)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="state-metric-state" className="flex flex-col gap-0.5 text-[11px]">
          <span className="text-muted-foreground">Highlight state</span>
          <select
            id="state-metric-state"
            value={selectedProfile?.usps ?? ""}
            onChange={(e) => onSearch({ state: e.target.value || undefined })}
            className={cn(selectClass, "w-44")}
          >
            <option value="">None</option>
            {[...data.states]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <option key={s.usps} value={s.usps}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <p className="ml-auto max-w-md text-[11px] leading-4 text-muted-foreground">{def.method}</p>
      </div>

      {partial ? (
        <p
          role="status"
          className="flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/10 px-3 py-1.5 text-xs"
        >
          <AlertTriangle className="size-3.5 text-warning" aria-hidden />
          {year} is a partial year ({partial}). Ranks and z-scores below describe incomplete data
          and are not used for the published state ranks.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={`United States, ${year}`}
          value={formatValue(nationalValue, def.format)}
          detail={
            nationalValue == null
              ? "No national figure"
              : def.denominator
                ? "U.S. numerator ÷ U.S. population"
                : (def.nationalBasis ?? undefined)
          }
        />
        <Kpi
          label="State median"
          value={formatValue(stateMedian, def.format)}
          detail={`${ranked.length} of ${data.states.length} reporting`}
        />
        <Kpi
          label="Highest"
          value={formatValue(ranked[0]?.value, def.format)}
          detail={ranked[0]?.name}
          onClick={ranked[0] ? () => select(ranked[0]!.usps) : undefined}
        />
        <Kpi
          label="Lowest"
          value={formatValue(ranked.at(-1)?.value, def.format)}
          detail={ranked.at(-1)?.name}
          onClick={ranked.at(-1) ? () => select(ranked.at(-1)!.usps) : undefined}
        />
        <Kpi
          label={`Outliers (|z| > ${OUTLIER_Z})`}
          value={String(outliers.length)}
          detail={outliers.map((o) => o.usps).join(", ") || "None"}
          tone={outliers.length ? "warning" : undefined}
        />
        <Kpi
          label="Coverage"
          value={`${ranked.length}/${data.states.length}`}
          detail={def.years ? `Series ${def.years[0]}–${def.years[1]}` : undefined}
        />
      </div>

      {selectedProfile ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
          <StateMark state={selectedProfile.usps} className="size-9" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{selectedProfile.name}</div>
            <div className="text-muted-foreground">
              {def.short}, {year}:{" "}
              <span className="font-mono text-foreground">
                {formatValue(selectedRank?.value, def.format)}
              </span>
              {selectedRank
                ? ` · rank ${selectedRank.rank} of ${ranked.length} · z ${selectedRank.z ?? "—"} · 5-yr ${formatChange(selectedRank.change5)}`
                : ""}
            </div>
          </div>
          <Link
            to="/places/$state"
            params={{ state: selectedProfile.usps }}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 hover:bg-muted"
          >
            <MapPinned className="size-3.5" aria-hidden />
            State page
          </Link>
          <button
            type="button"
            onClick={() => onSearch({ state: undefined })}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
            aria-label="Clear highlighted state"
          >
            <X className="size-3.5" aria-hidden />
            Clear
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <section className="min-w-0 space-y-1" aria-label={`Map of ${def.short}`}>
          {corpus.geo ? (
            <UsMap
              geo={corpus.geo}
              values={mapValues}
              valueLabel={def.unit}
              selectedState={selectedProfile?.usps}
              onState={(fips) => {
                const s = data.states.find((x) => x.fips === fips);
                if (s) select(s.usps);
              }}
            />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-lg border border-border text-xs text-muted-foreground">
              {corpus.error
                ? "Map geometry unavailable; the ranking remains available."
                : "Loading map…"}
            </div>
          )}
          <p className="px-1 text-[11px] text-muted-foreground">
            Shading: {def.label}, {year} (square-root scale; lightest = lowest or not recorded).{" "}
            {comparison} <SourceLine def={def} />
          </p>
        </section>
        <ChartCard
          title={`Ranking · ${def.short}, ${year}`}
          subtitle={`Rank 1 = highest. High / Low = outlier, |z| > ${OUTLIER_Z} (population SD across ${ranked.length} jurisdictions).`}
          footnote={
            <span>
              5-yr Δ compares {year} with {year - 5}. * = CDC footnote (hover).{" "}
              <SourceLine def={def} />
            </span>
          }
        >
          <StateRankingTable
            def={def}
            year={year}
            ranked={ranked}
            states={data.states}
            selected={selectedProfile?.usps ?? null}
            onSelect={select}
          />
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title={`Trend · ${selectedProfile ? selectedProfile.name : "state distribution"}`}
          subtitle={`${def.short} by year against the median and interquartile range of the states${def.format !== "int" && def.format !== "money_m" ? " and the U.S. value" : ""}.`}
          footnote={
            <span>
              {Object.keys(def.partialYears).length
                ? `Partial year: ${Object.entries(def.partialYears)
                    .map(([y, note]) => `${y} (${note})`)
                    .join("; ")}. `
                : ""}
              <SourceLine def={def} />
            </span>
          }
        >
          <TrendChart def={def} state={selectedProfile} years={years} />
        </ChartCard>
        <ChartCard
          title={`Distribution · ${year}`}
          subtitle="Number of states in each equal-width band; the dark bar holds the median."
          footnote={
            <span>
              Median {formatValue(stateMedian, def.format)} across {ranked.length} states.{" "}
              <SourceLine def={def} />
            </span>
          }
        >
          <HistogramChart def={def} ranked={ranked} median={stateMedian} />
        </ChartCard>
      </div>

      <ChartCard
        title={`Small multiples · ${def.short}, ${years[0] ?? ""}–${years.at(-1) ?? ""}`}
        subtitle={`Every state on one shared scale, ordered by ${year} value; dashed line = state median by year. Amber = outlier in ${year}.`}
        footnote={<SourceLine def={def} />}
      >
        <SmallMultiples
          def={def}
          states={data.states}
          ranked={ranked}
          years={years}
          selected={selectedProfile?.usps ?? null}
          onSelect={select}
        />
      </ChartCard>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          title="Correlation"
          subtitle={
            scatterYear == null
              ? "No common full year with at least 30 states reporting both metrics."
              : `${yDef.short} vs ${xDef.short}, ${scatterYear}: Pearson r = ${r == null ? "not computable" : r.toFixed(2)} (${correlationLabel(r)}), n = ${points.length}.`
          }
          footnote={
            <span>
              Pearson r over states reporting both values in the latest common full year; dashed
              line = least-squares fit. Correlation is descriptive and does not show causation.
            </span>
          }
        >
          <div className="flex flex-wrap items-end gap-2 border-b border-border/60 px-3 py-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Correlation presets">
              {PRESETS.filter((p) => byKey.has(p.x) && byKey.has(p.y)).map((p) => (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={xDef.key === p.x && yDef.key === p.y}
                  onClick={() => onSearch({ x: p.x, y: p.y })}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px]",
                    xDef.key === p.x && yDef.key === p.y
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <MetricSelect
              id="scatter-x"
              label="X axis"
              value={xDef.key}
              metrics={data.metrics}
              onChange={(key) => onSearch({ x: key })}
              className="w-full sm:w-56"
            />
            <MetricSelect
              id="scatter-y"
              label="Y axis"
              value={yDef.key}
              metrics={data.metrics}
              onChange={(key) => onSearch({ y: key })}
              className="w-full sm:w-56"
            />
          </div>
          <StateScatter
            points={points}
            xDef={xDef}
            yDef={yDef}
            selected={selectedProfile?.usps ?? null}
            onSelect={select}
          />
        </ChartCard>
        <ChartCard
          title="Outlier flags, latest ranked year"
          subtitle={`Every per-capita, rate or percentage metric with |z| > ${OUTLIER_Z} in its latest complete year, largest first. Raw totals are excluded because they mostly reflect population.`}
          footnote={<span>{data.outlierRule ?? ""}</span>}
        >
          {crossOutliers.length ? (
            <ul className="max-h-[360px] divide-y divide-border/60 overflow-auto text-xs">
              {crossOutliers.map((o) => (
                <li key={`${o.usps}:${o.metric.key}`}>
                  <button
                    type="button"
                    onClick={() => onSearch({ metric: o.metric.key, year: o.year, state: o.usps })}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50"
                  >
                    <StateMark state={o.usps} className="size-6 rounded-md p-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{o.name}</span>
                      <span className="block truncate text-muted-foreground">
                        {o.metric.short} · {o.year}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded border px-1 font-mono text-[10.5px]",
                        o.z > 0
                          ? "border-warning/50 bg-warning/15 text-warning-foreground"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      z {o.z > 0 ? "+" : ""}
                      {o.z.toFixed(2)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-6 text-xs text-muted-foreground">No outliers under this rule.</p>
          )}
        </ChartCard>
      </div>

      <section
        className="rounded-lg border border-border bg-surface px-3 py-2 text-xs"
        aria-label="Definition and sources"
      >
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Info className="size-3.5" aria-hidden />
          {def.label}
        </h3>
        <p className="mt-1 text-muted-foreground">{def.method}</p>
        {def.caveats.length ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {def.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
        <ul className="mt-2 space-y-1">
          {def.sources.map((s) => (
            <li key={s.url} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{s.publisher}</span>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                {s.name}
                <ExternalLink className="size-3" aria-hidden />
              </a>
              {s.retrieved ? (
                <span className="text-muted-foreground">retrieved {s.retrieved.slice(0, 10)}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted-foreground">
          {data.rankRule}{" "}
          {data.generatedAt ? `Built ${data.generatedAt.slice(0, 10)} from official files.` : ""}{" "}
          Values not published by the source are shown as “Not recorded”.
        </p>
      </section>
    </div>
  );
}
