import { useMemo, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { CoverageBar, type CoverageSegment } from "@/components/analysis/CoverageBar";
import { int } from "@/components/analysis/analysisFormat";
import { Panel, Segmented, StateNote } from "@/components/enforcement/parts";
import { selOf } from "./collectionSearch";
import {
  FilterSelect,
  ListCoverage,
  ResetButton,
  SearchBox,
} from "@/components/courts/caseload/CaseloadParts";
import type {
  AppealEdge,
  CiteEdge,
  CitingCourt,
  FlowYear,
  FlowsMap,
  Listed,
} from "@/lib/external/clbCollection.functions";
import {
  appealEdgesQuery,
  citeEdgesQuery,
  citingCourtsQuery,
  citingDetailQuery,
  flowYearsQuery,
  notesQuery,
} from "./collectionQueries";
import {
  countedOptions,
  NOT_RECORDED,
  partialYearText,
  pct,
  sharePct,
  spanYears,
  thinYears,
  yearsText,
  yearTick,
  SERIES_COLORS,
} from "./collectionFormat";
import {
  APPEAL_DEFAULT_SORT,
  APPEAL_SORT_KEYS,
  CITE_DEFAULT_SORT,
  CITE_SORT_KEYS,
  CITING_DEFAULT_SORT,
  CITING_SORT_KEYS,
  encodeSort,
  filterAppealEdges,
  filterCiteEdges,
  filterCiting,
  nextSort,
  parseSort,
  sortAppealEdges,
  sortCiteEdges,
  sortCiting,
} from "./collectionTables";
import {
  CourtLink,
  DataTable,
  DrillPanel,
  NumText,
  PctText,
  QueryPanel,
  SelectLink,
  type Col,
  type TabProps,
} from "./CollectionParts";
import { CourtShareList, YearBars, type BarRow } from "./CollectionVisuals";

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
      {children}
    </div>
  );
}

const levelOptions = (values: readonly (string | null)[]) =>
  countedOptions(values).map((o) => ({ id: o.id, label: `${o.label} (${int(o.count)})` }));

// -------------------------------------------------------------------------------------------- citing courts

export function CitingCourtsView({
  search,
  onSearch,
  map,
}: TabProps & { map: UseQueryResult<FlowsMap | null> }) {
  const query = useQuery(citingCourtsQuery);
  return (
    <>
      <Panel
        id="citations-courts"
        title="Courts and whom they cite"
        subtitle="Every citing court with a profile. Select a court to see the courts it cites most."
        footnote={
          <>
            Citations made are links from the court&apos;s opinions that resolve to a court; links
            between two opinions of the same decision are not counted. Own is the share to the
            court&apos;s own opinions; Supreme Court, To federal and To state are shares of the
            court&apos;s citations made. Median age is the median years between the cited opinion
            and the citing opinion: links whose citing opinion is dated before the cited one
            {map.data?.overview.citingFiledBeforeCited != null
              ? ` (${int(map.data.overview.citingFiledBeforeCited)} in the whole map)`
              : ""}{" "}
            stay in the counts but are left out of the ages
            {map.data?.overview.undatedLinks != null
              ? `, as are ${int(map.data.overview.undatedLinks)} links with a missing date`
              : ""}
            . Profiles are published for courts with at least 5,000 links.
          </>
        }
      >
        <QueryPanel
          query={query}
          label="Loading citing courts"
          errorText="The citing-court profiles could not be loaded."
          emptyText="The citing-court profiles are not recorded."
          isEmpty={(l) => !l.rows.length}
        >
          {(list) => (
            <CitingTable
              search={search}
              onSearch={onSearch}
              list={list}
              resolved={map.data?.overview.resolved ?? null}
            />
          )}
        </QueryPanel>
      </Panel>
      <CitingDrill search={search} onSearch={onSearch} list={query} />
    </>
  );
}

function CitingTable({
  search,
  onSearch,
  list,
  resolved,
}: TabProps & { list: Listed<CitingCourt>; resolved: number | null }) {
  const spec = parseSort(search.sort, CITING_SORT_KEYS, CITING_DEFAULT_SORT);
  const levels = useMemo(() => levelOptions(list.rows.map((c) => c.level)), [list.rows]);
  const shown = useMemo(
    () => sortCiting(filterCiting(list.rows, { q: search.q, level: search.level }), spec),
    [list.rows, search.q, search.level, spec],
  );
  const filtered = Boolean(search.q || search.level);
  const clear = () => onSearch({ q: undefined, level: undefined });
  const sortBy = (key: string) =>
    onSearch({
      sort: encodeSort(
        nextSort(spec, key as typeof spec.key, !["name", "level"].includes(key)),
        CITING_DEFAULT_SORT,
      ),
    });
  const covered = list.rows.reduce((a, c) => a + c.total, 0);
  const cols: Col<CitingCourt>[] = [
    {
      key: "name",
      label: "Court",
      sortKey: "name",
      render: (c) => (
        <SelectLink search={search} patch={{ sel: c.id }} selected={search.sel === c.id}>
          {c.name}
        </SelectLink>
      ),
    },
    {
      key: "level",
      label: "Level",
      sortKey: "level",
      hideBelow: "lg",
      render: (c) => c.level ?? NOT_RECORDED,
    },
    {
      key: "total",
      label: "Citations made",
      title: "Citation links from the court's opinions that resolve to a court",
      sortKey: "total",
      align: "right",
      render: (c) => int(c.total),
    },
    {
      key: "self",
      label: "Own %",
      title: "Share of the court's citations that go to its own opinions",
      sortKey: "selfPct",
      align: "right",
      render: (c) => <PctText v={c.selfPct} />,
    },
    {
      key: "scotus",
      label: "Supreme Ct. %",
      title: "Share of the court's citations that go to the U.S. Supreme Court",
      sortKey: "scotusPct",
      align: "right",
      render: (c) => <PctText v={c.scotusPct} />,
    },
    {
      key: "federal",
      label: "To federal %",
      title: "Share of the court's citations that go to federal courts",
      sortKey: "federalPct",
      align: "right",
      hideBelow: "lg",
      render: (c) => <PctText v={c.federalPct} />,
    },
    {
      key: "state",
      label: "To state %",
      title: "Share of the court's citations that go to state courts",
      sortKey: "statePct",
      align: "right",
      hideBelow: "lg",
      render: (c) => <PctText v={c.statePct} />,
    },
    {
      key: "age",
      label: "Median age",
      title: "Median years between the cited opinion and the citing opinion",
      sortKey: "lagMedian",
      align: "right",
      render: (c) => (c.lag?.median == null ? NOT_RECORDED : yearsText(c.lag.median)),
    },
  ];
  return (
    <>
      <Toolbar>
        <SearchBox
          value={search.q}
          onChange={(q) => onSearch({ q })}
          label="Search citing courts"
          placeholder="Search court name or id"
        />
        <FilterSelect
          label="Level"
          value={search.level}
          onChange={(level) => onSearch({ level })}
          options={levels}
          allLabel="All levels"
        />
        <span className="text-[11px] text-muted-foreground" role="status">
          Showing {int(shown.length)} of {int(list.rows.length)} courts
        </span>
        {filtered ? <ResetButton onClick={clear} /> : null}
      </Toolbar>
      {shown.length ? (
        <DataTable
          label="Citing courts"
          caption="Citing courts with citations made, own-court share, Supreme Court share and median age of cited opinions"
          columns={cols}
          rows={shown}
          rowKey={(c) => c.id}
          sort={{ key: spec.key, desc: spec.desc }}
          onSort={sortBy}
          selectedKey={selOf(search)}
          minWidth="min-w-[40rem]"
          resetKey={`${search.q ?? ""}|${search.level ?? ""}|${search.sort ?? ""}`}
          noun="courts"
        />
      ) : (
        <StateNote action={<ResetButton onClick={clear} />}>
          No citing court matches these filters.
        </StateNote>
      )}
      <ListCoverage
        loaded={list.rows.length}
        total={list.total}
        dropped={list.dropped}
        noun="citing courts"
      />
      {resolved ? (
        <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
          These {int(list.rows.length)} courts account for {int(covered)} of the {int(resolved)}{" "}
          resolved citation links ({pct(sharePct(covered, resolved))}).
        </p>
      ) : null}
    </>
  );
}

function CitingDrill({
  search,
  onSearch,
  list,
}: TabProps & { list: UseQueryResult<Listed<CitingCourt>> }) {
  const court = selOf(search);
  const detail = useQuery({ ...citingDetailQuery(court ?? ""), enabled: Boolean(court) });
  const row = court ? (list.data?.rows.find((c) => c.id === court) ?? null) : null;
  const segments: CoverageSegment[] = row
    ? [
        { key: "federal", label: "Federal courts", value: row.federal ?? 0, tone: "strong" },
        { key: "state", label: "State courts", value: row.state ?? 0, tone: "partial" },
        { key: "other", label: "Other courts", value: row.other ?? 0, tone: "none" },
      ]
    : [];
  return (
    <DrillPanel
      id="citations-detail"
      title="Citing court drill-down"
      hint="Select a court in the table to see the courts it cites most and how old the opinions it cites are."
      selected={court}
      ready={!detail.isLoading}
      subtitle={
        row
          ? `${row.name}: ${int(row.total)} citation links made that resolve to a court`
          : undefined
      }
      onClear={() => onSearch({ sel: undefined })}
    >
      <div className="grid gap-3 p-3 lg:grid-cols-2">
        <div className="space-y-2">
          {row && row.federal != null && row.state != null && row.other != null ? (
            <CoverageBar
              title="Who it cites"
              total={row.total}
              segments={segments}
              caption="Federal, state and other courts as shares of the court's citations made."
            />
          ) : (
            <StateNote>The split by kind of court is {NOT_RECORDED}.</StateNote>
          )}
          {row?.lag ? (
            <div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <Stat label="Median age" value={yearsText(row.lag.median)} />
                <Stat label="Mean age" value={yearsText(row.lag.mean)} />
                <Stat label="90th percentile" value={yearsText(row.lag.p90)} />
              </dl>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Years between the cited opinion and the citing opinion
                {row.lag.n != null ? `, over ${int(row.lag.n)} links with plausible dates` : ""}.
              </p>
            </div>
          ) : null}
          {row ? (
            <p className="text-xs">
              {row.href ? (
                <CourtLink courtId={row.id} href={row.href}>
                  Open the court page
                </CourtLink>
              ) : (
                <span className="text-muted-foreground">
                  No court page is linked for this court.
                </span>
              )}
            </p>
          ) : null}
        </div>
        <div className="rounded-md border border-border">
          <QueryPanel
            query={detail}
            label="Loading the courts it cites"
            errorText="The courts this court cites could not be loaded."
            emptyText="No cited-court list is recorded for this court."
          >
            {(d) => (
              <CourtShareList
                id="citations-cited-courts"
                caption="Courts cited most"
                countLabel="Citation links"
                shareLabel="Share of the court's citations made"
                limit={8}
                rows={d.top.map((c) => ({
                  courtId: c.courtId,
                  name: c.name,
                  href: c.href,
                  count: c.count,
                  sharePct: c.sharePct,
                }))}
              />
            )}
          </QueryPanel>
        </div>
      </div>
    </DrillPanel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm font-semibold">{value}</dd>
    </div>
  );
}

// -------------------------------------------------------------------------------------------- court pairs (edges)

export function EdgesView({
  search,
  onSearch,
  map,
}: TabProps & { map: UseQueryResult<FlowsMap | null> }) {
  const appeal = search.flow === "appeal";
  return (
    <Panel
      id="citations-edges"
      title={appeal ? "Appeals between courts" : "Citation links between courts"}
      subtitle={
        appeal
          ? "Appellate dockets that record the court they were appealed from, by pair of courts."
          : "The largest court-to-court pairs in the citation map; a court citing itself is not a pair."
      }
      actions={
        <Segmented
          label="Kind of flow"
          value={appeal ? "appeal" : "citation"}
          options={[
            { id: "citation", label: "Citations" },
            { id: "appeal", label: "Appeals" },
          ]}
          onChange={(id) =>
            onSearch({
              flow: id === "appeal" ? "appeal" : undefined,
              q: undefined,
              sort: undefined,
              level: undefined,
              to: undefined,
            })
          }
        />
      }
    >
      {appeal ? (
        <AppealTable search={search} onSearch={onSearch} />
      ) : (
        <CiteTable search={search} onSearch={onSearch} map={map} />
      )}
    </Panel>
  );
}

function EdgeFilters({
  search,
  onSearch,
  levelsFrom,
  levelsTo,
  fromLabel,
  toLabel,
  shown,
  total,
  placeholder,
}: TabProps & {
  levelsFrom: { id: string; label: string }[];
  levelsTo: { id: string; label: string }[];
  fromLabel: string;
  toLabel: string;
  shown: number;
  total: number;
  placeholder: string;
}) {
  const filtered = Boolean(search.q || search.level || search.to);
  return (
    <Toolbar>
      <SearchBox
        value={search.q}
        onChange={(q) => onSearch({ q })}
        label="Search courts"
        placeholder={placeholder}
      />
      <FilterSelect
        label={fromLabel}
        value={search.level}
        onChange={(level) => onSearch({ level })}
        options={levelsFrom}
        allLabel="All levels"
      />
      <FilterSelect
        label={toLabel}
        value={search.to}
        onChange={(to) => onSearch({ to })}
        options={levelsTo}
        allLabel="All levels"
      />
      <span className="text-[11px] text-muted-foreground" role="status">
        Showing {int(shown)} of {int(total)} pairs
      </span>
      {filtered ? (
        <ResetButton onClick={() => onSearch({ q: undefined, level: undefined, to: undefined })} />
      ) : null}
    </Toolbar>
  );
}

function CiteTable({ search, onSearch, map }: TabProps & { map: UseQueryResult<FlowsMap | null> }) {
  const query = useQuery(citeEdgesQuery);
  return (
    <QueryPanel
      query={query}
      label="Loading citation pairs"
      errorText="The court-to-court citation pairs could not be loaded."
      emptyText="The court-to-court citation pairs are not recorded."
      isEmpty={(l) => !l.rows.length}
    >
      {(list) => {
        const spec = parseSort(search.sort, CITE_SORT_KEYS, CITE_DEFAULT_SORT);
        const shown = sortCiteEdges(
          filterCiteEdges(list.rows, { q: search.q, level: search.level, to: search.to }),
          spec,
        );
        const sortBy = (key: string) =>
          onSearch({
            sort: encodeSort(
              nextSort(spec, key as typeof spec.key, !["citing", "cited"].includes(key)),
              CITE_DEFAULT_SORT,
            ),
          });
        const cols: Col<CiteEdge>[] = [
          {
            key: "citing",
            label: "Citing court",
            sortKey: "citing",
            render: (e) => (
              <CourtLink courtId={e.citing.id} href={e.citing.href}>
                {e.citing.name}
              </CourtLink>
            ),
          },
          {
            key: "fromLevel",
            label: "Level",
            hideBelow: "xl",
            render: (e) => e.citing.level ?? NOT_RECORDED,
          },
          {
            key: "cited",
            label: "Cited court",
            sortKey: "cited",
            render: (e) => (
              <CourtLink courtId={e.cited.id} href={e.cited.href}>
                {e.cited.name}
              </CourtLink>
            ),
          },
          {
            key: "toLevel",
            label: "Level",
            hideBelow: "xl",
            render: (e) => e.cited.level ?? NOT_RECORDED,
          },
          {
            key: "links",
            label: "Links",
            title: "Citation links from the citing court's opinions to the cited court's opinions",
            sortKey: "links",
            align: "right",
            render: (e) => int(e.links),
          },
          {
            key: "ofCiting",
            label: "% of citing",
            title:
              "Share of the citing court's citations (those that resolve to a court) that go to the cited court",
            sortKey: "shareOfCitingPct",
            align: "right",
            render: (e) => <PctText v={e.shareOfCitingPct} />,
          },
          {
            key: "ofCited",
            label: "% of cited",
            title: "Share of all citation links to the cited court that come from the citing court",
            sortKey: "shareOfCitedPct",
            align: "right",
            render: (e) => <PctText v={e.shareOfCitedPct} />,
          },
        ];
        const listed = list.rows.reduce((a, e) => a + e.links, 0);
        const smallest = Math.min(...list.rows.map((e) => e.links));
        const resolved = map.data?.overview.resolved ?? null;
        return (
          <>
            <EdgeFilters
              search={search}
              onSearch={onSearch}
              levelsFrom={levelOptions(list.rows.map((e) => e.citing.level))}
              levelsTo={levelOptions(list.rows.map((e) => e.cited.level))}
              fromLabel="Citing level"
              toLabel="Cited level"
              shown={shown.length}
              total={list.rows.length}
              placeholder="Search either court"
            />
            {shown.length ? (
              <DataTable
                label="Citation links between courts"
                caption="Court-to-court citation pairs with links and shares"
                columns={cols}
                rows={shown}
                rowKey={(e) => e.id}
                sort={{ key: spec.key, desc: spec.desc }}
                onSort={sortBy}
                minWidth="min-w-[40rem]"
                resetKey={`${search.q ?? ""}|${search.level ?? ""}|${search.to ?? ""}|${search.sort ?? ""}`}
                noun="pairs"
              />
            ) : (
              <StateNote
                action={
                  <ResetButton
                    onClick={() => onSearch({ q: undefined, level: undefined, to: undefined })}
                  />
                }
              >
                No court pair matches these filters.
              </StateNote>
            )}
            <ListCoverage
              loaded={list.rows.length}
              total={list.total}
              dropped={list.dropped}
              noun="pairs"
            />
            <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
              <PairsNote list={list} overview={map.data?.overview ?? null} />
            </p>
          </>
        );
      }}
    </QueryPanel>
  );
}

/** What the published court pairs are, and what is not published: stated from the overview record, not assumed. */
function PairsNote({
  list,
  overview,
}: {
  list: Listed<CiteEdge>;
  overview: FlowsMap["overview"] | null;
}) {
  const listed = list.rows.reduce((a, e) => a + e.links, 0);
  const floor = overview?.crossEdgeFloor ?? Math.min(...list.rows.map((e) => e.links));
  const published = overview?.crossEdgesPublished ?? list.rows.length;
  const resolved = overview?.resolved ?? null;
  return (
    <>
      <strong className="font-semibold text-foreground">Not every pair is shown.</strong> Only the{" "}
      {int(published)} largest court pairs
      {overview?.crossPairsAtLeast100 != null
        ? ` of ${int(overview.crossPairsAtLeast100)} pairs with at least 100 links`
        : ""}{" "}
      are published (ties broken by court id); the smallest published pair has {int(floor)} links.
      {overview?.crossPairsNotPublished != null && overview.crossLinksNotPublished != null
        ? ` The ${int(overview.crossPairsNotPublished)} smaller pairs hold ${int(overview.crossLinksNotPublished)} links and are not published.`
        : ""}{" "}
      The {int(list.rows.length)} pairs listed hold {int(listed)} links
      {resolved
        ? ` (${pct(sharePct(listed, resolved))} of the ${int(resolved)} resolved links)`
        : ""}
      . A repeat citation inside one opinion counts once, and links between two opinions of the same
      decision are excluded, as are links where a court cannot be resolved.
    </>
  );
}

function AppealTable({ search, onSearch }: TabProps) {
  const query = useQuery(appealEdgesQuery);
  return (
    <QueryPanel
      query={query}
      label="Loading appeal pairs"
      errorText="The appeal pairs could not be loaded."
      emptyText="The appeal pairs are not recorded."
      isEmpty={(l) => !l.rows.length}
    >
      {(list) => {
        const spec = parseSort(search.sort, APPEAL_SORT_KEYS, APPEAL_DEFAULT_SORT);
        const shown = sortAppealEdges(
          filterAppealEdges(list.rows, { q: search.q, level: search.level, to: search.to }),
          spec,
        );
        const sortBy = (key: string) =>
          onSearch({
            sort: encodeSort(
              nextSort(spec, key as typeof spec.key, !["from", "to"].includes(key)),
              APPEAL_DEFAULT_SORT,
            ),
          });
        const cols: Col<AppealEdge>[] = [
          {
            key: "from",
            label: "Appealed from",
            title: "The court recorded as the court appealed from",
            sortKey: "from",
            render: (e) => (
              <CourtLink courtId={e.from.id} href={e.from.href}>
                {e.from.name}
              </CourtLink>
            ),
          },
          {
            key: "fromLevel",
            label: "Level",
            hideBelow: "xl",
            render: (e) => e.from.level ?? NOT_RECORDED,
          },
          {
            key: "to",
            label: "Receiving court",
            title: "The court that holds the appellate docket",
            sortKey: "to",
            render: (e) => (
              <CourtLink courtId={e.to.id} href={e.to.href}>
                {e.to.name}
              </CourtLink>
            ),
          },
          {
            key: "toLevel",
            label: "Level",
            hideBelow: "xl",
            render: (e) => e.to.level ?? NOT_RECORDED,
          },
          {
            key: "dockets",
            label: "Dockets",
            sortKey: "dockets",
            align: "right",
            render: (e) => <NumText v={e.dockets} />,
          },
          {
            key: "share",
            label: "% of receiving",
            title: "Share of the receiving court's dockets that record an appeal-from court",
            sortKey: "sharePct",
            align: "right",
            render: (e) => <PctText v={e.sharePct} />,
          },
        ];
        const smallest = Math.min(...list.rows.map((e) => e.dockets));
        return (
          <>
            <EdgeFilters
              search={search}
              onSearch={onSearch}
              levelsFrom={levelOptions(list.rows.map((e) => e.from.level))}
              levelsTo={levelOptions(list.rows.map((e) => e.to.level))}
              fromLabel="From level"
              toLabel="To level"
              shown={shown.length}
              total={list.rows.length}
              placeholder="Search either court"
            />
            {shown.length ? (
              <DataTable
                label="Appeals between courts"
                caption="Appellate dockets by the court appealed from and the receiving court"
                columns={cols}
                rows={shown}
                rowKey={(e) => e.id}
                sort={{ key: spec.key, desc: spec.desc }}
                onSort={sortBy}
                minWidth="min-w-[40rem]"
                resetKey={`${search.q ?? ""}|${search.level ?? ""}|${search.to ?? ""}|${search.sort ?? ""}`}
                noun="pairs"
              />
            ) : (
              <StateNote
                action={
                  <ResetButton
                    onClick={() => onSearch({ q: undefined, level: undefined, to: undefined })}
                  />
                }
              >
                No appeal pair matches these filters.
              </StateNote>
            )}
            <ListCoverage
              loaded={list.rows.length}
              total={list.total}
              dropped={list.dropped}
              noun="pairs"
            />
            <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
              Dockets whose appeal-from court is recorded, which is a minority of appellate dockets
              in the collection. Pairs with fewer than {int(smallest)} dockets are not published.
            </p>
          </>
        );
      }}
    </QueryPanel>
  );
}

// -------------------------------------------------------------------------------------------- by year

export function FlowYearsView({
  span,
  onSpan,
}: {
  span: "all" | undefined;
  onSpan: (s: "all" | undefined) => void;
}) {
  const query = useQuery(flowYearsQuery);
  const notes = useQuery(notesQuery);
  const snapshot = notes.data?.flows?.snapshot ?? null;
  return (
    <Panel
      id="citations-years"
      title="Citation links by year of the citing opinion"
      subtitle="Links made by opinions filed each year, by the kind of court that made them"
      actions={
        <Segmented
          label="Years shown"
          value={span === "all" ? "all" : "recent"}
          options={[
            { id: "recent", label: "Since 1950" },
            { id: "all", label: "All years" },
          ]}
          onChange={(id) => onSpan(id === "all" ? "all" : undefined)}
        />
      }
      footnote="Each bar counts citation links whose citing opinion was filed in that year and that resolve to a court on both sides, split by the kind of court that filed the citing opinion. Only years with at least 1,000 links are published; earlier and sparser years are not listed, so a year with no bar is not a year with no citations. Volume reflects the opinions in the collection, whose coverage differs by court and period."
    >
      <QueryPanel
        query={query}
        label="Loading citation links by year"
        errorText="The citation series by year could not be loaded."
        emptyText="The citation series by year is not recorded."
        isEmpty={(l) => !l.rows.length}
        skeleton={<div className="h-64 animate-pulse bg-muted/50" aria-busy="true" />}
      >
        {(list) => <FlowYearsChart rows={list.rows} span={span} snapshot={snapshot} />}
      </QueryPanel>
    </Panel>
  );
}

function FlowYearsChart({
  rows,
  span,
  snapshot,
}: {
  rows: readonly FlowYear[];
  span: "all" | undefined;
  snapshot: string | null;
}) {
  const shown = spanYears(rows, span, 1950);
  const partial = shown.find((y) => y.partial);
  const thin = thinYears(shown, (y) => y.citations, 0.02);
  const data: BarRow[] = shown.map((y) => ({
    label: yearTick(y.year, y.partial),
    partial: y.partial,
    thin: thin.has(y.year),
    values: { federal: y.federal, state: y.state, other: y.other },
  }));
  return (
    <YearBars
      rows={data}
      series={[
        { key: "federal", label: "From federal courts", color: SERIES_COLORS[0]! },
        { key: "state", label: "From state courts", color: SERIES_COLORS[1]! },
        { key: "other", label: "From other courts", color: SERIES_COLORS[2]! },
      ]}
      subject="citation links made by opinions filed each year"
      note={
        <>
          {partial ? `${yearTick(partial.year, true)}: ${partialYearText(snapshot)}; ` : ""}
          {thin.size ? "years under 2% of the busiest year are drawn lighter" : ""}
        </>
      }
      height="h-64"
    />
  );
}
