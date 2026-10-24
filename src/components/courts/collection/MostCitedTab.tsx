import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { CoverageBar, type CoverageSegment } from "@/components/analysis/CoverageBar";
import { int } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { FlagChip, Kpi, Panel, SourceLink, StateNote } from "@/components/enforcement/parts";
import { selOf } from "./collectionSearch";
import {
  FilterSelect,
  ListCoverage,
  ResetButton,
  SearchBox,
} from "@/components/courts/caseload/CaseloadParts";
import { longDate } from "@/components/courts/caseload/caseloadFormat";
import { useJumpWhenShown } from "@/components/courts/caseload/useJumpWhenShown";
import type { Listed, TopCited, TopCitedDetail } from "@/lib/external/clbCollection.functions";
import { notesQuery, topCitedDetailQuery, topCitedQuery } from "./collectionQueries";
import { decadeLabel, NOT_RECORDED, pct, sharePct, SERIES_COLORS } from "./collectionFormat";
import { citedTakeaways } from "./collectionTakeaways";
import {
  encodeSort,
  filterTopCited,
  nextSort,
  parseSort,
  sortTopCited,
  TOP_DEFAULT_SORT,
  TOP_SORT_KEYS,
  topCitedCourtOptions,
  topCitedDecades,
} from "./collectionTables";
import {
  Callout,
  CourtLink,
  DataTable,
  KpiGrid,
  KpiSkeleton,
  MaybeText,
  NoteReference,
  PctText,
  QueryPanel,
  SelectLink,
  type Col,
  type TabProps,
} from "./CollectionParts";
import { CourtShareList, YearBars } from "./CollectionVisuals";
import { ParentheticalsBlock } from "./ParentheticalsBlock";

export function MostCitedTab({ search, onSearch }: TabProps) {
  const query = useQuery(topCitedQuery);
  const notes = useQuery(notesQuery);
  const note = notes.data?.topCited ?? null;
  const takeaways = useMemo(() => citedTakeaways(query.data?.rows ?? []), [query.data]);
  return (
    <div className="space-y-3">
      <CitedKpis query={query} />
      <Callout>
        <strong className="font-semibold text-foreground">Times cited</strong> is
        CourtListener&apos;s citation_count for the opinion cluster;{" "}
        <strong className="font-semibold text-foreground">map links</strong> counts rows of the bulk
        citation map that point at it. They are two different measures and are not expected to
        match. Citations are extracted from opinion text and are not a complete census. Case names
        are as recorded and can be truncated or reversed.{" "}
        {note?.caveats.filter((c) => /blocked|Ranking is per cluster/i.test(c)).join(" ") ?? ""}
      </Callout>
      <KeyTakeaways
        items={takeaways}
        scope={
          longDate(note?.snapshot) ? `Most-cited opinions · ${longDate(note?.snapshot)}` : undefined
        }
        note="Computed from the list below. Counts are not adjusted for how long an opinion has been available to cite."
      />
      <Panel
        id="cited-table"
        title="The most-cited opinions"
        subtitle="The opinion clusters the source counts as cited most often. Select a case for its citing courts and decades."
      >
        <QueryPanel
          query={query}
          label="Loading the most-cited opinions"
          errorText="The most-cited opinions could not be loaded."
          emptyText="The most-cited opinions have not been published yet."
          isEmpty={(l) => !l.rows.length}
        >
          {(list) => <CitedTable list={list} search={search} onSearch={onSearch} />}
        </QueryPanel>
      </Panel>
      <NoteReference note={note} title="How to read the most-cited list" />
    </div>
  );
}

function CitedKpis({ query }: { query: UseQueryResult<Listed<TopCited>> }) {
  if (query.isLoading) return <KpiSkeleton n={4} />;
  const rows = query.data?.rows ?? [];
  if (query.isError || !rows.length) return null;
  const top = rows[0]!;
  const last = rows.at(-1)!;
  const scotus = rows.filter((r) => r.courtId === "scotus").length;
  return (
    <KpiGrid id="cited-kpis" label="Most-cited totals" cols={4}>
      <Kpi
        label="Opinions listed"
        value={int(rows.length)}
        note="The most-cited clusters in the collection"
      />
      <Kpi
        label="Most times cited"
        value={int(top.timesCited)}
        note={`${top.caseName} (${top.year})`}
      />
      <Kpi
        label={`Times cited at rank ${int(last.rank)}`}
        value={int(last.timesCited)}
        note="The fewest among the listed opinions"
      />
      <Kpi
        label="Supreme Court opinions"
        value={`${int(scotus)} of ${int(rows.length)}`}
        note={`${pct(sharePct(scotus, rows.length), 0)} of the listed opinions`}
      />
    </KpiGrid>
  );
}

function CitedTable({ list, search, onSearch }: TabProps & { list: Listed<TopCited> }) {
  const spec = parseSort(search.sort, TOP_SORT_KEYS, TOP_DEFAULT_SORT);
  const courts = useMemo(() => topCitedCourtOptions(list.rows), [list.rows]);
  const decades = useMemo(() => topCitedDecades(list.rows), [list.rows]);
  const shown = useMemo(
    () =>
      sortTopCited(
        filterTopCited(list.rows, { q: search.q, court: search.court, decade: search.decade }),
        spec,
      ),
    [list.rows, search.q, search.court, search.decade, spec],
  );
  const filtered = Boolean(search.q || search.court || search.decade);
  const clear = () => onSearch({ q: undefined, court: undefined, decade: undefined });
  const sortBy = (key: string) =>
    onSearch({
      sort: encodeSort(
        nextSort(
          spec,
          key as typeof spec.key,
          !["caseName", "court", "rank", "year"].includes(key),
        ),
        TOP_DEFAULT_SORT,
      ),
    });
  const open = selOf(search);
  const byRank = useMemo(() => new Map(list.rows.map((r) => [r.rank, r])), [list.rows]);
  const cols: Col<TopCited>[] = [
    { key: "rank", label: "Rank", sortKey: "rank", align: "right", render: (r) => int(r.rank) },
    {
      key: "case",
      label: "Case",
      sortKey: "caseName",
      render: (r) => (
        <>
          <SelectLink
            search={search}
            patch={{ sel: open === String(r.clusterId) ? undefined : String(r.clusterId) }}
            selected={open === String(r.clusterId)}
            title={open === String(r.clusterId) ? "Close the detail" : "Open the detail"}
          >
            {r.caseName}
          </SelectLink>
          {r.twinRanks.length || r.lowMapRatio ? (
            <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
              {r.twinRanks.length ? <FlagChip title={twinText(r)}>Split decision</FlagChip> : null}
              {r.lowMapRatio ? <FlagChip title={lowMapText(r)}>Low map count</FlagChip> : null}
            </span>
          ) : null}
          <span className="block text-[11px] text-muted-foreground lg:hidden">
            {r.court}, {r.year}
          </span>
        </>
      ),
    },
    {
      key: "court",
      label: "Court",
      sortKey: "court",
      hideBelow: "lg",
      render: (r) => (
        <CourtLink courtId={r.courtId} href={r.courtHref}>
          {r.court}
        </CourtLink>
      ),
    },
    { key: "year", label: "Year", sortKey: "year", hideBelow: "lg", render: (r) => r.year },
    {
      key: "citation",
      label: "Citation",
      title: "One reporter citation as recorded",
      hideBelow: "xl",
      render: (r) => <MaybeText v={r.citation} />,
    },
    {
      key: "timesCited",
      label: "Times cited",
      title: "CourtListener's citation_count for the opinion cluster",
      sortKey: "timesCited",
      align: "right",
      render: (r) => int(r.timesCited),
    },
    {
      key: "mapLinks",
      label: "Map links",
      title:
        "Rows of the bulk citation map that point at the cluster: a different measure from times cited",
      sortKey: "mapLinks",
      align: "right",
      hideBelow: "lg",
      render: (r) => int(r.mapLinks),
    },
    {
      key: "federal",
      label: "Federal %",
      title:
        "Share of map links from federal courts, over the links whose citing opinion is in the opinion table and is not dated before the cited opinion",
      sortKey: "federalPct",
      align: "right",
      render: (r) => <PctText v={r.federalPct} />,
    },
    {
      key: "state",
      label: "State %",
      title:
        "Share of map links from state courts, over the links whose citing opinion is in the opinion table and is not dated before the cited opinion",
      sortKey: "statePct",
      align: "right",
      render: (r) => <PctText v={r.statePct} />,
    },
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <SearchBox
          value={search.q}
          onChange={(q) => onSearch({ q })}
          label="Search case names and citations"
          placeholder="Search case name or citation"
        />
        <FilterSelect
          label="Court"
          value={search.court}
          onChange={(court) => onSearch({ court })}
          options={courts.map((c) => ({ id: c.id, label: `${c.label} (${int(c.count)})` }))}
          allLabel="All courts"
        />
        <FilterSelect
          label="Decade"
          value={search.decade === undefined ? undefined : String(search.decade)}
          onChange={(decade) => onSearch({ decade: decade ? Number(decade) : undefined })}
          options={decades.map((d) => ({ id: String(d), label: decadeLabel(d) }))}
          allLabel="All decades"
        />
        <span className="text-[11px] text-muted-foreground" role="status">
          Showing {int(shown.length)} of {int(list.rows.length)} opinions
        </span>
        {filtered ? <ResetButton onClick={clear} /> : null}
      </div>
      {shown.length ? (
        <DataTable
          label="Most-cited opinions"
          caption="The most-cited opinions with court, year, times cited, citation-map links and federal and state shares"
          columns={cols}
          rows={shown}
          rowKey={(r) => String(r.clusterId)}
          sort={{ key: spec.key, desc: spec.desc }}
          onSort={sortBy}
          expanded={{
            key: open,
            render: (r) => (
              <CitedDetail
                row={r}
                byRank={byRank}
                search={search}
                onClose={() => onSearch({ sel: undefined })}
              />
            ),
          }}
          minWidth="min-w-[36rem]"
          pageSize={50}
          maxHeight="max-h-[34rem]"
          resetKey={`${search.q ?? ""}|${search.court ?? ""}|${search.decade ?? ""}|${search.sort ?? ""}`}
          noun="opinions"
        />
      ) : (
        <StateNote action={<ResetButton onClick={clear} />}>
          No opinion matches these filters.
        </StateNote>
      )}
      <ListCoverage
        loaded={list.rows.length}
        total={list.total}
        dropped={list.dropped}
        noun="opinions"
      />
      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        Federal % and State % are shares of the map links whose citing opinion is in the opinion
        table and is not dated before the cited opinion (the basis is stated for each case in its
        detail); the remainder is other courts. Split decision means another listed cluster has the
        same reporter citation; low map count means the map holds under half as many links as times
        cited.
      </p>
    </>
  );
}

function CitedDetail({
  row,
  byRank,
  search,
  onClose,
}: {
  row: TopCited;
  byRank: ReadonlyMap<number, TopCited>;
  search: TabProps["search"];
  onClose: () => void;
}) {
  const q = useQuery(topCitedDetailQuery(row.clusterId));
  useJumpWhenShown(String(row.clusterId), !q.isLoading, "cited-detail");
  return (
    <div
      id="cited-detail"
      className="scroll-mt-4 p-3 focus:outline-none"
      aria-label={`Detail for ${row.caseName}`}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs">
          <span className="font-semibold">{row.caseName}</span>{" "}
          <span className="text-muted-foreground">
            {row.court}, {row.dateFiled ?? row.year}
            {row.citation ? ` · ${row.citation}` : ""}
          </span>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Close
        </button>
      </div>
      <ClusterFlags row={row} byRank={byRank} search={search} />
      <QueryPanel
        query={q}
        label="Loading the citing courts"
        errorText="The detail for this opinion could not be loaded."
        emptyText="No citing-court detail is recorded for this opinion."
        skeleton={<div className="h-40 animate-pulse rounded-md bg-muted/50" aria-busy="true" />}
      >
        {(d) => <CitedDetailBody row={row} d={d} />}
      </QueryPanel>
      <ParentheticalsBlock clusterId={row.clusterId} caseName={row.caseName} />
    </div>
  );
}

function CitedDetailBody({ row, d }: { row: TopCited; d: TopCitedDetail }) {
  const basis = row.knownCitingCourt;
  const segments: CoverageSegment[] = [
    { key: "federal", label: "Federal courts", value: d.federal ?? 0, tone: "strong" },
    { key: "state", label: "State courts", value: d.state ?? 0, tone: "partial" },
    { key: "other", label: "Other courts", value: d.other ?? 0, tone: "none" },
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="min-w-0 rounded-md border border-border">
        <CourtShareList
          id={`cited-courts-${row.clusterId}`}
          caption="Courts that cite it most"
          countLabel="Citation-map links from this court"
          shareLabel="Share of the map links whose citing opinion is in the opinion table and is not dated before the cited opinion"
          limit={8}
          rows={d.citingCourts.map((c) => ({
            courtId: c.courtId,
            name: c.name,
            href: c.href,
            count: c.count,
            sharePct: basis ? sharePct(c.count, basis) : c.sharePct,
          }))}
        />
      </div>
      <div className="min-w-0 rounded-md border border-border">
        {d.byDecade.length ? (
          <YearBars
            rows={d.byDecade.map((x) => ({
              label: decadeLabel(x.decade),
              values: { links: x.links },
            }))}
            series={[
              {
                key: "links",
                label:
                  "Map links by decade of the citing opinion (those dated before the cited opinion left out)",
                color: SERIES_COLORS[0]!,
              },
            ]}
            subject={`citation-map links to ${row.caseName} by decade of the citing opinion`}
            height="h-44"
          />
        ) : (
          <StateNote>Links by decade are {NOT_RECORDED} for this opinion.</StateNote>
        )}
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          First cited {d.firstCitedYear ?? NOT_RECORDED}; most recently{" "}
          {d.lastCitedYear ?? NOT_RECORDED}
          {d.lastCitedYear === 2026 ? " (a partial year in this snapshot)" : ""}.
        </p>
      </div>
      <div className="min-w-0 space-y-2 text-xs">
        {d.federal != null && d.state != null && d.other != null && basis ? (
          <CoverageBar
            title="Cited from"
            total={basis}
            segments={segments}
            caption={`Shares of the ${int(basis)} of ${int(row.mapLinks)} map links whose citing opinion is in the opinion table and is not dated before the cited opinion${row.linksCitingFiledBeforeCited ? ` (${int(row.linksCitingFiledBeforeCited)} dated before it are set aside)` : ""}.`}
          />
        ) : (
          <StateNote>The split by kind of citing court is {NOT_RECORDED}.</StateNote>
        )}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Times cited</dt>
          <dd className="font-mono">{int(row.timesCited)}</dd>
          <dt className="text-muted-foreground">Map links</dt>
          <dd className="font-mono">{int(row.mapLinks)}</dd>
          <dt className="text-muted-foreground">Parenthetical descriptions</dt>
          <dd className="font-mono">
            {d.parentheticals ? int(d.parentheticals.total) : NOT_RECORDED}
          </dd>
          {d.parentheticals?.describingOpinions != null ? (
            <>
              <dt className="text-muted-foreground">Opinions describing it</dt>
              <dd className="font-mono">{int(d.parentheticals.describingOpinions)}</dd>
            </>
          ) : null}
        </dl>
        {d.reporterCitations.length ? (
          <p className="leading-4">
            <span className="text-muted-foreground">Reporter citations: </span>
            {d.reporterCitations.join("; ")}
          </p>
        ) : null}
        <p className="text-[11px] leading-4 text-muted-foreground">
          Times cited and map links are different measures and are not expected to match.
          {row.mapToCountRatio != null
            ? ` Map links are ${pct(100 * row.mapToCountRatio, 0)} of times cited here.`
            : ""}
        </p>
        {row.url ? (
          <p>
            <SourceLink href={row.url}>Open the source opinion</SourceLink>
          </p>
        ) : (
          <p className="text-muted-foreground">
            No link is recorded for this opinion.
          </p>
        )}
      </div>
    </div>
  );
}

/** The wording of the split-decision flag: the dataset's own reading of it. */
function twinText(r: TopCited) {
  return `Same reporter citation as ${r.twinRanks.length === 1 ? "rank" : "ranks"} ${r.twinRanks.join(", ")}: the decision's citations are split across clusters, so each ranks lower than the decision would.`;
}

function lowMapText(r: TopCited) {
  return `The citation map holds ${r.mapToCountRatio != null ? pct(100 * r.mapToCountRatio, 0) : "far fewer"} as many links (${int(r.mapLinks)}) as citation_count says (${int(r.timesCited)}), so the rank rests on citation_count alone.`;
}

/** The two flags of a cluster, stated in full above its detail. */
function ClusterFlags({
  row,
  byRank,
  search,
}: {
  row: TopCited;
  byRank: ReadonlyMap<number, TopCited>;
  search: TabProps["search"];
}) {
  if (!row.twinRanks.length && !row.lowMapRatio) return null;
  return (
    <ul className="mb-2 space-y-1" aria-label="Flags for this opinion">
      {row.twinRanks.length ? (
        <li>
          <Callout tone="warning">
            <strong className="font-semibold">Split decision.</strong> {twinText(row)}{" "}
            {row.twinRanks.map((k) => {
              const twin = byRank.get(k);
              return twin ? (
                <span key={k} className="mr-2">
                  <SelectLink
                    search={search}
                    patch={{
                      sel: String(twin.clusterId),
                      q: undefined,
                      court: undefined,
                      decade: undefined,
                    }}
                    selected={false}
                  >
                    Open rank {int(k)}: {twin.caseName}
                  </SelectLink>
                </span>
              ) : null;
            })}
          </Callout>
        </li>
      ) : null}
      {row.lowMapRatio ? (
        <li>
          <Callout tone="warning">
            <strong className="font-semibold">Low map count.</strong> {lowMapText(row)}
          </Callout>
        </li>
      ) : null}
    </ul>
  );
}
