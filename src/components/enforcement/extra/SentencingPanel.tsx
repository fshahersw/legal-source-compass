import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { type DistrictSentencing } from "@/lib/external/enforcementExtra.functions";
import {
  axisTick,
  Kpi,
  MoreToggle,
  Panel,
  Segmented,
  SourceLink,
  StateNote,
  tooltipStyle,
} from "../parts";
import { fmtInt, fmtMonths, fmtPct, share } from "./format";
import { districtSentencingQuery } from "./queries";

/** The 94 federal districts; the query is skipped for every other court id. */
const DISTRICT_ID = /^[a-z]{2,4}d$/;
const OFFENSE_LIMIT = 8;

/** U.S. Sentencing Commission aggregates for one federal district: trends, offense mix, guideline-range shares. */
export function SentencingPanel({ courtId }: { courtId: string }) {
  const enabled = DISTRICT_ID.test(courtId);
  const q = useQuery({ ...districtSentencingQuery(courtId), enabled });
  if (!enabled) return null;
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-64 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading federal sentencing statistics"
      />
    );
  if (q.isError)
    return (
      <div className="mb-5">
        <StateNote
          tone="error"
          action={
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Retry
            </button>
          }
        >
          Federal sentencing statistics could not be loaded.
        </StateNote>
      </div>
    );
  if (!q.data) return null;
  return <Body d={q.data} />;
}

type View = "cases" | "range" | "prison";

function Body({ d }: { d: DistrictSentencing }) {
  const uid = useId();
  const [view, setView] = useState<View>("cases");
  const [all, setAll] = useState(false);
  const last = d.years[d.years.length - 1]!;
  const first = d.years[0]!;
  const t = last.district;
  const n = last.national;
  const chart = d.years.map((y) => ({
    label: `FY${String(y.fy).slice(2)}`,
    fy: y.fy,
    cases: y.district.cases,
    within: y.district.withinPct,
    above: y.district.abovePct,
    below: y.district.belowPct,
    nationalWithin: y.national?.withinPct ?? null,
    prison: y.district.prisonMedian,
    nationalPrison: y.national?.prisonMedian ?? null,
  }));
  const offenses = d.latest?.offenses ?? [];
  const total = offenses.reduce((s, o) => s + o.cases, 0);
  const shown = all ? offenses : offenses.slice(0, OFFENSE_LIMIT);
  const breaks = d.years.filter(
    (y, i) => i > 0 && y.offenseVariable !== d.years[i - 1]!.offenseVariable,
  );
  return (
    <div className="mb-5">
      <Panel
        title={`Federal sentencing, FY${first.fy}–FY${last.fy}`}
        subtitle={`U.S. Sentencing Commission individual datafiles · ${d.name ?? d.courtId} · aggregates only`}
        actions={
          <Link
            to="/records/$dataset/$id"
            params={{ dataset: "ussc_sentencing_districts", id: `ussc:${last.fy}:${d.courtId}` }}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            FY{last.fy} record
          </Link>
        }
        footnote={
          <>
            Individuals sentenced = records in the Commission's datafile for the district. Median
            prison = length of imprisonment for cases with a prison term (life = 470 months).
            Guideline-range shares use cases with a range classification (FY{last.fy}:{" "}
            {fmtInt(t.rangeValid)}). Mandatory minimum = convicted under a statute carrying a
            minimum prison term.
            {breaks.length
              ? ` Offense categories change in ${breaks.map((b) => `FY${b.fy}`).join(" and ")} (the Commission's own reclassification), so offense mixes across those years are not comparable.`
              : ""}{" "}
            <SourceLink href="https://www.ussc.gov/research/datafiles/commission-datafiles">
              USSC datafiles
            </SourceLink>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-4">
          <Kpi
            label={`Individuals sentenced, FY${last.fy}`}
            value={fmtInt(t.cases)}
            note={
              n ? `${fmtPct(share(t.cases, n.cases))} of ${fmtInt(n.cases)} nationally` : undefined
            }
          />
          <Kpi
            label="Median prison term"
            value={fmtMonths(t.prisonMedian)}
            note={
              n
                ? `National ${fmtMonths(n.prisonMedian)} · mean here ${fmtMonths(t.prisonMean)}`
                : undefined
            }
          />
          <Kpi
            label="Within guideline range"
            value={fmtPct(t.withinPct)}
            note={`Below ${fmtPct(t.belowPct)} · above ${fmtPct(t.abovePct)}${n ? ` · national within ${fmtPct(n.withinPct)}` : ""}`}
          />
          <Kpi
            label="Mandatory-minimum statute"
            value={fmtPct(t.mmPct)}
            note={n ? `National ${fmtPct(n.mmPct)}` : undefined}
          />
        </div>
        <div className="border-t border-border/60 px-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">Trend by fiscal year</p>
            <Segmented<View>
              label="Trend measure"
              value={view}
              onChange={setView}
              options={[
                { id: "cases", label: "Sentenced" },
                { id: "range", label: "Guideline range" },
                { id: "prison", label: "Median prison" },
              ]}
            />
          </div>
          <div
            className="h-56 py-2"
            role="img"
            aria-label={
              view === "cases"
                ? "Bars of individuals sentenced per fiscal year in this district"
                : view === "range"
                  ? "Lines of the shares sentenced within, below and above the guideline range per fiscal year, with the national within-range share"
                  : "Lines of the median prison term per fiscal year in this district and nationally"
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              {view === "cases" ? (
                <BarChart data={chart} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={axisTick}
                    interval="preserveStartEnd"
                    minTickGap={10}
                  />
                  <YAxis
                    tick={axisTick}
                    width={44}
                    tickFormatter={(v: number) => v.toLocaleString("en-US")}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => [fmtInt(Number(v)), "Sentenced"]}
                  />
                  <Bar dataKey="cases" name="Sentenced" fill={FDA_COLORS[0]} />
                </BarChart>
              ) : view === "range" ? (
                <LineChart data={chart} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={axisTick}
                    interval="preserveStartEnd"
                    minTickGap={10}
                  />
                  <YAxis
                    tick={axisTick}
                    width={36}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, name) => [fmtPct(Number(v)), String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    dataKey="within"
                    name="Within range"
                    stroke={FDA_COLORS[0]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls={false}
                  />
                  <Line
                    dataKey="below"
                    name="Below range"
                    stroke={FDA_COLORS[2]}
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    dataKey="above"
                    name="Above range"
                    stroke={FDA_COLORS[1]}
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    dataKey="nationalWithin"
                    name="National within"
                    stroke={FDA_COLORS[5]}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              ) : (
                <LineChart data={chart} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={axisTick}
                    interval="preserveStartEnd"
                    minTickGap={10}
                  />
                  <YAxis tick={axisTick} width={36} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, name) => [fmtMonths(Number(v)), String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    dataKey="prison"
                    name="This district"
                    stroke={FDA_COLORS[0]}
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    dataKey="nationalPrison"
                    name="National"
                    stroke={FDA_COLORS[5]}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
        <div className="border-t border-border/60 px-3 py-2">
          <p className="text-xs font-medium">
            Offense mix, FY{d.latest?.fy ?? last.fy}
            <span className="font-normal text-muted-foreground">
              {" "}
              · primary offense type ({d.latest?.offenseVariable ?? "Not recorded"})
            </span>
          </p>
          {offenses.length ? (
            <>
              <div className="mt-1 overflow-x-auto">
                <table id={uid} className="w-full min-w-[36rem] text-xs">
                  <caption className="sr-only">
                    Primary offense types sentenced in this district
                  </caption>
                  <thead className="text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1 pr-2 text-left font-medium">
                        Offense type
                      </th>
                      <th scope="col" className="px-2 py-1 text-right font-medium">
                        Sentenced
                      </th>
                      <th scope="col" className="px-2 py-1 text-left font-medium">
                        Share here · nationally
                      </th>
                      <th scope="col" className="px-2 py-1 text-right font-medium">
                        Median prison
                      </th>
                      <th scope="col" className="px-2 py-1 text-right font-medium">
                        Within range
                      </th>
                      <th scope="col" className="px-2 py-1 text-right font-medium">
                        Mand. min.
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((o) => {
                      const here = share(o.cases, total);
                      const nat = d.latest?.nationalShare[o.label] ?? null;
                      return (
                        <tr key={o.label} className="border-t border-border/50">
                          <th scope="row" className="py-1 pr-2 text-left font-normal">
                            {o.label}
                          </th>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {fmtInt(o.cases)}
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 shrink-0 rounded bg-muted" aria-hidden>
                                <div
                                  className="h-1.5 rounded bg-primary"
                                  style={{ width: `${Math.min(100, here ?? 0)}%` }}
                                />
                              </div>
                              <span className="font-mono tabular-nums">
                                {fmtPct(here)}
                                <span className="text-muted-foreground"> · {fmtPct(nat)}</span>
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {fmtMonths(o.prisonMedian)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {fmtPct(o.withinPct)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            {fmtPct(o.mmPct)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <MoreToggle
                total={offenses.length}
                limit={OFFENSE_LIMIT}
                expanded={all}
                onToggle={() => setAll((v) => !v)}
                controls={uid}
                noun="offense types"
              />
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              No offense breakdown is recorded for this year.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
