/**
 * Bankruptcy filings tab of /courts/caseload, from the U.S. Courts Bankruptcy Filings tables: cases filed nationally in each
 * quarter (Table F-2, three months) with the newest quarter marked, cases filed in the 12 months ending each quarter (Table
 * F-2, from Bankruptcy Filings, Judicial Business, the Statistical Tables and Caseload Statistics), every bankruptcy court in
 * the newest quarter, and one court's quarterly trend. Figures are as printed; the publisher renamed the total columns in
 * September 2018 ("Total Filings" became "Total All Chapters"), and the two are shown as one line only because no period
 * prints both; the change is marked on the chart.
 */
import { useQuery } from "@tanstack/react-query";
import {
  BarTrend,
  ChartFrame,
  LineTrend,
  RankedBars,
  formatPercentChange,
  longDate,
  type ChartStatus,
  type TableSpec,
} from "@/components/charts";
import { Kpi, Segmented, StateNote } from "@/components/enforcement/parts";
import type {
  UstNationalTable,
  UstPeriod,
  UstSource,
} from "@/lib/external/uscourtsTables.functions";
import { RetryNote } from "./CaseloadParts";
import {
  seriesCourtsQuery,
  seriesLatestQuery,
  seriesNamesQuery,
  seriesTableQuery,
} from "./caseloadQueries";
import { MEASURES, type CaseloadSearch } from "./caseloadSearch";
import {
  PUB_NAMES,
  TABLES_PAGE,
  buildAxis,
  formatterFor,
  periodIndices,
  periodText,
  BANKRUPTCY_MEASURES as SPECS,
  measureSeries,
  sameQuarterYearEarlier,
  shortName,
  type Measure,
} from "./seriesModel";

type TabProps = { search: CaseloadSearch; onSearch: (patch: Partial<CaseloadSearch>) => void };
const MEASURE_OPTIONS = MEASURES.map((id) => ({
  id,
  label: {
    total: "All",
    business: "Business",
    nonbusiness: "Nonbusiness",
    ch7: "Ch. 7",
    ch11: "Ch. 11",
    ch13: "Ch. 13",
  }[id],
}));
const BANKRUPTCY_DS = "uscourts_tables_bankruptcy" as const;
const QUARTERLY = "f-2-three-months";
const count = formatterFor("count", 0);

/** The first period printed under the newer heading, for the chart's marker. */
function renameAt(
  periods: readonly UstPeriod[],
  printed: readonly (string | null)[],
  spec: (typeof SPECS)[Measure],
) {
  if (spec.printed.length < 2) return null;
  const i = printed.findIndex((p) => p === spec.printed[1]);
  return i > 0 ? periods[i]!.end : null;
}

/** The combined Arkansas row ("AR" in the tables): one row for the Eastern and Western districts, never split between them. */
const ARCOMB = "arcomb";
const ARCOMB_LABEL = "Arkansas, E.D. and W.D. (one row)";

/** A bankruptcy court's name as its records title it; a combined row takes its own label. */
function courtLabel(
  id: string,
  names: ReadonlyMap<string, string>,
  combined?: Record<string, { label: string }>,
) {
  if (combined?.[id]) return id === ARCOMB ? ARCOMB_LABEL : combined[id]!.label;
  if (id === ARCOMB) return ARCOMB_LABEL;
  return names.get(id) ?? id.toUpperCase();
}

function fileCell(src: UstSource | undefined) {
  return src?.url ? (
    <a
      href={src.url}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline-offset-2 hover:underline"
    >
      {src.format ? src.format.toUpperCase() : "File"}
    </a>
  ) : (
    "Not recorded"
  );
}

/** E.D. or W.D. Arkansas: from `from` the tables print the two districts in one row; a link to that row (never split). */
function CombinedRowNote({
  court,
  reported,
  onSelect,
}: {
  court: string;
  reported: { court: string; label: string; from: string; lastOwn: string | null };
  onSelect: (court: string) => void;
}) {
  return (
    <StateNote
      action={
        <button
          type="button"
          onClick={() => onSelect(reported.court)}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Show {ARCOMB_LABEL}
        </button>
      }
    >
      {`From the quarter ending ${longDate(reported.from)} the table prints ${court === "ared" ? "E.D." : court === "arwd" ? "W.D." : "this court\u2019s"} Arkansas figures only in one row for the Eastern and Western districts together${reported.lastOwn ? `; this court\u2019s own row ends with the quarter ending ${longDate(reported.lastOwn)}` : ""}. The combined row is not split between the districts.`}
    </StateNote>
  );
}

export function BankruptcyTab({ search, onSearch }: TabProps) {
  const measure: Measure = (MEASURES as readonly string[]).includes(search.measure ?? "")
    ? (search.measure as Measure)
    : "total";
  const quarterly = useQuery(seriesTableQuery("uscourts_tables_national", QUARTERLY));
  const rolling = useQuery(seriesTableQuery("uscourts_tables_national", "f-2"));
  if (quarterly.isLoading) return <StateNote>Loading the quarterly bankruptcy tables…</StateNote>;
  if (quarterly.isError)
    return (
      <RetryNote onRetry={() => void quarterly.refetch()}>
        The quarterly bankruptcy table could not be loaded.
      </RetryNote>
    );
  const q = quarterly.data?.kind === "national" ? quarterly.data.table : null;
  if (!q)
    return (
      <StateNote>
        The quarterly bankruptcy filings table (F-2, three months) is not published yet.
      </StateNote>
    );
  const r = rolling.data?.kind === "national" ? rolling.data.table : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Measure</span>
        <Segmented
          label="Measure"
          value={measure}
          onChange={(m) => onSearch({ measure: m === "total" ? undefined : m })}
          options={MEASURE_OPTIONS}
        />
      </div>
      <QuarterlyNational table={q} measure={measure} />
      <RollingNational
        table={r}
        loading={rolling.isLoading}
        failed={rolling.isError}
        retry={() => void rolling.refetch()}
        measure={measure}
      />
      <DistrictQuarter
        measure={measure}
        selected={search.court}
        onSelect={(court) => onSearch({ court })}
      />
      {search.court ? (
        <DistrictTrend
          court={search.court}
          measure={measure}
          onClear={() => onSearch({ court: undefined })}
          onSelect={(court) => onSearch({ court })}
        />
      ) : null}
    </div>
  );
}

function QuarterlyNational({ table, measure }: { table: UstNationalTable; measure: Measure }) {
  const spec = SPECS[measure];
  const periods = table.periods;
  const total = table.rows[0]!;
  const m = measureSeries(total.data, measure, periods.length);
  const idx = periodIndices(periods, "all");
  const axis = buildAxis(periods, idx, "BF");
  const newest = periods[periods.length - 1]!;
  const change = sameQuarterYearEarlier(periods, m.values);
  const rename = renameAt(periods, m.printed, spec);
  const annotations = [
    ...(rename ? [{ key: rename, label: "Heading renamed" }] : []),
    { key: newest.end, label: "Newest" },
  ];
  const status: ChartStatus = m.values.some((v) => v != null)
    ? { kind: "ready" }
    : { kind: "empty", reason: "No quarter prints this measure." };
  const dataTable: TableSpec = {
    caption: `${spec.label} in each quarter, United States`,
    columns: [
      { label: "Quarter", align: "left" },
      { label: "Cases" },
      { label: "Column as printed", align: "left" },
      { label: "File", align: "left" },
    ],
    rows: [...periods.keys()].reverse().map((i) => ({
      key: periods[i]!.end,
      cells: [
        periodText(periods[i]!),
        count.full(m.values[i]),
        m.printed[i] ?? "Not recorded",
        fileCell(table.sources[periods[i]!.src]),
      ],
    })),
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label={`${spec.label}, quarter ending ${longDate(newest.end)}`}
          value={count.full(m.values[m.values.length - 1])}
          note="Newest quarter published"
        />
        <Kpi
          label={
            change
              ? `Same quarter a year earlier (${longDate(change.priorEnd)})`
              : "Same quarter a year earlier"
          }
          value={change ? count.full(change.prior) : "Not recorded"}
        />
        <Kpi
          label="Change from a year earlier"
          value={change ? count.delta(change.change) : "Not recorded"}
          note={change ? "Newest quarter minus the same quarter a year earlier" : undefined}
        />
        <Kpi
          label="Percent change from a year earlier"
          value={
            change && change.percent != null ? formatPercentChange(change.percent) : "Not recorded"
          }
          note={change ? "(newest − year earlier) ÷ year earlier × 100" : undefined}
        />
      </div>
      <ChartFrame
        title={`${spec.label} in each quarter, United States`}
        unit="cases filed in the three months"
        period={`Quarters ending ${longDate(periods[0]!.end)} to ${longDate(newest.end)}`}
        sources={[
          ...(table.sources[newest.src]?.page
            ? [
                {
                  label: `U.S. Courts, Table F-2 (Three Months), ${longDate(newest.end)}`,
                  url: table.sources[newest.src]!.page!,
                },
              ]
            : []),
          { label: "U.S. Courts caseload statistics data tables", url: TABLES_PAGE },
        ]}
        asOf={`newest quarter ends ${longDate(newest.end)}`}
        status={status}
        notes={[
          "Each bar is the cases filed in the three months ending on the date, from that quarter's own Table F-2 (Three Months).",
          spec.printed.length > 1
            ? `The publisher renamed the column from '${spec.printed[0]}' to '${spec.printed[1]}' from the quarter ending September 30, 2018; no quarter prints both, so they are drawn as one series.`
            : "The column heading is the same in every quarter.",
          "Bankruptcy totals also count a few cases filed under chapters the table does not list separately.",
        ]}
        footnotes={
          m.conflicts.length
            ? [`${m.conflicts.length} quarters print both headings and are left as gaps.`]
            : []
        }
        table={dataTable}
        minHeight={220}
      >
        <div className="px-3 pb-2 pt-1">
          <BarTrend
            series={[
              {
                id: measure,
                label: spec.label,
                points: idx.map((i) => ({ key: periods[i]!.end, value: m.values[i] ?? null })),
              },
            ]}
            axis={axis}
            formatter={count}
            unit="cases"
            ariaLabel={`${spec.label} in each quarter, United States, ${longDate(periods[0]!.end)} to ${longDate(newest.end)}`}
            annotations={annotations}
            height={230}
          />
        </div>
      </ChartFrame>
    </>
  );
}

function RollingNational({
  table,
  loading,
  failed,
  retry,
  measure,
}: {
  table: UstNationalTable | null;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  measure: Measure;
}) {
  const spec = SPECS[measure];
  if (!table) {
    return (
      <ChartFrame
        title={`${spec.label} in the 12 months ending each quarter, United States`}
        sources={[{ label: "U.S. Courts caseload statistics data tables", url: TABLES_PAGE }]}
        status={
          loading
            ? { kind: "loading" }
            : failed
              ? { kind: "error", onRetry: retry }
              : { kind: "empty", reason: "Table F-2 is not published yet." }
        }
      />
    );
  }
  const periods = table.periods;
  const m = measureSeries(table.rows[0]!.data, measure, periods.length);
  const idx = periodIndices(periods, "all");
  const axis = buildAxis(periods, idx, "all");
  const newest = periods[periods.length - 1]!;
  const rename = renameAt(periods, m.printed, spec);
  const dataTable: TableSpec = {
    caption: `${spec.label} in the 12 months ending each quarter, United States`,
    columns: [
      { label: "Period", align: "left" },
      { label: "Publication", align: "left" },
      { label: "Cases" },
      { label: "File", align: "left" },
    ],
    rows: [...periods.keys()].reverse().map((i) => ({
      key: periods[i]!.end,
      cells: [
        periodText(periods[i]!),
        PUB_NAMES[periods[i]!.pub] ?? periods[i]!.pub,
        count.full(m.values[i]),
        fileCell(table.sources[periods[i]!.src]),
      ],
    })),
  };
  return (
    <ChartFrame
      title={`${spec.label} in the 12 months ending each quarter, United States`}
      unit="cases filed in the 12 months"
      period={`12 months ending ${longDate(periods[0]!.end)} to ${longDate(newest.end)}`}
      sources={[{ label: "U.S. Courts caseload statistics data tables", url: TABLES_PAGE }]}
      status={
        m.values.some((v) => v != null)
          ? { kind: "ready" }
          : { kind: "empty", reason: "No period prints this measure." }
      }
      notes={[
        "Each point is a 12-month total printed in the edition for that quarter end: Judicial Business (September), the Statistical Tables (June and December), Caseload Statistics (March) and Bankruptcy Filings (every quarter, from 2009).",
        "Before 2009 only some quarter ends are published, so earlier years show fewer points; a quarter with no edition is a gap.",
        "Overlapping 12-month windows are not added together.",
      ]}
      table={dataTable}
      minHeight={200}
    >
      <div className="px-3 pb-2 pt-1">
        <LineTrend
          series={[
            {
              id: measure,
              label: spec.label,
              points: idx.map((i) => ({ key: periods[i]!.end, value: m.values[i] ?? null })),
            },
          ]}
          axis={axis}
          formatter={count}
          unit="cases"
          ariaLabel={`${spec.label} in the 12 months ending each quarter, United States`}
          annotations={[
            ...(rename ? [{ key: rename, label: "Heading renamed" }] : []),
            { key: newest.end, label: "Newest" },
          ]}
          height={220}
        />
      </div>
    </ChartFrame>
  );
}

function DistrictQuarter({
  measure,
  selected,
  onSelect,
}: {
  measure: Measure;
  selected: string | undefined;
  onSelect: (court: string) => void;
}) {
  const spec = SPECS[measure];
  const latest = useQuery(seriesLatestQuery(BANKRUPTCY_DS, QUARTERLY));
  const names = useQuery(seriesNamesQuery(BANKRUPTCY_DS, QUARTERLY));
  const l = latest.data ?? null;
  const key = l ? spec.keys.find((k) => l.cols.some((c) => c.k === k)) : undefined;
  const nameMap = new Map((names.data ?? []).map((n) => [n.id, shortName(n.name)] as const));
  const items =
    l && key
      ? Object.entries(l.courts).map(([id, v]) => ({
          id,
          label: courtLabel(id, nameMap, l.combined),
          value: v[key] ?? null,
        }))
      : [];
  const status: ChartStatus = latest.isLoading
    ? { kind: "loading" }
    : latest.isError
      ? { kind: "error", onRetry: () => void latest.refetch() }
      : !l || !key
        ? { kind: "empty", reason: "No district comparison is stored for the newest quarter." }
        : { kind: "ready" };
  const sorted = [...items].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return (
    <ChartFrame
      title={`${spec.label} by bankruptcy court${l ? `, quarter ending ${longDate(l.end)}` : ""}`}
      unit="cases filed in the three months"
      period={l ? `Newest quarter, ${periodText({ end: l.end, months: 3 })}` : undefined}
      sources={[{ label: "U.S. Courts caseload statistics data tables", url: TABLES_PAGE }]}
      status={status}
      notes={[
        "The 20 courts with the most cases are drawn; Show data lists every court. Select a bar to chart that court by quarter.",
        "Counts follow the size of each district's population and economy; compare a court with its own history before reading a rank as a trend.",
        l?.combined?.[ARCOMB]
          ? "Arkansas: the table prints one bankruptcy row for the Eastern and Western districts together (\u2018AR\u2019). It is listed once as \u2018Arkansas, E.D. and W.D. (one row)\u2019 and is never split between the two districts or assigned to one of them."
          : "Each bar is one court's row as printed.",
      ]}
      table={{
        caption: `${spec.label} by bankruptcy court`,
        columns: [{ label: "Court", align: "left" }, { label: "Cases" }],
        rows: sorted.map((i) => ({ key: i.id, cells: [i.label, count.full(i.value)] })),
      }}
      minHeight={300}
    >
      <div className="px-3 pb-2 pt-1">
        <RankedBars
          items={items}
          formatter={count}
          unit="cases"
          ariaLabel={`${spec.label} by bankruptcy court, newest quarter`}
          highlight={selected ?? null}
          onSelect={onSelect}
          limit={20}
        />
      </div>
    </ChartFrame>
  );
}

function DistrictTrend({
  court,
  measure,
  onClear,
  onSelect,
}: {
  court: string;
  measure: Measure;
  onClear: () => void;
  onSelect: (court: string) => void;
}) {
  const spec = SPECS[measure];
  const q = useQuery(seriesCourtsQuery(BANKRUPTCY_DS, QUARTERLY, [court]));
  const names = useQuery(seriesNamesQuery(BANKRUPTCY_DS, QUARTERLY));
  const t = q.data?.[0] ?? null;
  const name =
    court === ARCOMB
      ? ARCOMB_LABEL
      : shortName(names.data?.find((n) => n.id === court)?.name ?? court.toUpperCase());
  const combinedFrom = t?.reportedWith ?? null;
  const periods = t?.periods ?? [];
  const m = t ? measureSeries(t.data, measure, periods.length) : null;
  const idx = periodIndices(periods, "all");
  const status: ChartStatus = q.isLoading
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !t || !m?.values.some((v) => v != null)
        ? { kind: "empty", reason: `No quarterly table is stored for ${name}.` }
        : { kind: "ready" };
  const newest = periods[periods.length - 1];
  const change = m ? sameQuarterYearEarlier(periods, m.values) : null;
  return (
    <>
      {combinedFrom ? (
        <CombinedRowNote court={court} reported={combinedFrom} onSelect={onSelect} />
      ) : null}
      <ChartFrame
        title={`${spec.label} in each quarter, ${name}`}
        unit="cases filed in the three months"
        period={
          periods.length
            ? `Quarters ending ${longDate(periods[0]!.end)} to ${longDate(newest!.end)}`
            : undefined
        }
        sources={[
          ...(t && newest && t.sources[newest.src]?.page
            ? [
                {
                  label: `U.S. Courts, Table F-2 (Three Months), ${longDate(newest.end)}`,
                  url: t.sources[newest.src]!.page!,
                },
              ]
            : []),
          { label: "U.S. Courts caseload statistics data tables", url: TABLES_PAGE },
        ]}
        status={status}
        actions={
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Clear court
          </button>
        }
        notes={[
          change
            ? `Quarter ending ${longDate(change.latestEnd)}: ${count.full(change.latest)} cases; ${longDate(change.priorEnd)}: ${count.full(change.prior)} (${change.percent != null ? formatPercentChange(change.percent) : "no percent: zero a year earlier"}).`
            : "The same quarter a year earlier is not printed, so no change is computed.",
          "The court's row as printed in each quarter's Table F-2 (Three Months).",
        ]}
        table={
          t && m
            ? {
                caption: `${spec.label} in each quarter, ${name}`,
                columns: [
                  { label: "Quarter", align: "left" },
                  { label: "Cases" },
                  { label: "File", align: "left" },
                ],
                rows: [...periods.keys()].reverse().map((i) => ({
                  key: periods[i]!.end,
                  cells: [
                    periodText(periods[i]!),
                    count.full(m.values[i]),
                    fileCell(t.sources[periods[i]!.src]),
                  ],
                })),
              }
            : undefined
        }
        minHeight={200}
      >
        {t && m ? (
          <div className="px-3 pb-2 pt-1">
            <LineTrend
              series={[
                {
                  id: court,
                  label: name,
                  points: idx.map((i) => ({ key: periods[i]!.end, value: m.values[i] ?? null })),
                },
              ]}
              axis={buildAxis(periods, idx, "BF")}
              formatter={count}
              unit="cases"
              ariaLabel={`${spec.label} in each quarter, ${name}`}
              annotations={
                newest ? [{ key: newest.end, label: `Newest: ${longDate(newest.end)}` }] : []
              }
              height={200}
            />
          </div>
        ) : null}
      </ChartFrame>
    </>
  );
}
