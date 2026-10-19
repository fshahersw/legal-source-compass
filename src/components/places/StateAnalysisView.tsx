import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Grid3x3,
  Landmark,
  Lightbulb,
  Map as MapIcon,
  Search,
} from "lucide-react";
import { HowToRead } from "@/components/analysis/HowToRead";
import { ANALYSIS_MEASURES } from "./analysisMeasures";
import { ChartCard } from "@/components/fda-analytics/FdaCharts";
import { useCorpus } from "@/lib/corpus/store";
import { getStateCountyAnalysis, type CountyRow } from "@/lib/external/countyAnalysis.functions";
import { getStateAnalysis, type StateAnalysis } from "@/lib/external/stateAnalysis.functions";
import { getStateCities, type CityRow } from "@/lib/external/placeProfiles.functions";
import type { DistrictSummary } from "@/lib/external/placeAnalysisParse";
import { cn } from "@/lib/utils";
import { AssociationGrid, HoldingList } from "./AssociationGrid";
import { CountyChoropleth } from "./CountyChoropleth";
import { MiniHistogram, ResidenceBar, ResidenceLegend, YearBars } from "./PlaceCharts";
import {
  DEFAULT_METRIC,
  formatPlaceValue,
  histogram,
  isSmallBase,
  METRIC_BY_KEY,
  metricGroups,
  NOT_RECORDED,
  rankRows,
  summarize,
  type MetricRow,
} from "./placeMetrics";
import type { AnalysisView } from "./placeSearch";

const STALE = 10 * 60 * 1000;
const selectClass =
  "h-8 min-w-0 max-w-full rounded-md border border-input bg-surface px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring";

export function StateAnalysisView({
  usps,
  stateName,
  view,
  metric,
  onChange,
  onCounty,
}: {
  usps: string;
  stateName: string;
  view: AnalysisView;
  metric: string;
  onChange: (patch: { view?: AnalysisView; metric?: string }) => void;
  onCounty: (fips: string) => void;
}) {
  const countiesFn = useServerFn(getStateCountyAnalysis);
  const analysisFn = useServerFn(getStateAnalysis);
  const counties = useQuery({
    queryKey: ["state-county-analysis", usps],
    queryFn: () => countiesFn({ data: { usps } }),
    staleTime: STALE,
  });
  const analysis = useQuery({
    queryKey: ["state-analysis", usps],
    queryFn: () => analysisFn({ data: { usps } }),
    staleTime: STALE,
  });
  const views: { id: AnalysisView; label: string; icon: typeof MapIcon }[] = [
    { id: "map", label: "Counties", icon: MapIcon },
    { id: "districts", label: "Federal districts", icon: Landmark },
    { id: "cities", label: "Cities", icon: Building2 },
    { id: "associations", label: "Associations", icon: Grid3x3 },
  ];
  return (
    <div className="space-y-3" data-testid="state-analysis">
      <StandOut
        analysis={analysis.data ?? null}
        loading={analysis.isPending}
        error={!!analysis.error}
        onRetry={() => void analysis.refetch()}
        usps={usps}
        stateName={stateName}
      />
      <div
        role="tablist"
        aria-label="Analysis views"
        className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1"
      >
        {views.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => onChange({ view: id })}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
              view === id
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {view === "map" ? (
        <CountyMapView
          usps={usps}
          stateName={stateName}
          metric={metric}
          onMetric={(m) => onChange({ metric: m })}
          rows={counties.data?.counties ?? null}
          loading={counties.isPending}
          error={!!counties.error}
          onRetry={() => void counties.refetch()}
          analysis={analysis.data ?? null}
          onCounty={onCounty}
        />
      ) : null}
      {view === "districts" ? (
        <DistrictComparison
          analysis={analysis.data ?? null}
          loading={analysis.isPending}
          error={!!analysis.error}
          onRetry={() => void analysis.refetch()}
          usps={usps}
        />
      ) : null}
      {view === "cities" ? <CityTable usps={usps} /> : null}
      {view === "associations" ? (
        <section className="resource-panel" aria-label="County associations">
          <div className="research-band">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Grid3x3 className="size-4" aria-hidden />
              What moves together across {stateName}'s counties
            </h2>
            {analysis.data ? (
              <span className="text-[11px] text-[var(--navy-muted)]">
                {analysis.data.testsHold} of {analysis.data.testsRun} hold
              </span>
            ) : null}
          </div>
          <div className="space-y-3 p-3">
            {analysis.isPending ? (
              <p role="status" className="text-xs text-muted-foreground">
                Loading associations…
              </p>
            ) : analysis.error ? (
              <Retry label="Associations could not load." onRetry={() => void analysis.refetch()} />
            ) : !analysis.data ? (
              <p className="text-xs text-muted-foreground">
                No county analysis is recorded for this state.
              </p>
            ) : (
              <>
                <AssociationGrid tests={analysis.data.tests} unit="counties" />
                <div>
                  <h3 className="mb-1 text-xs font-semibold">Associations that hold</h3>
                  <HoldingList tests={analysis.data.tests} unit="counties" />
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}
      <HowToRead measures={ANALYSIS_MEASURES} />
    </div>
  );
}

function Retry({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <p role="alert" className="text-xs">
      {label}{" "}
      <button type="button" className="text-primary underline" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

function StandOut({
  analysis,
  loading,
  error,
  onRetry,
  usps,
  stateName,
}: {
  analysis: StateAnalysis | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  usps: string;
  stateName: string;
}) {
  const [all, setAll] = useState(false);
  const items = analysis ? (all ? analysis.standouts : analysis.standouts.slice(0, 5)) : [];
  const hidden = analysis ? analysis.standouts.length - items.length : 0;
  return (
    <section className="resource-panel" aria-label="What stands out">
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="size-4" aria-hidden />
          What stands out in {stateName}
        </h2>
        {analysis ? (
          <span className="text-[11px] text-[var(--navy-muted)]">
            {analysis.counties} counties · {analysis.districts.length} district
            {analysis.districts.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      {loading ? (
        <p role="status" className="px-3 py-5 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : error ? (
        <div className="px-3 py-4">
          <Retry label="The state analysis could not load." onRetry={onRetry} />
        </div>
      ) : !analysis ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          No county analysis is recorded for this state.
        </p>
      ) : (
        <ul className="m-0 list-none divide-y divide-border/70 p-0 text-[12.5px]">
          {items.map((s, i) => (
            <li key={i} className="flex items-start gap-2 px-3 py-2">
              <span className="mt-0.5 shrink-0 rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {s.kind.startsWith("association")
                  ? "pattern"
                  : s.kind.startsWith("trend")
                    ? "trend"
                    : s.kind === "district"
                      ? "district"
                      : s.kind === "coverage"
                        ? "coverage"
                        : "county"}
              </span>
              <span className="min-w-0 flex-1 leading-5">
                {s.text}
                {s.county ? (
                  <>
                    {" "}
                    <Link
                      to="/places/$state/$county"
                      params={{ state: usps, county: s.county }}
                      search={{ tab: "counties" }}
                      className="text-primary hover:underline"
                    >
                      County profile
                    </Link>
                  </>
                ) : null}
                {s.courtId ? (
                  <>
                    {" "}
                    <Link
                      to="/courts/$id"
                      params={{ id: s.courtId }}
                      className="text-primary hover:underline"
                    >
                      Court page
                    </Link>
                  </>
                ) : null}
              </span>
            </li>
          ))}
          {analysis.screened.length ? (
            <li className="flex items-start gap-2 px-3 py-2 text-[12px] text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Residence code screened out for {analysis.screened.map((c) => c.name).join(", ")}:
                their federal filing rates read {NOT_RECORDED} (see the county profile for the
                reason).
              </span>
            </li>
          ) : null}
          {hidden || all ? (
            <li>
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="w-full bg-muted/30 px-3 py-1.5 text-left text-xs font-medium text-primary hover:bg-muted"
                aria-expanded={all}
              >
                {all ? "Show fewer" : `Show ${hidden} more`}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function MetricPicker({
  id,
  value,
  onChange,
  keys,
}: {
  id: string;
  value: string;
  onChange: (k: string) => void;
  keys?: ReadonlySet<string>;
}) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-0.5 text-[11px]">
      <span className="text-muted-foreground">Measure</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
      >
        {metricGroups(keys).map(({ group, items }) => (
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

function CountyMapView({
  usps,
  stateName,
  metric,
  onMetric,
  rows,
  loading,
  error,
  onRetry,
  analysis,
  onCounty,
}: {
  usps: string;
  stateName: string;
  metric: string;
  onMetric: (m: string) => void;
  rows: CountyRow[] | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  analysis: StateAnalysis | null;
  onCounty: (fips: string) => void;
}) {
  const corpus = useCorpus();
  const def = METRIC_BY_KEY.get(metric) ?? METRIC_BY_KEY.get(DEFAULT_METRIC)!;
  const mrows: MetricRow[] = useMemo(
    () => (rows ?? []).map((r) => ({ id: r.id, name: r.name, metrics: r.metrics })),
    [rows],
  );
  const values = useMemo(
    () => new Map(mrows.map((r) => [r.id, r.metrics[def.key] ?? null])),
    [mrows, def.key],
  );
  const smallBase = useMemo(
    () =>
      new Set(
        mrows.filter((r) => r.metrics[def.key] != null && isSmallBase(r, def.key)).map((r) => r.id),
      ),
    [mrows, def.key],
  );
  const ranked = useMemo(() => rankRows(mrows, def.key), [mrows, def.key]);
  const nums = ranked.map((r) => r.value);
  const summary = summarize(nums);
  const bins = histogram(nums, 14, 0.95);
  const stateValue = analysis?.values[def.key] ?? null;
  const usValue = analysis?.us[def.key] ?? null;
  // Rankings leave out rates resting on fewer than 10 events: a county with 2 cases and 600 residents is not "highest".
  const rankable = useMemo(
    () =>
      rankRows(
        mrows.filter((r) => !isSmallBase(r, def.key)),
        def.key,
      ),
    [mrows, def.key],
  );
  const leftOut = ranked.length - rankable.length;
  const top = rankable.slice(0, 8);
  const bottom = rankable.length > 16 ? rankable.slice(-8).reverse() : [];
  const fy = Object.keys(analysis?.fjcCoreFy ?? {}).sort();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <MetricPicker id={`metric-${usps}`} value={def.key} onChange={onMetric} />
        <p className="m-0 min-w-0 flex-1 basis-64 text-[11px] leading-4 text-muted-foreground">
          {def.label}, {def.unit}. Source: {def.source}.
        </p>
      </div>
      {loading ? (
        <p
          role="status"
          className="resource-panel px-3 py-8 text-center text-xs text-muted-foreground"
        >
          Loading county measures…
        </p>
      ) : error ? (
        <div className="resource-panel p-3">
          <Retry label="County measures could not load." onRetry={onRetry} />
        </div>
      ) : !rows?.length ? (
        <p className="resource-panel p-3 text-xs text-muted-foreground">
          No county measures are recorded for {stateName}.
        </p>
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          {corpus.geo ? (
            <CountyChoropleth
              geo={corpus.geo}
              usps={usps}
              values={values}
              format={def.format}
              unit={def.unit}
              title={`${def.short} by county`}
              onCounty={onCounty}
              flagged={smallBase}
            />
          ) : (
            <p className="resource-panel p-3 text-xs text-muted-foreground">
              {corpus.error ? "Map unavailable; the rankings remain available." : "Loading map…"}
            </p>
          )}
          <div className="min-w-0 space-y-3">
            <section className="resource-panel" aria-label="Distribution">
              <div className="research-band">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <BarChart3 className="size-4" aria-hidden />
                  Spread across counties
                </h2>
                <span className="text-[11px] text-[var(--navy-muted)]">
                  {summary?.n ?? 0} of {rows.length} recorded
                </span>
              </div>
              <div className="space-y-2 px-3 py-2.5">
                <dl className="m-0 grid grid-cols-3 gap-2 text-[11px]">
                  <Stat label={`${stateName}`} value={formatPlaceValue(stateValue, def.format)} />
                  <Stat label="United States" value={formatPlaceValue(usValue, def.format)} />
                  <Stat
                    label="Median county"
                    value={formatPlaceValue(summary?.median, def.format)}
                  />
                  <Stat
                    label="Middle half"
                    value={
                      summary
                        ? `${formatPlaceValue(summary.p25, def.format)} to ${formatPlaceValue(summary.p75, def.format)}`
                        : NOT_RECORDED
                    }
                  />
                  <Stat label="Lowest" value={formatPlaceValue(summary?.min, def.format)} />
                  <Stat label="Highest" value={formatPlaceValue(summary?.max, def.format)} />
                </dl>
                <MiniHistogram
                  bins={bins}
                  median={summary?.median ?? null}
                  format={def.format}
                  label={`${def.short}: distribution across counties`}
                />
              </div>
            </section>
            <section className="resource-panel" aria-label="County ranking">
              <div className="research-band">
                <h2 className="text-sm font-semibold">
                  Highest{bottom.length ? " and lowest" : ""}
                </h2>
                <span className="text-[11px] text-[var(--navy-muted)]">{def.unit}</span>
              </div>
              <RankList items={top} format={def.format} usps={usps} />
              {bottom.length ? (
                <>
                  <div className="border-t border-border bg-muted/30 px-3 py-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    Lowest
                  </div>
                  <RankList items={bottom} format={def.format} usps={usps} />
                </>
              ) : null}
              {leftOut ? (
                <p className="m-0 border-t border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground">
                  {leftOut} {leftOut === 1 ? "county" : "counties"} with fewer than 10 events in
                  five years
                  {leftOut === 1 ? " is" : " are"} left out of this list (still on the map, dotted).
                </p>
              ) : null}
            </section>
          </div>
        </div>
      )}
      {def.key.startsWith("fjc") && analysis && fy.length ? (
        <ChartCard
          title={`Core federal civil filings by ${stateName} residents`}
          subtitle={`By fiscal year of filing; counties whose residence code was screened out are left out. FY2021-FY2025 rate per 100,000: ${fy
            .filter((y) => analysis.fjcCoreFyRate[y] != null)
            .map((y) => `${y} ${formatPlaceValue(analysis.fjcCoreFyRate[y]!, "rate")}`)
            .join(", ")}.`}
        >
          <div className="px-3 py-2">
            <YearBars series={analysis.fjcCoreFy} years={fy} label="Core filings by fiscal year" />
          </div>
        </ChartCard>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10.5px] text-muted-foreground" title={label}>
        {label}
      </dt>
      <dd
        className="m-0 break-words font-mono text-[12.5px] leading-4 font-semibold tabular-nums"
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function RankList({
  items,
  format,
  usps,
}: {
  items: ReturnType<typeof rankRows>;
  format: Parameters<typeof formatPlaceValue>[1];
  usps: string;
}) {
  if (!items.length)
    return <p className="px-3 py-3 text-xs text-muted-foreground">{NOT_RECORDED}</p>;
  return (
    <ol className="m-0 list-none divide-y divide-border/60 p-0 text-[12px]">
      {items.map((r) => (
        <li key={r.id} className="flex items-baseline gap-2 px-3 py-1">
          <span className="w-7 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {r.rank}
          </span>
          <Link
            to="/places/$state/$county"
            params={{ state: usps, county: r.id }}
            search={{ tab: "counties" }}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            {r.name}
          </Link>
          {r.smallBase ? (
            <span
              className="shrink-0 text-[10px] text-muted-foreground"
              title="Fewer than 10 events in five years"
            >
              small base
            </span>
          ) : null}
          <span className="shrink-0 font-mono tabular-nums">
            {formatPlaceValue(r.value, format)}
          </span>
        </li>
      ))}
    </ol>
  );
}

const DISTRICT_COLS: {
  key: keyof DistrictSummary | string;
  label: string;
  get: (d: DistrictSummary) => number | null;
  format: Parameters<typeof formatPlaceValue>[1];
}[] = [
  { key: "population", label: "Residents (2025)", get: (d) => d.population, format: "int" },
  {
    key: "residentsCoreRate",
    label: "Core filings by residents /100k",
    get: (d) => d.residentsCoreRate,
    format: "rate",
  },
  { key: "oshaRate", label: "OSHA /100k", get: (d) => d.oshaRate, format: "rate" },
  { key: "cfpbRate", label: "CFPB /100k", get: (d) => d.cfpbRate, format: "rate" },
  {
    key: "poverty",
    label: "Poverty",
    get: (d) => d.demographics["poverty_rate"] ?? null,
    format: "pct",
  },
  {
    key: "bachelors",
    label: "Bachelor's+",
    get: (d) => d.demographics["pct_bachelors"] ?? null,
    format: "pct",
  },
  { key: "filed", label: "Filed in district FY21-25", get: (d) => d.filed5y, format: "int" },
];

function DistrictComparison({
  analysis,
  loading,
  error,
  onRetry,
  usps,
}: {
  analysis: StateAnalysis | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  usps: string;
}) {
  if (loading)
    return (
      <p
        role="status"
        className="resource-panel px-3 py-8 text-center text-xs text-muted-foreground"
      >
        Loading districts…
      </p>
    );
  if (error)
    return (
      <div className="resource-panel p-3">
        <Retry label="Districts could not load." onRetry={onRetry} />
      </div>
    );
  if (!analysis || !analysis.districts.length)
    return (
      <p className="resource-panel p-3 text-xs text-muted-foreground">
        No federal district is recorded for this state.
      </p>
    );
  const ds = analysis.districts;
  const legend = ds.reduce<Record<string, number>>((acc, d) => {
    for (const [k, v] of Object.entries(d.filedByResidence)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  return (
    <div className="space-y-3">
      <section className="resource-panel" aria-label="District comparison">
        <div className="research-band">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Landmark className="size-4" aria-hidden />
            Federal districts compared
          </h2>
          <span className="text-[11px] text-[var(--navy-muted)]">
            counties grouped by 28 U.S.C. ch. 5
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[10.5px] text-muted-foreground">
                <th scope="col" className="px-3 py-1.5 font-medium">
                  District
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Counties
                </th>
                {DISTRICT_COLS.map((c) => (
                  <th key={c.key} scope="col" className="px-2 py-1.5 text-right font-medium">
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="w-40 px-3 py-1.5 font-medium">
                  Where filers live
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {ds.map((d) => (
                <tr key={d.courtId}>
                  <th scope="row" className="px-3 py-1.5 text-left font-medium">
                    <Link to="/courts/$id" params={{ id: d.courtId }} className="hover:underline">
                      {d.name}
                    </Link>
                  </th>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {d.counties.length}
                  </td>
                  {DISTRICT_COLS.map((c) => (
                    <td key={c.key} className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {formatPlaceValue(c.get(d), c.format)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <ResidenceBar counts={d.filedByResidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border/70 px-3 py-2">
          <ResidenceLegend counts={legend} />
        </div>
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        {ds.map((d) => (
          <DistrictCard key={d.courtId} d={d} usps={usps} />
        ))}
      </div>
      {analysis.unassigned.length ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          No district recorded for {analysis.unassigned.map((c) => c.name).join(", ")}: neither 28
          U.S.C. ch. 5 nor the courts' local rules name them, and a district is never assigned by
          geography or elimination.
        </p>
      ) : null}
    </div>
  );
}

function DistrictCard({ d, usps }: { d: DistrictSummary; usps: string }) {
  const names = new Map(d.counties.map((c) => [c.fips, c.name]));
  const fy = Object.keys(d.filedFy).sort();
  return (
    <section className="resource-panel" aria-label={d.name}>
      <div className="research-band">
        <h3 className="truncate text-sm font-semibold">{d.name}</h3>
        <span className="shrink-0 text-[11px] text-[var(--navy-muted)]">
          {formatPlaceValue(d.population, "int")} residents
        </span>
      </div>
      <div className="space-y-2 px-3 py-2 text-[12px]">
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">
            Civil filings in the district by fiscal year (all filers)
          </div>
          <YearBars
            series={d.filedFy}
            years={fy}
            label={`${d.name}: civil filings by fiscal year`}
          />
        </div>
        {d.divisions.length ? (
          <details>
            <summary className="cursor-pointer text-[12px] font-medium">
              {d.divisions.length} divisions and where court is held
            </summary>
            <ul className="m-0 mt-1 list-none space-y-1.5 p-0">
              {d.divisions.map((dv) => (
                <li key={dv.name}>
                  <span className="font-medium">{dv.name}</span>
                  {dv.heldAt.length ? (
                    <span className="text-muted-foreground"> · held at {dv.heldAt.join(", ")}</span>
                  ) : null}
                  <div className="text-[11.5px] leading-5">
                    {dv.counties.map((f, i) => (
                      <span key={f}>
                        {i ? ", " : ""}
                        <Link
                          to="/places/$state/$county"
                          params={{ state: usps, county: f }}
                          search={{ tab: "counties" }}
                          className="hover:underline"
                        >
                          {names.get(f) ?? f}
                        </Link>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <details>
            <summary className="cursor-pointer text-[12px] font-medium">
              {d.counties.length} counties
            </summary>
            <p className="m-0 mt-1 text-[11.5px] leading-5">
              {d.counties.map((c, i) => (
                <span key={c.fips}>
                  {i ? ", " : ""}
                  <Link
                    to="/places/$state/$county"
                    params={{ state: usps, county: c.fips }}
                    search={{ tab: "counties" }}
                    className="hover:underline"
                  >
                    {c.name}
                  </Link>
                </span>
              ))}
            </p>
          </details>
        )}
        {d.screened.length ? (
          <p className="m-0 text-[11px] text-muted-foreground">
            Residence code screened out: {d.screened.map((c) => c.name).join(", ")}.
          </p>
        ) : null}
        {d.incomeRange ? (
          <p className="m-0 text-[11px] text-muted-foreground">
            County median household incomes range {formatPlaceValue(d.incomeRange[0], "dollars")} to{" "}
            {formatPlaceValue(d.incomeRange[1], "dollars")}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

type CitySort = "pop" | "income" | "poverty" | "bachelors" | "uninsured" | "density" | "age";
const CITY_COLS: {
  id: CitySort;
  label: string;
  get: (c: CityRow) => number | null;
  format: Parameters<typeof formatPlaceValue>[1];
}[] = [
  { id: "pop", label: "Population", get: (c) => c.metrics["pop_acs"] ?? null, format: "int" },
  { id: "density", label: "Per sq mi", get: (c) => c.density, format: "int" },
  {
    id: "income",
    label: "Median income",
    get: (c) => c.metrics["median_hh_income"] ?? null,
    format: "dollars",
  },
  { id: "poverty", label: "Poverty", get: (c) => c.metrics["poverty_rate"] ?? null, format: "pct" },
  {
    id: "bachelors",
    label: "Bachelor's+",
    get: (c) => c.metrics["pct_bachelors"] ?? null,
    format: "pct",
  },
  {
    id: "uninsured",
    label: "Uninsured",
    get: (c) => c.metrics["pct_uninsured"] ?? null,
    format: "pct",
  },
  { id: "age", label: "Median age", get: (c) => c.metrics["median_age"] ?? null, format: "dec1" },
];

function CityTable({ usps }: { usps: string }) {
  const fn = useServerFn(getStateCities);
  const q = useQuery({
    queryKey: ["state-cities", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: STALE,
  });
  const [sort, setSort] = useState<CitySort>("pop");
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const col = CITY_COLS.find((c) => c.id === sort)!;
  const rows = useMemo(() => {
    const t = query.trim().toLocaleLowerCase();
    return (q.data ?? [])
      .filter((c) => !t || c.name.toLocaleLowerCase().includes(t))
      .sort(
        (a, b) =>
          (col.get(b) ?? -Infinity) - (col.get(a) ?? -Infinity) || a.name.localeCompare(b.name),
      );
  }, [q.data, query, col]);
  const shown = all ? rows : rows.slice(0, 40);
  return (
    <section className="resource-panel" aria-label="Cities and places">
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4" aria-hidden />
          Cities and places
        </h2>
        <span className="text-[11px] text-[var(--navy-muted)]">
          ACS 2020-2024 · 10,000+ residents or the 15 largest
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <label className="flex h-8 min-w-0 flex-1 basis-48 items-center gap-1.5 rounded-md border border-input bg-surface px-2 text-xs">
          <Search className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="sr-only">Filter places</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name"
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
        <span className="text-[11px] text-muted-foreground">
          {q.data ? `${rows.length} places` : ""}
        </span>
      </div>
      {q.isPending ? (
        <p role="status" className="px-3 py-6 text-xs text-muted-foreground">
          Loading places…
        </p>
      ) : q.error ? (
        <div className="px-3 py-4">
          <Retry label="Places could not load." onRetry={() => void q.refetch()} />
        </div>
      ) : !rows.length ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          {q.data?.length
            ? "No place matches the filter."
            : "No place profiles are recorded for this state."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[10.5px] text-muted-foreground">
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Place
                </th>
                {CITY_COLS.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    className="px-2 py-1.5 text-right font-medium"
                    aria-sort={sort === c.id ? "descending" : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => setSort(c.id)}
                      className={cn(
                        "hover:text-foreground",
                        sort === c.id && "font-semibold text-foreground",
                      )}
                    >
                      {c.label}
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-3 py-1.5 font-medium">
                  County
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((c) => (
                <tr key={c.id}>
                  <th
                    scope="row"
                    className="max-w-56 truncate px-3 py-1.5 text-left font-medium"
                    title={c.name}
                  >
                    <Link
                      to="/records/$dataset/$id"
                      params={{ dataset: "city_profiles", id: c.id }}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                    {!c.incorporated ? (
                      <span
                        className="ml-1 text-[10px] font-normal text-muted-foreground"
                        title="Census-designated place: no municipal government"
                      >
                        CDP
                      </span>
                    ) : null}
                  </th>
                  {CITY_COLS.map((col2) => (
                    <td key={col2.id} className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {formatPlaceValue(col2.get(c), col2.format)}
                    </td>
                  ))}
                  <td className="max-w-48 truncate px-3 py-1.5">
                    {c.counties[0] ? (
                      <Link
                        to="/places/$state/$county"
                        params={{ state: usps, county: c.counties[0].fips }}
                        search={{ tab: "counties" }}
                        className="hover:underline"
                      >
                        {c.counties[0].name}
                      </Link>
                    ) : (
                      NOT_RECORDED
                    )}
                    {c.counties.length > 1 ? (
                      <span className="text-[10.5px] text-muted-foreground">
                        {" "}
                        +{c.counties.length - 1}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length ? (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="w-full border-t border-border bg-muted/30 px-3 py-2 text-xs font-medium text-primary hover:bg-muted"
            >
              Show all {rows.length} places
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
