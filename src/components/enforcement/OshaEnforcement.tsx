import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MapPin } from "lucide-react";
import { UsMap } from "@/components/corpus/UsMap";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { STATES } from "@/lib/corpus/geo";
import { useCorpus } from "@/lib/corpus/store";
import {
  getOshaEnforcement,
  type OshaEnforcement as OshaData,
} from "@/lib/external/oshaEnforcement.functions";
import { numTick, usdMillionsTick } from "./listDisplay";
import {
  axisTick,
  Kpi,
  LoadingBlock,
  MoreToggle,
  Panel,
  Segmented,
  SourceLink,
  StateNote,
  tooltipStyle,
} from "./parts";

export const oshaEnforcementQuery = {
  queryKey: ["osha-enforcement"],
  queryFn: () => getOshaEnforcement(),
  staleTime: 10 * 60 * 1000,
};

const NOT_RECORDED = "Not recorded";
const OSHA_DATA = "https://www.osha.gov/data";
const fmt = (n: number) => n.toLocaleString("en-US");
const fixed = (v: number, digits: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signedPct = (v: number | null) =>
  v == null
    ? NOT_RECORDED
    : `${v > 0 ? "+" : ""}${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
const count = (v: number | null) => (v == null ? NOT_RECORDED : fmt(v));
const usd = (n: number | null) => {
  if (n == null) return NOT_RECORDED;
  if (n >= 1e9) return `$${fixed(n / 1e9, 2)}B`;
  if (n >= 1e6) return `$${fixed(n / 1e6, 1)}M`;
  return `$${fmt(Math.round(n))}`;
};
const fipsByUsps = new Map(STATES.map((s) => [s.usps, s.fips]));
const uspsByFips = new Map(STATES.map((s) => [s.fips, s.usps]));
const nameByUsps = new Map(STATES.map((s) => [s.usps, s.name]));
const BUCKET_LABEL: Record<string, string> = {
  "0": "No penalty",
  "1-999": "$1–999",
  "1000-4999": "$1,000–4,999",
  "5000-9999": "$5,000–9,999",
  "10000-49999": "$10,000–49,999",
  "50000-99999": "$50,000–99,999",
  "100000-499999": "$100,000–499,999",
  "500000+": "$500,000 and over",
};

export function OshaEnforcement() {
  const q = useQuery(oshaEnforcementQuery);
  if (q.isLoading) return <LoadingBlock label="Loading OSHA enforcement analytics" />;
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" onClick={() => void q.refetch()} className="underline">
            Retry
          </button>
        }
      >
        OSHA enforcement analytics could not be loaded.
      </StateNote>
    );
  if (!q.data)
    return <StateNote>OSHA enforcement analytics have not been published yet.</StateNote>;
  return <Body data={q.data} />;
}

type SeriesMetric = "inspections" | "penalty";

function Body({ data }: { data: OshaData }) {
  const corpus = useCorpus();
  const navigate = useNavigate();
  const [metric, setMetric] = useState<SeriesMetric>("inspections");
  const [allEmployers, setAllEmployers] = useState(false);
  const latest = data.latest;
  const chart = data.series
    .filter((y) => y.fy >= 1996)
    .map((y) => ({
      label: y.partial ? `${y.fy}*` : String(y.fy),
      programmed: y.programmed ?? 0,
      unprogrammed: y.unprogrammed ?? 0,
      other: Math.max(0, y.inspections - (y.programmed ?? 0) - (y.unprogrammed ?? 0)),
      penaltyMillions: y.currentPenalty == null ? 0 : y.currentPenalty / 1e6,
      partial: y.partial,
    }));
  const values = new Map<string, number>();
  for (const r of data.stateRates) {
    const fips = fipsByUsps.get(r.code);
    if (fips) values.set(fips, r.per100k);
  }
  const employerLimit = 10;
  const shownEmployers = allEmployers ? data.employers : data.employers.slice(0, employerLimit);
  const distMax = Math.max(1, ...(latest?.distribution.map((d) => d.inspections) ?? [1]));
  const statePlanShare =
    latest?.statePlan != null && latest.inspections > 0
      ? (latest.statePlan / latest.inspections) * 100
      : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label={latest ? `Inspections, FY${latest.fy}` : "Inspections, latest complete year"}
          value={latest ? fmt(latest.inspections) : NOT_RECORDED}
          note={
            latest
              ? `${signedPct(latest.yoyInspectionsPct)} vs the year before; federal OSHA and State Plan offices combined`
              : undefined
          }
        />
        <Kpi
          label={latest ? `Current penalties, FY${latest.fy}` : "Current penalties"}
          value={latest ? usd(latest.currentPenalty) : NOT_RECORDED}
          note={
            latest
              ? `${signedPct(latest.yoyPenaltyPct)} vs the year before; computed from recorded amounts, nominal`
              : undefined
          }
        />
        <Kpi
          label="Serious violation records"
          value={latest ? count(latest.serious) : NOT_RECORDED}
          note={
            latest && latest.violationRecords != null
              ? `Of ${fmt(latest.violationRecords)} violation records; a lettered item group counts each letter`
              : undefined
          }
        />
        <Kpi
          label="Fatality or catastrophe inspections"
          value={latest ? count(latest.fatCat) : NOT_RECORDED}
          note="Inspection type M. State Plans often code these as accident investigations (type A); not a count of deaths"
        />
        <Kpi
          label="Median days to close"
          value={latest?.medianDaysToClose != null ? fmt(latest.medianDaysToClose) : NOT_RECORDED}
          note={
            latest?.p90DaysToClose != null
              ? `90th percentile ${fmt(latest.p90DaysToClose)} days; closed cases only`
              : "Closed cases only"
          }
        />
        <Kpi
          label="Run by State Plan offices"
          value={statePlanShare != null ? `${fixed(statePlanShare, 1)}%` : NOT_RECORDED}
          note="Share of inspections, identified from the office code in the report ID"
        />
      </div>

      <Panel
        title={
          metric === "inspections" ? "Inspections per fiscal year" : "Penalties per fiscal year"
        }
        subtitle={
          metric === "inspections"
            ? "Programmed (planned) versus unprogrammed (complaints, referrals, accidents), FY1996 onward"
            : "Current penalties assessed on the year's inspections, nominal dollars (millions)"
        }
        actions={
          <Segmented
            label="Series"
            value={metric}
            options={[
              { id: "inspections", label: "Inspections" },
              { id: "penalty", label: "Penalties" },
            ]}
            onChange={setMetric}
          />
        }
        footnote={
          <>
            * Fiscal year in progress (runs October to September; the data are a snapshot, and State
            Plan citations may post up to 30 days late). Penalties and violations are attached to
            the year the inspection opened, are not inflation-adjusted, and are sums of recorded
            amounts, not OSHA totals.{" "}
            <SourceLink href={OSHA_DATA}>OSHA enforcement data</SourceLink>
          </>
        }
      >
        <div
          className="h-72 p-2"
          role="img"
          aria-label={
            metric === "inspections"
              ? "Stacked bars of OSHA inspections per fiscal year, programmed versus unprogrammed"
              : "Bars of OSHA current penalties per fiscal year in millions of dollars"
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            {metric === "inspections" ? (
              <BarChart data={chart} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  interval="preserveStartEnd"
                  minTickGap={14}
                />
                <YAxis tick={axisTick} tickFormatter={numTick} width={52} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, name) => [fmt(Number(v)), String(name)]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="programmed" name="Programmed" stackId="a" fill={FDA_COLORS[0]}>
                  {chart.map((c) => (
                    <Cell key={c.label} fillOpacity={c.partial ? 0.5 : 1} />
                  ))}
                </Bar>
                <Bar dataKey="unprogrammed" name="Unprogrammed" stackId="a" fill={FDA_COLORS[2]}>
                  {chart.map((c) => (
                    <Cell key={c.label} fillOpacity={c.partial ? 0.5 : 1} />
                  ))}
                </Bar>
                <Bar dataKey="other" name="Other or unclassified" stackId="a" fill={FDA_COLORS[5]}>
                  {chart.map((c) => (
                    <Cell key={c.label} fillOpacity={c.partial ? 0.5 : 1} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <BarChart data={chart} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  interval="preserveStartEnd"
                  minTickGap={14}
                />
                <YAxis tick={axisTick} tickFormatter={usdMillionsTick} width={52} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, name) => [`$${fixed(Number(v), 1)}M`, String(name)]}
                />
                <Bar dataKey="penaltyMillions" name="Current penalties" fill={FDA_COLORS[1]}>
                  {chart.map((c) => (
                    <Cell key={c.label} fillOpacity={c.partial ? 0.5 : 1} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </Panel>

      {latest ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel
            title={`How penalties were distributed, FY${latest.fy}`}
            subtitle="Inspections by the total current penalty assessed on each"
            footnote={
              <>
                Most inspections carry no penalty. Of the {count(latest.penalizedInspections)}{" "}
                inspections with a penalty, the median is {usd(latest.medianCurrentPenalty)}, the
                90th percentile {usd(latest.p90CurrentPenalty)} and the 99th{" "}
                {usd(latest.p99CurrentPenalty)}
                {latest.top1pctSharePct != null
                  ? `; the top 1% of penalized inspections hold ${fixed(latest.top1pctSharePct, 1)}% of the dollars`
                  : ""}
                .
              </>
            }
          >
            {latest.distribution.length ? (
              <ul className="space-y-1.5 p-3 text-xs" aria-label="Penalty distribution">
                {latest.distribution.map((d) => (
                  <li
                    key={d.bucket}
                    className="grid grid-cols-[8.5rem_1fr_4rem] items-center gap-2"
                  >
                    <span className="truncate" title={BUCKET_LABEL[d.bucket] ?? d.bucket}>
                      {BUCKET_LABEL[d.bucket] ?? d.bucket}
                    </span>
                    <span className="h-3 rounded-sm bg-muted" aria-hidden>
                      <span
                        className="block h-3 rounded-sm"
                        style={{
                          width: `${Math.max(1, (d.inspections / distMax) * 100)}%`,
                          background: FDA_COLORS[1],
                        }}
                      />
                    </span>
                    <span className="text-right font-mono">{fmt(d.inspections)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <StateNote>The penalty distribution is {NOT_RECORDED} for this year.</StateNote>
            )}
          </Panel>

          <Panel
            title={`Most-cited standards, FY${latest.fy}`}
            subtitle="Violation records by the section of 29 CFR cited"
            footnote="Counts are records, so a standard cited several times in one inspection counts each time. Sections link to the current regulation."
          >
            {latest.topSections.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">Most-cited OSHA standards</caption>
                  <thead className="text-left text-[11px] text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Standard
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        Records
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {latest.topSections.slice(0, 10).map((s) => (
                      <tr key={s.section}>
                        <td className="px-2 py-1">
                          <SourceLink
                            href={`https://www.ecfr.gov/current/title-29/section-${s.section}`}
                          >
                            29 CFR {s.section}
                          </SourceLink>
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(s.records)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <StateNote>Cited standards are {NOT_RECORDED} for this year.</StateNote>
            )}
          </Panel>
        </div>
      ) : null}

      <Panel
        title="Inspections per 100,000 covered jobs"
        subtitle={`Enforcement intensity by state, FY${data.latestFy}`}
        footnote={
          <>
            Counts federal OSHA and State Plan inspections, so this compares enforcement activity,
            not injury rates. Numerator is a fiscal year; the denominator is the calendar-year
            average of covered employment
            {data.rateDenominator?.year ? ` (${data.rateDenominator.year})` : ""}.{" "}
            {data.rateDenominator ? (
              <SourceLink href={data.rateDenominator.source}>BLS employment data</SourceLink>
            ) : null}{" "}
            Territories with very small employment can show very high rates.
          </>
        }
      >
        {data.stateRates.length ? (
          <div className="grid gap-3 p-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {corpus.geo ? (
              <UsMap
                geo={corpus.geo}
                values={values}
                valueLabel="OSHA inspections per 100,000 covered jobs"
                heading="OSHA inspections by state"
                hint="Hover a state for its rate; the table lists the ten highest."
                stateAction="Rate for"
                formatValue={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                legendNote="Shading scales with the rate across the 50 states and DC."
                onState={(fips) => {
                  const code = uspsByFips.get(fips);
                  if (code) void navigate({ to: "/places/$state", params: { state: code } });
                }}
              />
            ) : (
              <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                <MapPin className="size-6 opacity-50" aria-hidden />
                {corpus.error ? "The map is unavailable; use the table." : "Preparing the map…"}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Jurisdictions with the most inspections per 100,000 covered jobs
                </caption>
                <thead className="text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      #
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      Jurisdiction
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      Per 100k
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      Inspections
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.stateRates.slice(0, 10).map((r, i) => (
                    <tr key={r.code}>
                      <td className="px-2 py-1 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-1">
                        {nameByUsps.has(r.code) ? (
                          <Link
                            to="/places/$state"
                            params={{ state: r.code }}
                            className="text-primary hover:underline"
                          >
                            {nameByUsps.get(r.code)}
                          </Link>
                        ) : (
                          r.code
                        )}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{fixed(r.per100k, 1)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(r.inspections)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <StateNote>State rates are {NOT_RECORDED}.</StateNote>
        )}
      </Panel>

      {data.sir ? (
        <Panel
          title="Severe injury reports"
          subtitle="Employer reports of in-patient hospitalizations, amputations and eye losses, federal OSHA jurisdiction"
          footnote={
            <>
              Published aggregates only: OSHA&apos;s record-level file was not available, so state
              detail after 2021 and the nature of injury are {NOT_RECORDED}. Federal OSHA
              jurisdiction only (State Plan private-sector reports and fatalities are excluded); a
              report can involve several workers. {data.sir.note ?? ""}{" "}
              <SourceLink href="https://www.osha.gov/severeinjury">
                Severe injury reports
              </SourceLink>
            </>
          }
        >
          <div className="h-60 p-2" role="img" aria-label="Bars of severe injury reports per year">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.sir.series.map((s) => ({
                  label: s.partial ? `${s.year}*` : String(s.year),
                  reports: s.reports,
                  partial: s.partial,
                }))}
                margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={axisTick} />
                <YAxis tick={axisTick} tickFormatter={numTick} width={48} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => [fmt(Number(v)), "Reports"]}
                />
                <Bar dataKey="reports" name="Reports" fill={FDA_COLORS[3]}>
                  {data.sir.series.map((s) => (
                    <Cell key={s.year} fillOpacity={s.partial ? 0.5 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Establishments with the highest penalties"
        subtitle="Exact OSHA establishment names, current penalties on inspections opened FY2017 to FY2026"
        footnote="Each name is exactly as OSHA records it: stores, subsidiaries and parents are separate entries and are never merged. Penalties are computed from recorded amounts and are not OSHA's official totals. An inspection is not a finding about the company as a whole."
      >
        {shownEmployers.length ? (
          <div className="overflow-x-auto" id="osha-employers">
            <table className="w-full text-xs">
              <caption className="sr-only">
                Establishments with the highest current penalties
              </caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Establishment
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Inspections
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Serious
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Willful or repeat
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Current penalties
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Main states
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shownEmployers.map((e) => (
                  <tr key={e.recordId}>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{e.rank}</td>
                    <td className="max-w-64 truncate px-2 py-1" title={e.name}>
                      <Link
                        to="/records/$dataset/$id"
                        params={{ dataset: "osha_employers", id: e.recordId }}
                        className="text-primary hover:underline"
                      >
                        {e.name}
                      </Link>
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{count(e.inspections)}</td>
                    <td className="px-2 py-1 text-right font-mono">{count(e.serious)}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {e.willful == null || e.repeat == null
                        ? NOT_RECORDED
                        : fmt(e.willful + e.repeat)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{usd(e.currentPenalty)}</td>
                    <td className="max-w-40 truncate px-2 py-1" title={e.states ?? NOT_RECORDED}>
                      {e.states ?? NOT_RECORDED}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-2 pb-1">
              <MoreToggle
                total={data.employers.length}
                limit={employerLimit}
                expanded={allEmployers}
                onToggle={() => setAllEmployers((v) => !v)}
                controls="osha-employers"
                noun="establishments"
              />
            </div>
          </div>
        ) : (
          <StateNote>No establishment ranking is published yet.</StateNote>
        )}
      </Panel>
    </div>
  );
}
