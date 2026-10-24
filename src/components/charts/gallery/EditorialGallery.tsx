/**
 * The editorial chart forms on published data (see ChartGallery): annotated trends, stacked and 100% areas with direct
 * labels, a diverging area, a scatter with a smooth line and ribbon, a verdict stack, a dumbbell range and a bench
 * matrix, then the empty and partial states. Every figure is a published value or plain arithmetic on published values
 * (filed minus terminated, shares of a total); the state examples remove values from the same data and say so.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { districtsQuery, nationalQuery } from "@/components/courts/caseload/caseloadQueries";
import { courtStatsQuery } from "@/components/courts/CourtStatsDashboard";
import { CIRCUIT_SHORT, at, fmtNum } from "@/components/courts/courtStatsData";
import { jpmlNationalQuery } from "@/components/mdl/jpml-series/queries";
import {
  JPML_PAGES,
  monthKeys,
  monthLabel,
  monthlyAxis,
  monthlySeries,
} from "@/components/mdl/jpml-series/model";
import { getMdlAnalytics } from "@/lib/external/mdlAnalytics.functions";
import { blockDef } from "@/lib/analytics/registry";
import { ChartCard, type TableSpec } from "../ChartCard";
import { metricFormatter } from "../format";
import { scatterStats, strengthWords } from "../ScatterCorrelation";
import type { PeriodAxis, TrendSeriesInput } from "../series";
import { periodTable, tickText, trendTakeaway } from "../recharts";
import { blockSeries } from "../recharts/blocks";
import {
  AnnotatedTrend,
  BenchMatrix,
  DivergingAreaTrend,
  DumbbellRange,
  ScatterBand,
  StackedAreaTrend,
  VerdictStack,
  type BenchGroup,
} from "../editorial";
import { GallerySection as Section } from "./GallerySection";

const count = metricFormatter("count");
const perJudgeship = { ...metricFormatter("ratio"), tick: count.tick };

/** "IN RE: Silicone Gel Breast Implant Products Liability Litigation" → "Silicone Gel Breast Implant". */
function shortCaption(caption: string): string {
  const core = caption
    .replace(/^in re:?\s*/i, "")
    .replace(
      /\s*(products?\s+liability\s+)?(marketing,\s+sales\s+practices\s+and\s+)?litigation.*$/i,
      "",
    )
    .replace(/\s*\(No\.[^)]*\)\s*$/i, "")
    .trim();
  if (core.length <= 22) return core;
  const cut = core.slice(0, 22);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 12))}…`;
}
const COURT_SOURCES = [
  {
    label: "Judicial Business of the United States Courts",
    url: "https://www.uscourts.gov/statistics-reports/analysis-reports/judicial-business-united-states-courts",
  },
];
const FJC = [
  {
    label: "Federal Judicial Center, Integrated Database",
    url: "https://www.fjc.gov/research/idb",
  },
];
const fmtN = (v: number) => fmtNum(v);

const yearAxis = (keys: string[], prefix = "FY"): PeriodAxis => ({
  keys,
  label: (k) => `${prefix}${k}`,
  tick: (k) => `${prefix === "FY" ? "FY" : ""}${k.slice(2)}`,
});
const loading = { kind: "loading" } as const;

export function EditorialGallery() {
  return (
    <>
      <Section
        id="annotated"
        title="Annotated trend"
        note="A line or area with the annotations that explain its shape: an event rule with its label, a peak callout on a leader, a labelled partial period and the last value at the line's end."
      >
        <div className="grid gap-3 xl:grid-cols-2">
          <JpmlAnnotated />
          <FilingsPeak />
        </div>
      </Section>
      <Section
        id="stacked"
        title="Stacked and 100% areas, names inside the areas"
        note="Direct labels sit inside each area (a leader at the right edge for a thin one); a legend appears only past four series. The 100% form reads shares; smoothing is display only."
      >
        <StackedAreas />
      </Section>
      <Section
        id="diverging"
        title="Diverging area"
        note="One signed series filled above and below the zero line in two tones, ending exactly on zero at each crossing, with the peak, the low and the last value written."
      >
        <NetDiverging />
      </Section>
      <Section
        id="scatterband"
        title="Scatter with a smooth line and ribbon"
        note="Local regression through the districts with its 95% confidence band; the points farthest from the line are named. A group-level association, never a cause."
      >
        <WorkloadScatter />
      </Section>
      <Section
        id="verdict"
        title="Verdict stack, dumbbell range and bench matrix"
        note="Composition of outcomes per subject with a legend that filters; two values per row on one zero-based scale; a comparison matrix with grouped rows and a highlighted column."
      >
        <div className="grid gap-3 xl:grid-cols-2">
          <TerminatedVerdicts />
          <FiledTerminated />
        </div>
        <CourtMatrix />
      </Section>
      <Section
        id="editorial-states"
        title="Empty and partial states of the editorial forms"
        note="The same published data with values removed, to show how each form reads a gap, a partial period, too few points and a subject with nothing recorded."
      >
        <EditorialStates />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ annotated trend

function JpmlAnnotated() {
  const q = useQuery(jpmlNationalQuery);
  const d = q.data;
  const built = useMemo(() => {
    if (!d || !d.monthly.length) return null;
    const keys = monthKeys(d.monthly[0]!.date, d.monthly[d.monthly.length - 1]!.date);
    const axis = monthlyAxis(keys);
    const pending = monthlySeries("pending", "Actions pending", d.monthly, (p) => p.pending);
    return { axis, pending };
  }, [d]);
  if (!built)
    return (
      <ChartCard
        variant="editorial"
        title="Pending MDL actions"
        status={
          q.isLoading ? loading : { kind: "empty", reason: "No JPML report series is published." }
        }
      />
    );
  const { axis, pending } = built;
  const title =
    trendTakeaway(
      "Actions pending in MDLs",
      pending.points.map((p) => ({ label: monthLabel(p.key), value: p.value })),
      fmtN,
      { window: 24 },
    ) ?? "Actions pending in MDLs";
  const rows = pending.points.map((p) => ({ month: monthLabel(p.key), pending: p.value }));
  const table: TableSpec = periodTable(
    rows,
    "month",
    [{ key: "pending", label: "Actions pending" }],
    fmtN,
    { caption: "Actions pending in MDLs, per JPML monthly report", xLabel: "Report month" },
  );
  return (
    <ChartCard
      variant="editorial"
      title={title}
      subtitle={`Actions now pending in all pending MDLs · per JPML monthly report · ${monthLabel(axis.keys[0]!)} to ${monthLabel(axis.keys[axis.keys.length - 1]!)}`}
      table={table}
      sources={[{ label: "JPML pending MDL reports", url: JPML_PAGES.archive }]}
      about={
        <p>
          Each point is one report: the sum of “Actions Now Pending” over every MDL listed. Months
          with no held report are gaps. Reports are dated mid-month until 2023 and on the first
          business day of the month from January 2024.
        </p>
      }
    >
      <AnnotatedTrend
        series={[pending]}
        axis={axis}
        formatter={count}
        form="line"
        events={[
          {
            key: "2024-01",
            label: "Reports dated the first business day, from Jan 2024",
            kind: "break",
          },
        ]}
        callouts={["peak"]}
        ariaLabel="Actions pending in MDLs per JPML monthly report, with the report-date change marked"
        height={300}
      />
    </ChartCard>
  );
}

function FilingsPeak() {
  const q = useQuery(courtStatsQuery);
  const data = q.data;
  if (!data)
    return (
      <ChartCard
        variant="editorial"
        title="Product liability filings"
        status={q.isLoading ? loading : { kind: "error", onRetry: () => void q.refetch() }}
      />
    );
  const keys = data.years.map(String);
  const axis = yearAxis(keys);
  const series: TrendSeriesInput = {
    id: "pl",
    label: "Product liability filings",
    points: data.years.map((y, i) => ({
      key: String(y),
      value: at(data.national.series["pl_total"], i),
    })),
  };
  const title =
    trendTakeaway(
      "Product liability filings",
      series.points.map((p) => ({ label: axis.label(p.key), value: p.value })),
      fmtN,
    ) ?? "Product liability filings";
  return (
    <ChartCard
      variant="editorial"
      title={title}
      subtitle={`Cases filed in U.S. district courts · Table C-11 · FY${keys[0]}–FY${keys.at(-1)}`}
      table={periodTable(
        series.points.map((p) => ({ year: axis.label(p.key), value: p.value })),
        "year",
        [{ key: "value", label: "Filings" }],
        fmtN,
        { caption: "Product liability filings", xLabel: "Fiscal year" },
      )}
      sources={COURT_SOURCES}
      about={
        <p>
          Large swings follow MDL dockets: cases filed directly in, or transferred to, an MDL court
          count as filings there.
        </p>
      }
    >
      <AnnotatedTrend
        series={[series]}
        axis={axis}
        formatter={count}
        form="area"
        callouts={["peak"]}
        ariaLabel="Product liability filings by fiscal year with the peak marked"
        height={300}
      />
    </ChartCard>
  );
}

// ------------------------------------------------------------------ stacked areas

function StackedAreas() {
  const q = useQuery(analyticsBlockQuery("fda-recalls"));
  const res = q.data;
  const def = blockDef("fda-recalls");
  if (!res || res.status !== "ok")
    return (
      <ChartCard
        variant="editorial"
        title={def?.title ?? "FDA recall enforcement-report entries"}
        status={
          q.isLoading
            ? loading
            : res && res.status === "empty"
              ? { kind: "empty", reason: res.reason }
              : { kind: "error", onRetry: () => void q.refetch() }
        }
      />
    );
  const { series, axis, formatter } = blockSeries(res.data);
  const totals = axis.keys.map((_, i) => {
    const vals = series.map((s) => s.points[i]!.value);
    const partial = series.some((s) => s.points[i]!.partial);
    return {
      label: axis.label(axis.keys[i]!),
      value: vals.every((v) => v !== null) ? (vals as number[]).reduce((a, v) => a + v, 0) : null,
      partial,
    };
  });
  const title =
    trendTakeaway("FDA recall entries", totals, fmtN) ?? "FDA recall enforcement-report entries";
  const table = periodTable(
    axis.keys.map((k, i) => ({
      period: axis.label(k),
      ...Object.fromEntries(series.map((s) => [s.id, s.points[i]!.value])),
      __partial: series.some((s) => s.points[i]!.partial),
    })),
    "period",
    series.map((s) => ({ key: s.id, label: s.label })),
    fmtN,
    {
      caption: def?.title ?? "FDA recall entries",
      xLabel: "Year",
      partialKey: "__partial",
      total: true,
    },
  );
  const common = {
    source: { label: res.data.source.label, url: res.data.source.url },
  };
  const partialNote = res.data.series.some((s) => s.points.some((p) => p.partial))
    ? "The last year was still in progress when the data was taken; it is hatched and not used in comparisons."
    : undefined;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <ChartCard
        variant="editorial"
        title={title}
        subtitle={`Recall enforcement-report entries by product type · ${res.data.period}`}
        table={table}
        sources={[common.source]}
        partial={partialNote}
        about={
          res.data.notes.length ? (
            <ul>
              {res.data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : undefined
        }
      >
        <StackedAreaTrend
          series={series}
          axis={axis}
          formatter={formatter}
          ariaLabel="FDA recall entries by product type, stacked"
          height={300}
        />
      </ChartCard>
      <ChartCard
        title="Share of entries by product type"
        subtitle={`Each year as 100% · ${res.data.period}`}
        table={table}
        sources={[common.source]}
        partial={partialNote}
      >
        <StackedAreaTrend
          series={series}
          axis={axis}
          formatter={formatter}
          mode="percent"
          smooth
          ariaLabel="Share of FDA recall entries by product type, each year as 100 percent"
          height={300}
        />
      </ChartCard>
    </div>
  );
}

// ------------------------------------------------------------------ diverging

function NetDiverging() {
  const q = useQuery(nationalQuery);
  const nat = q.data;
  if (!nat)
    return (
      <ChartCard
        variant="editorial"
        title="Filed minus terminated"
        status={q.isLoading ? loading : { kind: "error", onRetry: () => void q.refetch() }}
      />
    );
  const years = nat.years.filter((y) => y.filings !== null && y.terminations !== null);
  const keys = years.map((y) => String(y.fy));
  const axis = yearAxis(keys);
  const series: TrendSeriesInput = {
    id: "net",
    label: "Filed minus terminated",
    points: years.map((y) => ({
      key: String(y.fy),
      value: (y.filings as number) - (y.terminations as number),
      partial: y.partial,
    })),
  };
  const complete = series.points.filter((p) => !p.partial && p.value !== null);
  const last = complete[complete.length - 1];
  let switchKey: string | null = null;
  for (let i = complete.length - 1; i > 0; i--)
    if ((complete[i]!.value as number) < 0 && (complete[i - 1]!.value as number) >= 0) {
      switchKey = complete[i]!.key;
      break;
    }
  const title = last
    ? (last.value as number) >= 0
      ? `Federal courts took in ${fmtN(last.value as number)} more civil cases than they closed in ${axis.label(last.key)}`
      : `Federal courts closed ${fmtN(-(last.value as number))} more civil cases than they took in during ${axis.label(last.key)}`
    : "Civil cases filed minus terminated";
  return (
    <ChartCard
      variant="editorial"
      title={title}
      subtitle={`Civil cases filed minus terminated, U.S. district courts · fiscal years ${axis.label(keys[0]!)}–${axis.label(keys.at(-1)!)}`}
      table={periodTable(
        years.map((y) => ({
          year: `${axis.label(String(y.fy))}${y.partial ? " (partial)" : ""}`,
          filed: y.filings,
          terminated: y.terminations,
          net: (y.filings as number) - (y.terminations as number),
        })),
        "year",
        [
          { key: "filed", label: "Filed" },
          { key: "terminated", label: "Terminated" },
          { key: "net", label: "Filed minus terminated" },
        ],
        (v) => (v < 0 ? `−${fmtN(-v)}` : fmtN(v)),
        { caption: "Civil cases filed minus terminated", xLabel: "Fiscal year" },
      )}
      sources={FJC}
      partial={
        years.some((y) => y.partial)
          ? "The latest fiscal year was still in progress; it is dashed and never the last value."
          : undefined
      }
      about={
        <p>
          The difference is plain arithmetic on the two published counts. Above zero, more cases
          came in than were closed that year, so the pending count rose.
        </p>
      }
    >
      <DivergingAreaTrend
        series={series}
        axis={axis}
        formatter={count}
        positiveLabel="More filed than terminated"
        negativeLabel="More terminated than filed"
        annotation={
          switchKey
            ? { key: switchKey, label: `${axis.label(switchKey)}: terminations pass filings` }
            : undefined
        }
        ariaLabel="Civil cases filed minus terminated per fiscal year"
        height={300}
      />
    </ChartCard>
  );
}

// ------------------------------------------------------------------ scatter with a ribbon

function WorkloadScatter() {
  const q = useQuery(courtStatsQuery);
  const data = q.data;
  if (!data)
    return (
      <ChartCard
        title="Workload against time to disposition"
        status={q.isLoading ? loading : { kind: "error", onRetry: () => void q.refetch() }}
      />
    );
  const yi = data.years.length - 1;
  const year = `FY${data.years[yi]}`;
  const points = data.districts
    .map((d) => ({
      id: d.id,
      label: d.name,
      x: at(d.civilPerJudgeship, yi),
      y: at(d.median, yi),
    }))
    .filter(
      (p): p is { id: string; label: string; x: number; y: number } => p.x !== null && p.y !== null,
    );
  const stats = scatterStats(points);
  const rho = stats.spearman?.coefficient ?? null;
  const rhoText = rho === null ? "" : `Spearman ρ = ${rho.toFixed(2).replace("-", "−")} · `;
  const title =
    rho === null
      ? "Workload and time to disposition across districts"
      : `Districts with heavier dockets show ${strengthWords(rho)} with time to disposition`;
  return (
    <ChartCard
      variant="editorial"
      title={title}
      subtitle={`Civil filings per judgeship against median months to disposition · ${points.length} districts · ${rhoText}${year}`}
      table={{
        caption: `Civil filings per judgeship and median months to disposition, ${year}`,
        columns: [
          { label: "District" },
          { label: "Filings per judgeship", align: "right" },
          { label: "Median months", align: "right" },
        ],
        rows: [...points]
          .sort((a, b) => b.x - a.x)
          .map((p) => ({ key: p.id, cells: [p.label, fmtNum(p.x, 1), fmtNum(p.y, 1)] })),
      }}
      sources={COURT_SOURCES}
      about={
        <p>
          Tables C, C-5 and X-1A. Each dot is one district; months use a log scale so the many short
          times stay readable. The line is a local regression and the band its 95% confidence
          interval. This describes the districts, not the cases in them, and does not show that one
          measure causes the other.
        </p>
      }
    >
      <ScatterBand
        points={points}
        xFormatter={perJudgeship}
        yFormatter={metricFormatter("months")}
        xLabel="Civil filings per judgeship"
        yLabel="Median months to disposition"
        logY
        ariaLabel={`Civil filings per judgeship against median months to disposition across ${points.length} districts`}
        height={380}
      />
    </ChartCard>
  );
}

// ------------------------------------------------------------------ verdict stack, dumbbell, matrix

function TerminatedVerdicts() {
  const q = useQuery({
    queryKey: ["mdl-analytics-gallery"],
    queryFn: () => getMdlAnalytics(),
    staleTime: 600000,
  });
  const t = q.data?.terminated;
  if (!t)
    return (
      <ChartCard
        title="How the largest terminated MDLs ended"
        status={q.isLoading ? loading : { kind: "error", onRetry: () => void q.refetch() }}
      />
    );
  const rows = t.largest.slice(0, 8);
  const subjects = rows.map((r) => ({
    id: String(r.mdl),
    label: `MDL ${r.mdl} · ${shortCaption(r.caption)}`,
    counts: { closed: r.actions - r.remanded, remanded: r.remanded },
  }));
  const share = rows
    .map((r) => ({
      mdl: r.mdl,
      pct: r.actions > 0 ? Math.round((r.remanded / r.actions) * 100) : 0,
    }))
    .sort((a, b) => b.pct - a.pct);
  const title =
    share.length > 1 && share[0]!.pct > share[1]!.pct
      ? `MDL ${share[0]!.mdl} remanded the largest share of its actions, ${share[0]!.pct}%; the other ${share.length - 1} remanded ${share[1]!.pct}% or less`
      : `Remand shares of the ${rows.length} largest terminated MDLs`;
  const taxonomy = [
    { group: "Closed", tags: [{ key: "closed", label: "Closed in the transferee court" }] },
    { group: "Returned", tags: [{ key: "remanded", label: "Remanded to the original courts" }] },
  ];
  return (
    <ChartCard
      title={title}
      subtitle="Terminated actions by outcome · each bar is one MDL · JPML terminated-MDL statistics"
      table={{
        caption: "Largest terminated MDLs by outcome of their actions",
        columns: [
          { label: "MDL" },
          { label: "Terminated actions", align: "right" },
          { label: "Remanded", align: "right" },
          { label: "Year terminated", align: "right" },
        ],
        rows: rows.map((r) => ({
          key: String(r.mdl),
          cells: [`MDL ${r.mdl} · ${r.caption}`, fmtN(r.actions), fmtN(r.remanded), String(r.year)],
        })),
      }}
      sources={[
        {
          label: "JPML Statistical Analysis of Multidistrict Litigation",
          url: JPML_PAGES.statistics,
        },
      ]}
      about={
        <p>
          Terminated actions are those closed in the transferee court plus those remanded to the
          courts they came from, as the JPML reports them.
        </p>
      }
    >
      <VerdictStack
        subjects={subjects}
        taxonomy={taxonomy}
        sortBy="remanded"
        ariaLabel="Outcome of terminated actions in the largest terminated MDLs"
        labelWidth={190}
      />
    </ChartCard>
  );
}

function FiledTerminated() {
  const dq = useQuery(districtsQuery);
  const nq = useQuery(nationalQuery);
  const rows = dq.data?.rows;
  const fy = nq.data?.latestFy;
  if (!rows || !fy)
    return (
      <ChartCard
        title="Cases filed and terminated by district"
        status={
          dq.isLoading || nq.isLoading
            ? loading
            : { kind: "error", onRetry: () => void dq.refetch() }
        }
      />
    );
  const top = [...rows]
    .filter((r) => r.filings !== null)
    .sort((a, b) => (b.filings as number) - (a.filings as number))
    .slice(0, 10);
  const rowsIn = top.map((r) => ({
    id: r.id,
    label: r.name.replace(/^District Court,\s*/, ""),
    a: r.filings,
    b: r.terminations,
  }));
  const behind = rowsIn.filter(
    (r) => r.a !== null && r.b !== null && (r.b as number) < (r.a as number),
  ).length;
  return (
    <ChartCard
      title={
        behind === rowsIn.length
          ? `All ${rowsIn.length} of the busiest districts closed fewer civil cases than they took in during FY${fy}`
          : behind === 0
            ? `None of the ${rowsIn.length} busiest districts closed fewer civil cases than they took in during FY${fy}`
            : `${behind} of the ${rowsIn.length} busiest districts closed fewer civil cases than they took in during FY${fy}`
      }
      subtitle={`Civil cases filed and terminated · the ${rowsIn.length} districts with the most filings · FY${fy}`}
      table={{
        caption: `Civil cases filed and terminated, busiest districts, FY${fy}`,
        columns: [
          { label: "District" },
          { label: "Filed", align: "right" },
          { label: "Terminated", align: "right" },
        ],
        rows: rowsIn.map((r) => ({
          key: r.id,
          cells: [
            r.label,
            r.a === null ? "Not recorded" : fmtN(r.a),
            r.b === null ? "Not recorded" : fmtN(r.b),
          ],
        })),
      }}
      sources={FJC}
      about={
        <p>
          Both counts are for the fiscal year ending September 30. Where a district’s terminations
          are not recorded, its filed dot shows alone.
        </p>
      }
    >
      <DumbbellRange
        rows={rowsIn}
        aLabel="Filed"
        bLabel="Terminated"
        format={fmtN}
        tickFormat={(v) => tickText(v)}
        gapLabel="Terminated minus filed"
        sort="given"
        ariaLabel={`Civil cases filed and terminated in the ${rowsIn.length} busiest districts, FY${fy}`}
      />
    </ChartCard>
  );
}

function CourtMatrix() {
  const q = useQuery(courtStatsQuery);
  const data = q.data;
  if (!data)
    return (
      <ChartCard
        title="Four districts side by side"
        status={q.isLoading ? loading : { kind: "error", onRetry: () => void q.refetch() }}
      />
    );
  const yi = data.years.length - 1;
  const year = `FY${data.years[yi]}`;
  const byPl = [...data.districts].sort((a, b) => (at(b.pl, yi) ?? -1) - (at(a.pl, yi) ?? -1));
  const ilnd = data.districts.find((d) => d.id === "ilnd");
  const picked = [ilnd, ...byPl.filter((d) => d.id !== "ilnd")]
    .filter((d): d is NonNullable<typeof d> => !!d)
    .slice(0, 4);
  const columns = picked.map((d) => ({
    id: d.id,
    label: d.name,
    sub: d.circuit ? `${CIRCUIT_SHORT[d.circuit] ?? d.circuit} Circuit` : undefined,
    hero: d.id === "ilnd",
  }));
  const hero = picked[0];
  const others = picked.slice(1);
  const heroPerJ = hero ? at(hero.civilPerJudgeship, yi) : null;
  const heroMonths = hero ? at(hero.median, yi) : null;
  const lighter =
    heroPerJ === null
      ? null
      : others.filter((d) => (at(d.civilPerJudgeship, yi) ?? -1) > heroPerJ).length;
  const quicker =
    heroMonths === null ? null : others.filter((d) => (at(d.median, yi) ?? -1) > heroMonths).length;
  const matrixTitle =
    hero && lighter !== null && quicker !== null
      ? lighter === others.length && quicker === others.length
        ? `${hero.name} has the fewest filings per judgeship and the shortest median time to disposition of the ${picked.length} districts compared`
        : `${hero.name} against ${others.length} other districts, ${year}`
      : "Districts side by side";
  const groups: BenchGroup[] = [
    {
      label: "Workload",
      rows: [
        {
          label: "Civil filings per judgeship",
          note: "Table X-1A",
          values: picked.map((d) => at(d.civilPerJudgeship, yi)),
          format: (v) => fmtNum(v, 0),
          lead: "highest",
        },
        {
          label: "Product liability filings",
          note: "Table C-11",
          values: picked.map((d) => at(d.pl, yi)),
          format: (v) => fmtNum(v, 0),
          lead: "highest",
        },
      ],
    },
    {
      label: "Speed",
      rows: [
        {
          label: "Median months to disposition",
          note: "Civil cases, Table C-5",
          values: picked.map((d) => at(d.median, yi)),
          format: (v) => fmtNum(v, 1),
          lead: "lowest",
        },
        {
          label: "Civil cases pending 3+ years",
          note: "Share of pending, Table C-6",
          values: picked.map((d) => at(d.over3, yi)),
          format: (v) => `${fmtNum(v, 1)}%`,
          lead: "lowest",
        },
      ],
    },
    {
      label: "MDL",
      rows: [
        {
          label: "Actions pending in MDLs assigned here",
          note: "JPML",
          values: picked.map((d) => d.mdl?.pendingActions ?? null),
          format: (v) => fmtNum(v, 0),
          lead: "highest",
        },
      ],
    },
  ];
  return (
    <ChartCard
      title={matrixTitle}
      subtitle={`${picked.length} districts · the selected district and the three with the most product liability filings · ${year}`}
      sources={COURT_SOURCES}
      table={{
        caption: `District comparison, ${year}`,
        columns: [
          { label: "Measure" },
          ...columns.map((c) => ({ label: c.label, align: "right" as const })),
        ],
        rows: groups.flatMap((g) =>
          g.rows.map((r) => ({
            key: `${g.label}-${r.label}`,
            cells: [
              r.label,
              ...r.values.map((v) => (v == null ? "Not recorded" : (r.format ?? fmtN)(v))),
            ],
          })),
        ),
      }}
    >
      <BenchMatrix
        columns={columns}
        groups={groups}
        ariaLabel={`Comparison of ${picked.length} districts, ${year}`}
      />
    </ChartCard>
  );
}

// ------------------------------------------------------------------ states

function EditorialStates() {
  const fda = useQuery(analyticsBlockQuery("fda-recalls"));
  const courts = useQuery(courtStatsQuery);
  const mdl = useQuery({
    queryKey: ["mdl-analytics-gallery"],
    queryFn: () => getMdlAnalytics(),
    staleTime: 600000,
  });
  const block = fda.data && fda.data.status === "ok" ? blockSeries(fda.data.data) : null;
  // a gap: one period removed from one series of real data
  const gapped = block
    ? {
        ...block,
        series: block.series.map((s, si) =>
          si === 1
            ? {
                ...s,
                points: s.points.map((p, i) =>
                  i === Math.floor(block.axis.keys.length / 2) ? { ...p, value: null } : p,
                ),
              }
            : s,
        ),
      }
    : null;
  const data = courts.data;
  const yi = data ? data.years.length - 1 : 0;
  const few = data
    ? data.districts
        .slice(0, 5)
        .map((d) => ({
          id: d.id,
          label: d.name,
          x: at(d.civilPerJudgeship, yi),
          y: at(d.median, yi),
        }))
        .filter(
          (p): p is { id: string; label: string; x: number; y: number } =>
            p.x !== null && p.y !== null,
        )
    : [];
  const t = mdl.data?.terminated;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <ChartCard
        title="A period with a series missing is a gap in every layer"
        subtitle="FDA recall entries by product type · one value removed to show the state"
        status={gapped ? { kind: "ready" } : loading}
      >
        {gapped ? (
          <StackedAreaTrend
            series={gapped.series}
            axis={gapped.axis}
            formatter={gapped.formatter}
            ariaLabel="Stacked areas with a period not recorded"
            height={240}
          />
        ) : null}
      </ChartCard>
      <ChartCard
        title="Too few points: the points stand alone"
        subtitle="Civil filings per judgeship against months to disposition · five districts"
        status={data ? { kind: "ready" } : loading}
      >
        <ScatterBand
          points={few}
          xFormatter={perJudgeship}
          yFormatter={metricFormatter("months")}
          xLabel="Civil filings per judgeship"
          yLabel="Median months to disposition"
          ariaLabel="Five districts, no smooth line"
          height={240}
        />
      </ChartCard>
      <ChartCard
        title="A subject with nothing recorded reads Not recorded"
        subtitle="Terminated MDLs by outcome · one MDL's counts removed to show the state"
        status={t ? { kind: "ready" } : loading}
      >
        {t ? (
          <VerdictStack
            ariaLabel="Outcome of terminated actions with one MDL not recorded"
            labelWidth={190}
            taxonomy={[
              {
                group: "Closed",
                tags: [{ key: "closed", label: "Closed in the transferee court" }],
              },
              {
                group: "Returned",
                tags: [{ key: "remanded", label: "Remanded to the original courts" }],
              },
            ]}
            subjects={t.largest.slice(0, 3).map((r, i) => ({
              id: String(r.mdl),
              label: `MDL ${r.mdl}`,
              counts:
                i === 1
                  ? { closed: null, remanded: null }
                  : { closed: r.actions - r.remanded, remanded: r.remanded },
            }))}
          />
        ) : null}
      </ChartCard>
      <ChartCard
        title="No value is ever read as zero"
        subtitle="Four districts · one value removed from each of two rows to show the state"
        status={data ? { kind: "ready" } : loading}
      >
        {data ? (
          <BenchMatrix
            ariaLabel="Comparison with values not recorded"
            columns={data.districts
              .slice(0, 3)
              .map((d, i) => ({ id: d.id, label: d.name, hero: i === 0 }))}
            groups={[
              {
                label: "Speed",
                rows: [
                  {
                    label: "Median months to disposition",
                    values: data.districts
                      .slice(0, 3)
                      .map((d, i) => (i === 1 ? null : at(d.median, yi))),
                    format: (v) => fmtNum(v, 1),
                    lead: "lowest",
                  },
                  {
                    label: "Civil filings per judgeship",
                    values: data.districts
                      .slice(0, 3)
                      .map((d, i) => (i === 0 || i === 2 ? null : at(d.civilPerJudgeship, yi))),
                    format: (v) => fmtNum(v, 0),
                    lead: "highest",
                  },
                ],
              },
            ]}
          />
        ) : null}
      </ChartCard>
    </div>
  );
}
