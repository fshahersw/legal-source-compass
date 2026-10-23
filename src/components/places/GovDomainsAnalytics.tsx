import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HowToRead } from "@/components/analysis/HowToRead";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  axisTick,
  LoadingBlock,
  Panel,
  SourceLink,
  StateNote,
  tooltipStyle,
} from "@/components/enforcement/parts";
import { getGovDomainsSummary } from "@/lib/external/govDomains.functions";
import { snapshotText } from "@/components/places/state/govDomainsView";
import { cn } from "@/lib/utils";
import { SERIES, chartRows, chartSummary, stateBars, type SeriesKey } from "./govDomainsChart";

const TOP = 15;
const CISA_VIEWER = "https://data.get.gov/?file=current-full.csv";
const GSA_LIST = "https://github.com/GSA/govt-urls";
const COLOR: Record<SeriesKey, string> = {
  state: FDA_COLORS[0]!,
  county: FDA_COLORS[1]!,
  city: FDA_COLORS[2]!,
  special_district: FDA_COLORS[3]!,
  federal: FDA_COLORS[4]!,
  other: FDA_COLORS[5]!,
};
const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Registered government domains by state and government level: a count of domains listed by the CISA .gov registry and the
 * GSA list, by the state the publisher gives. Counts, not rates; the chart shows the largest states, the table every one.
 */
export function GovDomainsAnalytics({ className }: { className?: string }) {
  const fn = useServerFn(getGovDomainsSummary);
  const q = useQuery({
    queryKey: ["gov-domains-summary"],
    queryFn: () => fn(),
    staleTime: 10 * 60_000,
  });
  const [showTable, setShowTable] = useState(false);
  const bars = useMemo(() => stateBars(q.data?.states ?? []), [q.data]);
  const rows = useMemo(() => chartRows(bars, TOP), [bars]);
  const all = q.data?.all;
  const snapshot = snapshotText(all?.snapshot ?? null);
  return (
    <div className={cn("space-y-2", className)} data-testid="gov-domains-analytics">
      <Panel
        title="Registered government domains by state and level of government"
        subtitle={`Number of domains listed by the CISA .gov registry and the GSA government URLs list, by the state each publisher gives. ${snapshot}.`}
        footnote={
          <>
            Source: <SourceLink href={CISA_VIEWER}>CISA .gov registry data</SourceLink> and{" "}
            <SourceLink href={GSA_LIST}>GSA government URLs</SourceLink>. Unit: domains (a listed
            domain is counted once in each state the publisher gives).
          </>
        }
      >
        {q.isPending ? <LoadingBlock label="Loading registered government domains" /> : null}
        {q.error ? (
          <StateNote tone="error">The government domain registries could not be read.</StateNote>
        ) : null}
        {q.data && !all ? (
          <StateNote>
            The government domain registries are not available in this workspace yet.
          </StateNote>
        ) : null}
        {all && bars.length ? (
          <div className="px-3 py-2">
            <p className="m-0 mb-1 text-xs text-muted-foreground">
              {fmt(all.total)} domains in all ({fmt(all.withState)} with a publisher-given state,{" "}
              {fmt(all.withoutState)} without one, which no state&rsquo;s bar includes). The {TOP}{" "}
              largest of {bars.length} states and territories are charted.
            </p>
            <div
              role="img"
              aria-label={chartSummary(bars, TOP)}
              style={{ height: 40 + rows.length * 24 }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={rows}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                >
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" tick={axisTick} tickFormatter={fmt} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={axisTick} width={118} interval={0} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number) => fmt(v)}
                    cursor={{ fill: "var(--muted)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {SERIES.map((s) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label}
                      stackId="a"
                      fill={COLOR[s.key]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <button
              type="button"
              aria-expanded={showTable}
              onClick={() => setShowTable((v) => !v)}
              className="mt-1 rounded text-[11.5px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {showTable ? "Hide data table" : `Show data table for all ${bars.length}`}
            </button>
            {showTable ? (
              <div className="mt-1 max-h-96 overflow-auto rounded border border-border">
                <table className="w-full text-left text-xs tabular-nums">
                  <caption className="sr-only">
                    Registered government domains by state and level of government
                  </caption>
                  <thead className="sticky top-0 bg-muted text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2 py-1 font-medium">
                        State
                      </th>
                      <th scope="col" className="px-2 py-1 text-right font-medium">
                        Domains
                      </th>
                      {SERIES.map((s) => (
                        <th key={s.key} scope="col" className="px-2 py-1 text-right font-medium">
                          {s.label}
                        </th>
                      ))}
                      <th scope="col" className="px-2 py-1 text-right font-medium">
                        CISA
                      </th>
                      <th scope="col" className="px-2 py-1 text-right font-medium">
                        GSA
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {bars.map((b) => (
                      <tr key={b.usps}>
                        <th scope="row" className="px-2 py-1 font-normal">
                          {b.name}
                        </th>
                        <td className="px-2 py-1 text-right font-medium">{fmt(b.total)}</td>
                        {SERIES.map((s) => (
                          <td key={s.key} className="px-2 py-1 text-right">
                            {fmt(b.series[s.key])}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right">{fmt(b.cisa)}</td>
                        <td className="px-2 py-1 text-right">{fmt(b.gsa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
        {all && !bars.length ? (
          <StateNote>No registered government domain has a publisher-given state.</StateNote>
        ) : null}
      </Panel>
      <HowToRead
        measures={[
          {
            term: "Domains",
            means:
              "Entries in the CISA .gov registry (every domain registered in the .gov zone) and in GSA's list of government domains outside .gov and .mil.",
            caveat:
              "A count of domains, not of governments or websites in use, and not per resident. A state with many small townships, or many agencies that each register a name, has more.",
          },
          {
            term: "Level of government",
            means:
              "Taken from the type each registry publishes (for example State or territory, County, City, Special district); GSA's Local and CISA's City count together as City or local.",
            caveat: "The types are the registrants' own choices and are not audited.",
          },
          {
            term: "State",
            means: "The state the publisher gives, usually the organization's address.",
            caveat:
              "It is never taken from the domain name. Federal agencies show where they are located, not where they act.",
          },
        ]}
        notes={
          <>
            Browse a state&rsquo;s registered domains in the &ldquo;Official government
            websites&rdquo; section of its{" "}
            <Link to="/places" className="underline">
              state page
            </Link>
            .
          </>
        }
      />
    </div>
  );
}
