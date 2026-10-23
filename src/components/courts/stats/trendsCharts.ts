/**
 * Which charts the court statistics panel draws for a district, a circuit or a bankruptcy court, and from which published
 * columns. Columns are found by their published headings (never by position); a chart whose column is absent from the stored
 * table is left out rather than pointed at another column, and every chart carries its source table and the footnotes and
 * breaks that apply to its plotted window.
 */
import type {
  CourtTrends,
  UstColumn,
  UstTable,
  UstUnit,
} from "@/lib/external/uscourtsTables.functions";
import {
  breaksInWindow,
  columnPoints,
  findColumn,
  hasValues,
  latestNotes,
  marksInWindow,
  shareOfNational,
  type PeriodMode,
  type TrendSeries,
} from "./trendsModel";

export const CIRCUIT_NAMES: Record<string, string> = {
  cadc: "D.C. Circuit",
  ca1: "First Circuit",
  ca2: "Second Circuit",
  ca3: "Third Circuit",
  ca4: "Fourth Circuit",
  ca5: "Fifth Circuit",
  ca6: "Sixth Circuit",
  ca7: "Seventh Circuit",
  ca8: "Eighth Circuit",
  ca9: "Ninth Circuit",
  ca10: "Tenth Circuit",
  ca11: "Eleventh Circuit",
  cafc: "Federal Circuit",
};

export type ChartSource = { label: string; href: string | null };

export type ChartSpec = {
  id: string;
  title: string;
  unitText: string;
  unit: UstUnit;
  decimals: number | null;
  /** 12 for flows measured over twelve months, 0 for counts as of a date. */
  months: number;
  series: TrendSeries[];
  sources: ChartSource[];
  howToRead: string;
  breaks: { end: string; kind: string; detail: string }[];
  /** Footnotes the publisher attached to this court's row or to a plotted column heading, with the period ends they apply to. */
  footnotes: { text: string; ends: string[]; column: string | null }[];
  /** The table's own footnote lines for the latest plotted period. */
  tableNotes: string[];
  /** Publication of each period end ("JB", "STFJ · PDF"): a PDF edition was read from the PDF text layer, not from a spreadsheet. */
  periodSources: Record<string, string>;
};

export type ChartContext = {
  trends: CourtTrends;
  mode: PeriodMode;
  /** Short court name for series labels. */
  courtName: string;
};

const tableOf = (tables: readonly UstTable[], key: string) =>
  tables.find((t) => t.tableKey === key) ?? null;
const col = (t: UstTable, ...patterns: RegExp[]): UstColumn | null =>
  findColumn(t.columns, patterns);

function sourcesOf(t: UstTable): ChartSource[] {
  const last = t.sources[t.periods.at(-1)?.src ?? -1];
  return [{ label: `U.S. Courts, Table ${t.table}`, href: last?.page || last?.url || null }];
}

function nationalLabel(t: UstTable): string {
  return t.scope === "appeals" || t.scope === "circuit"
    ? "All circuits"
    : t.scope === "bankruptcy"
      ? "All bankruptcy courts"
      : "All U.S. district courts";
}

function seriesOf(
  t: UstTable,
  c: UstColumn,
  id: string,
  label: string,
  mode: PeriodMode,
  months: number,
): TrendSeries | null {
  const points = columnPoints(t, c.key, "court", mode, months);
  return hasValues(points) ? { id, label, points } : null;
}

/**
 * One line from the same measure under successive published headings: for each period the first column with a value (or a printed
 * dash) supplies the point. The caller states the join in the chart's "how to read" text; `joined` says whether a later heading
 * supplied any point.
 */
function joinedSeriesOf(
  t: UstTable,
  cols: readonly (UstColumn | null)[],
  id: string,
  label: string,
  mode: PeriodMode,
  months: number,
): { series: TrendSeries | null; joined: boolean } {
  const used = cols.filter((c): c is UstColumn => c != null);
  if (!used.length) return { series: null, joined: false };
  const lines = used.map((c) => columnPoints(t, c.key, "court", mode, months));
  let joined = false;
  const points = lines[0]!.map((p, i) => {
    if (p.value != null || p.dash) return p;
    for (let k = 1; k < lines.length; k += 1) {
      const q = lines[k]![i];
      if (q && (q.value != null || q.dash)) {
        joined = true;
        return q;
      }
    }
    return p;
  });
  return hasValues(points)
    ? { series: { id, label, points }, joined }
    : { series: null, joined: false };
}

function nationalSeries(
  t: UstTable,
  c: UstColumn,
  mode: PeriodMode,
  months: number,
  label?: string,
): TrendSeries | null {
  const points = columnPoints(t, c.key, "national", mode, months);
  return hasValues(points)
    ? { id: `${c.key}__nat`, label: label ?? nationalLabel(t), points, dashed: true }
    : null;
}

function circuitSeries(
  t: UstTable,
  c: UstColumn,
  mode: PeriodMode,
  months: number,
): TrendSeries | null {
  if (!t.circuitId) return null;
  const points = columnPoints(t, c.key, "circuit", mode, months);
  return hasValues(points)
    ? {
        id: `${c.key}__circ`,
        label: `${CIRCUIT_NAMES[t.circuitId] ?? t.circuitId} (all its districts)`,
        points,
      }
    : null;
}

function finish(
  spec: Omit<ChartSpec, "breaks" | "footnotes" | "tableNotes" | "sources" | "periodSources">,
  t: UstTable,
  mode: PeriodMode,
  columns: readonly (UstColumn | null)[],
): ChartSpec | null {
  if (!spec.series.length) return null;
  const keys = columns.filter((c): c is UstColumn => c != null).map((c) => c.key);
  return {
    ...spec,
    sources: sourcesOf(t),
    breaks: breaksInWindow(t, mode, spec.months),
    footnotes: marksInWindow(t, mode, keys, spec.months).map((m) => ({
      text: m.text,
      ends: m.ends,
      column: m.col == null ? null : (t.columns.find((c) => c.key === m.col)?.label ?? null),
    })),
    tableNotes: latestNotes(t, mode, spec.months),
    periodSources: Object.fromEntries(
      t.periods.map((p) => [p.end, t.sources[p.src]?.format === "pdf" ? `${p.pub} · PDF` : p.pub]),
    ),
  };
}

// The publisher worded the same three count columns "Filings / Terminations" (to 2021), "Commenced" and "Filed / Terminated".
const FILED = /^(Filed|Filings|Commenced)\b/i;
const TERMINATED = /^(Terminated|Terminations)\b/i;
const PENDING = /^Pending\b/i;

const ROLLING_NOTE =
  "Each point is a 12-month period ending on the date shown. Points from different months overlap by nine months, so they are never added together.";

/** Filed, terminated and pending for one court (a flow table with three count columns), plus the court's share of the national total. */
function volumeCharts(
  t: UstTable,
  ctx: ChartContext,
  o: {
    id: string;
    title: string;
    noun: string;
    filed: RegExp;
    terminated: RegExp;
    pending: RegExp;
    shareTitle: string;
  },
): ChartSpec[] {
  const { mode, courtName } = ctx;
  const cols = [
    col(t, o.filed, /^(?!.*percent)/i),
    col(t, o.terminated, /^(?!.*percent)/i),
    col(t, o.pending, /^(?!.*percent)/i),
  ];
  const [filed, terminated, pending] = cols;
  const series = [
    filed && seriesOf(t, filed, "filed", "Filed", mode, 12),
    terminated && seriesOf(t, terminated, "terminated", "Terminated", mode, 12),
    pending && seriesOf(t, pending, "pending", "Pending at period end", mode, 12),
  ].filter((s): s is TrendSeries => s != null);
  const out: ChartSpec[] = [];
  const volume = finish(
    {
      id: o.id,
      title: o.title,
      unitText: `${o.noun}, 12-month periods`,
      unit: "count",
      decimals: 0,
      months: 12,
      series,
      howToRead: `${ROLLING_NOTE} Counts are totals for ${courtName} only; pending is the number open at the end of the period.`,
    },
    t,
    mode,
    cols,
  );
  if (volume) out.push(volume);
  const shareSeries: TrendSeries[] = [];
  for (const [id, label, c] of [
    ["filed", "Filed", filed],
    ["terminated", "Terminated", terminated],
    ["pending", "Pending", pending],
  ] as const) {
    if (!c) continue;
    const court = columnPoints(t, c.key, "court", mode, 12);
    const nat = columnPoints(t, c.key, "national", mode, 12);
    const share = shareOfNational(court, nat);
    if (hasValues(share)) shareSeries.push({ id: `${id}__share`, label, points: share });
  }
  const share = finish(
    {
      id: `${o.id}-share`,
      title: o.shareTitle,
      unitText: "Percent of the national total for the same period",
      unit: "percent",
      decimals: 1,
      months: 12,
      series: shareSeries,
      howToRead: `${courtName}'s count divided by the published national total for the same 12-month period (${nationalLabel(t)}). A very large single docket, such as a multidistrict litigation transferred to a court, can move this share.`,
    },
    t,
    mode,
    cols,
  );
  if (share) out.push(share);
  return out;
}

export function buildCharts(ctx: ChartContext): ChartSpec[] {
  const { trends, mode, courtName } = ctx;
  const charts: ChartSpec[] = [];
  const push = (c: ChartSpec | null) => {
    if (c) charts.push(c);
  };
  if (trends.kind === "district") {
    const c = tableOf(trends.tables, "c");
    if (c)
      charts.push(
        ...volumeCharts(c, ctx, {
          id: "civil",
          title: "Civil cases filed, terminated and pending",
          noun: "Civil cases",
          filed: FILED,
          terminated: TERMINATED,
          pending: PENDING,
          shareTitle: "Share of all U.S. district court civil cases",
        }),
      );
    const d = tableOf(trends.tables, "d");
    if (d)
      charts.push(
        ...volumeCharts(d, ctx, {
          id: "criminal",
          title: "Criminal defendants filed, terminated and pending",
          noun: "Criminal defendants",
          filed: FILED,
          terminated: TERMINATED,
          pending: PENDING,
          shareTitle: "Share of all U.S. district court criminal defendants",
        }),
      );
    const c5 = tableOf(trends.tables, "c-5");
    if (c5) {
      const median = col(c5, /^Total Cases/i, /Median/i);
      if (median) {
        const series = [
          seriesOf(c5, median, "median", courtName, mode, 12),
          circuitSeries(c5, median, mode, 12),
          nationalSeries(c5, median, mode, 12),
        ].filter((s): s is TrendSeries => s != null);
        push(
          finish(
            {
              id: "median-civil",
              title: "Median months from filing to disposition, civil cases",
              unitText: "Months, 12-month periods",
              unit: "months",
              decimals: 1,
              months: 12,
              series,
              howToRead: `${ROLLING_NOTE} The median is over every civil case terminated in the period. The publisher does not compute a median when fewer than 10 cases were reported (shown as a gap), and one very large docket can dominate the national median.`,
            },
            c5,
            mode,
            [median],
          ),
        );
      }
    }
    const c6 = tableOf(trends.tables, "c-6");
    if (c6) {
      const pct = col(c6, /3 Years or More/i, /Percent/i);
      if (pct) {
        const series = [
          seriesOf(c6, pct, "over3", courtName, mode, 0),
          circuitSeries(c6, pct, mode, 0),
          nationalSeries(c6, pct, mode, 0),
        ].filter((s): s is TrendSeries => s != null);
        push(
          finish(
            {
              id: "pending-3y",
              title: "Share of pending civil cases that are three years old or older",
              unitText: "Percent of civil cases pending on the date shown",
              unit: "percent",
              decimals: 1,
              months: 0,
              series,
              howToRead:
                "A count of cases open on the date shown, not a 12-month flow. The publisher does not compute the percent when fewer than 10 cases are pending.",
            },
            c6,
            mode,
            [pct],
          ),
        );
      }
    }
    const x = tableOf(trends.tables, "x-1a");
    if (x) {
      // "Weighted Filings per Judgeship / Total" (the Total column moved from first to last between editions, so it is found by name).
      const weighted = col(x, /^Weighted Filings per Judgeship/i, /Total$/i);
      if (weighted) {
        const series = [
          seriesOf(x, weighted, "weighted", courtName, mode, 12),
          circuitSeries(x, weighted, mode, 12),
          nationalSeries(x, weighted, mode, 12),
        ].filter((s): s is TrendSeries => s != null);
        push(
          finish(
            {
              id: "weighted",
              title: "Weighted filings per authorized judgeship",
              unitText: "Weighted filings per judgeship, 12-month periods",
              unit: "ratio",
              decimals: 0,
              months: 12,
              series,
              howToRead: `${ROLLING_NOTE} Weighted filings count each case by the publisher's estimate of the judge time it needs; they are a workload measure, not a case count. The case weights come from the study or system each edition's note names; they changed between the September 2015 and September 2016 editions (the 2003-2004 study, then weights approved in March 2016), so read the series notes before comparing levels across that change.`,
            },
            x,
            mode,
            [weighted],
          ),
        );
      }
    }
  }
  if (trends.kind === "circuit") {
    const b = tableOf(trends.tables, "b");
    if (b)
      charts.push(
        ...volumeCharts(b, ctx, {
          id: "appeals",
          title: "Appeals filed, terminated and pending",
          noun: "Appeals",
          filed: FILED,
          terminated: TERMINATED,
          pending: PENDING,
          shareTitle: "Share of all U.S. courts of appeals filings",
        }),
      );
    const b4 = tableOf(trends.tables, "b-4");
    if (b4) {
      const median = col(b4, /Notice of Appeal.*to Last Opinion/i, /Interval$/i);
      if (median) {
        const series = [
          seriesOf(b4, median, "median", courtName, mode, 12),
          nationalSeries(b4, median, mode, 12),
        ].filter((s): s is TrendSeries => s != null);
        push(
          finish(
            {
              id: "appeals-median",
              title: "Median months from notice of appeal to final disposition",
              unitText: "Months, 12-month periods",
              unit: "months",
              decimals: 1,
              months: 12,
              series,
              howToRead: `${ROLLING_NOTE} Cases terminated on the merits only.`,
            },
            b4,
            mode,
            [median],
          ),
        );
      }
    }
  }
  for (const [tableKey, months] of [
    ["f-2", 12],
    ["f-2-three-months", 3],
  ] as const) {
    for (const f of trends.bankruptcy.filter((t) => t.tableKey === tableKey)) {
      // The "all chapters" column is headed "Total Filings" in the editions to 2018 and "Total All Chapters" from 2019; chapters 7, 11
      // and 13 keep one heading throughout. The quarterly chart ignores the fiscal-year toggle: it draws every published quarter.
      const shown: PeriodMode = months === 3 ? "rolling" : mode;
      const allCols = [col(f, /^Total All Chapters/i), col(f, /^Total Filings$/i)];
      const cols = [
        ...allCols,
        col(f, /^Total Chapter 7\b/i),
        col(f, /^Total Chapter 11\b/i),
        col(f, /^Total Chapter 13\b/i),
      ];
      const all = joinedSeriesOf(f, allCols, "ch0", "All chapters", shown, months);
      const series = [
        all.series,
        ...(
          [
            [cols[2], "Chapter 7"],
            [cols[3], "Chapter 11"],
            [cols[4], "Chapter 13"],
          ] as const
        ).map(([c, label], i) => (c ? seriesOf(f, c, `ch${i + 1}`, label, shown, months) : null)),
      ].filter((s): s is TrendSeries => s != null);
      const join = all.joined
        ? ' The all-chapters line joins two headings of the same table: "Total Filings" in the editions to 2018 and "Total All Chapters" from 2019.'
        : "";
      push(
        finish(
          {
            id: months === 3 ? "bankruptcy-quarterly" : "bankruptcy",
            title:
              months === 3
                ? "Bankruptcy cases filed each quarter, by chapter"
                : "Bankruptcy cases filed, by chapter",
            unitText:
              months === 3
                ? "Bankruptcy cases, 3-month periods"
                : "Bankruptcy cases, 12-month periods",
            unit: "count",
            decimals: 0,
            months,
            series,
            howToRead:
              (months === 3
                ? "Each point covers the three months ending on the date shown, as published in Bankruptcy Filings; the period toggle does not change it."
                : ROLLING_NOTE) +
              " Counts are for the bankruptcy court of this district; chapters 9, 12 and 15 are in the published table but not charted here." +
              join,
          },
          f,
          shown,
          cols,
        ),
      );
    }
  }
  return charts;
}
