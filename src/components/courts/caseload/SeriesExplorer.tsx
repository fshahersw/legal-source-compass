/**
 * Published tables tab of /courts/caseload: every U.S. Courts statistical table series the platform holds (Judicial
 * Business, Statistical Tables for the Federal Judiciary, Federal Judicial Caseload Statistics, Bankruptcy Filings, BAPCPA
 * and Wiretap report tables). Choose a series, then the row or court, the column and which publication's periods to show;
 * the trend, its data table and the source file of every period follow. Court tables add a comparison of every court in
 * the latest period. Every figure is the cell the publisher printed; a dash or a missing cell is a gap.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import {
  ChartFrame,
  LineTrend,
  RankedBars,
  longDate,
  type ChartStatus,
  type TableSpec,
  type TrendSeriesInput,
} from "@/components/charts";
import { Panel, Segmented, StateNote } from "@/components/enforcement/parts";
import type { UstNationalTable } from "@/lib/external/uscourtsTables.functions";
import { cn } from "@/lib/utils";
import { FilterSelect, RetryNote, SearchBox, TableScroll } from "./CaseloadParts";
import {
  coverageQuery,
  seriesCourtsQuery,
  seriesDetailQuery,
  seriesLatestQuery,
  seriesListQuery,
  seriesNamesQuery,
  seriesTableQuery,
} from "./caseloadQueries";
import type { CaseloadSearch } from "./caseloadSearch";
import {
  GEOGRAPHY,
  PUB_NAMES,
  RECONCILE_TEXT,
  TABLES_PAGE,
  breakAnnotations,
  buildAxis,
  columnDisplay,
  compareTables,
  defaultPub,
  formatterFor,
  matchesQuery,
  periodIndices,
  periodText,
  shortPeriods,
  pubCounts,
  rankingItems,
  shortName,
  unitText,
  type SeriesCard,
  type SeriesDataset,
  type SeriesDetail,
} from "./seriesModel";

type TabProps = {
  search: CaseloadSearch;
  onSearch: (patch: Partial<CaseloadSearch>) => void;
};

const CIRCUIT = /^ca(dc|fc|\d{1,2})$/;
const DEFAULT_SERIES = ["c", "f-2-three-months", "b"];

export function SeriesExplorer({ search, onSearch }: TabProps) {
  const list = useQuery(seriesListQuery);
  const cards = useMemo(
    () =>
      [...(list.data?.cards ?? [])].sort(
        (a, b) => compareTables(a.table, b.table) || a.tableKey.localeCompare(b.tableKey),
      ),
    [list.data],
  );
  const pubs = useMemo(() => [...new Set(cards.flatMap((c) => c.pubs))], [cards]);
  const shown = cards.filter(
    (c) =>
      matchesQuery(c, search.q) &&
      (!search.fpub || c.pubs.includes(search.fpub)) &&
      (!search.fscope || c.scope === search.fscope),
  );
  if (list.isLoading) return <StateNote>Loading the published table series…</StateNote>;
  if (list.isError)
    return (
      <RetryNote onRetry={() => void list.refetch()}>
        The list of published table series could not be loaded.
      </RetryNote>
    );
  if (!cards.length)
    return <StateNote>No U.S. Courts statistical table series are published yet.</StateNote>;
  const selected =
    cards.find((c) => c.tableKey === search.series) ??
    DEFAULT_SERIES.map((k) => cards.find((c) => c.tableKey === k)).find(Boolean) ??
    cards[0]!;
  const fromCatalog = list.data?.source === "catalog";
  return (
    <div className="grid gap-3 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <section
        aria-label="Table series"
        className="min-w-0 rounded-md border border-border bg-surface"
      >
        <div className="space-y-2 border-b border-border/70 px-3 py-2">
          <h3 className="text-sm font-semibold leading-5">Table series</h3>
          <SearchBox
            value={search.q}
            onChange={(q) => onSearch({ q })}
            label="Search table series"
            placeholder="Table number or words"
          />
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              label="Publication"
              value={search.fpub}
              onChange={(fpub) => onSearch({ fpub })}
              allLabel="All"
              options={pubs.map((p) => ({ id: p, label: PUB_NAMES[p] ?? p }))}
            />
            <FilterSelect
              label="Geography"
              value={search.fscope}
              onChange={(fscope) => onSearch({ fscope })}
              allLabel="All"
              options={(Object.keys(GEOGRAPHY) as (keyof typeof GEOGRAPHY)[]).map((g) => ({
                id: g,
                label: GEOGRAPHY[g],
              }))}
            />
          </div>
          <p className="text-[11px] text-muted-foreground" role="status">
            {shown.length === cards.length
              ? `${cards.length} series`
              : `${shown.length} of ${cards.length} series`}
            {list.data?.dropped ? ` · ${list.data.dropped} could not be read and are left out` : ""}
          </p>
          {fromCatalog ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              Listed from the published table catalog. Coverage and reconciliation per series appear
              once the series index is published.
            </p>
          ) : null}
        </div>
        <TableScroll label="Table series list" maxHeight="max-h-[34rem]">
          {shown.length ? (
            <ul className="divide-y divide-border/60">
              {shown.map((c) => (
                <li key={c.tableKey}>
                  <button
                    type="button"
                    aria-pressed={c.tableKey === selected.tableKey}
                    onClick={() =>
                      onSearch({
                        series: c.tableKey,
                        row: undefined,
                        col: undefined,
                        court: undefined,
                        cmp: undefined,
                        pub: undefined,
                      })
                    }
                    className={cn(
                      "block w-full px-3 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                      c.tableKey === selected.tableKey && "bg-muted",
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">Table {c.table}</span>
                      {c.held ? (
                        <span className="shrink-0 text-[10px] text-warning-foreground">
                          {c.held} held
                        </span>
                      ) : null}
                    </span>
                    <span className="line-clamp-2 text-foreground/90">{c.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {c.geography} · {c.periods} {c.periods === 1 ? "period" : "periods"} ·{" "}
                      {c.first.slice(0, 4)}–{c.last.slice(0, 4)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              No series match these filters.
            </p>
          )}
        </TableScroll>
      </section>
      <div className="min-w-0 space-y-3">
        <SeriesView
          key={selected.tableKey}
          card={selected}
          fromIndex={!fromCatalog}
          search={search}
          onSearch={onSearch}
        />
        {!fromCatalog ? <PublicationCoverage /> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ one series

function useNames(dataset: SeriesDataset | null, tableKey: string, enabled: boolean) {
  const q = useQuery({
    ...seriesNamesQuery(dataset ?? "uscourts_tables_district", tableKey),
    enabled: enabled && !!dataset,
  });
  return useMemo(
    () => new Map((q.data ?? []).map((n) => [n.id, shortName(n.name)] as const)),
    [q.data],
  );
}

function SeriesView({
  card,
  fromIndex,
  search,
  onSearch,
}: { card: SeriesCard; fromIndex: boolean } & TabProps) {
  const national = useQuery({
    ...seriesTableQuery(
      card.national?.dataset ?? "uscourts_tables_national",
      card.national?.id ?? card.tableKey,
    ),
    enabled: !!card.national,
  });
  const detail = useQuery({ ...seriesDetailQuery(card.tableKey), enabled: fromIndex });
  const courtScope = card.scope !== "category" && card.scope !== "county";
  const courtsDs = card.courtsDataset;
  const circuitDs: SeriesDataset | null =
    card.scope === "appeals"
      ? courtsDs
      : card.family === "tables"
        ? "uscourts_tables_circuit"
        : courtsDs;
  const courtNames = useNames(courtsDs, card.tableKey, courtScope);
  const circuitNames = useNames(circuitDs, card.tableKey, courtScope && circuitDs !== courtsDs);
  const names = useMemo(
    () => new Map([...courtNames, ...circuitNames]),
    [courtNames, circuitNames],
  );

  const table = national.data?.kind === "national" ? national.data.table : null;
  if (national.isLoading) return <StateNote>Loading Table {card.table}…</StateNote>;
  if (national.isError)
    return (
      <RetryNote onRetry={() => void national.refetch()}>
        Table {card.table} could not be loaded.
      </RetryNote>
    );
  if (!table)
    return <StateNote>Table {card.table} has no stored national record to chart.</StateNote>;
  return (
    <SeriesCharts
      card={card}
      table={table}
      detail={detail.data ?? null}
      names={names}
      circuitDs={circuitDs}
      search={search}
      onSearch={onSearch}
    />
  );
}

function SeriesCharts({
  card,
  table,
  detail,
  names,
  circuitDs,
  search,
  onSearch,
}: {
  card: SeriesCard;
  table: UstNationalTable;
  detail: SeriesDetail | null;
  names: ReadonlyMap<string, string>;
  circuitDs: SeriesDataset | null;
} & TabProps) {
  const courtScope = card.scope !== "category" && card.scope !== "county";
  const periods = table.periods;
  const choices = pubCounts(periods);
  const choice =
    search.pub && (search.pub === "all" || choices.some((c) => c.pub === search.pub))
      ? search.pub
      : defaultPub(periods);
  const idx = periodIndices(periods, choice);
  const axis = buildAxis(periods, idx, choice);
  const col = table.columns.find((c) => c.key === search.col) ?? table.columns[0]!;
  const row =
    card.scope === "category"
      ? (table.rows.find((r) => r.key === search.row) ?? table.rows[0]!)
      : table.rows[0]!;
  const selectedCourts = courtScope
    ? [search.court, ...(search.cmp ?? "").split(",")].filter((c): c is string => !!c)
    : [];
  const unique = [...new Set(selectedCourts)].slice(0, 6);
  const districtIds = unique.filter((c) => !CIRCUIT.test(c) || card.scope === "appeals");
  const circuitIds = card.scope === "appeals" ? [] : unique.filter((c) => CIRCUIT.test(c));
  const courtsQ = useQuery({
    ...seriesCourtsQuery(
      card.courtsDataset ?? "uscourts_tables_district",
      card.tableKey,
      districtIds,
    ),
    enabled: !!card.courtsDataset && districtIds.length > 0,
  });
  const circuitsQ = useQuery({
    ...seriesCourtsQuery(circuitDs ?? "uscourts_tables_circuit", card.tableKey, circuitIds),
    enabled: !!circuitDs && circuitIds.length > 0,
  });
  const courtTables = [...(courtsQ.data ?? []), ...(circuitsQ.data ?? [])];
  const loadingCourts =
    (districtIds.length > 0 && courtsQ.isLoading) || (circuitIds.length > 0 && circuitsQ.isLoading);
  const failedCourts = courtsQ.isError || circuitsQ.isError;

  const label = (id: string) => names.get(id) ?? id.toUpperCase();
  const series: TrendSeriesInput[] = [];
  const valueAt = (t: { periods: { end: string }[]; data: Record<string, (number | null)[]> }) => {
    const m = new Map<string, number | null>();
    t.periods.forEach((p, i) => m.set(p.end, t.data[col.key]?.[i] ?? null));
    return m;
  };
  if (!unique.length) {
    const m = valueAt({ periods, data: row.data });
    series.push({
      id: row.key,
      label: card.scope === "category" ? row.label : "United States (Total row)",
      points: idx.map((i) => ({ key: periods[i]!.end, value: m.get(periods[i]!.end) ?? null })),
    });
  } else {
    for (const id of unique) {
      const t = courtTables.find((x) => x.court === id);
      const m = t ? valueAt(t) : new Map<string, number | null>();
      series.push({
        id,
        label: label(id),
        points: idx.map((i) => ({ key: periods[i]!.end, value: m.get(periods[i]!.end) ?? null })),
      });
    }
  }
  const formatter = formatterFor(col.unit, col.decimals);
  const colText = columnDisplay(col.label, col.key);
  const recorded = series.some((s) => s.points.some((p) => p.value != null));
  const held = detail?.rec?.held ?? [];
  const short = shortPeriods(periods, idx);
  const status: ChartStatus = loadingCourts
    ? { kind: "loading" }
    : failedCourts
      ? {
          kind: "error",
          message: "The selected courts could not be loaded.",
          onRetry: () => void (courtsQ.refetch(), circuitsQ.refetch()),
        }
      : recorded
        ? { kind: "ready" }
        : {
            kind: "empty",
            reason: "The table prints no figure in this column for the periods shown.",
          };
  const latestSource = table.sources[periods[periods.length - 1]!.src];
  const sources = [
    ...(latestSource?.page
      ? [{ label: `U.S. Courts, Table ${card.table} (latest period page)`, url: latestSource.page }]
      : []),
    { label: "U.S. Courts caseload statistics data tables", url: TABLES_PAGE },
  ];
  const first = periods[idx[0] ?? 0]!;
  const last = periods[idx[idx.length - 1] ?? periods.length - 1]!;
  const dataTable: TableSpec = {
    caption: `Table ${card.table}, ${colText}`,
    columns: [
      { label: "Period", align: "left" },
      { label: "Publication", align: "left" },
      ...series.map((s) => ({ label: s.label })),
      { label: "File", align: "left" },
    ],
    rows: [...idx].reverse().map((i) => {
      const p = periods[i]!;
      const src = table.sources[p.src];
      return {
        key: p.end + p.pub,
        cells: [
          periodText(p),
          PUB_NAMES[p.pub] ?? p.pub,
          ...series.map((s) =>
            formatter.full(s.points.find((pt) => pt.key === p.end)?.value ?? null),
          ),
          src?.url ? (
            <a
              key="f"
              href={src.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              {src.format ? src.format.toUpperCase() : "File"}
            </a>
          ) : (
            "Not recorded"
          ),
        ],
      };
    }),
  };
  const notes = [
    "Each point is the figure printed in that period's own edition of the table; a later edition's revised figure for the same period is not used.",
    choice === "all"
      ? "All publications: points are overlapping 12-month windows ending in different months (and, for quarterly tables, 3-month periods); they are not to be added together."
      : `${PUB_NAMES[choice] ?? choice} only: one point per edition.`,
    "A gap is a period whose table prints no figure in this column (a dash or no cell), never zero.",
  ];
  const footnotes = [
    ...(detail?.rec
      ? [
          `Reconciliation: ${RECONCILE_TEXT[detail.rec.status] ?? detail.rec.status}${detail.rec.tests ? ` (${detail.rec.passed.toLocaleString("en-US")} of ${detail.rec.tests.toLocaleString("en-US")} tests hold)` : ""}.`,
        ]
      : []),
    ...(table.breaks.length
      ? [
          `${table.breaks.length} changes of columns, title, footnotes or source format between editions are recorded; column and title changes are marked on the chart.`,
        ]
      : []),
  ];
  const geoOptions = courtScope ? courtOptions(card, names) : [];
  return (
    <div className="space-y-3">
      <header className="rounded-md border border-border bg-surface px-3 py-2">
        <h3 className="text-sm font-semibold leading-5">
          Table {card.table}: {table.title}
        </h3>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {card.geography} · {periods.length} periods ending {longDate(periods[0]!.end)} to{" "}
          {longDate(periods[periods.length - 1]!.end)} ·{" "}
          {choices.map((c) => `${PUB_NAMES[c.pub] ?? c.pub} (${c.n})`).join(", ")}
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <LabeledSelect
            label="Column"
            value={col.key}
            onChange={(v) => onSearch({ col: v })}
            options={table.columns.map((c) => ({
              id: c.key,
              label: columnDisplay(c.label, c.key),
            }))}
          />
          {card.scope === "category" ? (
            <LabeledSelect
              label="Row"
              value={row.key}
              onChange={(v) => onSearch({ row: v })}
              options={table.rows.map((r) => ({
                id: r.key,
                label: `${"– ".repeat(Math.min(r.depth, 4))}${r.label}`,
              }))}
            />
          ) : null}
          {courtScope ? (
            <LabeledSelect
              label="Geography"
              value={search.court ?? ""}
              onChange={(v) => onSearch({ court: v || undefined })}
              options={[{ id: "", label: "United States (Total row)" }, ...geoOptions]}
            />
          ) : null}
          {courtScope && search.court ? (
            <LabeledSelect
              label="Compare with"
              value=""
              onChange={(v) => {
                if (!v) return;
                const next = [...new Set([...(search.cmp ?? "").split(",").filter(Boolean), v])]
                  .filter((x) => x !== search.court)
                  .slice(0, 5);
                onSearch({ cmp: next.join(",") || undefined });
              }}
              options={[
                { id: "", label: "Add a court…" },
                ...geoOptions.filter(
                  (o) => o.id !== search.court && !(search.cmp ?? "").split(",").includes(o.id),
                ),
              ]}
            />
          ) : null}
        </div>
        {search.cmp ? (
          <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Compared courts">
            {search.cmp.split(",").map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() =>
                    onSearch({
                      cmp:
                        (search.cmp ?? "")
                          .split(",")
                          .filter((x) => x !== id)
                          .join(",") || undefined,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Remove ${label(id)} from the comparison`}
                >
                  {label(id)}
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      <ChartFrame
        title={`${colText}: ${unique.length ? (unique.length === 1 ? label(unique[0]!) : `${unique.length} courts`) : series[0]!.label}`}
        unit={unitText(col.unit)}
        period={`Periods ending ${longDate(first.end)} to ${longDate(last.end)}`}
        sources={sources}
        status={status}
        partialNotice={
          [
            held.length
              ? `${held.length} ${held.length === 1 ? "edition fails" : "editions fail"} the table's own printed totals and ${held.length === 1 ? "is" : "are"} left out: ${held.map((h) => `${PUB_NAMES[h.pub] ?? h.pub}, ${longDate(h.end)}`).join("; ")}.`
              : "",
            short.length
              ? `Not a full period: ${short.map((p) => `${longDate(p.end)} (${p.text})`).join("; ")}.`
              : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        notes={notes}
        footnotes={footnotes}
        table={dataTable}
        minHeight={220}
        actions={
          choices.length > 1 ? (
            <Segmented
              label="Periods shown"
              value={choice}
              onChange={(v) => onSearch({ pub: v })}
              options={[
                ...choices.map((c) => ({ id: c.pub, label: c.pub })),
                { id: "all", label: "All" },
              ]}
            />
          ) : undefined
        }
      >
        <div className="px-3 pb-2 pt-1">
          <LineTrend
            series={series}
            axis={axis}
            formatter={formatter}
            ariaLabel={`${colText}, ${series.map((s) => s.label).join(", ")}, ${periodText(first)} to ${periodText(last)}`}
            annotations={breakAnnotations(table.breaks, periods, axis.keys)}
            zero={col.unit === "count"}
            height={240}
          />
        </div>
      </ChartFrame>
      {courtScope && card.latest ? (
        <CourtComparison
          card={card}
          colKey={col.key}
          colLabel={colText}
          table={table}
          names={names}
          selected={search.court}
          onSelect={(court) => onSearch({ court })}
        />
      ) : null}
      {detail ? <SeriesCoverage detail={detail} /> : null}
    </div>
  );
}

function courtOptions(card: SeriesCard, names: ReadonlyMap<string, string>) {
  const entries = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const circuits = entries.filter(([id]) => CIRCUIT.test(id) && card.scope !== "appeals");
  const courts = entries.filter(([id]) => !(CIRCUIT.test(id) && card.scope !== "appeals"));
  return [
    ...circuits.map(([id, name]) => ({ id, label: `Circuit roll-up: ${name}` })),
    ...courts.map(([id, name]) => ({ id, label: name })),
  ];
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  const id = `sel-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-0.5">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full max-w-[22rem] rounded-md border border-border bg-background px-1.5 text-xs focus-visible:outline-2 focus-visible:outline-ring"
      >
        {options.map((o) => (
          <option key={o.id || "none"} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ court comparison

function CourtComparison({
  card,
  colKey,
  colLabel,
  table,
  names,
  selected,
  onSelect,
}: {
  card: SeriesCard;
  colKey: string;
  colLabel: string;
  table: UstNationalTable;
  names: ReadonlyMap<string, string>;
  selected: string | undefined;
  onSelect: (court: string) => void;
}) {
  const latest = useQuery({
    ...seriesLatestQuery(card.latest!.dataset, card.tableKey),
    enabled: !!card.latest,
  });
  const l = latest.data ?? null;
  const col = l?.cols.find((c) => c.k === colKey) ?? null;
  const items = l ? rankingItems(l, colKey, names) : [];
  const ranked = items.filter((i) => i.value != null);
  const natIndex = l ? table.periods.findIndex((p) => p.end === l.end) : -1;
  const natValue = natIndex >= 0 ? (table.rows[0]?.data[colKey]?.[natIndex] ?? null) : null;
  const formatter = formatterFor(col?.unit ?? "count", col?.dec ?? null);
  const latestPeriod = l ? table.periods.find((p) => p.end === l.end) : undefined;
  const status: ChartStatus = latest.isLoading
    ? { kind: "loading" }
    : latest.isError
      ? { kind: "error", onRetry: () => void latest.refetch() }
      : !l
        ? { kind: "empty", reason: "No latest-period comparison is stored for this table." }
        : !ranked.length
          ? {
              kind: "empty",
              reason: "This column is not printed for the courts in the latest period.",
            }
          : { kind: "ready" };
  const rankedSorted = [...ranked].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const tableSpec: TableSpec = {
    caption: `${colLabel} by court`,
    columns: [{ label: "Court", align: "left" }, { label: colLabel }],
    rows: [...rankedSorted, ...items.filter((i) => i.value == null)].map((i) => ({
      key: i.id,
      cells: [i.label, formatter.full(i.value)],
    })),
  };
  const isAverage = col ? col.unit !== "count" : false;
  return (
    <ChartFrame
      title={`${colLabel}: every court${latestPeriod ? `, ${periodText(latestPeriod)}` : ""}`}
      unit={col ? unitText(col.unit) : undefined}
      period={
        l
          ? `Latest period, ${PUB_NAMES[latestPeriod?.pub ?? ""] ?? ""}`.replace(/, $/, "")
          : undefined
      }
      sources={[{ label: "U.S. Courts caseload statistics data tables", url: TABLES_PAGE }]}
      status={status}
      notes={[
        "Bars rank the courts by the figure printed in the latest edition; select a bar to chart that court over time.",
        isAverage
          ? "This column is a rate, average or share: courts of very different sizes are compared on the printed figure, not weighted."
          : "Counts reflect court size; compare a court with its own history before reading a rank as a trend.",
      ]}
      footnotes={
        natValue != null
          ? [
              isAverage
                ? `The vertical line is the national figure printed in the same edition (${formatter.full(natValue)}).`
                : `The national Total row of the same edition prints ${formatter.full(natValue)}.`,
            ]
          : []
      }
      table={tableSpec}
      minHeight={260}
    >
      <div className="px-3 pb-2 pt-1">
        <RankedBars
          items={items}
          formatter={formatter}
          ariaLabel={`${colLabel} by court, latest period`}
          references={natValue != null && isAverage ? [{ label: "National", value: natValue }] : []}
          highlight={selected ?? null}
          onSelect={onSelect}
          limit={20}
        />
      </div>
    </ChartFrame>
  );
}

// ------------------------------------------------------------------------------------------------ coverage

function SeriesCoverage({ detail }: { detail: SeriesDetail }) {
  const c = detail.coverage;
  const rec = detail.rec;
  return (
    <Panel
      title={`Coverage and checks: Table ${detail.table}`}
      subtitle="Listing rows of this table number in every publication, and how its editions reconcile with their own totals"
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2 text-xs sm:grid-cols-4">
        {[
          ["Listed", c["listed"]],
          ["Acquired", c["acquired"]],
          ["Parsed", c["parsed"]],
          ["Published here", c["published"]],
          ["Held", c["held"]],
          ["Same period from another publication", c["duplicate"]],
          ["Published by another dataset", c["other_stream"]],
          ["Not published", c["not_published"]],
        ].map(([k, v]) => (
          <div key={String(k)} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="tabular-nums">
              {typeof v === "number" ? v.toLocaleString("en-US") : "Not recorded"}
            </dd>
          </div>
        ))}
      </dl>
      {rec ? (
        <div className="space-y-1 border-t border-border/60 px-3 py-2 text-xs">
          <p>
            {RECONCILE_TEXT[rec.status] ?? rec.status}
            {rec.tests
              ? `: ${rec.passed.toLocaleString("en-US")} of ${rec.tests.toLocaleString("en-US")} sum tests hold on the published periods`
              : ""}
            {rec.exceedsParts
              ? `; ${rec.exceedsParts.toLocaleString("en-US")} totals are larger than their printed parts (the total also counts parts the table does not list)`
              : ""}
            .
          </p>
          {rec.held.length ? (
            <ul className="space-y-0.5">
              {rec.held.map((h) => (
                <li key={h.end + h.pub} className="flex items-start gap-1.5">
                  <AlertTriangle
                    className="mt-0.5 size-3 shrink-0 text-warning-foreground"
                    aria-hidden
                  />
                  <span>
                    Held: {PUB_NAMES[h.pub] ?? h.pub}, {longDate(h.end)}. {h.failureCount}{" "}
                    {h.failureCount === 1 ? "test fails" : "tests fail"}
                    {h.failures[0]
                      ? ` (first: printed ${h.failures[0].printed.toLocaleString("en-US")}, parts add up to ${h.failures[0].sum.toLocaleString("en-US")})`
                      : ""}
                    .{" "}
                    {h.replacedBy
                      ? `The period is shown from ${PUB_NAMES[h.replacedBy] ?? h.replacedBy}.`
                      : "The period is a gap."}{" "}
                    {h.url ? (
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        Edition file
                      </a>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {detail.duplicates.length ? (
            <p className="text-muted-foreground">
              {detail.duplicates.length} periods are printed by two publications; the one shown is
              the first of Judicial Business, the Statistical Tables, Caseload Statistics and
              Bankruptcy Filings.
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function PublicationCoverage() {
  const cov = useQuery(coverageQuery);
  const [open, setOpen] = useState(false);
  if (cov.isLoading || cov.isError || !cov.data) return null;
  const rows = cov.data.publications;
  return (
    <Panel
      title="Coverage of the U.S. Courts statistical publications"
      subtitle={`Every table and period the U.S. Courts lists, and how much of it is acquired, read and published${cov.data.generatedAt ? ` (as of ${longDate(cov.data.generatedAt.slice(0, 10))})` : ""}`}
      actions={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          {open ? "Hide" : "Show"} by publication
        </button>
      }
    >
      <p className="px-3 py-2 text-xs">
        {(cov.data.totals["listed"] ?? 0).toLocaleString("en-US")} table-periods listed;{" "}
        {(cov.data.totals["acquired"] ?? 0).toLocaleString("en-US")} acquired;{" "}
        {(cov.data.totals["parsed"] ?? 0).toLocaleString("en-US")} read;{" "}
        {(cov.data.totals["published"] ?? 0).toLocaleString("en-US")} published in these series,{" "}
        {(cov.data.totals["other_stream"] ?? 0).toLocaleString("en-US")} in other datasets of the
        platform, {(cov.data.totals["held"] ?? 0).toLocaleString("en-US")} held.
      </p>
      {open ? (
        <TableScroll label="Coverage by publication" maxHeight="max-h-80">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-muted-foreground">
                {[
                  "Publication",
                  "Listed",
                  "Acquired",
                  "Read",
                  "Published here",
                  "Other dataset",
                  "Held",
                  "Gap",
                ].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={cn("px-3 py-1 font-medium", i ? "text-right" : "text-left")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.code} className="border-b border-border/50">
                  <th scope="row" className="px-3 py-0.5 text-left font-normal">
                    {p.page ? (
                      <a
                        href={p.page}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {p.title}
                      </a>
                    ) : (
                      p.title
                    )}
                  </th>
                  {[
                    "listed",
                    "acquired",
                    "parsed",
                    "published",
                    "other_stream",
                    "held",
                    "not_published",
                  ].map((k) => (
                    <td key={k} className="px-3 py-0.5 text-right tabular-nums">
                      {(p.counts[k] ?? 0).toLocaleString("en-US")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : null}
    </Panel>
  );
}
