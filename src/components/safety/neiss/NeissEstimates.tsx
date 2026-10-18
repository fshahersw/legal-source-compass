import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { compact, int, NOT_RECORDED, pct, signedPct } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { numTick } from "@/components/enforcement/listDisplay";
import {
  axisTick,
  Kpi,
  LoadingBlock,
  MoreToggle,
  Panel,
  SourceLink,
  StateNote,
  tooltipStyle,
} from "@/components/enforcement/parts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { getNeissNational, type NeissNational } from "@/lib/external/neiss.functions";
import { InjuryExplorer } from "./InjuryExplorer";
import { neissNationalQuery } from "./queries";
import { NeissBadge, NeissCredit, NeissNotice } from "./parts";
import {
  neissTakeaways,
  nationalRows,
  NEISS_LABEL,
  sameDesign,
  yearOf,
  type NationalRow,
} from "./neissView";

const PRE = FDA_COLORS[0];
const POST = FDA_COLORS[2];
const TOP_LIMIT = 10;

export function NeissEstimates() {
  const q = useQuery(neissNationalQuery);
  return (
    <div className="space-y-3">
      <NeissNotice breakYear={q.data?.designBreak?.year ?? null} />
      {q.isLoading ? (
        <LoadingBlock label="Loading NEISS national estimates" />
      ) : q.isError ? (
        <StateNote
          tone="error"
          action={
            <button type="button" onClick={() => void q.refetch()} className="underline">
              Retry
            </button>
          }
        >
          The NEISS national estimates could not be loaded.
        </StateNote>
      ) : !q.data ? (
        <StateNote>The NEISS national estimates have not been published yet.</StateNote>
      ) : (
        <Body data={q.data} />
      )}
      <InjuryExplorer />
      <NeissCredit />
    </div>
  );
}

function measures(data: NeissNational): Measure[] {
  const b = data.designBreak;
  return [
    {
      term: "Weighted estimate",
      means:
        "The sum of CPSC's case weights over the sample cases: an estimate of emergency-department-treated injuries associated with a product, projected from about 100 hospitals.",
      caveat:
        "Not a count of cases, people or all injuries. “Associated with” does not mean caused by the product.",
    },
    {
      term: "95% interval and CV",
      means:
        "Estimate ± 1.96 × estimate × CV, CPSC's formula, with the CV from hospital clusters within strata.",
      caveat:
        "Computed by this project from CPSC's public-use files; CPSC's own variance routine is unpublished, so small CV differences are possible.",
    },
    {
      term: "Withheld (unstable)",
      means: data.reliabilityRule
        ? `CPSC's rule: ${data.reliabilityRule.replace(/\s*\(CPSC; estimate withheld\)\s*$/, "")}. The estimate is not shown; only the unweighted sample count is kept.`
        : "CPSC's rule withholds small or imprecise estimates; only the unweighted sample count is kept.",
      caveat: "A sample count is a number of records, not a national estimate.",
    },
    {
      term: b ? `${b.year} design change` : "Sample design change",
      means: b
        ? `CPSC re-stratified the sample in ${b.year}: ${b.changedStratum != null && b.inBothYears != null ? `${int(b.changedStratum)} of ${int(b.inBothYears)} hospitals present in both ${b.year - 1} and ${b.year} moved stratum, ` : ""}and the per-stratum weights changed.`
        : "The design break is not recorded.",
      caveat: b
        ? `Estimates from ${b.year} on are not like-for-like with earlier years; ${b.year - 1} to ${b.year} is not a trend.`
        : undefined,
    },
    {
      term: "Overlap",
      means:
        "A case with up to three product codes counts under each, so product estimates overlap.",
      caveat: "Never add estimates of different products.",
    },
    {
      term: "Admitted to hospital",
      means: "The estimated share of visits that ended with admission, with its own interval.",
      caveat:
        "A coded field that moved a lot over 1997 to 2025; CPSC warns that system and coding changes affect comparisons over time.",
    },
  ];
}

function Body({ data }: { data: NeissNational }) {
  const [allTop, setAllTop] = useState(false);
  const b = data.designBreak;
  const breakYear = b?.year ?? null;
  const latest = yearOf(data.years, data.latestYear);
  const prev = yearOf(data.years, data.latestYear - 1);
  const before = b ? yearOf(data.years, b.year - 1) : undefined;
  const after = b ? yearOf(data.years, b.year) : undefined;
  const first = data.years[0];
  const rows = nationalRows(data.years, breakYear);
  const takeaways = neissTakeaways(data);
  const comparable = latest && prev ? sameDesign(latest.year, prev.year, breakYear) : false;
  const shownTop = allTop ? data.topProducts : data.topProducts.slice(0, TOP_LIMIT);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={latest ? `${latest.year} estimated injuries (weighted)` : "Latest estimate"}
          value={latest ? int(latest.estimate) : NOT_RECORDED}
          note={
            latest
              ? `95% interval ${compact(latest.ci95[0])} to ${compact(latest.ci95[1])}; CV ${pct(latest.cvPct, 1)}. An estimate, not a case count`
              : undefined
          }
        />
        <Kpi
          label={
            latest && prev ? `${latest.year} against ${prev.year}` : "Change on the year before"
          }
          value={latest?.change && comparable ? signedPct(latest.change.pct) : NOT_RECORDED}
          note={
            latest?.change && comparable
              ? `${latest.change.exceedsSamplingError ? "Beyond" : "Within"} the sampling error; both years use the ${breakYear ?? "current"} sample design`
              : "Not compared across the sample redesign"
          }
        />
        <Kpi
          label={b ? `${b.year - 1} to ${b.year}: sample redesign` : "Sample redesign"}
          value={
            before && after
              ? `${compact(before.estimate)} → ${compact(after.estimate)}`
              : NOT_RECORDED
          }
          note={
            b
              ? `Not a trend. ${b.changedStratum != null && b.inBothYears != null ? `${int(b.changedStratum)} of ${int(b.inBothYears)} shared hospitals changed stratum and weights changed` : "The stratification and weights changed"}`
              : undefined
          }
        />
        <Kpi
          label={latest ? `Admitted to hospital, ${latest.year}` : "Admitted to hospital"}
          value={latest?.admittedPct ? pct(latest.admittedPct.pct, 1) : NOT_RECORDED}
          note={
            latest?.admittedPct
              ? `95% interval ${pct(latest.admittedPct.ciLow, 1)} to ${pct(latest.admittedPct.ciHigh, 1)}${first?.admittedPct ? `; ${pct(first.admittedPct.pct, 1)} in ${first.year}` : ""}`
              : undefined
          }
        />
        <Kpi
          label={latest ? `Reporting hospitals, ${latest.year}` : "Reporting hospitals"}
          value={latest?.hospitals != null ? int(latest.hospitals) : NOT_RECORDED}
          note={
            latest
              ? `${first?.hospitals != null ? `${int(first.hospitals)} in ${first.year}; ` : ""}${int(latest.cases)} sample cases (unweighted count, not an estimate)`
              : undefined
          }
        />
        <Kpi
          label={`Reliable ${data.latestYear} product estimates`}
          value={
            data.reliability
              ? `${int(data.reliability.reliable)} of ${int(data.reliability.total)}`
              : NOT_RECORDED
          }
          note={
            data.reliability
              ? `${int(data.reliability.withheld)} withheld as unstable; ${int(data.reliability.noCases)} codes with no sample case`
              : undefined
          }
        />
      </div>

      <KeyTakeaways
        items={takeaways}
        scope={`${NEISS_LABEL} · ${first?.year ?? ""}–${data.latestYear}`}
      />
      <HowToRead measures={measures(data)} notes={data.caveats} />

      <Panel
        id="neiss-national"
        title="National estimate per year"
        subtitle={`Emergency-department-treated consumer-product injuries, ${first?.year ?? ""} to ${data.latestYear}, with the 95% interval`}
        actions={<NeissBadge />}
        footnote={
          <>
            Weighted national estimates with 95% intervals (shaded), not case counts.{" "}
            {b
              ? `The line is split at ${b.year}: CPSC re-stratified the sample (${b.hospitalsBefore != null && b.hospitalsAfter != null ? `${int(b.hospitalsBefore)} hospitals in ${b.year - 1}, ${int(b.hospitalsAfter)} in ${b.year}; ` : ""}weights changed), so the step between ${b.year - 1} and ${b.year} is not a trend. `
              : "The sample design break is not recorded. "}
            <SourceLink
              href={data.sourceUrls[0] ?? "https://www.cpsc.gov/cgibin/NEISSQuery/home.aspx"}
            >
              CPSC NEISS
            </SourceLink>
          </>
        }
      >
        <div
          className="h-72 p-2"
          role="img"
          aria-label={`Line of the weighted national NEISS estimate per year with its 95% interval, ${first?.year ?? ""} to ${data.latestYear}${breakYear != null ? `, split at the ${breakYear} sample redesign` : ""}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 16, right: 14, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="year" tick={axisTick} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={axisTick} tickFormatter={numTick} width={48} domain={[0, "auto"]} />
              {breakYear != null ? (
                <ReferenceLine
                  x={breakYear}
                  stroke="var(--warning)"
                  strokeDasharray="4 3"
                  label={{
                    // Drawn to the left of the line so the text never runs off the right edge of the plot.
                    content: (props) => {
                      const vb = props.viewBox as { x?: number; y?: number } | undefined;
                      return (
                        <text
                          x={(vb?.x ?? 0) - 6}
                          y={(vb?.y ?? 0) + 11}
                          textAnchor="end"
                          fontSize={11}
                          fill="var(--muted-foreground)"
                        >
                          {`${breakYear}: new sample design`}
                        </text>
                      );
                    },
                  }}
                />
              ) : null}
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }}
                content={({ active, payload }) => {
                  const row = active
                    ? (payload?.[0]?.payload as NationalRow | undefined)
                    : undefined;
                  if (!row) return null;
                  return (
                    <div
                      className="rounded-md border border-border bg-popover px-2 py-1 text-popover-foreground shadow-sm"
                      style={tooltipStyle}
                    >
                      <p className="font-medium">
                        {row.year}
                        {breakYear != null
                          ? row.afterBreak
                            ? " · new sample design"
                            : " · earlier sample design"
                          : ""}
                      </p>
                      <p className="font-mono">{int(row.estimate)} (weighted estimate)</p>
                      <p>
                        95% interval {int(row.ci95[0])} to {int(row.ci95[1])}; CV{" "}
                        {pct(row.cvPct, 1)}
                      </p>
                      <p className="text-muted-foreground">
                        {int(row.hospitals)} hospitals; {int(row.cases)} sample cases (unweighted)
                      </p>
                      <p className="text-muted-foreground">{row.changeNote}</p>
                    </div>
                  );
                }}
              />
              <Area
                dataKey="preBand"
                name="95% interval"
                stroke="none"
                fill={PRE}
                fillOpacity={0.14}
                isAnimationActive={false}
                activeDot={false}
              />
              <Area
                dataKey="postBand"
                name="95% interval"
                stroke="none"
                fill={POST}
                fillOpacity={0.18}
                isAnimationActive={false}
                activeDot={false}
              />
              <Line
                dataKey="preEstimate"
                name="Estimate"
                stroke={PRE}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="postEstimate"
                name="Estimate"
                stroke={POST}
                strokeWidth={2}
                dot={{ r: 3, fill: POST, stroke: POST }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4" style={{ background: PRE }} />
            {breakYear != null ? `Before ${breakYear} (earlier sample design)` : "Estimate"}
          </li>
          {breakYear != null ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4" style={{ background: POST }} />
              {breakYear} on (new sample design)
            </li>
          ) : null}
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-4 rounded-sm bg-muted-foreground/25" />
            95% interval
          </li>
        </ul>
      </Panel>

      <Panel
        id="neiss-products"
        title={`Largest product groups, ${data.latestYear}`}
        subtitle="Reliable weighted estimates only; products overlap and must not be added"
        actions={<NeissBadge />}
        footnote="A case with up to three product codes counts under each, so rows overlap. Share is of all estimated injuries that year. Estimates CPSC's rule withholds as unstable are not shown here; they are listed with their unweighted sample counts under NEISS product signals."
      >
        {shownTop.length ? (
          <div className="overflow-x-auto" id="neiss-top-products">
            <table className="w-full text-xs">
              <caption className="sr-only">
                Largest NEISS product groups by weighted national estimate
              </caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Product
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    {data.latestYear} estimate
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    95% interval
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    CV
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Share of all
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shownTop.map((p, i) => (
                  <tr key={p.code}>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{i + 1}</td>
                    <td className="max-w-80 truncate px-2 py-1" title={p.label}>
                      <Link
                        to="/records/$dataset/$id"
                        params={{ dataset: "neiss_product_estimates", id: p.code }}
                        className="text-primary hover:underline"
                      >
                        {p.label}
                      </Link>
                      <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                        {p.code}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{int(p.estimate)}</td>
                    <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                      {p.ci95 ? `${int(p.ci95[0])} to ${int(p.ci95[1])}` : NOT_RECORDED}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{pct(p.cvPct, 1)}</td>
                    <td className="px-2 py-1 text-right font-mono">{pct(p.sharePct, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-2 pb-1">
              <MoreToggle
                total={data.topProducts.length}
                limit={TOP_LIMIT}
                expanded={allTop}
                onToggle={() => setAllTop((v) => !v)}
                controls="neiss-top-products"
                noun="products"
              />
            </div>
          </div>
        ) : (
          <StateNote>No product group has a reliable {data.latestYear} estimate.</StateNote>
        )}
      </Panel>
    </div>
  );
}
