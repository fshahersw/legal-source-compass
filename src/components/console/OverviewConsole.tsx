/**
 * The Overview's lead (analyst-console layout): the federal civil docket and the MDL dockets at a glance, above the
 * platform headlines and the map. Every figure comes from the FJC Integrated Database and the JPML-based MDL
 * analytics records through the same server functions and view hooks as Docket health; nothing is estimated.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChartFrame,
  ChartLegend,
  LineTrend,
  RankedBars,
  metricFormatter,
  seriesVar,
} from "@/components/charts";
import { nationalQuery } from "@/components/courts/caseload/caseloadQueries";
import { KpiStrip } from "@/components/kit/KpiCard";
import { Cell, ConsoleGrid, ConsoleHeading, queryStatus } from "./ConsoleGrid";
import {
  FJC,
  JPML,
  mdlAnalyticsConsoleQuery,
  shortTitle,
  useMdlView,
  useNationalView,
} from "./DocketHealth";
import {
  clearanceRate,
  fmtInt,
  fmtPct,
  fmtSignedInt,
  massTortShare,
  monthYear,
  pctChange,
} from "./docketModel";

const count = metricFormatter("count");

export function OverviewConsole() {
  const national = useQuery(nationalQuery);
  const mdl = useQuery(mdlAnalyticsConsoleQuery);
  const nat = useNationalView(national.data);
  const mdlView = useMdlView(mdl.data);
  const navigate = useNavigate();

  const natStatus = queryStatus(
    national,
    nat !== null,
    "The FJC national series is not published yet.",
  );
  const mdlStatus = queryStatus(
    mdl,
    mdlView !== null,
    "The MDL analytics records are not published yet.",
  );

  const latest = nat?.pair.latest;
  const prior = nat?.pair.prior;
  const change = mdlView?.change;

  const kpis = [
    {
      key: "mdl-actions",
      label: "Actions pending in MDLs",
      value: change ? fmtInt(change.last.pending) : null,
      delta: change?.prior
        ? {
            value: pctChange(change.prior.pending, change.last.pending),
            detail: `vs ${monthYear(change.prior.date)}`,
          }
        : null,
      state: mdl.isLoading ? ("loading" as const) : undefined,
    },
    {
      key: "mdls",
      label: "Pending MDLs",
      value: mdlView ? fmtInt(mdlView.overview.pending_mdls) : null,
      meta: mdlView ? `JPML report ${monthYear(mdlView.overview.as_of)}` : undefined,
      state: mdl.isLoading ? ("loading" as const) : undefined,
    },
    {
      key: "mass",
      label: "Share in mass-tort MDLs",
      value: change ? fmtPct(massTortShare(change.last)) : null,
      meta: mdlView ? `${fmtInt(mdlView.overview.mass_tort_mdls)} mass-tort MDLs` : undefined,
      state: mdl.isLoading ? ("loading" as const) : undefined,
    },
    {
      key: "filed",
      label: `Federal civil filings, FY${latest?.fy ?? ""}`,
      value: latest ? fmtInt(latest.filings) : null,
      delta: prior
        ? { value: pctChange(prior.filings, latest!.filings), detail: `vs FY${prior.fy}` }
        : null,
      state: national.isLoading ? ("loading" as const) : undefined,
    },
    {
      key: "pending",
      label: "Civil cases pending",
      value: latest ? fmtInt(latest.pendingEnd) : null,
      delta: prior
        ? { value: pctChange(prior.pendingEnd, latest!.pendingEnd), detail: `vs FY${prior.fy}` }
        : null,
      state: national.isLoading ? ("loading" as const) : undefined,
    },
    {
      key: "median",
      label: "Median days to disposition",
      value: latest ? fmtInt(latest.medianDays) : null,
      unit: "days",
      meta:
        latest && clearanceRate(latest) != null
          ? `${clearanceRate(latest)!.toFixed(1)} terminations per 100 filings`
          : undefined,
      state: national.isLoading ? ("loading" as const) : undefined,
    },
  ];

  return (
    <section aria-labelledby="overview-docket" className="mb-8 space-y-3">
      <ConsoleHeading
        id="overview-docket"
        eyebrow="Litigation pulse"
        title="Federal and MDL dockets"
        description="The latest JPML report and the latest complete federal fiscal year, with the change on the period before."
        actions={
          <Link
            to="/courts/docket-health"
            className="text-[12.5px] font-medium text-primary hover:underline"
          >
            Docket health →
          </Link>
        }
      />
      <KpiStrip label="Litigation pulse" items={kpis} />
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
            ]}
            minHeight={230}
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
                  height={230}
                />
              </>
            ) : null}
          </ChartFrame>
        </Cell>
        <Cell span={4}>
          <ChartFrame
            title="Largest pending MDLs"
            unit="actions pending, latest report"
            sources={[JPML]}
            status={mdlStatus}
            table={
              mdlView
                ? {
                    caption: "Largest pending MDLs by actions pending",
                    columns: [
                      { label: "MDL", align: "left" },
                      { label: "Pending" },
                      { label: "12-month change" },
                    ],
                    rows: mdlView.largest.map((r) => ({
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
            minHeight={230}
          >
            {mdlView ? (
              <RankedBars
                items={mdlView.largest.map((r) => ({
                  id: String(r.mdl),
                  label: shortTitle(r.title),
                  value: r.pending,
                }))}
                formatter={count}
                unit="actions"
                ariaLabel="Largest pending MDLs by actions pending"
                limit={10}
                onSelect={(id) => void navigate({ to: "/matters/lens/$mdl", params: { mdl: id } })}
              />
            ) : null}
          </ChartFrame>
        </Cell>
        <Cell span={6}>
          <ChartFrame
            title="Federal civil cases filed and terminated"
            unit="cases"
            period={nat?.period}
            sources={[FJC]}
            status={natStatus}
            table={nat?.flowTable}
            notes={["Complete fiscal years only; the year in progress is not drawn."]}
            minHeight={210}
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
                  height={210}
                />
              </>
            ) : null}
          </ChartFrame>
        </Cell>
        <Cell span={6}>
          <ChartFrame
            title="MDLs with the biggest 12-month moves"
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
            minHeight={210}
          >
            {mdlView ? (
              <RankedBars
                items={[...mdlView.movers.up.slice(0, 5), ...mdlView.movers.down.slice(0, 5)].map(
                  (r) => ({
                    id: String(r.mdl),
                    label: shortTitle(r.title),
                    value: r.change12m,
                  }),
                )}
                formatter={count}
                unit="actions"
                ariaLabel="Pending MDLs with the largest 12-month change in actions pending"
                diverging
                onSelect={(id) => void navigate({ to: "/matters/lens/$mdl", params: { mdl: id } })}
              />
            ) : null}
          </ChartFrame>
        </Cell>
      </ConsoleGrid>
    </section>
  );
}
