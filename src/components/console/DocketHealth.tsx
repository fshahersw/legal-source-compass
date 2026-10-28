/**
 * Docket health (Courts & judges): how the federal civil docket is moving, in the analyst-console layout. Filings
 * against terminations by complete fiscal year, terminations per 100 filings, cases pending at year end, median time
 * to disposition, the districts against their median, and the MDL dockets from the JPML report series.
 *
 * Every figure is read from the FJC Integrated Database records (fjc_civil_national, fjc_civil_districts) and the MDL
 * analytics records (mdl_analytics) through the existing server functions; nothing is estimated. The fiscal year in
 * progress is never charted as a complete year.
 */
import { useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarTrend,
  ChartFrame,
  ChartLegend,
  LineTrend,
  RankedBars,
  ScatterCorrelation,
  metricFormatter,
  seriesVar,
  type ChartSource,
  type PeriodAxis,
  type TableSpec,
  type TrendSeriesInput,
} from "@/components/charts";
import { districtsQuery, nationalQuery } from "@/components/courts/caseload/caseloadQueries";
import { KpiStrip } from "@/components/kit/KpiCard";
import type { DistrictRow, NationalCaseload } from "@/lib/external/courtCaseload.functions";
import { getMdlAnalytics, type MdlAnalytics } from "@/lib/external/mdlAnalytics.functions";
import {
  Cell,
  ConsoleGrid,
  ConsoleHeading,
  ConsoleTable,
  InlineBar,
  queryStatus,
  type ConsoleColumn,
} from "./ConsoleGrid";
import {
  clearanceRate,
  completeYears,
  districtHealth,
  fmtInt,
  fmtPct,
  fmtSignedInt,
  fmtSignedPct,
  largestMdls,
  latestPair,
  massTortShare,
  mdlMovers,
  mdlNumberShare,
  median,
  monthYear,
  pctChange,
  portfolioChange,
  type DistrictHealth,
} from "./docketModel";

export const mdlAnalyticsConsoleQuery = {
  queryKey: ["mdl-analytics"],
  queryFn: () => getMdlAnalytics(),
  staleTime: 10 * 60 * 1000,
};

export const FJC: ChartSource = {
  label: "Federal Judicial Center, Integrated Database (civil)",
  url: "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
};
export const JPML: ChartSource = {
  label: "JPML pending MDL reports",
  url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
};

const count = metricFormatter("count");
const days = metricFormatter("days");
const ratio = metricFormatter("ratio");

export const short = (name: string) => name.replace(/^(U\.S\. )?District Court,?\s*/i, "");

function fyAxis(keys: readonly string[]): PeriodAxis {
  return {
    keys,
    label: (k) => `FY${k} (October 1 to September 30)`,
    tick: (k) => `FY${k.slice(2)}`,
    showTick: (_k, i) => keys.length <= 12 || i % Math.ceil(keys.length / 9) === 0,
  };
}

function monthAxis(keys: readonly string[]): PeriodAxis {
  return {
    keys,
    label: (k) => monthYear(`${k}-01`),
    tick: (k) => `${monthYear(`${k}-01`).slice(0, 3)} ’${k.slice(2, 4)}`,
    showTick: (_k, i) => keys.length <= 8 || i % Math.ceil(keys.length / 7) === 0,
  };
}

export function useNationalView(data: NationalCaseload | null | undefined) {
  return useMemo(() => {
    const years = completeYears(data);
    const pair = latestPair(years);
    if (!pair) return null;
    const window = years.slice(-15);
    const keys = window.map((y) => String(y.fy));
    const axis = fyAxis(keys);
    const filed: TrendSeriesInput = {
      id: "filed",
      label: "Filed",
      points: window.map((y) => ({ key: String(y.fy), value: y.filings })),
    };
    const term: TrendSeriesInput = {
      id: "terminated",
      label: "Terminated",
      points: window.map((y) => ({ key: String(y.fy), value: y.terminations })),
    };
    const clearance: TrendSeriesInput = {
      id: "clearance",
      label: "Terminations per 100 filings",
      points: window.map((y) => ({ key: String(y.fy), value: clearanceRate(y) })),
    };
    const pending: TrendSeriesInput = {
      id: "pending",
      label: "Pending at fiscal-year end",
      points: window.map((y) => ({ key: String(y.fy), value: y.pendingEnd })),
    };
    const medianDays: TrendSeriesInput = {
      id: "median",
      label: "Median days, filing to disposition",
      points: window.map((y) => ({ key: String(y.fy), value: y.medianDays })),
    };
    const flowTable: TableSpec = {
      caption: "Federal civil cases filed, terminated and pending by fiscal year",
      columns: [
        { label: "Fiscal year", align: "left" },
        { label: "Filed" },
        { label: "Terminated" },
        { label: "Per 100 filings" },
        { label: "Pending at year end" },
        { label: "Median days" },
      ],
      rows: [...window].reverse().map((y) => ({
        key: String(y.fy),
        cells: [
          `FY${y.fy}`,
          fmtInt(y.filings),
          fmtInt(y.terminations),
          clearanceRate(y) == null ? "Not recorded" : clearanceRate(y)!.toFixed(1),
          fmtInt(y.pendingEnd),
          fmtInt(y.medianDays),
        ],
      })),
    };
    const period = `FY${keys[0]}–FY${keys[keys.length - 1]}`;
    return { pair, axis, filed, term, clearance, pending, medianDays, flowTable, period };
  }, [data]);
}

export function useDistrictView(input: readonly DistrictRow[] | undefined) {
  return useMemo(() => {
    const rows = districtHealth(input ?? []);
    if (!rows.length) return null;
    const medDays = median(rows.map((r) => r.medianDays));
    const medYears = median(rows.map((r) => r.pendingYears));
    const scatter = rows
      .filter((r) => (r.filings ?? 0) > 0 && r.medianDays != null)
      .map((r) => ({ id: r.id, label: short(r.name), x: r.filings!, y: r.medianDays! }));
    const byPendingYears = [...rows]
      .filter((r) => r.pendingYears != null)
      .sort((a, b) => b.pendingYears! - a.pendingYears!);
    const maxPending = Math.max(0, ...rows.map((r) => r.pending ?? 0));
    const table = (caption: string, list: readonly DistrictHealth[]): TableSpec => ({
      caption,
      columns: [
        { label: "District", align: "left" },
        { label: "Filed" },
        { label: "Terminated" },
        { label: "Pending" },
        { label: "Median days" },
        { label: "Pending ÷ terminations" },
      ],
      rows: list.map((r) => ({
        key: r.id,
        cells: [
          short(r.name),
          fmtInt(r.filings),
          fmtInt(r.terminations),
          fmtInt(r.pending),
          fmtInt(r.medianDays),
          r.pendingYears == null ? "Not recorded" : r.pendingYears.toFixed(2),
        ],
      })),
    });
    return {
      rows,
      medDays,
      medYears,
      scatter,
      byPendingYears,
      maxPending,
      allTable: table(
        "District courts, latest complete fiscal year",
        [...rows].sort((a, b) => (b.pending ?? -1) - (a.pending ?? -1)),
      ),
    };
  }, [input]);
}

export function useMdlView(data: MdlAnalytics | null | undefined) {
  return useMemo(() => {
    const d = data;
    if (!d) return null;
    const pts = [...d.overview.portfolio].sort((a, b) => a.date.localeCompare(b.date));
    const keys = pts.map((p) => p.date.slice(0, 7));
    const axis = monthAxis(keys);
    const all: TrendSeriesInput = {
      id: "all",
      label: "All pending MDLs",
      points: pts.map((p) => ({ key: p.date.slice(0, 7), value: p.pending })),
    };
    const mass: TrendSeriesInput = {
      id: "mass",
      label: "Mass-tort MDLs",
      points: pts.map((p) => ({ key: p.date.slice(0, 7), value: p.mass_tort_pending })),
    };
    const change = portfolioChange(d.overview);
    const movers = mdlMovers(d.mdls, 6);
    const largest = largestMdls(d.mdls, 12);
    const flow = d.mdls
      .filter((r) => r.status === "pending" && r.pending != null)
      .sort((a, b) => b.pending! - a.pending!)
      .slice(0, 15);
    const portfolioTable: TableSpec = {
      caption: "Actions pending in pending MDLs, per JPML monthly report",
      columns: [
        { label: "Report", align: "left" },
        { label: "Pending MDLs" },
        { label: "Actions pending" },
        { label: "Mass-tort MDLs" },
        { label: "Mass-tort actions" },
      ],
      rows: [...pts].reverse().map((p) => ({
        key: p.date,
        cells: [
          monthYear(p.date),
          fmtInt(p.mdls),
          fmtInt(p.pending),
          fmtInt(p.mass_tort_mdls),
          fmtInt(p.mass_tort_pending),
        ],
      })),
    };
    return {
      overview: d.overview,
      axis,
      all,
      mass,
      change,
      movers,
      largest,
      flow,
      portfolioTable,
      period: pts.length
        ? `${monthYear(pts[0]!.date)}–${monthYear(pts[pts.length - 1]!.date)}`
        : "",
    };
  }, [data]);
}

export function DocketHealth() {
  const national = useQuery(nationalQuery);
  const districts = useQuery(districtsQuery);
  const mdl = useQuery(mdlAnalyticsConsoleQuery);
  const navigate = useNavigate();

  const nat = useNationalView(national.data);
  const dist = useDistrictView(districts.data?.rows);
  const mdlView = useMdlView(mdl.data);

  const natStatus = queryStatus(
    national,
    nat !== null,
    "The FJC national series is not published yet.",
  );
  const distStatus = queryStatus(
    districts,
    dist !== null,
    "The FJC district table is not published yet.",
  );
  const mdlStatus = queryStatus(
    mdl,
    mdlView !== null,
    "The MDL analytics records are not published yet.",
  );

  const latest = nat?.pair.latest;
  const prior = nat?.pair.prior;
  const kpis = [
    {
      key: "filed",
      label: `Civil cases filed, FY${latest?.fy ?? ""}`,
      value: latest ? fmtInt(latest.filings) : null,
      delta: prior
        ? {
            value: pctChange(prior.filings, latest!.filings),
            detail: `${fmtSignedInt((latest!.filings ?? 0) - (prior.filings ?? 0))} vs FY${prior.fy}`,
          }
        : null,
    },
    {
      key: "terminated",
      label: `Terminated, FY${latest?.fy ?? ""}`,
      value: latest ? fmtInt(latest.terminations) : null,
      delta: prior
        ? {
            value: pctChange(prior.terminations, latest!.terminations),
            detail: `vs FY${prior.fy}`,
          }
        : null,
    },
    {
      key: "clearance",
      label: "Terminations per 100 filings",
      value: latest && clearanceRate(latest) != null ? clearanceRate(latest)!.toFixed(1) : null,
      meta: "Same fiscal year; above 100 the docket shrinks",
    },
    {
      key: "pending",
      label: `Pending, Sept. 30, ${latest?.fy ?? ""}`,
      value: latest ? fmtInt(latest.pendingEnd) : null,
      delta: prior
        ? { value: pctChange(prior.pendingEnd, latest!.pendingEnd), detail: `vs FY${prior.fy}` }
        : null,
    },
    {
      key: "median",
      label: "Median days to disposition",
      value: latest ? fmtInt(latest.medianDays) : null,
      unit: "days",
      delta:
        prior && latest?.medianDays != null && prior.medianDays != null
          ? {
              value: latest.medianDays - prior.medianDays,
              kind: "absolute" as const,
              text: fmtSignedInt(latest.medianDays - prior.medianDays),
              detail: `days vs FY${prior.fy}`,
            }
          : null,
    },
    {
      key: "mdlshare",
      label: "Filings with an MDL number",
      value: latest ? fmtPct(mdlNumberShare(latest)) : null,
      meta: "IDB association, not JPML membership",
    },
  ];

  const mdlKpis = mdlView
    ? [
        {
          key: "mdls",
          label: "Pending MDLs",
          value: fmtInt(mdlView.overview.pending_mdls),
          meta: `JPML report ${monthYear(mdlView.overview.as_of)}`,
        },
        {
          key: "actions",
          label: "Actions pending in MDLs",
          value: fmtInt(mdlView.change?.last.pending ?? mdlView.overview.pending_actions),
          delta: mdlView.change?.prior
            ? {
                value: pctChange(mdlView.change.prior.pending, mdlView.change.last.pending),
                detail: `vs ${monthYear(mdlView.change.prior.date)}`,
              }
            : null,
        },
        {
          key: "mass",
          label: "In mass-tort MDLs",
          value: mdlView.change ? fmtPct(massTortShare(mdlView.change.last)) : null,
          meta: `${fmtInt(mdlView.overview.mass_tort_mdls)} mass-tort MDLs`,
        },
        {
          key: "top10",
          label: "Held by the ten largest",
          value: fmtPct(mdlView.overview.top10_share_pct),
          meta: "Share of all pending actions",
        },
        {
          key: "age",
          label: "Median MDL age",
          value:
            mdlView.overview.median_age_years != null
              ? mdlView.overview.median_age_years.toFixed(1)
              : null,
          unit: "years",
          meta: "Since transfer order",
        },
        {
          key: "new",
          label: "New MDLs in the series",
          value: fmtInt(mdlView.overview.new_mdls_in_series),
          meta: `${fmtInt(mdlView.overview.left_series)} left the list`,
        },
      ]
    : [];

  const districtColumns: ConsoleColumn<DistrictHealth>[] = [
    {
      key: "name",
      label: "District",
      render: (r) =>
        r.hasCourtPage ? (
          <Link
            to="/courts/$id"
            params={{ id: r.id }}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {short(r.name)}
          </Link>
        ) : (
          <span className="font-medium">{short(r.name)}</span>
        ),
    },
    { key: "cir", label: "Circuit", render: (r) => r.circuit?.replace(" Circuit", "") ?? "—" },
    { key: "filed", label: "Filed", align: "right", render: (r) => fmtInt(r.filings) },
    { key: "pending", label: "Pending", align: "right", render: (r) => fmtInt(r.pending) },
    {
      key: "bar",
      label: "",
      render: (r) => <InlineBar value={r.pending} max={dist?.maxPending ?? 0} />,
      className: "w-28",
    },
    { key: "days", label: "Median days", align: "right", render: (r) => fmtInt(r.medianDays) },
    {
      key: "years",
      label: "Pending ÷ terminations",
      align: "right",
      render: (r) => (r.pendingYears == null ? "Not recorded" : r.pendingYears.toFixed(2)),
    },
    {
      key: "product",
      label: "Product liability",
      align: "right",
      render: (r) => fmtPct(r.productPct),
    },
  ];

  return (
    <div className="space-y-3">
      <KpiStrip label="Federal civil docket, latest complete fiscal year" items={kpis} />

      <ConsoleGrid>
        <Cell span={8}>
          <ChartFrame
            title={
              latest && clearanceRate(latest) != null
                ? clearanceRate(latest)! >= 100
                  ? `Courts closed more civil cases than were filed in FY${latest.fy}`
                  : `Filings outpaced terminations in FY${latest.fy}`
                : "Civil cases filed and terminated"
            }
            unit="cases"
            period={nat?.period}
            sources={[FJC]}
            status={natStatus}
            table={nat?.flowTable}
            notes={[
              "Complete fiscal years only (October 1 to September 30); the year in progress is not drawn.",
              "FJC IDB counts can differ from the totals the Administrative Office publishes for filings.",
            ]}
            minHeight={240}
          >
            {nat ? (
              <>
                <ChartLegend
                  items={[
                    { id: "filed", label: "Filed", color: seriesVar(0) },
                    { id: "terminated", label: "Terminated", color: seriesVar(1) },
                  ]}
                />
                <LineTrend
                  series={[nat.filed, nat.term]}
                  axis={nat.axis}
                  formatter={count}
                  unit="cases"
                  ariaLabel="Federal civil cases filed and terminated by fiscal year"
                  height={240}
                />
              </>
            ) : null}
          </ChartFrame>
        </Cell>
        <Cell span={4}>
          <ChartFrame
            title="Terminations per 100 filings"
            subtitle="Same complete fiscal year · a flow comparison, not a backlog estimate"
            period={nat?.period}
            sources={[FJC]}
            status={natStatus}
            table={nat?.flowTable}
            notes={[
              "Terminations in a fiscal year divided by filings in the same year, times 100.",
              "Above 100 the year closed more cases than it opened; a large MDL settlement can move it.",
            ]}
            minHeight={240}
          >
            {nat ? (
              <BarTrend
                series={[nat.clearance]}
                axis={nat.axis}
                formatter={ratio}
                unit="per 100 filings"
                ariaLabel="Terminations per 100 filings by fiscal year"
                height={240}
              />
            ) : null}
          </ChartFrame>
        </Cell>

        <Cell span={6}>
          <ChartFrame
            title="Civil cases pending at fiscal-year end"
            unit="cases"
            period={nat?.period}
            sources={[FJC]}
            status={natStatus}
            table={nat?.flowTable}
            notes={["Cases open on September 30 of each fiscal year, all district courts."]}
            minHeight={210}
          >
            {nat ? (
              <BarTrend
                series={[nat.pending]}
                axis={nat.axis}
                formatter={count}
                unit="cases"
                ariaLabel="Civil cases pending at fiscal-year end"
                height={210}
              />
            ) : null}
          </ChartFrame>
        </Cell>
        <Cell span={6}>
          <ChartFrame
            title="Median time from filing to disposition"
            unit="days"
            period={nat?.period}
            sources={[FJC]}
            status={natStatus}
            table={nat?.flowTable}
            notes={["Median over the cases terminated in each fiscal year."]}
            minHeight={210}
          >
            {nat ? (
              <LineTrend
                series={[nat.medianDays]}
                axis={nat.axis}
                formatter={days}
                unit="days"
                ariaLabel="Median days from filing to disposition by fiscal year"
                height={210}
              />
            ) : null}
          </ChartFrame>
        </Cell>
      </ConsoleGrid>

      <ConsoleHeading
        id="districts"
        eyebrow="District courts"
        title="Where the docket is slow or heavy"
        description={`Latest complete fiscal year. Each district is compared with the median district${
          dist?.medDays != null ? ` (${fmtInt(dist.medDays)} median days)` : ""
        }; open a district for its own page.`}
      />
      <ConsoleGrid>
        <Cell span={7}>
          <ChartFrame
            title="Busier districts are not always slower"
            subtitle="Civil filings (log scale) against median days to disposition, one dot per district"
            sources={[FJC]}
            status={distStatus}
            table={dist?.allTable}
            notes={[
              "Each dot is one of the 94 district courts in the latest complete fiscal year.",
              "Select a dot to open the district's court page when one is recorded.",
            ]}
            minHeight={340}
          >
            {dist ? (
              <ScatterCorrelation
                points={dist.scatter}
                xFormatter={count}
                yFormatter={days}
                xLabel="Civil filings"
                yLabel="Median days"
                ariaLabel="District civil filings against median days to disposition"
                logX
                height={340}
                onSelect={(id) => {
                  const row = dist.rows.find((r) => r.id === id);
                  if (row?.hasCourtPage) void navigate({ to: "/courts/$id", params: { id } });
                }}
              />
            ) : null}
          </ChartFrame>
        </Cell>
        <Cell span={5}>
          <ChartFrame
            title="Slowest districts against the median district"
            unit="median days to disposition"
            sources={[FJC]}
            status={distStatus}
            table={dist?.allTable}
            notes={["The reference line is the median of the 94 districts, not a national figure."]}
            minHeight={340}
          >
            {dist ? (
              <RankedBars
                items={dist.rows.map((r) => ({
                  id: r.id,
                  label: short(r.name),
                  value: r.medianDays,
                }))}
                formatter={days}
                unit="days"
                ariaLabel="Districts ranked by median days to disposition"
                references={
                  dist.medDays != null ? [{ label: "Median district", value: dist.medDays }] : []
                }
                limit={12}
                onSelect={(id) => {
                  const row = dist.rows.find((r) => r.id === id);
                  if (row?.hasCourtPage) void navigate({ to: "/courts/$id", params: { id } });
                }}
              />
            ) : null}
          </ChartFrame>
        </Cell>
        <Cell span={12}>
          <ChartFrame
            title="Districts carrying the most pending cases"
            subtitle="Pending ÷ terminations: years of terminations at the same year's pace that the pending docket equals"
            sources={[FJC]}
            status={distStatus}
            table={dist?.allTable}
            notes={[
              "Pending ÷ terminations is a stock-to-flow ratio for comparing districts, not a forecast of when cases close.",
              "Product liability is the share of the year's filings with a product liability nature of suit.",
            ]}
            minHeight={300}
          >
            {dist ? (
              <ConsoleTable
                caption="Districts with the most pending civil cases"
                columns={districtColumns}
                rows={[...dist.rows]
                  .sort((a, b) => (b.pending ?? -1) - (a.pending ?? -1))
                  .slice(0, 15)}
                rowKey={(r) => r.id}
              />
            ) : null}
          </ChartFrame>
        </Cell>
      </ConsoleGrid>

      <ConsoleHeading
        id="mdl"
        eyebrow="Multidistrict litigation"
        title="MDL dockets"
        description="Actions pending in every MDL the JPML lists, by monthly report. Figures are MDL-wide; months without a held report are gaps."
        actions={
          <Link
            to="/matters/intel"
            className="text-[12.5px] font-medium text-primary hover:underline"
          >
            MDL intelligence →
          </Link>
        }
      />
      {mdlKpis.length ? <KpiStrip label="MDL dockets" items={mdlKpis} /> : null}
      <ConsoleGrid>
        <Cell span={8}>
          <ChartFrame
            title="Actions pending in MDLs, all and mass-tort"
            unit="actions"
            period={mdlView?.period}
            sources={[JPML]}
            status={mdlStatus}
            table={mdlView?.portfolioTable}
            notes={[
              "Each point is one JPML monthly report: the sum of actions now pending over every MDL it lists.",
              "Mass-tort MDLs are the products-liability and mass-tort dockets as the analytics records classify them.",
            ]}
            minHeight={240}
          >
            {mdlView ? (
              <>
                <ChartLegend
                  items={[
                    { id: "all", label: "All pending MDLs", color: seriesVar(0) },
                    { id: "mass", label: "Mass-tort MDLs", color: seriesVar(1) },
                  ]}
                />
                <LineTrend
                  series={[mdlView.all, mdlView.mass]}
                  axis={mdlView.axis}
                  formatter={count}
                  unit="actions"
                  ariaLabel="Actions pending in pending MDLs per JPML monthly report"
                  height={240}
                />
              </>
            ) : null}
          </ChartFrame>
        </Cell>
        <Cell span={4}>
          <ChartFrame
            title="Biggest 12-month moves"
            unit="change in actions pending"
            sources={[JPML]}
            status={mdlStatus}
            table={
              mdlView
                ? {
                    caption: "Pending MDLs with the largest 12-month change in actions pending",
                    columns: [
                      { label: "MDL", align: "left" },
                      { label: "Pending" },
                      { label: "12-month change" },
                    ],
                    rows: [...mdlView.movers.up, ...mdlView.movers.down].map((r) => ({
                      key: String(r.mdl),
                      cells: [
                        `MDL ${r.mdl} ${r.title.replace(/^IN RE:\s*/i, "")}`,
                        fmtInt(r.pending),
                        fmtSignedInt(r.change12m),
                      ],
                    })),
                  }
                : undefined
            }
            notes={[
              "Change against the report of the same calendar month a year earlier; an MDL without that report is left out.",
            ]}
            minHeight={240}
          >
            {mdlView ? (
              <RankedBars
                items={[...mdlView.movers.up, ...mdlView.movers.down].map((r) => ({
                  id: String(r.mdl),
                  label: `${r.mdl} ${shortTitle(r.title)}`,
                  value: r.change12m,
                }))}
                formatter={count}
                unit="actions"
                ariaLabel="Pending MDLs with the largest 12-month change in actions pending"
                diverging
                onSelect={(id) => void navigate({ to: "/matters/lens/$mdl", params: { mdl: id } })}
              />
            ) : null}
          </ChartFrame>
        </Cell>
        <Cell span={12}>
          <ChartFrame
            title="Largest pending MDLs: inflow and resolution over 12 months"
            subtitle="Actions pending in the latest report, with actions added and resolved over the last 12 months"
            sources={[JPML]}
            status={mdlStatus}
            table={
              mdlView
                ? {
                    caption: "Largest pending MDLs",
                    columns: [
                      { label: "MDL", align: "left" },
                      { label: "District", align: "left" },
                      { label: "Pending" },
                      { label: "Added, 12 months" },
                      { label: "Resolved, 12 months" },
                      { label: "Change, 12 months" },
                    ],
                    rows: mdlView.flow.map((r) => ({
                      key: String(r.mdl),
                      cells: [
                        `MDL ${r.mdl} ${r.title.replace(/^IN RE:\s*/i, "")}`,
                        r.district ?? "Not recorded",
                        fmtInt(r.pending),
                        fmtInt(r.new12m),
                        fmtInt(r.resolved12m),
                        fmtSignedInt(r.change12m),
                      ],
                    })),
                  }
                : undefined
            }
            notes={[
              "Added and resolved are the published 12-month figures of each MDL's analytics record; a missing figure is Not recorded.",
            ]}
            minHeight={300}
          >
            {mdlView ? (
              <ConsoleTable
                caption="Largest pending MDLs"
                rows={mdlView.flow}
                rowKey={(r) => String(r.mdl)}
                columns={[
                  {
                    key: "mdl",
                    label: "MDL",
                    render: (r) => (
                      <Link
                        to="/matters/lens/$mdl"
                        params={{ mdl: String(r.mdl) }}
                        className="group inline-flex min-w-0 max-w-[34rem] flex-col"
                      >
                        <span className="truncate font-medium text-foreground group-hover:text-primary group-hover:underline">
                          {shortTitle(r.title)}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          MDL {r.mdl}
                          {r.judge ? ` · ${r.judge}` : ""}
                        </span>
                      </Link>
                    ),
                  },
                  { key: "dist", label: "District", render: (r) => r.district ?? "—" },
                  {
                    key: "pending",
                    label: "Pending",
                    align: "right",
                    render: (r) => fmtInt(r.pending),
                  },
                  {
                    key: "bar",
                    label: "",
                    className: "w-28",
                    render: (r) => (
                      <InlineBar value={r.pending} max={mdlView.flow[0]?.pending ?? 0} />
                    ),
                  },
                  { key: "new", label: "Added", align: "right", render: (r) => fmtInt(r.new12m) },
                  {
                    key: "resolved",
                    label: "Resolved",
                    align: "right",
                    render: (r) => fmtInt(r.resolved12m),
                  },
                  {
                    key: "chg",
                    label: "12-month change",
                    align: "right",
                    render: (r) => (
                      <span
                        className={r.change12m == null ? "text-muted-foreground" : "font-semibold"}
                      >
                        {fmtSignedInt(r.change12m)}
                        {r.change12m != null && r.pending != null && r.pending - r.change12m > 0
                          ? ` (${fmtSignedPct(pctChange(r.pending - r.change12m, r.pending))})`
                          : ""}
                      </span>
                    ),
                  },
                  {
                    key: "age",
                    label: "Age",
                    align: "right",
                    render: (r) => (r.ageYears != null ? `${r.ageYears.toFixed(1)} yrs` : "—"),
                  },
                ]}
              />
            ) : null}
          </ChartFrame>
        </Cell>
      </ConsoleGrid>
    </div>
  );
}

export function shortTitle(title: string): string {
  return title
    .replace(/^IN RE:\s*/i, "")
    .replace(
      /\s+(Products? Liability|Marketing, Sales Practices,? and Products Liability|Sales Practices)\s+Litigation.*$/i,
      "",
    )
    .replace(/\s+Litigation$/i, "")
    .trim();
}
