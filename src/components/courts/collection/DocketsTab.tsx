import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { int } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { Kpi, Panel, Segmented } from "@/components/enforcement/parts";
import { longDate } from "@/components/courts/caseload/caseloadFormat";
import type {
  DocketBreakdown,
  DocketLevel,
  DocketOverview,
  DocketYear,
  Listed,
} from "@/lib/external/clbCollection.functions";
import type { ShareRow } from "@/lib/external/courtCaseload.functions";
import {
  docketBreakdownQuery,
  docketNosQuery,
  docketOverviewQuery,
  docketYearsQuery,
  notesQuery,
} from "./collectionQueries";
import {
  latestCompleteYear,
  NOT_RECORDED,
  partialYearText,
  pct,
  sharePct,
  signedPct,
  spanYears,
  yearTick,
  SERIES_COLORS,
} from "./collectionFormat";
import { docketTakeaways } from "./collectionTakeaways";
import {
  Callout,
  DataTable,
  DrillPanel,
  KpiGrid,
  KpiSkeleton,
  NoteReference,
  NumText,
  PctText,
  QueryPanel,
  SelectLink,
  type Col,
  type TabProps,
} from "./CollectionParts";
import { CourtShareList, ShareBars, YearBars, type BarRow } from "./CollectionVisuals";
import { CorrelationStrip } from "./CorrelationStrip";
import { DocketTablesPanel } from "./DocketTables";

export function DocketsTab({ search, onSearch }: TabProps) {
  const overview = useQuery(docketOverviewQuery);
  const years = useQuery(docketYearsQuery);
  const breakdown = useQuery(docketBreakdownQuery);
  const nos = useQuery(docketNosQuery);
  const notes = useQuery(notesQuery);
  const note = notes.data?.docket ?? null;
  const snapshot = note?.snapshot ?? null;
  const takeaways = useMemo(
    () =>
      docketTakeaways({
        overview: overview.data ?? null,
        years: years.data?.rows ?? [],
        levels: breakdown.data?.levels.rows ?? [],
        states: breakdown.data?.states.rows ?? [],
        nos: nos.data ?? null,
        snapshot,
      }),
    [overview.data, years.data, breakdown.data, nos.data, snapshot],
  );
  return (
    <div className="space-y-3">
      <DocketKpis overview={overview} years={years} snapshot={snapshot} />
      <Callout>
        Counts of rows in CourtListener&apos;s collection
        {longDate(snapshot) ? ` (snapshot of its bulk files, ${longDate(snapshot)})` : ""}, not
        complete court totals: coverage differs by court and year, and a docket row can exist
        without a filing date. {note?.caveats.find((c) => /attorneys/i.test(c)) ?? ""}
      </Callout>
      <KeyTakeaways
        items={takeaways}
        scope={longDate(snapshot) ? `CourtListener collection · ${longDate(snapshot)}` : undefined}
        note="Computed from the figures on this tab. Every share names what it is a share of; the partial year is never compared."
      />
      <YearsPanel
        query={years}
        overview={overview.data ?? null}
        snapshot={snapshot}
        span={search.span}
        onSpan={(span) => onSearch({ span })}
      />
      <LevelsPanel
        breakdown={breakdown}
        total={overview.data?.dockets ?? null}
        search={search}
        onSearch={onSearch}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <CompletenessPanel query={overview} />
        <SourcesPanel query={overview} />
      </div>
      <DocketTablesPanel
        search={search}
        onSearch={onSearch}
        breakdown={breakdown}
        total={overview.data?.dockets ?? null}
        snapshot={snapshot}
      />
      <CorrelationStrip />
      <NoteReference note={note} title="How to read the docket collection" />
    </div>
  );
}

function DocketKpis({
  overview,
  years,
  snapshot,
}: {
  overview: UseQueryResult<DocketOverview | null>;
  years: UseQueryResult<Listed<DocketYear>>;
  snapshot: string | null;
}) {
  if (overview.isLoading) return <KpiSkeleton />;
  const o = overview.data;
  if (overview.isError || !o)
    return (
      <QueryPanel
        query={overview}
        label="Loading the docket totals"
        errorText="The docket totals could not be loaded."
        emptyText="The docket collection totals are not recorded."
      >
        {() => null}
      </QueryPanel>
    );
  const rows = years.data?.rows ?? [];
  const latest = latestCompleteYear(rows);
  const partial = rows.find((y) => y.partial) ?? null;
  const yoy = latest?.yoyPct;
  return (
    <KpiGrid id="collection-kpis" label="Docket collection totals">
      <Kpi
        label="Dockets in the collection"
        value={int(o.dockets)}
        note={`${o.courtsWithDockets != null ? `${int(o.courtsWithDockets)} courts` : "Courts not recorded"}; rows, not complete court totals`}
      />
      <Kpi
        label={latest ? `Filed in ${latest.year}` : "Latest complete year"}
        value={latest ? int(latest.dockets) : NOT_RECORDED}
        note={
          latest
            ? yoy != null
              ? `${signedPct(yoy)} on ${latest.year - 1} as published; latest complete year`
              : "Latest complete year"
            : years.isError
              ? "The year series could not be loaded"
              : undefined
        }
      />
      <Kpi
        label={partial ? `Filed in ${partial.year} so far` : "Year in progress"}
        value={partial ? int(partial.dockets) : NOT_RECORDED}
        note={
          partial
            ? `${partialYearText(snapshot)}; never compared with a full year`
            : "No partial year in this snapshot"
        }
      />
      <Kpi
        label="From RECAP sources"
        value={o.recap == null ? NOT_RECORDED : pct(sharePct(o.recap, o.dockets))}
        note={o.recap == null ? undefined : `${int(o.recap)} of ${int(o.dockets)} dockets`}
      />
      <Kpi
        label="With an assigned judge"
        value={o.assignedJudge == null ? NOT_RECORDED : pct(sharePct(o.assignedJudge, o.dockets))}
        note={
          o.assignedJudge == null
            ? undefined
            : `${int(o.assignedJudge)} of ${int(o.dockets)} dockets`
        }
      />
    </KpiGrid>
  );
}

function YearsPanel({
  query,
  overview,
  snapshot,
  span,
  onSpan,
}: {
  query: UseQueryResult<Listed<DocketYear>>;
  overview: DocketOverview | null;
  snapshot: string | null;
  span: "all" | undefined;
  onSpan: (span: "all" | undefined) => void;
}) {
  return (
    <Panel
      id="collection-years"
      title="Dockets by filing year"
      subtitle="Docket rows by the year of their filing date, split by the case type in the docket number"
      actions={
        <Segmented
          label="Years shown"
          value={span === "all" ? "all" : "recent"}
          options={[
            { id: "recent", label: "Since 1990" },
            { id: "all", label: "All years" },
          ]}
          onChange={(id) => onSpan(id === "all" ? "all" : undefined)}
        />
      }
      footnote={
        <>
          Civil-numbered and criminal-numbered are dockets whose number contains -cv- or -cr-; other
          is every remaining docket, including those with no case type in the number
          {overview?.withoutCaseType != null
            ? ` (${int(overview.withoutCaseType)} of ${int(overview.dockets)} dockets, state-court and older numbers)`
            : ""}
          . Dockets without a filing date (
          {overview?.noFilingDate != null ? int(overview.noFilingDate) : NOT_RECORDED}) are not in
          any year. Volume reflects what CourtListener collected, which grew with RECAP; it is not a
          measure of court activity.
        </>
      }
    >
      <QueryPanel
        query={query}
        label="Loading dockets by year"
        errorText="The docket series by year could not be loaded."
        emptyText="The docket series by year is not recorded."
        isEmpty={(l) => !l.rows.length}
        skeleton={<div className="h-64 animate-pulse bg-muted/50" aria-busy="true" />}
      >
        {(list) => {
          const shown = spanYears(list.rows, span, 1990);
          const partial = shown.find((y) => y.partial);
          const rows: BarRow[] = shown.map((y) => ({
            label: yearTick(y.year, y.partial),
            partial: y.partial,
            values: { civil: y.civil, criminal: y.criminal, other: y.other },
          }));
          return (
            <YearBars
              rows={rows}
              series={[
                { key: "civil", label: "Civil-numbered", color: SERIES_COLORS[0]! },
                { key: "criminal", label: "Criminal-numbered", color: SERIES_COLORS[1]! },
                {
                  key: "other",
                  label: "Other or no case type in the number",
                  color: SERIES_COLORS[2]!,
                },
              ]}
              subject="dockets filed per year in CourtListener's collection"
              note={
                partial ? (
                  <>
                    {yearTick(partial.year, true)}: {partialYearText(snapshot)}, drawn lighter and
                    not compared with complete years
                  </>
                ) : null
              }
              height="h-64"
            />
          );
        }}
      </QueryPanel>
      {query.data?.dropped ? (
        <p
          className="border-t border-border/60 px-3 py-1.5 text-[11px] text-warning-foreground"
          role="status"
        >
          {int(query.data.dropped)} year {query.data.dropped === 1 ? "record" : "records"} could not
          be read and {query.data.dropped === 1 ? "is" : "are"} left out.
        </p>
      ) : null}
    </Panel>
  );
}

// -------------------------------------------------------------------------------------------- court levels

function LevelsPanel({
  breakdown,
  total,
  search,
  onSearch,
}: {
  breakdown: UseQueryResult<DocketBreakdown>;
  total: number | null;
  search: TabProps["search"];
  onSearch: TabProps["onSearch"];
}) {
  return (
    <>
      <Panel
        id="collection-levels"
        title="Court levels"
        subtitle="Dockets by the court level stored for each court. Select a level to see its largest courts."
        footnote="Levels are the codes CourtListener stores for its courts; federal is F, FD, FB, FBP and FS, and state is S, SA, ST, SS and SAG. Shares are of all dockets in the collection. A termination date is recorded for few state dockets, so the termination column reflects what each court's records carry."
      >
        <QueryPanel
          query={breakdown}
          label="Loading court levels"
          errorText="The court-level breakdown could not be loaded."
          emptyText="The court-level breakdown is not recorded."
          isEmpty={(b) => !b.levels.rows.length}
        >
          {(b) => {
            const rows = b.levels.rows.filter((l) => l.dockets > 0);
            const empty = b.levels.rows.length - rows.length;
            const cols: Col<DocketLevel>[] = [
              {
                key: "level",
                label: "Court level",
                render: (l) => (
                  <>
                    <SelectLink
                      search={search}
                      patch={{ level: l.code ?? undefined }}
                      selected={search.level === l.code}
                    >
                      {l.label}
                    </SelectLink>
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      {l.code}
                    </span>
                  </>
                ),
              },
              {
                key: "family",
                label: "Family",
                hideBelow: "lg",
                render: (l) => <span className="capitalize">{l.family}</span>,
              },
              { key: "courts", label: "Courts", align: "right", render: (l) => int(l.courts) },
              { key: "dockets", label: "Dockets", align: "right", render: (l) => int(l.dockets) },
              {
                key: "share",
                label: "% of all",
                title: "Share of all dockets in the collection",
                align: "right",
                render: (l) => <PctText v={sharePct(l.dockets, total)} />,
              },
              {
                key: "recap",
                label: "RECAP %",
                title: "Share of the level's dockets from RECAP (PACER) sources",
                align: "right",
                render: (l) => <PctText v={sharePct(l.recap, l.dockets)} />,
              },
              {
                key: "terminated",
                label: "Terminated %",
                title: "Share of the level's dockets that carry a termination date",
                align: "right",
                hideBelow: "lg",
                render: (l) => <PctText v={sharePct(l.terminated, l.dockets)} />,
              },
              {
                key: "clusters",
                label: "Opinion clusters",
                align: "right",
                hideBelow: "xl",
                render: (l) => <NumText v={l.clusters} />,
              },
            ];
            return (
              <>
                <DataTable
                  label="Court levels"
                  caption="Dockets, courts and shares by court level"
                  columns={cols}
                  rows={rows}
                  rowKey={(l) => l.code ?? l.id}
                  selectedKey={search.level}
                  minWidth="min-w-[36rem]"
                  noun="levels"
                />
                {empty > 0 ? (
                  <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                    {int(empty)} stored {empty === 1 ? "level record has" : "level records have"} no
                    dockets and {empty === 1 ? "is" : "are"} not listed.
                  </p>
                ) : null}
              </>
            );
          }}
        </QueryPanel>
      </Panel>
      <LevelDrill
        breakdown={breakdown}
        total={total}
        level={search.level}
        onClear={() => onSearch({ level: undefined })}
      />
    </>
  );
}

function LevelDrill({
  breakdown,
  total,
  level,
  onClear,
}: {
  breakdown: UseQueryResult<DocketBreakdown>;
  total: number | null;
  level: string | undefined;
  onClear: () => void;
}) {
  const row = level ? (breakdown.data?.levels.rows.find((l) => l.code === level) ?? null) : null;
  return (
    <DrillPanel
      id="collection-level"
      title="Court level drill-down"
      hint="Select a court level in the table to see the courts with the most dockets at that level."
      selected={level}
      ready={!breakdown.isLoading}
      subtitle={
        row
          ? `${row.label}: ${int(row.dockets)} dockets in ${int(row.courts)} courts${total ? `, ${pct(sharePct(row.dockets, total))} of all dockets` : ""}`
          : undefined
      }
      onClear={onClear}
    >
      {row ? (
        <CourtShareList
          id="collection-level-courts"
          caption={`Largest ${row.label.toLowerCase()} courts`}
          countLabel="Dockets in the collection"
          shareLabel="Share of this level's dockets"
          limit={10}
          rows={row.topCourts.map((c) => ({
            courtId: c.courtId,
            name: c.name,
            href: c.href,
            count: c.count,
            sharePct: sharePct(c.count, row.dockets),
          }))}
        />
      ) : (
        <p className="p-3 text-xs text-muted-foreground">
          This court level is not in the loaded breakdown ({NOT_RECORDED}).
        </p>
      )}
    </DrillPanel>
  );
}

// -------------------------------------------------------------------------------------------- completeness and sources

function CompletenessPanel({ query }: { query: UseQueryResult<DocketOverview | null> }) {
  return (
    <Panel
      id="collection-coverage"
      title="Field completeness"
      subtitle="How much of the collection carries each field"
    >
      <QueryPanel
        query={query}
        label="Loading field completeness"
        errorText="The field completeness figures could not be loaded."
        emptyText="Field completeness is not recorded."
      >
        {(o) => {
          const row = (key: string, label: string, n: number | null): ShareRow | null =>
            n == null
              ? null
              : { key, label, count: n, sharePct: sharePct(n, o.dockets), group: null };
          const rows = [
            row("dated", "Filing date on record", o.withFilingDate),
            row("undated", "No filing date", o.noFilingDate),
            row("recap", "From RECAP (PACER) sources", o.recap),
            row("judge", "Assigned judge", o.assignedJudge),
            row("nos", "Nature-of-suit text", o.natureOfSuit),
            row("fjc", "Linked to an FJC IDB record", o.fjcRecord),
          ].filter((r): r is ShareRow => r != null);
          return (
            <>
              <ShareBars
                id="collection-completeness-list"
                caption="Field completeness"
                countLabel="Dockets with the field"
                rows={rows}
                limit={6}
              />
              <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
                Each row is a share of all {int(o.dockets)} dockets, and the rows overlap.
                {o.implausibleDates != null
                  ? ` ${int(o.implausibleDates)} dockets have a filing date outside 1700 to the snapshot date and are left out of the year series.`
                  : ""}
              </p>
            </>
          );
        }}
      </QueryPanel>
    </Panel>
  );
}

function SourcesPanel({ query }: { query: UseQueryResult<DocketOverview | null> }) {
  return (
    <Panel
      id="collection-sources"
      title="Where the docket rows come from"
      subtitle="CourtListener's source flags for each docket"
    >
      <QueryPanel
        query={query}
        label="Loading source flags"
        errorText="The source flags could not be loaded."
        emptyText="The source flags are not recorded."
        isEmpty={(o) => !o.sources.length}
      >
        {(o) => {
          const listed = o.sources.reduce((a, s) => a + s.count, 0);
          const rest = o.dockets - listed;
          const rows: ShareRow[] = o.sources.map((s) => ({
            key: String(s.value),
            label: s.flags.join(" + "),
            count: s.count,
            sharePct: s.sharePct,
            group: null,
          }));
          if (rest > 0)
            rows.push({
              key: "rest",
              label: "Other combinations",
              count: rest,
              sharePct: sharePct(rest, o.dockets),
              group: null,
            });
          return (
            <>
              <ShareBars
                id="collection-sources-list"
                caption="Source flags"
                countLabel="Dockets"
                rows={rows}
                limit={8}
              />
              <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
                A docket carries one combination of source flags, so these shares do not overlap and
                add to all {int(o.dockets)} dockets. RECAP is CourtListener&apos;s archive of PACER
                documents.
              </p>
            </>
          );
        }}
      </QueryPanel>
    </Panel>
  );
}
