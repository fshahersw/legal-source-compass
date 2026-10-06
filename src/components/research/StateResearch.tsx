import { fetchBundleSnapshot } from "@/lib/private-data/client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Scatter,
  ScatterChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/corpus/BarList";
import {
  correlations,
  courtStates,
  exportJson,
  stateComparisons,
} from "@/lib/corpus/research";
import { decodeTopology } from "@/lib/corpus/geo";
import { control, Field, fmt, Panel, pct, Source, tableClass, type WorkbenchProps } from "./shared";

const metrics = [
  { key: "filingsPer100k", label: "Civil filings per 100,000 residents" },
  { key: "pendingPer100k", label: "Pending civil cases per 100,000 residents" },
  { key: "filed2025", label: "Civil filings · FY 2025" },
  { key: "filingChange", label: "Filing change · FY 2024 → 2025 (%)" },
  { key: "clearance", label: "Terminated / filed · FY 2025 (%)" },
  { key: "population2025", label: "Population · July 2025" },
  { key: "districtJudges", label: "FJC district judges in service · Sept 30, 2025" },
  { key: "sampleCases", label: "Cases in the saved catalog" },
] as const;
type Metric = (typeof metrics)[number]["key"];
const metricName = (key: Metric) => metrics.find((m) => m.key === key)!.label;

export function StateResearch({ data, cases, state, update }: WorkbenchProps) {
  const rows = useMemo(() => stateComparisons(data, cases), [data, cases]);
  const [metric, setMetric] = useState<Metric>("filingsPer100k");
  const [compare, setCompare] = useState("IL");
  const [x, setX] = useState<Metric>("population2025"),
    [y, setY] = useState<Metric>("filed2025");
  const geo = useQuery({
    queryKey: ["research-geometry"],
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetchBundleSnapshot("/data/corpus/us-counties-albers-10m.json");
      if (!response.ok) throw new Error("Map geometry could not load.");
      return decodeTopology(await response.json());
    },
  });
  const ordered = [...rows].sort((a, b) => (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity));
  const selected = rows.find((row) => row.code === state);
  const comparison = rows.find((row) => row.code === compare);
  const min = Math.min(...rows.map((r) => r[metric] ?? 0)),
    max = Math.max(...rows.map((r) => r[metric] ?? 0));
  const paired = correlations(rows.map((r) => ({ label: r.name, x: r[x], y: r[y] })));
  const totals = rows.reduce(
    (s, r) => ({
      filed: s.filed + r.filed2025,
      population: s.population + r.population2025,
      pending: s.pending + r.pending2025,
    }),
    { filed: 0, population: 0, pending: 0 },
  );
  const mapping = courtStates(data.courts.records);
  const outsideState = cases.filter((c) => !c.court || !mapping.has(c.court)).length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="States + DC" value={rows.length} note="Federal district civil workload" />
        <Stat
          label="Civil filings · FY 2025"
          value={totals.filed}
          note="50 states + DC; territories excluded"
        />
        <Stat
          label="Filings per 100,000 residents"
          value={fmt((totals.filed / totals.population) * 100000, 1)}
          note="Census July 1, 2025 denominator"
        />
        <Stat
          label="Catalog mapped to states"
          value={cases.length - outsideState}
          note={`${outsideState} appellate / panel cases outside state totals`}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <Panel
          title="Compare the states"
          note="Select a metric and a state. Color shows its value within this 51-jurisdiction comparison."
        >
          <Field label="Map and ranking metric">
            <select
              className={control}
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
            >
              {metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          {geo.data ? (
            <svg
              viewBox="0 0 975 610"
              className="mt-3 w-full"
              aria-label={`State map: ${metricName(metric)}`}
            >
              {geo.data.states.map((shape) => {
                const r = rows.find((r) => r.fips === shape.id);
                const value = r?.[metric];
                const opacity =
                  value == null
                    ? 0.07
                    : 0.2 + 0.8 * (max === min ? 1 : (value - min) / (max - min));
                return (
                  <path
                    key={shape.id}
                    d={shape.d}
                    role="button"
                    tabIndex={0}
                    aria-label={`${r?.name ?? shape.name}: ${fmt(value, 1)}`}
                    aria-pressed={r?.code === state}
                    className="cursor-pointer stroke-background outline-none focus:stroke-foreground focus:stroke-2"
                    style={{
                      fill: "var(--primary)",
                      fillOpacity: opacity,
                      stroke: r?.code === state ? "var(--foreground)" : "var(--background)",
                      strokeWidth: r?.code === state ? 3 : 1,
                    }}
                    onClick={() => r && update({ state: r.code })}
                    onKeyDown={(e) => {
                      if (r && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        update({ state: r.code });
                      }
                    }}
                  >
                    <title>
                      {r?.name}: {fmt(value, 1)} · {metricName(metric)}
                    </title>
                  </path>
                );
              })}
            </svg>
          ) : (
            <p className="py-8 text-[12px] text-muted-foreground">
              {geo.error
                ? "Map unavailable; every value is in the table below."
                : "Loading state map…"}
            </p>
          )}
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{fmt(min, 1)}</span>
            <span>Lower → higher</span>
            <span>{fmt(max, 1)}</span>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Federal district courts only.{" "}
            <Source href={data.workload.sourceUrl}>U.S. Courts Table C</Source> · FY ended September
            30, 2025.{" "}
            <Source href="https://www.census.gov/data/tables/time-series/demo/popest/2020s-state-total.html">
              Census Vintage 2025
            </Source>{" "}
            population is dated July 1, 2025.
          </p>
        </Panel>
        <Panel
          title={selected ? `${selected.name}: what the records show` : "What the comparison shows"}
        >
          {selected ? (
            <>
              <p className="text-[13px] leading-relaxed">
                <strong>{selected.name}</strong> recorded <strong>{fmt(selected.filed2025)}</strong>{" "}
                civil filings, {pct(selected.filingChange)} change from FY 2024. Its{" "}
                <strong>{fmt(selected.filingsPer100k, 1)}</strong> filings per 100,000 residents
                rank{" "}
                <strong>
                  {[...rows]
                    .sort((a, b) => (b.filingsPer100k ?? 0) - (a.filingsPer100k ?? 0))
                    .findIndex((r) => r.code === selected.code) + 1}{" "}
                  of 51
                </strong>
                .
              </p>
              <div className="my-3 grid grid-cols-2 gap-2">
                <Stat label="Pending at year end" value={selected.pending2025} />
                <Stat
                  label="Terminated / filed"
                  value={pct(selected.clearance)}
                  note="Flow ratio; can exceed 100%"
                />
                <Stat label="Saved catalog cases" value={selected.sampleCases} />
                <Stat
                  label="District judges in service"
                  value={selected.districtJudges}
                  note="Includes senior judges; headcount, not FTE"
                />
              </div>
              <Field label={`Compare ${selected.name} with`}>
                <select
                  value={compare}
                  className={control}
                  onChange={(e) => setCompare(e.target.value)}
                >
                  {rows.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              {comparison && (
                <p className="mt-3 text-[12px] leading-relaxed">
                  {selected.name}: <strong>{fmt(selected.filingsPer100k, 1)}</strong> vs{" "}
                  {comparison.name}: <strong>{fmt(comparison.filingsPer100k, 1)}</strong> filings
                  per 100,000 residents. Population normalization does not adjust for case mix, MDL
                  transfers, or venue rules.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
                <Link
                  className="text-primary underline"
                  to="/places/$state"
                  params={{ state: selected.code }}
                >
                  State directory
                </Link>
                <button
                  className="text-primary underline"
                  onClick={() => update({ view: "cases" })}
                >
                  Analyze this state’s cases
                </button>
                <button
                  className="text-primary underline"
                  onClick={() => update({ view: "sources" })}
                >
                  Court and rules hierarchy
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed">
                <strong>{ordered[0]?.name}</strong> has the highest recorded value for{" "}
                {metricName(metric).toLowerCase()} at{" "}
                <strong>{fmt(ordered[0]?.[metric], 1)}</strong>. Select a state to see its workload,
                year-over-year change, case sample, and court resources.
              </p>
              <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
                These are district-court statistics grouped by state. State trial-court caseloads
                use different reporting systems. The saved catalog is a selected collection; its
                case count is not a completeness percentage.
              </p>
              <p className="mt-4 text-[12px]">
                <Source href="https://www.ncsc.org/our-centers-projects/court-statistics-project">
                  NCSC Court Statistics Project: state-court research
                </Source>
              </p>
            </>
          )}
        </Panel>
      </div>
      <Panel
        title="State-by-state ranking"
        note="Every state and DC is included. Sort using the metric above; select any state for a closer comparison."
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            exportJson("state-comparison-fy2025.json", {
              scope: "Federal district civil workload, 50 states + DC",
              periodEnd: "2025-09-30",
              populationDate: data.population.referenceDate,
              judgeHeadcountDate: "2025-09-30",
              sources: [data.workload.sourceUrl, ...data.sources.sources.map((s) => s.page)],
              rows: ordered,
            })
          }
        >
          Download all 51 state rows
        </Button>
        <div className="mt-3 max-h-[28rem] overflow-auto">
          <table className={tableClass}>
            <caption className="sr-only">
              Federal civil workload and saved catalog counts by state, FY 2025
            </caption>
            <thead>
              <tr>
                <th>Rank / state</th>
                <th>Filings</th>
                <th>Per 100k</th>
                <th>Change</th>
                <th>Terminated / filed</th>
                <th>Pending</th>
                <th>Catalog cases</th>
                <th>District judges</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r, i) => (
                <tr key={r.code} className={r.code === state ? "bg-primary/10" : ""}>
                  <td>
                    <button
                      onClick={() => update({ state: r.code })}
                      className="whitespace-nowrap text-primary underline"
                    >
                      {i + 1}. {r.name}
                    </button>
                  </td>
                  <td>{fmt(r.filed2025)}</td>
                  <td>{fmt(r.filingsPer100k, 1)}</td>
                  <td>{pct(r.filingChange)}</td>
                  <td>{pct(r.clearance)}</td>
                  <td>{fmt(r.pending2025)}</td>
                  <td>{fmt(r.sampleCases)}</td>
                  <td>{fmt(r.districtJudges)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel
        title="Explore correlations"
        note="Each point is one state or DC. Change either variable and inspect the paired observations. Associations do not establish cause or predict case outcomes."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="X axis">
            <select className={control} value={x} onChange={(e) => setX(e.target.value as Metric)}>
              {metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Y axis">
            <select className={control} value={y} onChange={(e) => setY(e.target.value as Metric)}>
              {metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Pearson r" value={fmt(paired.pearson, 3)} note="Linear association" />
          <Stat
            label="Spearman ρ"
            value={fmt(paired.spearman, 3)}
            note="Rank association; tied ranks averaged"
          />
          <Stat label="Paired observations" value={paired.n} />
          <Stat label="Missing pairs excluded" value={paired.excluded} />
        </div>
        <div className="mt-4 h-80 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 20, bottom: 24, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="x"
                name={metricName(x)}
                tickFormatter={(v) => fmt(Number(v))}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={metricName(y)}
                width={75}
                tickFormatter={(v) => fmt(Number(v))}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as
                    { label: string; x: number; y: number } | undefined;
                  return active && p ? (
                    <div className="max-w-xs rounded border border-border bg-surface p-3 text-[12px] shadow-card">
                      <strong>{p.label}</strong>
                      <p>
                        {metricName(x)}: {fmt(p.x, 1)}
                      </p>
                      <p>
                        {metricName(y)}: {fmt(p.y, 1)}
                      </p>
                    </div>
                  ) : null;
                }}
              />
              <Scatter name="States + DC" data={paired.pairs} fill="var(--primary)" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            exportJson("state-correlations.json", {
              x: metricName(x),
              y: metricName(y),
              scope: "50 states + DC, FY 2025 workload / July 2025 population / saved catalog",
              ...paired,
            })
          }
        >
          Download paired observations and coefficients
        </Button>
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer text-primary">
            Inspect all {paired.n} plotted pairs
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>State</th>
                  <th>{metricName(x)}</th>
                  <th>{metricName(y)}</th>
                </tr>
              </thead>
              <tbody>
                {paired.pairs.map((p) => (
                  <tr key={p.label}>
                    <td>{p.label}</td>
                    <td>{fmt(p.x, 2)}</td>
                    <td>{fmt(p.y, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Panel>
      <Panel
        title={
          selected
            ? `Disposition time: ${selected.name} districts`
            : "Disposition time: federal districts"
        }
        note="Official Table C-5 medians are shown by district; district medians are never averaged into a state median. Select a state to narrow the table."
      >
        <p className="mb-3 text-[12px]">
          National Table C-5:{" "}
          <strong>{fmt(data.timing.national["all"]?.medianMonths, 1)} months</strong> across{" "}
          {fmt(data.timing.national["all"]?.cases)} terminated cases.{" "}
          <Source href="https://www.uscourts.gov/data-news/data-tables/2025/09/30/judicial-business/c-5">
            Read the publisher’s table and exclusions
          </Source>
          .
        </p>
        <div className="max-h-[28rem] overflow-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>District as published</th>
                <th>Cases</th>
                <th>Median months</th>
                <th>No court action</th>
                <th>Before pretrial</th>
                <th>During / after pretrial</th>
                <th>During trial</th>
              </tr>
            </thead>
            <tbody>
              {data.timing.districts
                .filter((r) => state === "ALL" || r.state === state)
                .map((r) => (
                  <tr key={r.label}>
                    <td className="font-mono">{r.label}</td>
                    <td>{fmt(r.metrics["all"]?.cases)}</td>
                    <td>{fmt(r.metrics["all"]?.medianMonths, 1)}</td>
                    {["noCourtAction", "beforePretrial", "duringAfterPretrial", "duringTrial"].map(
                      (k) => (
                        <td key={k}>
                          {fmt(r.metrics[k]?.medianMonths, 1)}
                          <span className="block text-[10px] text-muted-foreground">
                            n={fmt(r.metrics[k]?.cases)}
                          </span>
                        </td>
                      ),
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Table C-5 excludes several case categories and suppresses medians when fewer than 10 cases
          are reported. Its population differs from Table C. The FJC headcount includes senior
          district judges with a recorded open service interval as of September 30, 2025; it
          measures people, not seats or workload capacity.
        </p>
      </Panel>
    </div>
  );
}
