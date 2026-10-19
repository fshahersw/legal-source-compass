import { useMemo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
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
  DocketBreakdown,
  DocketCause,
  DocketDetail,
  DocketNos,
  DocketNosList,
} from "@/lib/external/clbCollection.functions";
import { docketCausesQuery, docketDetailQuery, docketNosQuery } from "./collectionQueries";
import {
  hasPlacePage,
  NOT_RECORDED,
  partialYearText,
  pct,
  sharePct,
  stateName,
  yearTick,
  SERIES_COLORS,
} from "./collectionFormat";
import {
  CAUSE_DEFAULT_SORT,
  CAUSE_SORT_KEYS,
  encodeSort,
  filterCauses,
  filterNos,
  filterStates,
  NOS_DEFAULT_SORT,
  NOS_SORT_KEYS,
  nextSort,
  nosRows,
  parseSort,
  sortCauses,
  sortNos,
  sortStates,
  STATE_DEFAULT_SORT,
  STATE_SORT_KEYS,
  stateRows,
  type NosTableRow,
  type StateTableRow,
} from "./collectionTables";
import {
  CellBar,
  DataTable,
  DrillPanel,
  NumText,
  PctText,
  QueryPanel,
  SelectLink,
  type Col,
  type TabProps,
} from "./CollectionParts";
import { CourtShareList, ShareBars, YearBars, type BarRow } from "./CollectionVisuals";

const VIEWS = [
  { id: "states", label: "States" },
  { id: "nos", label: "Nature of suit" },
  { id: "causes", label: "Causes of action" },
] as const;
type View = (typeof VIEWS)[number]["id"];

/** The state, nature-of-suit and cause tables, one at a time, each with its drill-down. */
export function DocketTablesPanel({
  search,
  onSearch,
  breakdown,
  total,
  snapshot,
}: TabProps & {
  breakdown: UseQueryResult<DocketBreakdown>;
  total: number | null;
  snapshot: string | null;
}) {
  const view: View = search.view === "nos" || search.view === "causes" ? search.view : "states";
  const subtitle =
    view === "states"
      ? "Dockets by the state of the court, with the federal and state courts in each. Select a state for its largest courts."
      : view === "nos"
        ? "Dockets by nature-of-suit code, using this project's grouping of the FJC codebook. Select a code for its filings by year."
        : "The 200 causes of action with the most dockets, as recorded. Select one for its largest courts.";
  return (
    <>
      <Panel
        id="collection-table"
        title={VIEWS.find((v) => v.id === view)?.label ?? "States"}
        subtitle={subtitle}
        actions={
          <Segmented
            label="Docket table"
            value={view}
            options={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
            onChange={(id) =>
              onSearch({
                view: id,
                q: undefined,
                sort: undefined,
                sel: undefined,
                group: undefined,
              })
            }
          />
        }
      >
        {view === "states" ? (
          <StatesView search={search} onSearch={onSearch} breakdown={breakdown} total={total} />
        ) : view === "nos" ? (
          <NosView search={search} onSearch={onSearch} />
        ) : (
          <CausesView search={search} onSearch={onSearch} />
        )}
      </Panel>
      {view === "states" ? (
        <StateDrill search={search} onSearch={onSearch} breakdown={breakdown} />
      ) : view === "nos" ? (
        <NosDrill search={search} onSearch={onSearch} snapshot={snapshot} />
      ) : (
        <CauseDrill search={search} onSearch={onSearch} />
      )}
    </>
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
      {children}
    </div>
  );
}

// -------------------------------------------------------------------------------------------- states

function StatesView({
  search,
  onSearch,
  breakdown,
  total,
}: TabProps & { breakdown: UseQueryResult<DocketBreakdown>; total: number | null }) {
  return (
    <QueryPanel
      query={breakdown}
      label="Loading states"
      errorText="The state breakdown could not be loaded."
      emptyText="The state breakdown is not recorded."
      isEmpty={(b) => !b.states.rows.length}
    >
      {(b) => {
        const placed = b.states.rows.reduce((a, s) => a + s.dockets, 0);
        return (
          <StatesTable
            search={search}
            onSearch={onSearch}
            states={b.states}
            total={total}
            unplaced={total != null && total > placed ? total - placed : null}
          />
        );
      }}
    </QueryPanel>
  );
}

function StatesTable({
  search,
  onSearch,
  states,
  total,
  unplaced,
}: TabProps & {
  states: DocketBreakdown["states"];
  total: number | null;
  unplaced: number | null;
}) {
  const rows = useMemo(() => stateRows(states.rows, total), [states.rows, total]);
  const spec = parseSort(search.sort, STATE_SORT_KEYS, STATE_DEFAULT_SORT);
  const shown = useMemo(
    () => sortStates(filterStates(rows, { q: search.q }), spec),
    [rows, search.q, spec],
  );
  const sortBy = (key: string) =>
    onSearch({
      sort: encodeSort(nextSort(spec, key as typeof spec.key, key !== "name"), STATE_DEFAULT_SORT),
    });
  const cols: Col<StateTableRow>[] = [
    {
      key: "rank",
      label: "Rank",
      title:
        "Rank by dockets among the listed states and territories; ties share the lowest number",
      align: "right",
      render: (r) => (r.rank == null ? NOT_RECORDED : int(r.rank)),
    },
    {
      key: "name",
      label: "State or territory",
      sortKey: "name",
      render: (r) => (
        <>
          <SelectLink search={search} patch={{ sel: r.code }} selected={search.sel === r.code}>
            {r.name}
          </SelectLink>
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">{r.code}</span>
        </>
      ),
    },
    {
      key: "place",
      label: "Place page",
      title: "A place page exists for the 50 states and DC only",
      hideBelow: "lg",
      render: (r) =>
        hasPlacePage(r.code) ? (
          <Link
            to="/places/$state"
            params={{ state: r.code }}
            className="text-primary hover:underline"
          >
            Open {r.code}
          </Link>
        ) : (
          <span className="text-muted-foreground" title="No place page for territories">
            –
          </span>
        ),
    },
    {
      key: "courts",
      label: "Courts",
      sortKey: "courts",
      align: "right",
      render: (r) => int(r.courts),
    },
    {
      key: "dockets",
      label: "Dockets",
      sortKey: "dockets",
      align: "right",
      render: (r) => int(r.dockets),
    },
    {
      key: "share",
      label: "% of all",
      title: "Share of all dockets in the collection",
      sortKey: "sharePct",
      align: "right",
      render: (r) => <PctText v={r.sharePct} />,
    },
    {
      key: "federal",
      label: "Federal %",
      title: "Share of the place's own dockets that are in federal courts",
      sortKey: "federalPct",
      align: "right",
      render: (r) => <PctText v={r.federalPct} />,
    },
    {
      key: "civil",
      label: "Civil-numbered",
      title: "Dockets whose number contains -cv-",
      sortKey: "civil",
      align: "right",
      hideBelow: "lg",
      render: (r) => <NumText v={r.civil} />,
    },
    {
      key: "recap",
      label: "RECAP %",
      title: "Share of the place's dockets from RECAP (PACER) sources",
      sortKey: "recapPct",
      align: "right",
      hideBelow: "xl",
      render: (r) => <PctText v={r.recapPct} />,
    },
  ];
  return (
    <>
      <Toolbar>
        <SearchBox
          value={search.q}
          onChange={(q) => onSearch({ q })}
          label="Search states and territories"
          placeholder="Search state or territory"
        />
        <span className="text-[11px] text-muted-foreground" role="status">
          Showing {int(shown.length)} of {int(rows.length)} places
        </span>
        {search.q ? <ResetButton onClick={() => onSearch({ q: undefined })} /> : null}
      </Toolbar>
      {shown.length ? (
        <DataTable
          label="Dockets by state"
          caption="Dockets, courts and federal share by state, DC and territory"
          columns={cols}
          rows={shown}
          rowKey={(r) => r.code}
          sort={{ key: spec.key, desc: spec.desc }}
          onSort={sortBy}
          selectedKey={selOf(search)}
          minWidth="min-w-[40rem]"
          resetKey={`${search.q ?? ""}${search.sort ?? ""}`}
          noun="places"
        />
      ) : (
        <StateNote action={<ResetButton onClick={() => onSearch({ q: undefined })} />}>
          No state or territory matches &ldquo;{search.q}&rdquo;.
        </StateNote>
      )}
      <ListCoverage
        loaded={rows.length}
        total={states.total}
        dropped={states.dropped}
        noun="places"
      />
      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        A court is placed in a state by this project&apos;s court spine. Shares are of all{" "}
        {total != null ? int(total) : NOT_RECORDED} dockets in the collection
        {unplaced != null
          ? `; ${int(unplaced)} dockets (${pct(sharePct(unplaced, total))}) are in courts with no state and are in no row`
          : ""}
        . Federal % is the federal courts&apos; share of that place&apos;s own dockets.
      </p>
    </>
  );
}

function StateDrill({
  search,
  onSearch,
  breakdown,
}: TabProps & { breakdown: UseQueryResult<DocketBreakdown> }) {
  const code = selOf(search);
  const s = code ? (breakdown.data?.states.rows.find((x) => x.code === code) ?? null) : null;
  const segments: CoverageSegment[] = s
    ? [
        { key: "federal", label: "Federal courts", value: s.federal ?? 0, tone: "strong" },
        { key: "state", label: "State courts", value: s.stateCourts ?? 0, tone: "partial" },
        { key: "other", label: "Other courts", value: s.other ?? 0, tone: "none" },
      ]
    : [];
  return (
    <DrillPanel
      id="collection-detail"
      title="State drill-down"
      hint="Select a state or territory in the table to see its federal and state courts and the courts with the most dockets."
      selected={code}
      ready={!breakdown.isLoading}
      subtitle={
        s ? `${stateName(s.code)}: ${int(s.dockets)} dockets in ${int(s.courts)} courts` : undefined
      }
      onClear={() => onSearch({ sel: undefined })}
    >
      {s ? (
        <div className="grid gap-3 p-3 lg:grid-cols-2">
          <div className="space-y-2">
            {s.federal != null && s.stateCourts != null && s.other != null ? (
              <CoverageBar
                title="Federal and state courts"
                total={s.dockets}
                segments={segments}
                caption={`Dockets in ${stateName(s.code)} by the kind of court. Shares are of the place's ${int(s.dockets)} dockets.`}
              />
            ) : (
              <StateNote>
                The federal and state split for {stateName(s.code)} is {NOT_RECORDED}.
              </StateNote>
            )}
            {hasPlacePage(s.code) ? (
              <p className="text-xs">
                <Link
                  to="/places/$state"
                  params={{ state: s.code }}
                  className="text-primary hover:underline"
                >
                  Open the {stateName(s.code)} place page
                </Link>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {stateName(s.code)} is a territory; there is no place page for it.
              </p>
            )}
          </div>
          <div className="rounded-md border border-border">
            <CourtShareList
              id="collection-state-courts"
              caption={`Courts in ${stateName(s.code)} with the most dockets`}
              countLabel="Dockets in the collection"
              shareLabel="Share of the place's dockets"
              limit={8}
              rows={s.topCourts.map((c) => ({
                courtId: c.courtId,
                name: c.name,
                href: c.href,
                count: c.count,
                sharePct: sharePct(c.count, s.dockets),
              }))}
            />
          </div>
        </div>
      ) : (
        <p className="p-3 text-xs text-muted-foreground">
          This place is not in the loaded breakdown ({NOT_RECORDED}).
        </p>
      )}
    </DrillPanel>
  );
}

// -------------------------------------------------------------------------------------------- nature of suit

function NosView({ search, onSearch }: TabProps) {
  const query = useQuery(docketNosQuery);
  return (
    <QueryPanel
      query={query}
      label="Loading nature of suit"
      errorText="The nature-of-suit table could not be loaded."
      emptyText="The nature-of-suit table is not recorded."
      isEmpty={(n) => !n.nos.rows.length && !n.groups.rows.length}
    >
      {(list) => <NosBody list={list} search={search} onSearch={onSearch} />}
    </QueryPanel>
  );
}

const stripCode = (name: string) => name.replace(/^\d{3}\s+/, "");

function NosBody({ list, search, onSearch }: TabProps & { list: DocketNosList }) {
  const rows = useMemo(
    () => nosRows(list.nos.rows, list.numericCodeDockets),
    [list.nos.rows, list.numericCodeDockets],
  );
  const spec = parseSort(search.sort, NOS_SORT_KEYS, NOS_DEFAULT_SORT);
  const shown = useMemo(
    () => sortNos(filterNos(rows, { q: search.q, group: search.group }), spec),
    [rows, search.q, search.group, spec],
  );
  const filtered = Boolean(search.q || search.group);
  const clear = () => onSearch({ q: undefined, group: undefined });
  const sortBy = (key: string) =>
    onSearch({
      sort: encodeSort(
        nextSort(spec, key as typeof spec.key, !["code", "name", "group"].includes(key)),
        NOS_DEFAULT_SORT,
      ),
    });
  const denominator = list.numericCodeDockets;
  const cols: Col<NosTableRow>[] = [
    {
      key: "code",
      label: "Code",
      sortKey: "code",
      render: (r) => (
        <SelectLink search={search} patch={{ sel: r.id }} selected={search.sel === r.id}>
          <span className="font-mono">{r.code}</span>
        </SelectLink>
      ),
    },
    { key: "name", label: "Nature of suit", sortKey: "name", render: (r) => stripCode(r.name) },
    {
      key: "group",
      label: "Group",
      title: "This project's grouping of FJC codebook codes",
      sortKey: "group",
      hideBelow: "lg",
      render: (r) => r.groupLabel ?? <span className="text-muted-foreground">{NOT_RECORDED}</span>,
    },
    {
      key: "dockets",
      label: "Dockets",
      sortKey: "dockets",
      align: "right",
      render: (r) => int(r.dockets),
    },
    {
      key: "share",
      label: "% of coded",
      title: "Share of the dockets whose nature-of-suit text starts with a three-digit code",
      sortKey: "sharePct",
      align: "right",
      render: (r) => <PctText v={r.sharePct} digits={2} />,
    },
    {
      key: "terminated",
      label: "Terminated %",
      title: "Share of the code's dated dockets that carry a termination date",
      sortKey: "terminatedPct",
      align: "right",
      hideBelow: "lg",
      render: (r) => <PctText v={r.terminatedPct} />,
    },
    {
      key: "fjc",
      label: "FJC record",
      title: "The FJC national record for this code, linked only where the record carries the link",
      hideBelow: "xl",
      render: (r) =>
        r.fjcHref ? (
          <Link
            to="/records/$dataset/$id"
            params={{ dataset: "fjc_civil_nos", id: r.id }}
            className="text-primary hover:underline"
          >
            Open
          </Link>
        ) : (
          <span className="text-muted-foreground">–</span>
        ),
    },
  ];
  return (
    <>
      <div className="border-b border-border/60">
        <p className="px-3 pt-2 text-[11px] font-medium">
          Groups (this project&apos;s grouping of FJC codebook codes)
        </p>
        <ShareBars
          id="collection-nos-groups"
          caption="Nature-of-suit groups"
          countLabel="Dockets with a code in the group"
          limit={6}
          rows={list.groups.rows.map((g) => ({
            key: g.key,
            label: g.label,
            count: g.dockets,
            sharePct: sharePct(g.dockets, denominator),
            group: null,
          }))}
        />
        <p className="px-3 pb-2 text-[11px] leading-4 text-muted-foreground">
          Shares are of the {denominator != null ? int(denominator) : NOT_RECORDED} dockets whose
          nature-of-suit text starts with a three-digit code. Texts without a code (for example
          &ldquo;Habeas Corpus (General)&rdquo;) are in no group.
        </p>
      </div>
      <Toolbar>
        <SearchBox
          value={search.q}
          onChange={(q) => onSearch({ q })}
          label="Search nature-of-suit codes"
          placeholder="Search code, name or group"
        />
        <FilterSelect
          label="Group"
          value={search.group}
          onChange={(group) => onSearch({ group })}
          options={list.groups.rows.map((g) => ({ id: g.key, label: g.label }))}
          allLabel="All groups"
        />
        <span className="text-[11px] text-muted-foreground" role="status">
          Showing {int(shown.length)} of {int(rows.length)} codes
        </span>
        {filtered ? <ResetButton onClick={clear} /> : null}
      </Toolbar>
      {shown.length ? (
        <DataTable
          label="Dockets by nature of suit"
          caption="Dockets by nature-of-suit code with group, share and termination share"
          columns={cols}
          rows={shown}
          rowKey={(r) => r.id}
          sort={{ key: spec.key, desc: spec.desc }}
          onSort={sortBy}
          selectedKey={selOf(search)}
          minWidth="min-w-[38rem]"
          resetKey={`${search.q ?? ""}|${search.group ?? ""}|${search.sort ?? ""}`}
          noun="codes"
        />
      ) : (
        <StateNote action={<ResetButton onClick={clear} />}>
          No nature-of-suit code matches these filters.
        </StateNote>
      )}
      <ListCoverage
        loaded={rows.length}
        total={list.nos.total}
        dropped={list.nos.dropped}
        noun="nature-of-suit codes"
      />
    </>
  );
}

function NosDrill({ search, onSearch, snapshot }: TabProps & { snapshot: string | null }) {
  const id = selOf(search);
  const nos = useQuery(docketNosQuery);
  const detail = useQuery({ ...docketDetailQuery(id ?? ""), enabled: Boolean(id) });
  const row = id ? (nos.data?.nos.rows.find((r) => r.id === id) ?? null) : null;
  return (
    <DrillPanel
      id="collection-detail"
      title="Nature-of-suit drill-down"
      hint="Select a nature-of-suit code in the table to see its dockets by filing year and its largest courts."
      selected={id}
      ready={!detail.isLoading}
      subtitle={row ? `${row.name}: ${int(row.dockets)} dockets` : undefined}
      onClear={() => onSearch({ sel: undefined })}
    >
      <QueryPanel
        query={detail}
        label="Loading the nature-of-suit detail"
        errorText="The detail for this code could not be loaded."
        emptyText="No detail is recorded for this code."
      >
        {(d) => <NosDetailBody d={d} row={row} snapshot={snapshot} />}
      </QueryPanel>
    </DrillPanel>
  );
}

function NosDetailBody({
  d,
  row,
  snapshot,
}: {
  d: DocketDetail;
  row: DocketNos | null;
  snapshot: string | null;
}) {
  const since = d.byYear.filter((y) => y.year >= 1990);
  const partial = since.find((y) => y.partial);
  const withTerm = since.some((y) => y.terminated != null);
  const rows: BarRow[] = since.map((y) => ({
    label: yearTick(y.year, y.partial),
    partial: y.partial,
    values: withTerm
      ? { terminated: y.terminated, open: y.terminated == null ? null : y.dockets - y.terminated }
      : { dockets: y.dockets },
  }));
  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 rounded-md border border-border">
        {rows.length ? (
          <YearBars
            rows={rows}
            series={
              withTerm
                ? [
                    {
                      key: "terminated",
                      label: "With a termination date",
                      color: SERIES_COLORS[0]!,
                    },
                    { key: "open", label: "No termination date", color: SERIES_COLORS[2]! },
                  ]
                : [{ key: "dockets", label: "Dockets", color: SERIES_COLORS[0]! }]
            }
            subject="dockets with this nature-of-suit code per filing year"
            note={
              partial ? (
                <>
                  {yearTick(partial.year, true)}: {partialYearText(snapshot)}, drawn lighter
                </>
              ) : null
            }
          />
        ) : (
          <StateNote>Dockets by filing year since 1990 are {NOT_RECORDED} for this code.</StateNote>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="rounded-md border border-border">
          <CourtShareList
            id="collection-nos-courts"
            caption="Courts with the most dockets for this code"
            countLabel="Dockets with this code"
            shareLabel="Share of the code's dockets"
            limit={6}
            rows={d.topCourts.map((c) => ({
              courtId: c.courtId,
              name: c.name,
              href: c.href,
              count: c.count,
              sharePct: sharePct(c.count, row?.dockets ?? null),
            }))}
          />
        </div>
        {row?.fjcHref ? (
          <p className="text-xs">
            <Link
              to="/records/$dataset/$id"
              params={{ dataset: "fjc_civil_nos", id: row.id }}
              className="text-primary hover:underline"
            >
              Open the FJC national record for this code
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------- causes

function CausesView({ search, onSearch }: TabProps) {
  const query = useQuery(docketCausesQuery);
  return (
    <QueryPanel
      query={query}
      label="Loading causes of action"
      errorText="The causes of action could not be loaded."
      emptyText="The causes of action are not recorded."
      isEmpty={(l) => !l.rows.length}
    >
      {(list) => {
        const spec = parseSort(search.sort, CAUSE_SORT_KEYS, CAUSE_DEFAULT_SORT);
        const shown = sortCauses(filterCauses(list.rows, { q: search.q }), spec);
        const max = Math.max(...list.rows.map((c) => c.dockets), 0);
        const sortBy = (key: string) =>
          onSearch({
            sort: encodeSort(
              nextSort(spec, key as typeof spec.key, key === "dockets"),
              CAUSE_DEFAULT_SORT,
            ),
          });
        const cols: Col<DocketCause>[] = [
          {
            key: "rank",
            label: "Rank",
            sortKey: "rank",
            align: "right",
            render: (c) => int(c.rank),
          },
          {
            key: "cause",
            label: "Cause of action (as recorded)",
            sortKey: "cause",
            render: (c) => (
              <SelectLink search={search} patch={{ sel: c.id }} selected={search.sel === c.id}>
                {c.cause}
              </SelectLink>
            ),
          },
          {
            key: "dockets",
            label: "Dockets",
            title:
              "Dockets with this exact cause string; bars are scaled to the largest cause listed",
            sortKey: "dockets",
            align: "right",
            render: (c) => <CellBar value={c.dockets} max={max} label={int(c.dockets)} />,
          },
        ];
        return (
          <>
            <Toolbar>
              <SearchBox
                value={search.q}
                onChange={(q) => onSearch({ q })}
                label="Search causes of action"
                placeholder="Search cause of action"
              />
              <span className="text-[11px] text-muted-foreground" role="status">
                Showing {int(shown.length)} of {int(list.rows.length)} causes
              </span>
              {search.q ? <ResetButton onClick={() => onSearch({ q: undefined })} /> : null}
            </Toolbar>
            {shown.length ? (
              <DataTable
                label="Dockets by cause of action"
                caption="The causes of action with the most dockets"
                columns={cols}
                rows={shown}
                rowKey={(c) => c.id}
                sort={{ key: spec.key, desc: spec.desc }}
                onSort={sortBy}
                selectedKey={selOf(search)}
                minWidth="min-w-[30rem]"
                resetKey={`${search.q ?? ""}${search.sort ?? ""}`}
                noun="causes"
              />
            ) : (
              <StateNote action={<ResetButton onClick={() => onSearch({ q: undefined })} />}>
                No cause of action matches &ldquo;{search.q}&rdquo;.
              </StateNote>
            )}
            <ListCoverage
              loaded={list.rows.length}
              total={list.total}
              dropped={list.dropped}
              noun="causes"
            />
            <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
              The top 200 causes by dockets, each the exact string CourtListener records, so
              near-duplicates (for example two spellings of the same statute) are separate rows. Few
              dockets carry a cause, so these counts are not shares of the collection.
            </p>
          </>
        );
      }}
    </QueryPanel>
  );
}

function CauseDrill({ search, onSearch }: TabProps) {
  const query = useQuery(docketCausesQuery);
  const id = selOf(search);
  const row = id ? (query.data?.rows.find((c) => c.id === id) ?? null) : null;
  return (
    <DrillPanel
      id="collection-detail"
      title="Cause-of-action drill-down"
      hint="Select a cause of action in the table to see the courts with the most dockets for it."
      selected={id}
      ready={!query.isLoading}
      subtitle={
        row ? `${row.cause}: ${int(row.dockets)} dockets (rank ${int(row.rank)})` : undefined
      }
      onClear={() => onSearch({ sel: undefined })}
    >
      {row ? (
        <CourtShareList
          id="collection-cause-courts"
          caption="Courts with the most dockets for this cause"
          countLabel="Dockets with this cause"
          shareLabel="Share of the cause's dockets"
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
          This cause is not in the loaded list ({NOT_RECORDED}).
        </p>
      )}
    </DrillPanel>
  );
}
