import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  CoverageBar,
  type CoverageSegment,
  type CoverageTone,
} from "@/components/analysis/CoverageBar";
import { int } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { Kpi, Panel, SourceLink, StateNote } from "@/components/enforcement/parts";
import {
  FilterSelect,
  ListCoverage,
  ResetButton,
  SearchBox,
} from "@/components/courts/caseload/CaseloadParts";
import { longDate } from "@/components/courts/caseload/caseloadFormat";
import type {
  ClbNotes,
  Listed,
  SchemaTableDetail,
  SchemaTableRow,
} from "@/lib/external/clbCollection.functions";
import { notesQuery, schemaTableQuery, schemaTablesQuery } from "./collectionQueries";
import {
  countedOptions,
  loadShort,
  megabytes,
  NOT_RECORDED,
  pct,
  sharePct,
} from "./collectionFormat";
import { patchSearch, selOf } from "./collectionSearch";
import { schemaTakeaways } from "./collectionTakeaways";
import {
  encodeSort,
  filterSchemaTables,
  nextSort,
  parseSort,
  SCHEMA_DEFAULT_SORT,
  SCHEMA_SORT_KEYS,
  sortSchemaTables,
} from "./collectionTables";
import {
  CellBar,
  Callout,
  DataTable,
  DrillPanel,
  KpiGrid,
  KpiSkeleton,
  NoteReference,
  NumText,
  QueryPanel,
  SelectLink,
  type Col,
  type TabProps,
} from "./CollectionParts";

const LOAD_TONE: Record<string, CoverageTone> = {
  "No public bulk file": "none",
  "Public bulk file, not loaded here": "weak",
  "Public bulk file, loaded here (selected columns)": "partial",
  "Public bulk file, loaded here (all columns, as text)": "strong",
};

export function SchemaTab({ search, onSearch }: TabProps) {
  const tables = useQuery(schemaTablesQuery);
  const notes = useQuery(notesQuery);
  const note = notes.data?.schema ?? null;
  const takeaways = useMemo(
    () => schemaTakeaways(tables.data?.rows ?? [], note?.notInBulk?.tables ?? []),
    [tables.data, note],
  );
  return (
    <div className="space-y-3">
      <NotInBulk notes={notes} tables={tables.data?.rows ?? []} search={search} />
      <SchemaKpis tables={tables} notes={notes} />
      {note?.loadStatus.length ? (
        <CoverageBar
          title="Where the tables stand"
          total={note.loadStatus.reduce((a, s) => a + s.count, 0)}
          segments={note.loadStatus.map((s): CoverageSegment => ({
            key: s.label,
            label: s.label,
            value: s.count,
            tone: LOAD_TONE[s.label] ?? "none",
          }))}
          caption="Every table in CourtListener's published schema, by whether it has a public bulk file and whether this project loads it."
        />
      ) : null}
      <KeyTakeaways
        items={takeaways}
        scope={
          longDate(note?.snapshot) ? `Published schema · ${longDate(note?.snapshot)}` : undefined
        }
        note="Computed from the schema listing below."
      />
      <Panel
        id="schema-tables"
        title="Tables in the published schema"
        subtitle="Every table CourtListener's database schema defines, whether it has a public bulk file, and how this project loads it. Select a table for its columns."
        footnote="Loaded here means this project holds a copy of the bulk file: all columns as text, or selected columns only (long text is reduced to lengths or presence flags). Rows loaded and compressed size are for the table's bulk file."
      >
        <QueryPanel
          query={tables}
          label="Loading the schema tables"
          errorText="The schema table list could not be loaded."
          emptyText="The schema table list has not been published yet."
          isEmpty={(l) => !l.rows.length}
        >
          {(list) => <TablesTable list={list} search={search} onSearch={onSearch} />}
        </QueryPanel>
      </Panel>
      <TableDrill search={search} onSearch={onSearch} list={tables} />
      <NoteReference note={note} title="How to read the data coverage" />
    </div>
  );
}

function NotInBulk({
  notes,
  tables,
  search,
}: {
  notes: UseQueryResult<ClbNotes>;
  tables: readonly SchemaTableRow[];
  search: TabProps["search"];
}) {
  const label = new Map(tables.map((t) => [t.table, t.label]));
  return (
    <section
      id="schema-not-in-bulk"
      aria-label="What is not in the bulk files"
      className="scroll-mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 focus:outline-none"
    >
      <h3 className="text-sm font-semibold leading-5">
        Attorneys, law firms, parties, roles, docket entries and RECAP documents are not in the bulk
        files
      </h3>
      <QueryPanel
        query={notes}
        label="Loading what the bulk files leave out"
        errorText="The statement of what the bulk files leave out could not be loaded."
        emptyText="The statement of what the bulk files leave out is not recorded."
        isEmpty={(n) => !n.schema?.notInBulk}
        skeleton={<div className="mt-2 h-16 animate-pulse rounded bg-muted/50" aria-busy="true" />}
      >
        {(n) => {
          const nb = n.schema!.notInBulk!;
          return (
            <div className="mt-1 space-y-2 text-xs leading-5">
              <p>{nb.statement}</p>
              <p className="font-medium">
                No attorney, law-firm, party, role, docket-entry or RECAP-document statistics can be
                derived from CourtListener&apos;s bulk data.
              </p>
              <ul
                className="flex flex-wrap gap-1.5"
                aria-label="Tables with no public bulk file named by the dataset"
              >
                {nb.tables.map((t) => (
                  <li key={t}>
                    <Link
                      to="/courts/collection"
                      search={patchSearch(search, { sel: t })}
                      resetScroll={false}
                      title={label.get(t) ?? undefined}
                      className="inline-flex rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {t}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        }}
      </QueryPanel>
    </section>
  );
}

function SchemaKpis({
  tables,
  notes,
}: {
  tables: UseQueryResult<Listed<SchemaTableRow>>;
  notes: UseQueryResult<ClbNotes>;
}) {
  if (tables.isLoading) return <KpiSkeleton />;
  const rows = tables.data?.rows ?? [];
  if (!rows.length) return null;
  const totals = notes.data?.schema?.totals ?? null;
  const bulk = rows.filter((t) => t.bulk).length;
  const all = rows.filter((t) => t.load === "all").length;
  const selected = rows.filter((t) => t.load === "selected").length;
  const columns = totals?.columns ?? rows.reduce((a, t) => a + t.columns, 0);
  return (
    <KpiGrid id="schema-kpis" label="Schema totals">
      <Kpi
        label="Tables in the published schema"
        value={int(totals?.tables ?? rows.length)}
        note="Every table the schema defines"
      />
      <Kpi
        label="With a public bulk file"
        value={int(totals?.tablesWithBulk ?? bulk)}
        note={`${pct(sharePct(totals?.tablesWithBulk ?? bulk, totals?.tables ?? rows.length), 0)} of the tables`}
      />
      <Kpi
        label="Loaded in this project"
        value={int(all + selected)}
        note={`${int(all)} with all columns as text; ${int(selected)} with selected columns`}
      />
      <Kpi
        label="Columns"
        value={int(columns)}
        note={
          totals?.columnsWithDescription != null
            ? `${int(totals.columnsWithDescription)} have a description in the schema`
            : undefined
        }
      />
      <Kpi
        label="Foreign keys"
        value={totals?.foreignKeys == null ? NOT_RECORDED : int(totals.foreignKeys)}
        note="Links between tables, as defined"
      />
    </KpiGrid>
  );
}

function TablesTable({ list, search, onSearch }: TabProps & { list: Listed<SchemaTableRow> }) {
  const spec = parseSort(search.sort, SCHEMA_SORT_KEYS, SCHEMA_DEFAULT_SORT);
  const groups = useMemo(
    () =>
      countedOptions(list.rows.map((t) => t.group)).map((o) => ({
        id: o.id,
        label: `${o.label} (${int(o.count)})`,
      })),
    [list.rows],
  );
  const shown = useMemo(
    () =>
      sortSchemaTables(
        filterSchemaTables(list.rows, {
          q: search.q,
          group: search.group,
          bulk: search.bulk,
          loaded: search.loaded,
        }),
        spec,
      ),
    [list.rows, search.q, search.group, search.bulk, search.loaded, spec],
  );
  const filtered = Boolean(search.q || search.group || search.bulk || search.loaded);
  const clear = () =>
    onSearch({ q: undefined, group: undefined, bulk: undefined, loaded: undefined });
  const sortBy = (key: string) =>
    onSearch({
      sort: encodeSort(
        nextSort(spec, key as typeof spec.key, !["table", "group", "load"].includes(key)),
        SCHEMA_DEFAULT_SORT,
      ),
    });
  const cols: Col<SchemaTableRow>[] = [
    {
      key: "table",
      label: "Table",
      sortKey: "table",
      render: (t) => (
        <>
          <SelectLink search={search} patch={{ sel: t.table }} selected={search.sel === t.table}>
            <span className="font-mono">{t.table}</span>
          </SelectLink>
          <span className="block text-[11px] text-muted-foreground">{t.label}</span>
        </>
      ),
    },
    { key: "group", label: "Group", sortKey: "group", hideBelow: "lg", render: (t) => t.group },
    {
      key: "bulk",
      label: "Bulk file",
      title: "Whether CourtListener publishes a bulk file for the table",
      render: (t) =>
        t.bulk ? "Yes" : <span className="font-medium text-warning-foreground">No</span>,
    },
    {
      key: "loaded",
      label: "Loaded here",
      title: "How this project holds the table",
      sortKey: "load",
      render: (t) => loadShort(t.load),
    },
    {
      key: "columns",
      label: "Columns",
      sortKey: "columns",
      align: "right",
      hideBelow: "lg",
      render: (t) => int(t.columns),
    },
    {
      key: "rows",
      label: "Rows loaded",
      title: "Rows loaded into this project's copy of the table",
      sortKey: "rowsLoaded",
      align: "right",
      render: (t) =>
        t.load === "none" ? (
          <span className="font-sans text-muted-foreground">No bulk file</span>
        ) : t.load === "not_loaded" ? (
          <span className="font-sans text-muted-foreground">Not loaded</span>
        ) : (
          <NumText v={t.rowsLoaded} />
        ),
    },
    {
      key: "mb",
      label: "Compressed",
      title: "Size of the table's compressed bulk file",
      sortKey: "compressedMb",
      align: "right",
      hideBelow: "lg",
      render: (t) =>
        t.load === "none" ? (
          <span className="font-sans text-muted-foreground">No bulk file</span>
        ) : (
          megabytes(t.compressedMb)
        ),
    },
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <SearchBox
          value={search.q}
          onChange={(q) => onSearch({ q })}
          label="Search tables"
          placeholder="Search table or what it holds"
        />
        <FilterSelect
          label="Group"
          value={search.group}
          onChange={(group) => onSearch({ group })}
          options={groups}
          allLabel="All groups"
        />
        <FilterSelect
          label="Bulk file"
          value={search.bulk}
          onChange={(bulk) =>
            onSearch({ bulk: bulk === "yes" || bulk === "no" ? bulk : undefined })
          }
          options={[
            { id: "yes", label: "Has a public bulk file" },
            { id: "no", label: "No public bulk file" },
          ]}
          allLabel="Either"
        />
        <FilterSelect
          label="Loaded"
          value={search.loaded}
          onChange={(loaded) =>
            onSearch({
              loaded:
                loaded === "none" ||
                loaded === "not_loaded" ||
                loaded === "selected" ||
                loaded === "all"
                  ? loaded
                  : undefined,
            })
          }
          options={[
            { id: "all", label: "All columns, as text" },
            { id: "selected", label: "Selected columns" },
            { id: "not_loaded", label: "Bulk file, not loaded" },
            { id: "none", label: "No bulk file" },
          ]}
          allLabel="Any"
        />
        <span className="text-[11px] text-muted-foreground" role="status">
          Showing {int(shown.length)} of {int(list.rows.length)} tables
        </span>
        {filtered ? <ResetButton onClick={clear} /> : null}
      </div>
      {shown.length ? (
        <DataTable
          label="Tables in the published schema"
          caption="Tables with group, bulk-file status, load status, columns, rows loaded and compressed size"
          columns={cols}
          rows={shown}
          rowKey={(t) => t.table}
          sort={{ key: spec.key, desc: spec.desc }}
          onSort={sortBy}
          selectedKey={selOf(search)}
          minWidth="min-w-[38rem]"
          pageSize={60}
          resetKey={`${search.q ?? ""}|${search.group ?? ""}|${search.bulk ?? ""}|${search.loaded ?? ""}|${search.sort ?? ""}`}
          noun="tables"
        />
      ) : (
        <StateNote action={<ResetButton onClick={clear} />}>
          No table matches these filters.
        </StateNote>
      )}
      <ListCoverage
        loaded={list.rows.length}
        total={list.total}
        dropped={list.dropped}
        noun="tables"
      />
    </>
  );
}

function TableDrill({
  search,
  onSearch,
  list,
}: TabProps & { list: UseQueryResult<Listed<SchemaTableRow>> }) {
  const table = selOf(search);
  const detail = useQuery({ ...schemaTableQuery(table ?? ""), enabled: Boolean(table) });
  const row = table ? (list.data?.rows.find((t) => t.table === table) ?? null) : null;
  return (
    <DrillPanel
      id="schema-detail"
      title="Table drill-down"
      hint="Select a table to see its columns, types, schema comments and foreign keys, and for loaded tables how much of each column is populated."
      selected={table}
      ready={!detail.isLoading}
      subtitle={row ? `${row.table}: ${row.label}` : undefined}
      onClear={() => onSearch({ sel: undefined })}
    >
      <QueryPanel
        query={detail}
        label="Loading the table's columns"
        errorText="The columns of this table could not be loaded."
        emptyText="This table is not in the published schema listing."
      >
        {(d) => <TableDetailBody d={d} row={row} search={search} tables={list.data?.rows ?? []} />}
      </QueryPanel>
    </DrillPanel>
  );
}

function TableDetailBody({
  d,
  row,
  search,
  tables,
}: {
  d: SchemaTableDetail;
  row: SchemaTableRow | null;
  search: TabProps["search"];
  tables: readonly SchemaTableRow[];
}) {
  const known = new Set(tables.map((t) => t.table));
  const cols: Col<SchemaTableDetail["columns"][number]>[] = [
    { key: "name", label: "Column", render: (c) => <span className="font-mono">{c.name}</span> },
    {
      key: "type",
      label: "Type",
      render: (c) => <span className="font-mono text-[11px]">{c.type}</span>,
    },
    {
      key: "required",
      label: "Required",
      title: "Declared NOT NULL in the schema",
      hideBelow: "lg",
      render: (c) => (c.notNull ? "Yes" : "No"),
    },
    {
      key: "bulk",
      label: "In bulk file",
      hideBelow: "lg",
      render: (c) => (d.load === "none" ? "No bulk file" : c.inBulkFile ? "Yes" : "No"),
    },
    {
      key: "populated",
      label: "Populated",
      title:
        "Non-null share of the rows loaded into this project's copy; dates and numbers that failed to parse count as not populated",
      align: "right",
      render: (c) =>
        d.load === "none" ? (
          <span className="font-sans text-muted-foreground">No bulk file</span>
        ) : !c.loadedHere ? (
          <span className="font-sans text-muted-foreground">Not loaded here</span>
        ) : c.populatedPct == null ? (
          <span className="font-sans text-muted-foreground">{NOT_RECORDED}</span>
        ) : (
          <CellBar
            value={c.populatedPct}
            max={100}
            label={pct(c.populatedPct, c.populatedPct >= 99.95 || c.populatedPct === 0 ? 0 : 2)}
          />
        ),
    },
    {
      key: "comment",
      label: "Schema comment",
      hideBelow: "xl",
      render: (c) =>
        c.comment ? (
          <span className="text-muted-foreground">{c.comment}</span>
        ) : (
          <span className="text-muted-foreground">–</span>
        ),
    },
  ];
  return (
    <div className="space-y-3 p-3">
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Fact label="Group" value={d.group} />
        <Fact label="Bulk file" value={d.bulkFile ?? "None published"} mono />
        <Fact label="Loaded here" value={loadShort(d.load)} />
        <Fact label="Rows loaded" value={d.rowsLoaded == null ? NOT_RECORDED : int(d.rowsLoaded)} />
        <Fact label="Columns" value={int(d.columns.length)} />
        <Fact label="Compressed bulk file" value={megabytes(row?.compressedMb)} />
        <Fact label="Foreign keys out" value={int(d.foreignKeys.length)} />
        <Fact
          label="Referenced by"
          value={row ? `${int(row.referencedBy)} tables` : NOT_RECORDED}
        />
      </dl>
      {d.load === "none" ? (
        <Callout tone="warning">
          This table has no public bulk file, so nothing in it can be derived from the bulk data.
          The columns below are the schema&apos;s definition only.
        </Callout>
      ) : null}
      {d.schemaUrl || d.loadScriptUrl ? (
        <p className="flex flex-wrap gap-3 text-xs">
          {d.schemaUrl ? <SourceLink href={d.schemaUrl}>Published schema (SQL)</SourceLink> : null}
          {d.loadScriptUrl ? (
            <SourceLink href={d.loadScriptUrl}>Bulk-data load script</SourceLink>
          ) : null}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-md border border-border">
        <DataTable
          label={`Columns of ${d.table}`}
          caption={`Columns of ${d.table} with type, whether required, bulk-file presence and populated share`}
          columns={cols}
          rows={d.columns}
          rowKey={(c) => c.name}
          minWidth="min-w-[34rem]"
          pageSize={80}
          maxHeight="max-h-[22rem]"
          noun="columns"
        />
      </div>
      {d.foreignKeys.length ? (
        <div className="text-xs">
          <p className="mb-1 font-medium">Foreign keys</p>
          <ul className="space-y-0.5">
            {d.foreignKeys.map((fk) => (
              <li
                key={`${fk.column}>${fk.references}.${fk.referencedColumn}`}
                className="font-mono text-[11px]"
              >
                {fk.column} →{" "}
                {known.has(fk.references) ? (
                  <SelectLink search={search} patch={{ sel: fk.references }} selected={false}>
                    {fk.references}
                  </SelectLink>
                ) : (
                  fk.references
                )}
                .{fk.referencedColumn}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[11px] leading-4 text-muted-foreground">
        Populated is the non-null share of the rows loaded into this project&apos;s copy of the
        table
        {d.rowsLoaded != null ? ` (${int(d.rowsLoaded)} rows)` : ""}. Columns not loaded here, or in
        a table with no bulk file, have no populated share.
      </p>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-border px-2 py-1">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={`break-words text-xs font-semibold ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
