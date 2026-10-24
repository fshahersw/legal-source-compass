/**
 * National JPML statistics over time (MDL statistics page): pending actions and pending MDLs per monthly report since
 * July 2012, actions added per month, transferee-district concentration, fiscal-year-end pending FY1992–FY2025,
 * quarter-end caseload by circuit, and transferee districts and judges over time. Every value is printed in a JPML
 * report or a stated formula over printed values; months with no held report are gaps.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarTrend,
  ChartFrame,
  LineTrend,
  RankedBars,
  SmallMultiples,
  metricFormatter,
  type ChartSource,
  type ChartStatus,
  type TableSpec,
} from "@/components/charts";
import { SegmentedControl } from "@/components/matters/common";
import {
  JPML_PAGES,
  fmtInt,
  fmtPct,
  fmtSigned,
  longDate,
  longGaps,
  monthKeys,
  monthLabel,
  monthlyAxis,
  monthlySeries,
  yearAxis,
  type EntitySeries,
  type National,
} from "./model";
import { jpmlNationalQuery } from "./queries";

const count = metricFormatter("count");
const hhiFmt = {
  full: (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v)
      ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "Not recorded",
  tick: (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 }),
  delta: (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(Math.round(d))}`,
};

const ARCHIVE: ChartSource = {
  label: "JPML pending MDL reports (archive and older official files)",
  url: JPML_PAGES.archive,
};
const SERIES_INDEX = "/records/jpml_series_index/series:national.pending_actions.monthly";

function statusOf(
  q: { isLoading: boolean; isError: boolean; refetch: () => unknown },
  data: National | null | undefined,
): ChartStatus {
  if (q.isLoading) return { kind: "loading" };
  if (q.isError) return { kind: "error", onRetry: () => void q.refetch() };
  if (!data)
    return {
      kind: "empty",
      reason: "The JPML report series has not been published to the corpus yet.",
    };
  return { kind: "ready" };
}

export function JpmlNationalPanel() {
  const q = useQuery(jpmlNationalQuery);
  const data = q.data ?? null;
  const status = statusOf(q, data);
  const view = useMemo(() => (data ? build(data) : null), [data]);
  return (
    <section aria-labelledby="jpml-series-heading" className="mb-6 space-y-3">
      <header className="space-y-1">
        <h2 id="jpml-series-heading" className="text-base font-semibold">
          JPML statistics over time
        </h2>
        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
          Pending MDLs and actions from every JPML monthly pending-MDL report held (the archive page
          keeps one year; the older reports are official files the Panel still serves), the MDL
          Quarterly Caseload Summary and the fiscal-year statistical analysis. Months without a held
          report are gaps, never zero.
        </p>
        {view ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {view.coverage}{" "}
            <Link
              to="/records/$dataset/$id"
              params={{
                dataset: "jpml_series_index",
                id: "series:national.pending_actions.monthly",
              }}
              className="text-primary underline-offset-2 hover:underline"
            >
              Series index
            </Link>
          </p>
        ) : null}
      </header>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartFrame
          title="Actions now pending in all pending MDLs, per monthly report"
          unit="actions"
          period={view?.period}
          sources={[
            ARCHIVE,
            ...(view
              ? [
                  {
                    label: `Latest report, ${longDate(view.latest.date)} (PDF)`,
                    url: view.latest.sourceUrl ?? JPML_PAGES.current,
                  },
                ]
              : []),
          ]}
          status={status}
          notes={[
            "Each point is one JPML report: the sum of 'Actions Now Pending' over every MDL listed, as printed in the report totals.",
            "Reports are dated mid-month until 2023 and on the first business day of the month from January 2024.",
            "A single large MDL can move the national total; each MDL's own series is on its MDL page.",
          ]}
          footnotes={view?.gapNote ? [view.gapNote] : undefined}
          table={view?.nationalTable}
          minHeight={220}
        >
          {view ? (
            <LineTrend
              series={[view.pending]}
              axis={view.axis}
              formatter={count}
              unit="actions"
              ariaLabel="Actions now pending in all pending MDLs, per JPML monthly report"
              height={220}
            />
          ) : null}
        </ChartFrame>
        <ChartFrame
          title="Pending MDL dockets, per monthly report"
          unit="MDL dockets"
          period={view?.period}
          sources={[ARCHIVE]}
          status={status}
          notes={[
            "Counts every MDL docket the report lists ('Total Number of MDL Dockets'), with the report's own filters (transferred, active).",
          ]}
          footnotes={view?.filterNote ? [view.filterNote] : undefined}
          table={view?.nationalTable}
          minHeight={220}
        >
          {view ? (
            <LineTrend
              series={[view.mdls]}
              axis={view.axis}
              formatter={count}
              unit="MDL dockets"
              ariaLabel="Pending MDL dockets per JPML monthly report"
              height={220}
            />
          ) : null}
        </ChartFrame>
        <ChartFrame
          title="Actions added to continuing MDLs between consecutive monthly reports"
          unit="actions"
          period={view?.period}
          sources={[ARCHIVE]}
          status={status}
          notes={[
            "Sum, over MDLs listed in both reports, of the change in printed 'Total Actions (Historical)'; shown only when the two reports are one calendar month apart.",
            "Actions in newly listed MDLs are not included; a lowered historical count in a continuing MDL reduces the sum.",
          ]}
          table={view?.addedTable}
          minHeight={200}
        >
          {view ? (
            <BarTrend
              series={[view.added]}
              axis={view.axis}
              formatter={count}
              unit="actions"
              ariaLabel="Actions added to continuing MDLs between consecutive JPML monthly reports"
              height={200}
            />
          ) : null}
        </ChartFrame>
        <ChartFrame
          title="Concentration of pending actions across transferee districts"
          unit="HHI, 0 to 10,000"
          period={view?.period}
          sources={[ARCHIVE]}
          status={status}
          notes={[
            "Herfindahl–Hirschman index: the sum of each transferee district's squared percentage share of all pending actions. 10,000 means one district holds every pending action.",
            "It summarises concentration only; the table names the largest district in each report.",
          ]}
          table={view?.districtTable}
          minHeight={200}
        >
          {view ? (
            <LineTrend
              series={[view.hhi]}
              axis={view.axis}
              formatter={hhiFmt}
              ariaLabel="HHI of pending actions across transferee districts per JPML monthly report"
              height={200}
            />
          ) : null}
        </ChartFrame>
        <ChartFrame
          title="Actions pending at fiscal-year end (September 30)"
          unit="actions"
          period={view?.fyPeriod}
          sources={[
            {
              label: "JPML Statistical Analysis of Multidistrict Litigation, FY1992–FY2025",
              url: JPML_PAGES.statistics,
            },
          ]}
          status={
            view && !view.fy
              ? { kind: "empty", reason: "The fiscal-year series is not available." }
              : status
          }
          notes={[
            "Grand total of actions pending at September 30 in each fiscal-year edition's Circuit-and-District table.",
            "FY1992 covers 15 months (July 1991 to September 1992). Earlier counts are as each edition printed them; the Panel revises some later.",
          ]}
          table={view?.fyTable}
          minHeight={200}
        >
          {view?.fy ? (
            <BarTrend
              series={[view.fy.series]}
              axis={view.fy.axis}
              formatter={count}
              unit="actions"
              ariaLabel="Actions pending at fiscal-year end, FY1992 to FY2025"
              height={200}
            />
          ) : null}
        </ChartFrame>
        <CircuitChart data={data} status={status} />
      </div>
      <EntityPanel
        kind="district"
        title="Transferee districts over time: actions pending in the district's MDLs"
        data={data}
        status={status}
      />
      <EntityPanel
        kind="judge"
        title="Transferee judges over time: actions pending in the MDLs listing the judge"
        data={data}
        status={status}
      />
    </section>
  );
}

// ------------------------------------------------------------------ view model

function build(d: National) {
  const first = d.monthly[0]!;
  const latest = d.monthly[d.monthly.length - 1]!;
  const keys = monthKeys(first.date, latest.date);
  const axis = monthlyAxis(keys);
  const pending = monthlySeries("pending", "Actions now pending", d.monthly, (p) => p.pending);
  const mdls = monthlySeries("mdls", "Pending MDL dockets", d.monthly, (p) => p.mdls);
  const added = monthlySeries(
    "added",
    "Actions added to continuing MDLs",
    d.monthly,
    (p) => p.addedContinuing,
  );
  const hhi = monthlySeries("hhi", "District HHI", d.monthly, (p) => p.hhiDistrict);
  const big = longGaps(d.gaps, 5);
  const gapNote = d.gaps.length
    ? `${d.gaps.length} gaps in the monthly series (months with no held report)${big.length ? `, the longest ${big.map((g) => `${monthLabel(g.after.slice(0, 7))} – ${monthLabel(g.before.slice(0, 7))}`).join("; ")}` : ""}.`
    : null;
  const odd = d.monthly.filter((p) => !p.filtersStandard).map((p) => longDate(p.date));
  const filterNote = odd.length
    ? `Report filters differ (only 'Limited to Active Litigations' printed): ${odd.join(", ")}.`
    : null;
  const rows = [...d.monthly].reverse();
  const nationalTable: TableSpec = {
    caption: "JPML monthly reports: pending MDLs, actions now pending and total actions",
    columns: [
      { label: "Report date" },
      { label: "MDLs", align: "right" },
      { label: "Pending", align: "right" },
      { label: "Total (historical)", align: "right" },
      { label: "Report" },
    ],
    rows: rows.map((p) => ({
      key: p.date,
      cells: [
        longDate(p.date),
        fmtInt(p.mdls),
        fmtInt(p.pending),
        fmtInt(p.total),
        p.sourceUrl ? (
          <a
            href={p.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            PDF
          </a>
        ) : (
          "Not recorded"
        ),
      ],
    })),
  };
  const addedTable: TableSpec = {
    caption: "Actions added to continuing MDLs between consecutive monthly reports",
    columns: [
      { label: "Report date" },
      { label: "Previous report" },
      { label: "Actions added", align: "right" },
      { label: "MDLs first listed", align: "right" },
      { label: "No longer listed", align: "right" },
    ],
    rows: rows.slice(0, -1).map((p, i) => ({
      key: p.date,
      muted: p.addedContinuing === null,
      cells: [
        longDate(p.date),
        rows[i + 1]
          ? `${longDate(rows[i + 1]!.date)}${p.monthsSincePrevious && p.monthsSincePrevious > 1 ? ` (${p.monthsSincePrevious} months earlier)` : ""}`
          : "—",
        p.addedContinuing === null
          ? "Not shown (reports not one month apart)"
          : fmtSigned(p.addedContinuing),
        fmtInt(p.entered),
        fmtInt(p.left),
      ],
    })),
  };
  const districtTable: TableSpec = {
    caption: "Transferee-district concentration per monthly report",
    columns: [
      { label: "Report date" },
      { label: "Districts", align: "right" },
      { label: "HHI", align: "right" },
      { label: "Largest district" },
      { label: "Its share", align: "right" },
    ],
    rows: rows.map((p) => ({
      key: p.date,
      cells: [
        longDate(p.date),
        fmtInt(p.districts),
        hhiFmt.full(p.hhiDistrict),
        p.leadDistrict ?? "Not recorded",
        fmtPct(p.leadDistrictSharePct),
      ],
    })),
  };
  const fyKeys = d.fiscalYear.map((p) => p.date.slice(0, 4));
  const fy = d.fiscalYear.length
    ? {
        axis: yearAxis(fyKeys),
        series: {
          id: "fy",
          label: "Actions pending at September 30",
          points: d.fiscalYear.map((p) => ({ key: p.date.slice(0, 4), value: p.value })),
        },
      }
    : null;
  const fyTable: TableSpec | undefined = fy
    ? {
        caption: "Actions pending at fiscal-year end",
        columns: [{ label: "Fiscal year" }, { label: "Pending at Sept. 30", align: "right" }],
        rows: [...d.fiscalYear]
          .reverse()
          .map((p) => ({ key: p.date, cells: [`FY${p.date.slice(0, 4)}`, fmtInt(p.value)] })),
      }
    : undefined;
  return {
    axis,
    keys,
    latest,
    pending,
    mdls,
    added,
    hhi,
    nationalTable,
    addedTable,
    districtTable,
    gapNote,
    filterNote,
    fy,
    fyTable,
    fyPeriod: fy ? `FY${fyKeys[0]}–FY${fyKeys[fyKeys.length - 1]}` : undefined,
    period: `${monthLabel(first.date.slice(0, 7))} – ${monthLabel(latest.date.slice(0, 7))}`,
    coverage: `${d.monthly.length} monthly reports held, ${longDate(first.date)} to ${longDate(latest.date)}; ${d.gaps.length} gaps; ${d.quarterEnd.length} quarter-end reports; ${d.heldReports} files held back because they fail their own printed totals or cannot be read.`,
  };
}

// ------------------------------------------------------------------ quarter-end caseload by circuit

function CircuitChart({ data, status }: { data: National | null; status: ChartStatus }) {
  const dates = useMemo(
    () => [...new Set((data?.circuits ?? []).flatMap((c) => c.points.map((p) => p.date)))].sort(),
    [data],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked && dates.includes(picked) ? picked : (dates[dates.length - 1] ?? null);
  const items = (data?.circuits ?? []).map((c) => {
    const p = c.points.find((x) => x.date === date);
    return {
      id: c.slug,
      label: c.name,
      value: p ? p.pending : null,
      note: p ? `${p.mdls} MDLs · ${fmtPct(p.sharePct)}` : undefined,
    };
  });
  const table: TableSpec | undefined = data?.circuits.length
    ? {
        caption: "Actions now pending by circuit at each quarter end (printed Circuit Summary)",
        columns: [
          { label: "Circuit" },
          ...dates.map((d) => ({ label: longDate(d), align: "right" as const })),
        ],
        rows: data.circuits.map((c) => ({
          key: c.slug,
          cells: [
            c.name,
            ...dates.map((d) => {
              const p = c.points.find((x) => x.date === d);
              return p ? `${fmtInt(p.pending)} (${p.mdls} MDLs)` : "Not recorded";
            }),
          ],
        })),
      }
    : undefined;
  const st: ChartStatus =
    status.kind === "ready" && !items.length
      ? { kind: "empty", reason: "No quarter-end report is held yet." }
      : status;
  return (
    <ChartFrame
      title="Actions now pending by circuit at quarter end"
      unit="actions"
      period={date ? longDate(date) : undefined}
      sources={[{ label: "JPML MDL Quarterly Caseload Summary", url: JPML_PAGES.quarterly }]}
      status={st}
      actions={
        dates.length > 1 ? (
          <SegmentedControl
            label="Quarter end"
            value={date ?? ""}
            options={dates.map((d) => ({ value: d, label: d.slice(0, 7) }))}
            onChange={setPicked}
          />
        ) : null
      }
      notes={[
        "Each bar is the circuit's printed Circuit Summary (sum of its MDLs' pending actions). Quarter-end reports are dated the last day of the quarter, a day before the next monthly report.",
      ]}
      table={table}
      minHeight={220}
    >
      {items.length ? (
        <RankedBars
          items={items}
          formatter={count}
          unit="actions"
          ariaLabel={`Actions now pending by circuit, ${date}`}
        />
      ) : null}
    </ChartFrame>
  );
}

// ------------------------------------------------------------------ districts and judges over time

function EntityPanel({
  kind,
  title,
  data,
  status,
}: {
  kind: "district" | "judge";
  title: string;
  data: National | null;
  status: ChartStatus;
}) {
  const [scale, setScale] = useState<"shared" | "own">("shared");
  const view = useMemo(() => {
    if (!data) return null;
    const first = data.monthly[0]!.date;
    const latest = data.monthly[data.monthly.length - 1]!.date;
    // small panels: a year tick every few years so labels never touch at 1024 px
    const axis = monthlyAxis(monthKeys(first, latest), 4);
    const pool: EntitySeries[] = kind === "district" ? data.districts : data.judges;
    const top = pool
      .flatMap((e) => {
        const p = e.points.find((x) => x.date === latest);
        return p ? [{ e, p }] : [];
      })
      .sort((a, b) => b.p.pending - a.p.pending || a.e.name.localeCompare(b.e.name))
      .slice(0, kind === "district" ? 9 : 12);
    const series = top.map(({ e }) => ({
      id: e.id,
      label: kind === "district" ? `${e.name}${e.courtLabel ? ` · ${e.courtLabel}` : ""}` : e.name,
      points: e.points.map((p) => ({ key: p.date.slice(0, 7), value: p.pending })),
    }));
    const table: TableSpec = {
      caption: `${title}, latest report`,
      columns: [
        { label: kind === "district" ? "District" : "Judge (as printed)" },
        { label: "MDLs", align: "right" },
        { label: "Pending", align: "right" },
        ...(kind === "district"
          ? [{ label: "Share of all pending", align: "right" as const }]
          : []),
        { label: "First report listed" },
        { label: "Reports listed", align: "right" },
      ],
      rows: top.map(({ e, p }) => ({
        key: e.id,
        cells: [
          kind === "district" && e.courtId ? (
            <Link
              to="/courts/$id"
              params={{ id: e.courtId }}
              className="text-primary hover:underline"
            >{`${e.name}${e.courtLabel ? ` · ${e.courtLabel}` : ""}`}</Link>
          ) : (
            e.name
          ),
          fmtInt(p.mdls),
          fmtInt(p.pending),
          ...(kind === "district" ? [fmtPct(p.sharePct)] : []),
          longDate(e.points[0]!.date),
          fmtInt(e.points.length),
        ],
      })),
    };
    return { axis, series, table, latest };
  }, [data, kind, title]);
  const notes =
    kind === "district"
      ? [
          "The nine transferee districts with the most pending actions in the latest report; each panel sums the printed pending actions of the MDLs the report lists under the district.",
          "Shared scale compares sizes; own scales show each district's shape.",
        ]
      : [
          "The twelve transferee judges whose MDLs hold the most pending actions in the latest report. An MDL with several judges counts in full for each.",
          "Names are exactly as printed. Older reports print some names without periods (e.g. 'Joseph R Goodwin'); those are kept as separate names and are not merged, so a judge's line can start where the printed spelling changed.",
        ];
  return (
    <ChartFrame
      title={title}
      unit="actions"
      period={
        view
          ? `${monthLabel(data!.monthly[0]!.date.slice(0, 7))} – ${monthLabel(view.latest.slice(0, 7))}`
          : undefined
      }
      sources={[ARCHIVE, { label: "Series index", url: SERIES_INDEX }]}
      status={
        view && !view.series.length
          ? { kind: "empty", reason: "No transferee series is held." }
          : status
      }
      actions={
        <SegmentedControl
          label="Value scale"
          value={scale}
          options={[
            { value: "shared", label: "Shared scale" },
            { value: "own", label: "Own scales" },
          ]}
          onChange={setScale}
        />
      }
      notes={notes}
      footnotes={
        kind === "judge" && data
          ? [
              `${data.judgesTotal.toLocaleString("en-US")} printed judge names appear across the held reports.`,
            ]
          : undefined
      }
      table={view?.table}
      headingLevel="h3"
      minHeight={260}
    >
      {view ? (
        <SmallMultiples
          series={view.series}
          axis={view.axis}
          formatter={count}
          unit="actions"
          shared={scale === "shared"}
          panelHeight={96}
        />
      ) : null}
    </ChartFrame>
  );
}
