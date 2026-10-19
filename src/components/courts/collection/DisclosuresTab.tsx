import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { int } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { Kpi, Panel, StateNote } from "@/components/enforcement/parts";
import {
  FilterSelect,
  ListCoverage,
  ResetButton,
  SearchBox,
} from "@/components/courts/caseload/CaseloadParts";
import { longDate } from "@/components/courts/caseload/caseloadFormat";
import type {
  DisclosureData,
  DisclosureYear,
  Listed,
} from "@/lib/external/clbCollection.functions";
import { disclosuresQuery, notesQuery } from "./collectionQueries";
import {
  countedOptions,
  NOT_RECORDED,
  pct,
  sharePct,
  thinYears,
  yearRuns,
  SERIES_COLORS,
} from "./collectionFormat";
import { disclosureTakeaways } from "./collectionTakeaways";
import {
  DISC_DEFAULT_SORT,
  DISC_SORT_KEYS,
  disclosureCourtRows,
  encodeSort,
  filterDisclosureCourts,
  nextSort,
  parseSort,
  sortDisclosureCourts,
  type DisclosureCourtRow,
} from "./collectionTables";
import {
  Callout,
  CellBar,
  CourtLink,
  DataTable,
  KpiGrid,
  KpiSkeleton,
  NoteReference,
  NumText,
  PctText,
  QueryPanel,
  type Col,
  type TabProps,
} from "./CollectionParts";
import { ShareBars, YearBars } from "./CollectionVisuals";

export function DisclosuresTab({ search, onSearch }: TabProps) {
  const query = useQuery(disclosuresQuery);
  const notes = useQuery(notesQuery);
  const note = notes.data?.disclosures ?? null;
  const takeaways = useMemo(() => disclosureTakeaways(query.data ?? null), [query.data]);
  const thin = useMemo(
    () => thinYears(query.data?.years.rows ?? [], (y) => y.reports),
    [query.data],
  );
  return (
    <div className="space-y-3">
      <DisclosureKpis query={query} />
      <Callout id="disclosures-scope">
        <strong className="font-semibold text-foreground">
          Counts only: no holdings, amounts, creditors, gifts or descriptions are published here.
        </strong>{" "}
        Coverage is what CourtListener collected, not whether a judge was required to file.
        {query.data?.overview?.firstYear != null && query.data.overview.lastYear != null
          ? ` Filing years run ${query.data.overview.firstYear}–${query.data.overview.lastYear} in this snapshot${
              thin.size
                ? `, and ${yearRuns([...thin])} each hold under 5% of the busiest year's reports.`
                : "."
            }`
          : ""}
      </Callout>
      <KeyTakeaways
        items={takeaways}
        scope={
          longDate(note?.snapshot) ? `Disclosure coverage · ${longDate(note?.snapshot)}` : undefined
        }
        note="Computed from counts of reports, people and rows. Nothing in a report's contents is read or shown."
      />
      <YearsPanel query={query} />
      <SectionsPanel query={query} />
      <CourtsPanel query={query} search={search} onSearch={onSearch} />
      <NoteReference note={note} title="How to read the disclosure counts" />
    </div>
  );
}

function DisclosureKpis({ query }: { query: UseQueryResult<DisclosureData> }) {
  if (query.isLoading) return <KpiSkeleton />;
  const o = query.data?.overview;
  if (query.isError || !o)
    return (
      <QueryPanel
        query={query}
        label="Loading disclosure totals"
        errorText="The disclosure totals could not be loaded."
        emptyText="The disclosure totals are not recorded."
        isEmpty={(d) => d.overview == null}
      >
        {() => null}
      </QueryPanel>
    );
  const items = o.sections.length ? o.sections.reduce((a, s) => a + s.items, 0) : null;
  return (
    <KpiGrid id="disclosures-kpis" label="Disclosure totals">
      <Kpi
        label="Reports on file"
        value={int(o.reports)}
        note="Reports in CourtListener's collection"
      />
      <Kpi
        label="People with a report"
        value={o.people == null ? NOT_RECORDED : int(o.people)}
        note="People with at least one report"
      />
      <Kpi
        label="Filing years"
        value={
          o.firstYear != null && o.lastYear != null ? `${o.firstYear}–${o.lastYear}` : NOT_RECORDED
        }
        note="Sparse before 2003"
      />
      <Kpi
        label="Judicial people with a report"
        value={
          o.judicialPeople != null && o.judicialWithReport != null
            ? pct(sharePct(o.judicialWithReport, o.judicialPeople))
            : NOT_RECORDED
        }
        note={
          o.judicialPeople != null && o.judicialWithReport != null
            ? `${int(o.judicialWithReport)} of ${int(o.judicialPeople)} people with a judicial position on record`
            : undefined
        }
      />
      <Kpi
        label="Line items"
        value={items == null ? NOT_RECORDED : int(items)}
        note="Rows in the section tables; counts only"
      />
    </KpiGrid>
  );
}

function YearsPanel({ query }: { query: UseQueryResult<DisclosureData> }) {
  return (
    <Panel
      id="disclosures-years"
      title="Reports by filing year"
      subtitle="Reports in the collection by the year they were filed, with the share amended and with line items extracted"
      footnote="Amended and extracted are shares of the year's reports. A year with fewer than 5% of the busiest year's reports is drawn lighter: read it as thin coverage in the collection, not as fewer filings. Report type codes are stored as numbers the published schema does not describe, so they are not decoded here."
    >
      <QueryPanel
        query={query}
        label="Loading reports by year"
        errorText="The reports by filing year could not be loaded."
        emptyText="The reports by filing year are not recorded."
        isEmpty={(d) => !d.years.rows.length}
        skeleton={<div className="h-64 animate-pulse bg-muted/50" aria-busy="true" />}
      >
        {(d) => <YearsBody years={d.years} />}
      </QueryPanel>
    </Panel>
  );
}

function YearsBody({ years }: { years: Listed<DisclosureYear> }) {
  const thin = thinYears(years.rows, (y) => y.reports);
  const cols: Col<DisclosureYear>[] = [
    {
      key: "year",
      label: "Filing year",
      render: (y) => <span className="font-mono">{y.year}</span>,
    },
    { key: "reports", label: "Reports", align: "right", render: (y) => int(y.reports) },
    {
      key: "people",
      label: "People",
      title: "People with a report filed in the year",
      align: "right",
      render: (y) => <NumText v={y.people} />,
    },
    {
      key: "amended",
      label: "Amended %",
      title: "Share of the year's reports marked amended",
      align: "right",
      render: (y) => <PctText v={sharePct(y.amended, y.reports)} />,
    },
    {
      key: "extracted",
      label: "Extracted %",
      title: "Share of the year's reports with extracted line items",
      align: "right",
      render: (y) => <PctText v={sharePct(y.extracted, y.reports)} />,
    },
    {
      key: "pages",
      label: "Median pages",
      align: "right",
      hideBelow: "lg",
      render: (y) => (y.medianPages == null ? NOT_RECORDED : y.medianPages.toLocaleString("en-US")),
    },
    {
      key: "items",
      label: "Line items",
      title: "Rows in the report section tables for the year's reports",
      align: "right",
      render: (y) => <NumText v={y.lineItems} />,
    },
    {
      key: "perReport",
      label: "Items per report",
      title: "Line items divided by the year's reports",
      align: "right",
      hideBelow: "lg",
      render: (y) => {
        const v = y.lineItems != null && y.reports > 0 ? y.lineItems / y.reports : null;
        return v == null ? NOT_RECORDED : v.toLocaleString("en-US", { maximumFractionDigits: 1 });
      },
    },
    {
      key: "thin",
      label: "Coverage",
      render: (y) =>
        thin.has(y.year) ? (
          <span className="rounded border border-warning/40 bg-warning/15 px-1 py-px text-[10px] font-medium text-warning-foreground">
            Thin
          </span>
        ) : (
          ""
        ),
    },
  ];
  return (
    <>
      <YearBars
        rows={years.rows.map((y) => ({
          label: String(y.year),
          thin: thin.has(y.year),
          values: { reports: y.reports },
        }))}
        series={[{ key: "reports", label: "Reports filed", color: SERIES_COLORS[0]! }]}
        subject="financial-disclosure reports in the collection by filing year"
        note={
          thin.size ? `${yearRuns([...thin])}: under 5% of the busiest year, drawn lighter` : null
        }
      />
      <details className="border-t border-border/60">
        <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          Table of filing years ({years.rows.length})
        </summary>
        <DataTable
          label="Reports by filing year"
          caption="Reports, people, amended and extracted shares and line items by filing year"
          columns={cols}
          rows={[...years.rows].sort((a, b) => b.year - a.year)}
          rowKey={(y) => String(y.year)}
          minWidth="min-w-[36rem]"
          pageSize={40}
          maxHeight="max-h-72"
          noun="years"
        />
      </details>
      <ListCoverage
        loaded={years.rows.length}
        total={years.total}
        dropped={years.dropped}
        noun="filing years"
      />
    </>
  );
}

function SectionsPanel({ query }: { query: UseQueryResult<DisclosureData> }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel
        id="disclosures-sections"
        title="Line items by section"
        subtitle="Rows in each section's table, whatever the rows contain"
      >
        <QueryPanel
          query={query}
          label="Loading line items"
          errorText="The line-item counts could not be loaded."
          emptyText="The line-item counts are not recorded."
          isEmpty={(d) => !d.overview?.sections.length}
        >
          {(d) => {
            const sections = d.overview?.sections ?? [];
            const total = sections.reduce((a, s) => a + s.items, 0);
            return (
              <>
                <ShareBars
                  id="disclosures-sections-list"
                  caption="Line items by section"
                  countLabel="Line items (rows)"
                  limit={8}
                  rows={sections.map((s) => ({
                    key: s.section,
                    label: s.section,
                    count: s.items,
                    sharePct: sharePct(s.items, total),
                    group: null,
                  }))}
                />
                <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
                  Shares are of all {int(total)} line items. One row per listed item, whatever its
                  value; no value, creditor, asset or description is shown.
                </p>
              </>
            );
          }}
        </QueryPanel>
      </Panel>
      <Panel
        id="disclosures-people"
        title="People by number of reports"
        subtitle="People with at least one report in the collection"
      >
        <QueryPanel
          query={query}
          label="Loading reports per person"
          errorText="The reports-per-person counts could not be loaded."
          emptyText="The reports-per-person counts are not recorded."
          isEmpty={(d) => !d.overview?.reportsPerPerson.length}
        >
          {(d) => {
            const buckets = d.overview?.reportsPerPerson ?? [];
            const total = buckets.reduce((a, b) => a + b.people, 0);
            return (
              <>
                <ShareBars
                  id="disclosures-people-list"
                  caption="People by number of reports"
                  countLabel="People"
                  limit={6}
                  rows={buckets.map((b) => ({
                    key: b.bucket,
                    label: `${b.bucket} ${b.bucket === "1" ? "report" : "reports"}`,
                    count: b.people,
                    sharePct: sharePct(b.people, total),
                    group: null,
                  }))}
                />
                <p className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
                  Shares are of the {int(total)} people with a report.
                </p>
              </>
            );
          }}
        </QueryPanel>
      </Panel>
    </div>
  );
}

function CourtsPanel({
  query,
  search,
  onSearch,
}: TabProps & { query: UseQueryResult<DisclosureData> }) {
  return (
    <Panel
      id="disclosures-courts"
      title="Coverage by court"
      subtitle="The share of people with a judicial position on record at each court who have at least one report"
      footnote="Coverage is a share of people, not of years served: people are matched to a court by their position records and to reports by person id, and a report follows the person to any court. A person can hold positions at more than one court, so the rows do not add to the totals. Courts with fewer than five people on record are not listed."
    >
      <QueryPanel
        query={query}
        label="Loading court coverage"
        errorText="The court coverage could not be loaded."
        emptyText="The court coverage is not recorded."
        isEmpty={(d) => !d.courts.rows.length}
      >
        {(d) => <CourtsTable courts={d.courts} search={search} onSearch={onSearch} />}
      </QueryPanel>
    </Panel>
  );
}

function CourtsTable({
  courts,
  search,
  onSearch,
}: TabProps & { courts: Listed<DisclosureData["courts"]["rows"][number]> }) {
  const rows = useMemo(() => disclosureCourtRows(courts.rows), [courts.rows]);
  const spec = parseSort(search.sort, DISC_SORT_KEYS, DISC_DEFAULT_SORT);
  const levels = useMemo(
    () =>
      countedOptions(rows.map((c) => c.level)).map((o) => ({
        id: o.id,
        label: `${o.label} (${int(o.count)})`,
      })),
    [rows],
  );
  const shown = useMemo(
    () =>
      sortDisclosureCourts(
        filterDisclosureCourts(rows, { q: search.q, level: search.level }),
        spec,
      ),
    [rows, search.q, search.level, spec],
  );
  const filtered = Boolean(search.q || search.level);
  const clear = () => onSearch({ q: undefined, level: undefined });
  const sortBy = (key: string) =>
    onSearch({
      sort: encodeSort(
        nextSort(spec, key as typeof spec.key, !["name", "level"].includes(key)),
        DISC_DEFAULT_SORT,
      ),
    });
  const cols: Col<DisclosureCourtRow>[] = [
    {
      key: "name",
      label: "Court",
      sortKey: "name",
      render: (c) => (
        <CourtLink courtId={c.id} href={c.href}>
          {c.name}
        </CourtLink>
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
      key: "people",
      label: "People on record",
      title: "People with a judicial position at the court on record",
      sortKey: "people",
      align: "right",
      render: (c) => int(c.people),
    },
    {
      key: "withReport",
      label: "With a report",
      title: "Of those, people with at least one report",
      sortKey: "withReport",
      align: "right",
      render: (c) => int(c.withReport),
    },
    {
      key: "coverage",
      label: "Coverage %",
      title: "People with a report as a share of people on record at the court",
      sortKey: "coveragePct",
      align: "right",
      render: (c) => (
        <CellBar value={c.coveragePct} max={100} label={<PctText v={c.coveragePct} />} />
      ),
    },
    {
      key: "reports",
      label: "Reports",
      title: "Reports by those people, any court, any year",
      sortKey: "reports",
      align: "right",
      hideBelow: "lg",
      render: (c) => int(c.reports),
    },
    {
      key: "first",
      label: "First year",
      sortKey: "firstYear",
      align: "right",
      hideBelow: "xl",
      render: (c) => (c.firstYear == null ? NOT_RECORDED : c.firstYear),
    },
    {
      key: "last",
      label: "Last year",
      sortKey: "lastYear",
      align: "right",
      hideBelow: "xl",
      render: (c) => (c.lastYear == null ? NOT_RECORDED : c.lastYear),
    },
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <SearchBox
          value={search.q}
          onChange={(q) => onSearch({ q })}
          label="Search courts"
          placeholder="Search court name"
        />
        <FilterSelect
          label="Level"
          value={search.level}
          onChange={(level) => onSearch({ level })}
          options={levels}
          allLabel="All levels"
        />
        <span className="text-[11px] text-muted-foreground" role="status">
          Showing {int(shown.length)} of {int(rows.length)} courts
        </span>
        {filtered ? <ResetButton onClick={clear} /> : null}
      </div>
      {shown.length ? (
        <DataTable
          label="Disclosure coverage by court"
          caption="Courts with people on record, people with a report, coverage share and reports"
          columns={cols}
          rows={shown}
          rowKey={(c) => c.id}
          sort={{ key: spec.key, desc: spec.desc }}
          onSort={sortBy}
          minWidth="min-w-[38rem]"
          resetKey={`${search.q ?? ""}|${search.level ?? ""}|${search.sort ?? ""}`}
          noun="courts"
        />
      ) : (
        <StateNote action={<ResetButton onClick={clear} />}>
          No court matches these filters.
        </StateNote>
      )}
      <ListCoverage
        loaded={rows.length}
        total={courts.total}
        dropped={courts.dropped}
        noun="courts"
      />
    </>
  );
}
