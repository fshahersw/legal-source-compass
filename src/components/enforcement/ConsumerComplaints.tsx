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
  getConsumerComplaints,
  type ConsumerComplaints as ConsumerData,
} from "@/lib/external/consumerComplaints.functions";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { consumerTakeaways } from "./enforcementTakeaways";
import { numTick } from "./listDisplay";
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

export const consumerComplaintsQuery = {
  queryKey: ["cfpb-consumer-complaints"],
  queryFn: () => getConsumerComplaints(),
  staleTime: 10 * 60 * 1000,
};

const CFPB_DATABASE = "https://www.consumerfinance.gov/data-research/consumer-complaints/";
const fmt = (n: number) => n.toLocaleString("en-US");
const NOT_RECORDED = "Not recorded";
const fixed = (v: number, digits: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pctText = (v: number | null, digits = 1) =>
  v == null ? NOT_RECORDED : `${fixed(v, digits)}%`;
const signedPct = (v: number | null) =>
  v == null
    ? NOT_RECORDED
    : `${v > 0 ? "+" : ""}${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
const millions = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`
    : fmt(n);
const fipsByUsps = new Map(STATES.map((s) => [s.usps, s.fips]));
const uspsByFips = new Map(STATES.map((s) => [s.fips, s.usps]));

export function ConsumerComplaints() {
  const q = useQuery(consumerComplaintsQuery);
  if (q.isLoading) return <LoadingBlock label="Loading CFPB consumer complaint analytics" />;
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
        Consumer complaint analytics could not be loaded.
      </StateNote>
    );
  if (!q.data)
    return <StateNote>Consumer complaint analytics have not been published yet.</StateNote>;
  return <Body data={q.data} />;
}

const CFPB_MEASURES: Measure[] = [
  {
    term: "Complaint",
    means:
      "A consumer submission to the CFPB Consumer Complaint Database, counted by the date the CFPB received it.",
    caveat:
      "Not a finding of wrongdoing. A complaint is published after the company responds or after 15 days.",
  },
  {
    term: "Year in progress (*)",
    means:
      "The database starts 2011-12-01 and recent weeks are not yet published, so the current year is understated.",
    caveat: "A year in progress is left out of year-over-year change.",
  },
  {
    term: "Per 100,000 residents",
    means:
      "Complaints from the consumer's mailing-address state divided by the Census July 1 resident-population estimate, times 100,000.",
    caveat:
      "A rate compares states of different size; a count does not. Only the 50 states and DC are ranked.",
  },
  {
    term: "Rise since 2022",
    means: "The percent change in a state's per-capita rate from 2022 to 2025.",
    caveat: "A small base can produce a large percentage.",
  },
  {
    term: "Timely and relief rates",
    means:
      "Timely = Yes ÷ (Yes + No) company responses. Relief = complaints closed with monetary or non-monetary relief ÷ complaints with a company response.",
    caveat:
      "Both describe the company's recorded response, not whether the complaint was justified.",
  },
  {
    term: "Company names",
    means: "Exactly as recorded by the CFPB; spelling variants of one company are not merged.",
    caveat: "Names are not matched to SEC company profiles in this view.",
  },
];

type MapMetric = "per100k" | "rise";
const METRIC_LABEL: Record<MapMetric, string> = {
  per100k: "complaints per 100,000 residents, 2025",
  rise: "rise in the per-capita rate, 2022 to 2025 (%)",
};

function Body({ data }: { data: ConsumerData }) {
  const corpus = useCorpus();
  const navigate = useNavigate();
  const [metric, setMetric] = useState<MapMetric>("per100k");
  const [allCompanies, setAllCompanies] = useState(false);
  const [allReports, setAllReports] = useState(false);
  const lastComplete = [...data.years].reverse().find((y) => y.complete);
  const previous = lastComplete
    ? data.years.find((y) => y.year === lastComplete.year - 1 && y.complete)
    : undefined;
  const chart = data.years.map((y) => {
    const credit = y.creditReporting ?? 0;
    return {
      label: y.complete ? String(y.year) : `${y.year}*`,
      creditReporting: credit,
      other: Math.max(0, y.complaints - credit),
      partial: !y.complete,
    };
  });
  const ranking = metric === "per100k" ? data.perCapitaRanking : data.riseRanking;
  const byCode = new Map(data.states.map((s) => [s.code, s]));
  const values = new Map<string, number>();
  for (const r of ranking) {
    const fips = fipsByUsps.get(r.code);
    if (fips) values.set(fips, r.value);
  }
  const companyLimit = 10;
  const shownCompanies = allCompanies
    ? data.topCompanies
    : data.topCompanies.slice(0, companyLimit);
  const reportLimit = 8;
  const takeaways = consumerTakeaways({
    lastYear: lastComplete
      ? {
          year: lastComplete.year,
          complaints: lastComplete.complaints,
          creditReporting: lastComplete.creditReporting,
        }
      : null,
    previous: previous
      ? {
          year: previous.year,
          complaints: previous.complaints,
          creditReporting: previous.creditReporting,
        }
      : null,
    topState: data.perCapitaRanking[0]
      ? { name: data.perCapitaRanking[0].name, value: data.perCapitaRanking[0].value }
      : null,
    perCapitaLabel: METRIC_LABEL.per100k,
    riseState: data.riseRanking[0]
      ? {
          name: data.riseRanking[0].name,
          value: data.riseRanking[0].value,
          label: "rise in the per-capita complaint rate from 2022 to 2025",
        }
      : null,
    topCompanies: data.topCompanies.map((c) => ({ company: c.company, complaints: c.complaints })),
    totalComplaints: data.complaints,
    since: data.from,
  });
  const shownReports = allReports ? data.reports.slice(0, 30) : data.reports.slice(0, reportLimit);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label="Complaints, all history"
          value={millions(data.complaints)}
          note={`Received ${data.from} to ${data.to}`}
        />
        <Kpi
          label={lastComplete ? `Complaints in ${lastComplete.year}` : "Latest complete year"}
          value={lastComplete ? millions(lastComplete.complaints) : NOT_RECORDED}
          note={
            lastComplete && previous
              ? `${signedPct(lastComplete.yoyPct)} vs ${previous.year} (${fmt(previous.complaints)})`
              : undefined
          }
        />
        <Kpi
          label={data.ytd ? `Complaints ${data.ytd.from.slice(0, 4)} to date` : "Year to date"}
          value={data.ytd ? millions(data.ytd.complaints) : NOT_RECORDED}
          note={
            data.ytd
              ? `${signedPct(data.ytd.changePct)} vs the same span last year; understated (recent weeks incomplete)`
              : undefined
          }
        />
        <Kpi
          label={
            lastComplete ? `Credit reporting share, ${lastComplete.year}` : "Credit reporting share"
          }
          value={pctText(lastComplete?.creditReportingSharePct ?? null)}
          note="Complaints about credit reports against the three bureaus dominate recent growth"
        />
        <Kpi
          label="Timely company response"
          value={pctText(data.timelyRate, 2)}
          note="Yes / (Yes + No), all history"
        />
        <Kpi
          label="Companies named"
          value={fmt(data.companies)}
          note="Exact recorded names; variants are not merged"
        />
      </div>

      <KeyTakeaways items={takeaways} scope={`${data.from} to ${data.to} · all complaints`} />
      <HowToRead measures={CFPB_MEASURES} />

      <Panel
        id="cfpb-years"
        title="Complaints per year"
        subtitle="Credit reporting versus every other product"
        footnote={
          <>
            * Year in progress: data start 2011-12-01 and recent weeks are not yet published (a
            complaint is published after the company responds or after 15 days). Credit reporting
            means products whose recorded name starts with “Credit reporting”. Complaints are
            consumer submissions, not findings of wrongdoing.{" "}
            <SourceLink href={CFPB_DATABASE}>Consumer Complaint Database</SourceLink>
          </>
        }
      >
        <div
          className="h-72 p-2"
          role="img"
          aria-label="Stacked bars of consumer complaints per year, credit reporting versus other products"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={axisTick} />
              <YAxis tick={axisTick} tickFormatter={numTick} width={48} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) => [fmt(Number(v)), String(name)]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="creditReporting"
                name="Credit reporting"
                stackId="a"
                fill={FDA_COLORS[2]}
              >
                {chart.map((c) => (
                  <Cell key={c.label} fillOpacity={c.partial ? 0.5 : 1} />
                ))}
              </Bar>
              <Bar dataKey="other" name="All other products" stackId="a" fill={FDA_COLORS[0]}>
                {chart.map((c) => (
                  <Cell key={c.label} fillOpacity={c.partial ? 0.5 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Product share shift"
          subtitle={`${data.productShift.from} to ${data.productShift.to}, share of all complaints`}
          footnote="Product names changed in 2013, 2017 and August 2023; only the two most recent complete years, which use the same form, are compared."
        >
          {data.productShift.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Product share of complaints by year and shift in percentage points
                </caption>
                <thead className="text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      Product
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      {data.productShift.from}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      {data.productShift.to}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      Shift (pp)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.productShift.rows.slice(0, 8).map((r) => (
                    <tr key={r.product}>
                      <td className="max-w-56 truncate px-2 py-1" title={r.product}>
                        {r.product}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {pctText(r.share2024Pct, 2)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {pctText(r.share2025Pct, 2)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {r.shiftPp > 0 ? "+" : ""}
                        {r.shiftPp.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <StateNote>No comparable products for the two most recent complete years.</StateNote>
          )}
        </Panel>

        <Panel
          title="Recent years"
          subtitle="Complaints, change, and how companies responded"
          footnote={
            <>
              Relief rate = complaints closed with monetary or non-monetary relief ÷ complaints with
              a company response (every response except “In progress” and blank). Consumer
              “disputed” is {NOT_RECORDED}: the CFPB discontinued that field on 2017-04-24 and
              removed it from its export. * Year in progress.
            </>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">
                Recent years: complaints, change from the year before, timely response and relief
                rates
              </caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Year
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Complaints
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Change
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Timely
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Relief
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {[...data.years]
                  .reverse()
                  .slice(0, 7)
                  .map((y) => (
                    <tr key={y.year}>
                      <td className="px-2 py-1 font-mono">{y.complete ? y.year : `${y.year}*`}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(y.complaints)}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {y.complete ? signedPct(y.yoyPct) : NOT_RECORDED}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{pctText(y.timelyRate, 2)}</td>
                      <td className="px-2 py-1 text-right font-mono">{pctText(y.reliefRate, 1)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel
        id="cfpb-states"
        title="Consumer complaints by state"
        subtitle={`Shading and ranking: ${METRIC_LABEL[metric]}`}
        actions={
          <Segmented
            label="Map metric"
            value={metric}
            options={[
              { id: "per100k", label: "Per 100,000, 2025" },
              { id: "rise", label: "Rise since 2022" },
            ]}
            onChange={setMetric}
          />
        }
        footnote="State is the consumer's mailing-address state. Per-capita uses Census July 1 resident-population estimates. Rankings cover the 50 states and DC; territories and the 63,343 complaints with no state are in the dataset records."
      >
        <div className="grid gap-3 p-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {corpus.geo ? (
            <UsMap
              geo={corpus.geo}
              values={values}
              valueLabel={METRIC_LABEL[metric]}
              heading="CFPB consumer complaints by state"
              hint="Hover a state for its value; the table lists the ten highest."
              stateAction="Value for"
              formatValue={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 1 })}
              legendNote="Shading scales with the selected metric across the 50 states and DC."
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
              <caption className="sr-only">Highest states for {METRIC_LABEL[metric]}</caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    State
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    {metric === "per100k" ? "Per 100k" : "Rise"}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Complaints
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {ranking.slice(0, 10).map((r) => (
                  <tr key={r.code}>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{r.rank}</td>
                    <td className="px-2 py-1">
                      <Link
                        to="/places/$state"
                        params={{ state: r.code }}
                        className="text-primary hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {metric === "per100k" ? fixed(r.value, 1) : signedPct(r.value)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {byCode.has(r.code) ? fmt(byCode.get(r.code)!.complaints) : NOT_RECORDED}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <Panel
        id="cfpb-companies-panel"
        title="Most-named companies"
        subtitle="By complaints received over all history; exact recorded company names"
        footnote={
          <>
            The change column compares the latest three years with the three before. Names are
            exactly as recorded by the CFPB (variants are not merged) and are not matched to SEC
            company profiles in this view.
          </>
        }
      >
        <div className="overflow-x-auto" id="cfpb-companies">
          <table className="w-full text-xs">
            <caption className="sr-only">Companies with the most consumer complaints</caption>
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  #
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Company
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Complaints
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Change, 3 years
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Top product
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Timely
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Relief
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shownCompanies.map((c) => (
                <tr key={c.company}>
                  <td className="px-2 py-1 font-mono text-muted-foreground">{c.rank ?? ""}</td>
                  <td className="max-w-64 truncate px-2 py-1" title={c.company}>
                    {c.company}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(c.complaints)}</td>
                  <td className="px-2 py-1 text-right font-mono">{signedPct(c.windowChangePct)}</td>
                  <td className="max-w-48 truncate px-2 py-1" title={c.topProduct ?? NOT_RECORDED}>
                    {c.topProduct ?? NOT_RECORDED}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{pctText(c.timelyRate, 3)}</td>
                  <td className="px-2 py-1 text-right font-mono">{pctText(c.reliefRate, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-2 pb-1">
            <MoreToggle
              total={data.topCompanies.length}
              limit={companyLimit}
              expanded={allCompanies}
              onToggle={() => setAllCompanies((v) => !v)}
              controls="cfpb-companies"
              noun="companies"
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="CFPB research reports"
        subtitle={`${fmt(data.reportCount)} reports in the CFPB catalog; most recent first`}
        footnote={
          <>
            Titles, dates and categories as listed by the CFPB.{" "}
            <SourceLink href="https://www.consumerfinance.gov/data-research/research-reports/">
              Research reports
            </SourceLink>
          </>
        }
      >
        {shownReports.length ? (
          <ul className="divide-y divide-border/60 text-xs" id="cfpb-reports">
            {shownReports.map((r) => (
              <li
                key={r.url}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5"
              >
                <span className="w-20 shrink-0 font-mono text-muted-foreground">{r.date}</span>
                <SourceLink href={r.url}>{r.title}</SourceLink>
                <span className="text-[11px] text-muted-foreground">
                  {r.category ?? NOT_RECORDED}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <StateNote>No reports are published yet.</StateNote>
        )}
        <div className="px-3 pb-1">
          <MoreToggle
            total={Math.min(30, data.reports.length)}
            limit={reportLimit}
            expanded={allReports}
            onToggle={() => setAllReports((v) => !v)}
            controls="cfpb-reports"
            noun="reports"
          />
        </div>
      </Panel>
    </div>
  );
}
