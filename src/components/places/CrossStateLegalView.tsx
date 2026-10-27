import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Grid3x3, ListOrdered, Rows3 } from "lucide-react";
import { HowToRead } from "@/components/analysis/HowToRead";
import { StateChoropleth } from "@/components/states/StateChoropleth";
import { useCorpus } from "@/lib/corpus/store";
import { STATES } from "@/lib/corpus/geo";
import {
  getCrossStateAnalysis,
  type CrossStateAnalysis,
} from "@/lib/external/stateAnalysis.functions";
import type { MetricFormat } from "@/lib/external/stateMetrics.functions";
import { cn } from "@/lib/utils";
import { AssociationGrid, HoldingList } from "./AssociationGrid";
import { ANALYSIS_MEASURES } from "./analysisMeasures";
import {
  formatPlaceValue,
  METRIC_BY_KEY,
  metricGroups,
  NOT_RECORDED,
  type PlaceFormat,
} from "./placeMetrics";

// fjc_rate (filings coded to the county, incl. MDL) is not offered: it is not a residence measure.
const STATE_KEYS = new Set([
  "fjc_core_rate",
  "osha_rate",
  "cfpb_rate",
  "cfpb_noncredit_rate",
  "echo_formal_per_1k",
  "population",
  "density",
  "median_age",
  "pct_65plus",
  "pct_hispanic",
  "pct_black_nh",
  "pct_white_nh",
  "pct_foreign_born",
  "median_hh_income",
  "per_capita_personal_income",
  "poverty_rate",
  "unemployment_rate",
  "pct_bachelors",
  "pct_uninsured",
  "owner_occupied",
]);
const SPREAD_KEYS = [
  "fjc_core_rate",
  "osha_rate",
  "cfpb_rate",
  "cfpb_noncredit_rate",
  "echo_formal_per_1k",
];
const toMapFormat = (f: PlaceFormat): MetricFormat => (f === "dec1" || f === "change" ? "rate" : f);
const NAME = new Map(STATES.map((s) => [s.usps, s.name]));

/**
 * Legal activity across the 50 states and DC beside demographics: a state choropleth with a measure picker, rankings,
 * the cross-state associations (Spearman, Benjamini-Hochberg) and how widely counties differ inside each state.
 */
export function CrossStateLegalView({
  measure,
  selected,
  onMeasure,
  onState,
}: {
  measure: string | undefined;
  selected: string | null;
  onMeasure: (m: string) => void;
  onState: (usps: string) => void;
}) {
  const fn = useServerFn(getCrossStateAnalysis);
  const q = useQuery({
    queryKey: ["cross-state-analysis"],
    queryFn: () => fn(),
    staleTime: 10 * 60 * 1000,
  });
  const corpus = useCorpus();
  const key = measure && STATE_KEYS.has(measure) ? measure : "fjc_core_rate";
  const def = METRIC_BY_KEY.get(key)!;
  if (q.isPending)
    return (
      <p
        role="status"
        className="resource-panel px-3 py-10 text-center text-xs text-muted-foreground"
      >
        Loading the cross-state analysis…
      </p>
    );
  if (q.error)
    return (
      <p role="alert" className="resource-panel p-3 text-xs">
        The cross-state analysis could not load.{" "}
        <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  if (!q.data)
    return (
      <p className="resource-panel p-3 text-xs text-muted-foreground">
        No cross-state analysis is recorded.
      </p>
    );
  return (
    <Body
      data={q.data}
      defKey={key}
      format={def.format}
      selected={selected}
      onMeasure={onMeasure}
      onState={onState}
      geo={corpus.geo}
      geoError={!!corpus.error}
    />
  );
}

function Body({
  data,
  defKey,
  format,
  selected,
  onMeasure,
  onState,
  geo,
  geoError,
}: {
  data: CrossStateAnalysis;
  defKey: string;
  format: PlaceFormat;
  selected: string | null;
  onMeasure: (m: string) => void;
  onState: (usps: string) => void;
  geo: ReturnType<typeof useCorpus>["geo"];
  geoError: boolean;
}) {
  const def = METRIC_BY_KEY.get(defKey)!;
  const values = useMemo(() => {
    const m = new Map<string, number>();
    for (const [u, v] of Object.entries(data.states)) {
      const x = v[defKey];
      if (x != null) m.set(u, x);
    }
    return m;
  }, [data, defKey]);
  const ranked = [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const missing = STATES.filter((s) => !values.has(s.usps)).map((s) => s.name);
  return (
    <div className="space-y-3" data-testid="cross-state-legal">
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="cross-measure" className="flex min-w-0 flex-col gap-0.5 text-[11px]">
          <span className="text-muted-foreground">Measure</span>
          <select
            id="cross-measure"
            value={defKey}
            onChange={(e) => onMeasure(e.target.value)}
            className="h-8 min-w-0 max-w-full rounded-md border border-input bg-surface px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
          >
            {metricGroups(STATE_KEYS).map(({ group, items }) => (
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
        <p className="m-0 min-w-0 flex-1 basis-64 text-[11px] leading-4 text-muted-foreground">
          {def.label}, {def.unit}. State values sum the state's counties (rates over the counties
          that have the measure). Source: {def.source}.
          {missing.length ? ` ${NOT_RECORDED}: ${missing.join(", ")}.` : ""}
        </p>
      </div>
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {geo ? (
          <StateChoropleth
            geo={geo}
            values={values}
            format={toMapFormat(def.format)}
            unit={def.unit}
            title={`${def.short} by state`}
            selected={selected}
            onSelect={onState}
          />
        ) : (
          <p className="resource-panel p-3 text-xs text-muted-foreground">
            {geoError ? "Map unavailable; the ranking remains available." : "Loading map…"}
          </p>
        )}
        <section className="resource-panel" aria-label="State ranking">
          <div className="research-band">
            <h2 className="flex items-center gap-2 text-heading font-semibold text-foreground">
              <ListOrdered className="size-4" aria-hidden />
              Ranking
            </h2>
            <span className="text-[11px] text-muted-foreground">
              U.S. {formatPlaceValue(data.us[defKey], format)}
            </span>
          </div>
          <ol className="m-0 max-h-[26rem] list-none divide-y divide-border/60 overflow-y-auto p-0 text-[12px]">
            {ranked.map(([u, v], i) => (
              <li
                key={u}
                className={cn("flex items-center gap-2 px-3 py-1", selected === u && "bg-muted")}
              >
                <span className="w-6 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <Link
                  to="/places/$state"
                  params={{ state: u }}
                  search={{ tab: "analysis" }}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {NAME.get(u) ?? u}
                </Link>
                <span className="shrink-0 font-mono tabular-nums">
                  {formatPlaceValue(v, format)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <section className="resource-panel" aria-label="Associations across states">
        <div className="research-band">
          <h2 className="flex items-center gap-2 text-heading font-semibold text-foreground">
            <Grid3x3 className="size-4" aria-hidden />
            What moves together across states
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {data.testsHold} of {data.testsRun} hold
          </span>
        </div>
        <div className="space-y-3 p-3">
          <AssociationGrid tests={data.tests} unit="states" />
          <div>
            <h3 className="mb-1 text-xs font-semibold">Associations that hold</h3>
            <HoldingList tests={data.tests} unit="states" />
          </div>
        </div>
      </section>
      <SpreadTable data={data} onState={onState} />
      <HowToRead measures={ANALYSIS_MEASURES} />
    </div>
  );
}

/** How widely counties differ inside each state, for one legal measure. */
function SpreadTable({
  data,
  onState,
}: {
  data: CrossStateAnalysis;
  onState: (u: string) => void;
}) {
  const [key, setKey] = useState("fjc_core_rate");
  const def = METRIC_BY_KEY.get(key)!;
  const rows = STATES.map((s) => {
    const d = data.dispersion[s.usps];
    const dist = d?.distributions[key];
    return {
      usps: s.usps,
      name: s.name,
      counties: d?.counties ?? 0,
      hold: d?.hold ?? 0,
      run: d?.run ?? 0,
      dist,
      spread: dist && dist.n >= 8 && dist.p25 > 0 ? dist.p75 / dist.p25 : null,
    };
  }).sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1) || a.name.localeCompare(b.name));
  return (
    <section className="resource-panel" aria-label="County spread within states">
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-heading font-semibold text-foreground">
          <Rows3 className="size-4" aria-hidden />
          How much counties differ inside each state
        </h2>
        <select
          aria-label="Spread measure"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="h-7 max-w-52 rounded border border-white/30 bg-transparent px-1.5 text-[11px] text-white [&>option]:text-foreground"
        >
          {SPREAD_KEYS.map((k) => (
            <option key={k} value={k}>
              {METRIC_BY_KEY.get(k)?.short}
            </option>
          ))}
        </select>
      </div>
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[40rem] text-[12px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-left text-[10.5px] text-muted-foreground">
              <th scope="col" className="px-3 py-1.5 font-medium">
                State
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Counties
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Median county
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Middle half
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                75th / 25th
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">
                County associations holding
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.usps}>
                <th scope="row" className="px-3 py-1 text-left font-normal">
                  <button type="button" onClick={() => onState(r.usps)} className="hover:underline">
                    {r.name}
                  </button>
                </th>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{r.counties}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">
                  {formatPlaceValue(r.dist?.median, def.format)}
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                  {r.dist
                    ? `${formatPlaceValue(r.dist.p25, def.format)} to ${formatPlaceValue(r.dist.p75, def.format)}`
                    : NOT_RECORDED}
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">
                  {r.spread != null
                    ? `${r.spread.toFixed(1)}×`
                    : r.dist && r.dist.n < 8
                      ? "fewer than 8 counties"
                      : NOT_RECORDED}
                </td>
                <td className="px-3 py-1 text-right font-mono tabular-nums">
                  <Link
                    to="/places/$state"
                    params={{ state: r.usps }}
                    search={{ tab: "analysis", view: "associations" }}
                    className="hover:underline"
                  >
                    {r.run ? `${r.hold} of ${r.run}` : "not tested"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
