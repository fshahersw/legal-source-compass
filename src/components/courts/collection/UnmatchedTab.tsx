import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Kpi, Panel, SourceLink } from "@/components/enforcement/parts";
import { FilterSelect, ResetButton, SearchBox } from "@/components/courts/caseload/CaseloadParts";
import { encodeSort, nextSort, parseSort } from "@/components/courts/caseload/caseloadTables";
import { ShareBars } from "@/components/courts/clb/ClbParts";
import { fmtInt, fmtPct, NOT_RECORDED } from "@/components/courts/clb/clbFormat";
import {
  getClbUnmatchedDetail,
  getClbUnmatchedList,
  type UnmatchedDetail,
  type UnmatchedList,
  type UnmatchedRow,
} from "@/lib/external/clbCitationExtras.functions";
import { selOf } from "./collectionSearch";
import { DEFAULT_SORT, KINDS, SORT_KEYS, unmatchedRows, type SortKey } from "./unmatchedRows";
import {
  Callout,
  DataTable,
  KpiGrid,
  KpiSkeleton,
  QueryPanel,
  SelectLink,
  type Col,
  type TabProps,
} from "./CollectionParts";

const FILE_URL =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/unmatched-citations-2026-09-30.csv.bz2";
const STALE = 10 * 60 * 1000;
const unmatchedListQuery = {
  queryKey: ["clb-unmatched-list"],
  queryFn: () => getClbUnmatchedList(),
  staleTime: STALE,
};
const detailQuery = (id: string) => ({
  queryKey: ["clb-unmatched", id],
  queryFn: () => getClbUnmatchedDetail({ data: { id } }),
  staleTime: STALE,
});

export function UnmatchedTab({ search, onSearch }: TabProps) {
  const query = useQuery(unmatchedListQuery);
  return (
    <div className="space-y-3">
      <Kpis query={query} />
      <Callout>
        Source links each citation it finds in an opinion to the case it names. These are the
 citations it could <strong className="font-semibold text-foreground">not</strong> link when
        the opinion was processed: Westlaw and LEXIS numbers, slip opinions, reporters it does not
        hold, and citations that fit more than one case. The status says what happened since.
        Unmatched does not mean the citation is wrong.{" "}
        <SourceLink href={FILE_URL}>Bulk file</SourceLink>
      </Callout>
      <QueryPanel
        query={query}
        label="Loading unresolved citations"
        errorText="The unresolved citations could not be loaded."
        emptyText="The unresolved-citation figures have not been published yet."
        isEmpty={(d) => !d.rows.length && !d.overview}
      >
        {(d) => <Body d={d} search={search} onSearch={onSearch} />}
      </QueryPanel>
    </div>
  );
}

function Kpis({ query }: { query: UseQueryResult<UnmatchedList> }) {
  if (query.isLoading) return <KpiSkeleton n={4} />;
  const o = query.data?.overview;
  if (!o) return null;
  const resolved = o.statuses.find((s) => s.code === 3);
  const ambiguous = o.statuses.find((s) => s.code === 4);
  return (
    <KpiGrid id="unmatched-kpis" label="Unresolved citations at a glance" cols={4}>
      <Kpi
        label="Citations not matched when processed"
        value={fmtInt(o.citations)}
        note="one row per citing opinion and citation"
      />
      <Kpi
        label="Still unresolved"
        value={fmtPct(o.unresolvedPct)}
        note="not found, ambiguous or failed"
      />
      <Kpi
        label="Fit more than one case"
        value={ambiguous ? fmtInt(ambiguous.n) : NOT_RECORDED}
        note={ambiguous ? fmtPct(ambiguous.sharePct) : undefined}
      />
      <Kpi
        label="Resolved later"
        value={resolved ? fmtInt(resolved.n) : NOT_RECORDED}
        note={resolved ? `${fmtPct(resolved.sharePct)} now matched and relinked` : undefined}
      />
    </KpiGrid>
  );
}

function Body({ d, search, onSearch }: TabProps & { d: UnmatchedList }) {
  const sort = parseSort<SortKey>(search.sort, SORT_KEYS, DEFAULT_SORT);
  const kind = search.group === "court" ? "court" : "reporter";
  const rows = useMemo(
    () => unmatchedRows(d.rows, kind, search.q, sort),
    [d.rows, kind, search.q, sort],
  );
  const sel = selOf(search);
  const o = d.overview;
  const columns: Col<UnmatchedRow>[] = [
    {
      key: "name",
      label: kind === "court" ? "Citing court" : "Reporter (as parsed)",
      sortKey: "name",
      render: (r) => (
        <SelectLink
          search={search}
          patch={{ sel: sel === r.id ? undefined : r.id }}
          selected={sel === r.id}
        >
          {r.name}
        </SelectLink>
      ),
    },
    {
      key: "citations",
      label: "Unmatched",
      align: "right",
      sortKey: "citations",
      render: (r) => fmtInt(r.citations),
    },
    {
      key: "distinct",
      label: "Distinct",
      align: "right",
      render: (r) => fmtInt(r.distinct),
      hideBelow: "lg",
    },
    {
      key: "opinions",
      label: "Citing opinions",
      align: "right",
      sortKey: "opinions",
      render: (r) => fmtInt(r.opinions),
    },
    {
      key: "unresolved",
      label: "Still unresolved",
      align: "right",
      sortKey: "unresolved",
      title: "Share with status not found, ambiguous or failed",
      render: (r) => fmtPct(r.unresolvedPct),
    },
    kind === "reporter"
      ? {
          key: "type",
          label: "Citation type",
          render: (r) => r.type ?? NOT_RECORDED,
          hideBelow: "lg",
        }
      : {
          key: "type",
          label: "Most frequent type",
          render: (r) => r.type ?? NOT_RECORDED,
          hideBelow: "lg",
        },
    ...(kind === "reporter"
      ? [
          {
            key: "table",
            label: "Held by CourtListener",
            title:
              "Whether CourtListener's citation table holds any citation with this reporter string",
            render: (r: UnmatchedRow) =>
              r.inCitationTable == null ? NOT_RECORDED : r.inCitationTable ? "Yes" : "No",
          } as Col<UnmatchedRow>,
        ]
      : []),
  ];
  return (
    <>
      {o ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel
            title="Status"
            subtitle="What has happened to the unmatched citations since they were found; shares of all of them."
          >
            <div className="p-3">
              <ShareBars
                heading="Citations by status"
                rows={o.statuses.map((s) => ({
                  key: String(s.code),
                  label: s.label,
                  count: s.n,
                  sharePct: s.sharePct,
                }))}
                whole={o.citations}
              />
            </div>
          </Panel>
          <Panel
            title="Citation type"
            subtitle="The type of the reporter; shares of all unmatched citations."
          >
            <div className="p-3">
              <ShareBars
                heading="Citations by type"
                rows={o.types.map((s) => ({
                  key: String(s.code),
                  label: s.label,
                  count: s.n,
                  sharePct: s.sharePct,
                }))}
                whole={o.citations}
              />
            </div>
          </Panel>
        </div>
      ) : null}
      <Panel
        id="unmatched-table"
        title={kind === "court" ? "Citing courts" : "Reporters"}
        subtitle={
          kind === "court"
            ? `Courts whose opinions hold at least ${fmtInt(o?.minCourt)} unmatched citations. Select a court for its reporters and years.`
            : `Reporters with at least ${fmtInt(o?.minReporter)} unmatched citations${o?.reportersTotal ? ` (of ${fmtInt(o.reportersTotal)} reporter strings)` : ""}. Select one for its most frequent citations and citing courts.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Show"
              value={kind}
              onChange={(v) =>
                onSearch({ group: v === "court" ? "court" : undefined, sel: undefined })
              }
              options={KINDS}
              allLabel="Reporters"
            />
            <SearchBox
              value={search.q}
              onChange={(v) => onSearch({ q: v, sel: undefined })}
              label="Filter by name"
              placeholder={kind === "court" ? "Court name" : "Reporter"}
            />
            {search.q || search.group ? (
              <ResetButton
                onClick={() => onSearch({ q: undefined, group: undefined, sel: undefined })}
              />
            ) : null}
          </div>
        }
      >
        {rows.length ? (
          <DataTable
            label={
              kind === "court"
                ? "Citing courts with unmatched citations"
                : "Reporters with unmatched citations"
            }
            caption="Unmatched citations"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            sort={sort}
            onSort={(k) =>
              onSearch({
                sort: encodeSort(nextSort(sort, k as SortKey, k !== "name"), DEFAULT_SORT),
              })
            }
            expanded={{ key: sel, render: (r) => <Detail id={r.id} /> }}
            resetKey={`${kind}|${search.q ?? ""}`}
            minWidth="min-w-[40rem]"
            noun={kind === "court" ? "courts" : "reporters"}
          />
        ) : (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No {kind === "court" ? "court" : "reporter"} matches the filter.
          </p>
        )}
      </Panel>
    </>
  );
}

function Detail({ id }: { id: string }) {
  const q = useQuery(detailQuery(id));
  return (
    <div className="p-3">
      <QueryPanel
        query={q}
        label="Loading the detail"
        errorText="The detail could not be loaded."
        emptyText="No detail is recorded for this row."
        skeleton={<div className="h-28 animate-pulse rounded-md bg-muted/50" aria-busy="true" />}
      >
        {(d) => <DetailBody d={d} />}
      </QueryPanel>
    </div>
  );
}

function DetailBody({ d }: { d: UnmatchedDetail }) {
  const total = d.statuses.reduce((a, s) => a + s.n, 0);
  return (
    <div className="grid gap-4 text-xs lg:grid-cols-3">
      <ShareBars
        heading="Status"
        rows={d.statuses
          .filter((s) => s.n)
          .map((s) => ({ key: String(s.code), label: s.label, count: s.n, sharePct: s.sharePct }))}
        whole={total}
      />
      {d.kind === "reporter" ? (
        <div className="min-w-0">
          <h4 className="text-xs font-medium">Cited most often without a match</h4>
          <ol className="mt-1 space-y-0.5">
            {d.topCitations.map((c) => (
              <li key={c.citation} className="flex justify-between gap-2">
                <span className="min-w-0 break-words font-mono">{c.citation}</span>
                <span className="shrink-0 text-muted-foreground" title={c.status ?? undefined}>
                  {fmtInt(c.n)}
                  {c.mixed ? " · mixed status" : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {d.inCitationTable
              ? `CourtListener's citation table holds ${fmtInt(d.inCitationTable.citations)} citations with this reporter string.`
              : "CourtListener's citation table holds no citation with this reporter string."}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">
          {d.opinionsWithUnmatchedPct != null
            ? `${fmtPct(d.opinionsWithUnmatchedPct)} of the court's ${fmtInt(d.courtOpinions)} opinions in the collection hold at least one unmatched citation.`
            : NOT_RECORDED}
        </p>
      )}
      <ShareBars
        heading={d.kind === "reporter" ? "Citing courts" : "Reporters most often unmatched"}
        note={
          d.kind === "reporter"
            ? "Shares of the citations whose citing opinion has a court."
            : "Shares of this court's unmatched citations."
        }
        rows={d.parts.map((p) => ({
          key: p.key,
          label: p.label,
          count: p.n,
          sharePct: p.sharePct,
          courtId: p.link ? p.key : undefined,
        }))}
      />
    </div>
  );
}
