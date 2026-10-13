import { useRegulatoryWorkspace } from "./useRegulatoryWorkspace";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Search, RefreshCw } from "lucide-react";
import {
  getRegulatoryOverview,
  queryRegulatoryEvents,
  queryRegulatoryEntities,
} from "@/lib/external/regulatory.functions";
import {
  REGULATORY_EVENT_TYPES,
  type RegulatoryEvent,
  type RegulatoryOverview,
  type RegulatoryQuery,
  type RegulatorySourceId,
} from "@/lib/regulatory/types";
import { RegulatoryQueryComposer } from "./RegulatoryQueryComposer";
import { RegulatoryEvidenceDrawer } from "./RegulatoryEvidenceDrawer";
import { RegulatoryCoverage } from "./RegulatoryCoverage";
import { RegulatoryTrends } from "./RegulatoryTrends";
import { RegulatoryReviewEditor, RegulatoryWorkspacePanel } from "./RegulatoryWorkspace";
import {
  actionClass,
  Empty,
  fieldClass,
  LoadError,
  panelClass,
  Pending,
} from "./RegulatoryPrimitives";
import {
  changeMonitoringFilters,
  displayCount,
  displayDate,
  EVENT_LABELS,
  MONITORING_VIEWS,
  monitoringQuery,
  normalizeMonitoringSearch,
  PAGE_SIZE,
  queryLabels,
  type MonitoringSearch,
} from "./monitoringView";

type Props = { search: MonitoringSearch; onSearch: (next: MonitoringSearch) => void };

export function RegulatoryMonitoring({ search, onSearch }: Props) {
  const query = monitoringQuery(search);
  const binding = JSON.stringify(query);
  const [selected, setSelected] = useState<RegulatoryEvent[]>([]);
  const workspace = useRegulatoryWorkspace();
  const overview = useQuery({
    queryKey: ["regulatory-overview"],
    queryFn: () => getRegulatoryOverview(),
    staleTime: 30000,
  });
  const invalidWindow = !!search.from && !!search.to && search.from > search.to;
  const invalidEntity = !!search.entityNamespace !== !!search.entityId;
  const events = useQuery({
    queryKey: ["regulatory-events", query],
    queryFn: () => queryRegulatoryEvents({ data: query }),
    enabled: search.view === "signals" && !invalidWindow && !invalidEntity,
    staleTime: 30000,
  });
  const entityQuery = {
    ...(query.q ? { q: query.q } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.sourceFamily ? { sourceFamily: query.sourceFamily } : {}),
    limit: PAGE_SIZE,
    offset: (search.page - 1) * PAGE_SIZE,
  };
  const entities = useQuery({
    queryKey: ["regulatory-entities", entityQuery],
    queryFn: () => queryRegulatoryEntities({ data: entityQuery }),
    enabled: search.view === "entities",
    staleTime: 30000,
  });
  useEffect(() => {
    setSelected([]);
  }, [binding]);
  function apply(next: RegulatoryQuery) {
    onSearch(
      normalizeMonitoringSearch({
        view: "signals",
        page: 1,
        ...next,
        offset: undefined,
        limit: undefined,
      }),
    );
  }
  function open(event: RegulatoryEvent) {
    onSearch({
      ...search,
      recordSource: event.source,
      recordId: event.nativeId,
      eventId: event.id,
    });
  }
  const sources = overview.data?.sources ?? [];
  const sourceLabel = (id: string) => sources.find((source) => source.id === id)?.label ?? id;
  const problems = sources.filter(
    (source) => source.latestAttemptStatus === "partial" || source.latestAttemptStatus === "failed",
  );
  return (
    <div className="space-y-2">
      <nav
        aria-label="Regulatory intelligence views"
        className="flex flex-wrap gap-1 border-b border-border pb-2"
      >
        {MONITORING_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            aria-current={search.view === view ? "page" : undefined}
            onClick={() =>
              onSearch({
                ...search,
                view,
                page:
                  (view === "entities" && search.view !== "entities") ||
                  (view === "signals" && search.view === "entities")
                    ? 1
                    : search.page,
                recordId: undefined,
                recordSource: undefined,
                eventId: undefined,
              })
            }
            className={`${actionClass} ${search.view === view ? "!border-primary !bg-primary !text-primary-foreground hover:!bg-primary/90" : "border-transparent"}`}
          >
            {view[0]!.toUpperCase() + view.slice(1)}
          </button>
        ))}
      </nav>
      {search.view !== "investigations" && search.view !== "coverage" && (
        <>
          <RegulatoryQueryComposer query={query} onApply={apply} />
          <Filters key={binding} search={search} overview={overview.data} onSearch={onSearch} />
        </>
      )}
      {overview.isError ? (
        <LoadError retry={() => void overview.refetch()}>
          Source health could not be refreshed. Public results may still load, but current
          collection status is unavailable.
        </LoadError>
      ) : (
        overview.data && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border py-2 text-xs text-muted-foreground">
            <span>
              <strong className="text-foreground">
                {displayCount(overview.data.counts.completedSources)}
              </strong>{" "}
              sources with completed capture
            </span>
            <span>
              <strong className="text-foreground">{problems.length}</strong> latest collection
              attempts incomplete or failed
            </span>
            <button
              type="button"
              className="min-h-8 text-primary underline"
              onClick={() => onSearch({ ...search, view: "coverage" })}
            >
              Inspect coverage
            </button>
            <button
              type="button"
              className="ml-auto flex min-h-8 items-center gap-1 text-primary underline"
              disabled={overview.isFetching}
              onClick={() => {
                void overview.refetch();
                if (search.view === "signals") void events.refetch();
                if (search.view === "entities") void entities.refetch();
              }}
            >
              <RefreshCw className="size-3" aria-hidden />
              {overview.isFetching ? "Refreshing…" : "Refresh recorded data"}
            </button>
          </div>
        )
      )}
      {(invalidWindow || invalidEntity) &&
        search.view !== "coverage" &&
        search.view !== "investigations" && (
          <p role="alert" className="rounded-md border border-warning/40 p-3 text-sm">
            {invalidWindow
              ? "The end date precedes the start date. Correct the date filters to load results."
              : "An exact entity filter needs both its namespace and native identifier. Clear or complete it before searching."}
          </p>
        )}
      {search.view === "signals" && !invalidWindow && !invalidEntity && (
        <section className={panelClass} aria-label="Source change queue">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-3">
            <div>
              <h2 className="font-sans text-base font-semibold">Source changes to review</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                An observed source change is a research lead, not a finding of injury or liability.
                Initial captures and backfills remain separately labeled.
              </p>
            </div>
            {selected.length > 0 && (
              <button
                type="button"
                className={actionClass}
                onClick={() => onSearch({ ...search, view: "investigations" })}
              >
                Use {selected.length} selected in a brief
                <ArrowRight className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
          {events.isPending ? (
            <Pending />
          ) : events.isError ? (
            <LoadError retry={() => void events.refetch()} />
          ) : !events.data.items.length ? (
            <Empty title="No retained events match these filters">
              Broaden the filters or check source coverage. This is not evidence that no relevant
              real-world events occurred.
            </Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  {displayCount(events.data.total)}
                  {events.data.totalCapped ? " (capped)" : ""} {events.data.countUnit} ·{" "}
                  {events.data.dateBasis === "published" ? "publisher date" : "first detected date"}
                </span>
                <span>{selected.length} selected on this page</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-sm">
                  <caption className="sr-only">
                    Versioned source events. Use each evidence button to open the retained document
                    and changes.
                  </caption>
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-10 px-3 py-2">
                        <span className="sr-only">Select for brief</span>
                      </th>
                      {["Record / subject", "Change and reason", "Source", "Dates", "Evidence"].map(
                        (label) => (
                          <th key={label} scope="col" className="px-3 py-2 font-medium">
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {events.data.items.map((event) => (
                      <tr
                        key={event.id}
                        className="border-t border-border align-top hover:bg-muted/20"
                      >
                        <td className="px-3 py-2">
                          <label className="flex min-h-10 items-center">
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              checked={selected.some((item) => item.id === event.id)}
                              onChange={(e) =>
                                setSelected((previous) =>
                                  e.target.checked
                                    ? [...previous.filter((item) => item.id !== event.id), event]
                                    : previous.filter((item) => item.id !== event.id),
                                )
                              }
                            />
                            <span className="sr-only">Select {event.record.title} for a brief</span>
                          </label>
                        </td>
                        <th scope="row" className="max-w-sm px-3 py-3 font-normal">
                          <button
                            type="button"
                            className="text-left font-semibold text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                            onClick={() => open(event)}
                          >
                            {event.record.title}
                          </button>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {event.record.document_type} · {event.nativeId}
                          </p>
                          {event.record.entity_refs.slice(0, 2).map((entity, i) => (
                            <p className="mt-1 text-xs" key={i}>
                              {entity.label}{" "}
                              <span className="text-muted-foreground">
                                ({entity.namespace}: {entity.native_id})
                              </span>
                            </p>
                          ))}
                        </th>
                        <td className="max-w-xs px-3 py-3">
                          <span className="rounded-md border border-border px-1.5 py-0.5 text-xs">
                            {EVENT_LABELS[event.eventType]}
                          </span>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {event.reason}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-xs">{sourceLabel(event.source)}</td>
                        <td className="px-3 py-3 text-xs">
                          <p>Published: {displayDate(event.record.published_on)}</p>
                          <p className="mt-1 text-muted-foreground">Detected: {event.detectedAt}</p>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className={actionClass}
                            aria-label={`Open evidence for ${event.record.title}`}
                            onClick={() => open(event)}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={search.page}
                next={events.data.nextOffset}
                onPage={(page) => onSearch({ ...search, page })}
              />
            </>
          )}
        </section>
      )}
      {search.view === "trends" && !invalidWindow && !invalidEntity && (
        <RegulatoryTrends
          query={query}
          onRange={(range) => onSearch(changeMonitoringFilters(search, range))}
        />
      )}
      {search.view === "entities" && (
        <section className={panelClass}>
          <div className="border-b border-border p-3">
            <h2 className="font-sans text-base font-semibold">Recorded source identities</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Exact namespace and native identifier only. Similar names are not merged. Date,
              event-type and existing entity filters do not restrict this identity directory.
            </p>
          </div>
          {entities.isPending ? (
            <Pending />
          ) : entities.isError ? (
            <LoadError retry={() => void entities.refetch()} />
          ) : !entities.data.items.length ? (
            <Empty title="No recorded identities match">
              Some sources provide only a name or narrative; those records do not establish an exact
              entity relationship.
            </Empty>
          ) : (
            <>
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {displayCount(entities.data.total)}
                {entities.data.totalCapped ? " (capped)" : ""} source-native identities ·{" "}
                {entities.data.qualification}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <caption className="sr-only">Exact source entity directory</caption>
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      {[
                        "Recorded labels",
                        "Exact identity",
                        "Source records",
                        "Sources",
                        "Action",
                      ].map((label) => (
                        <th key={label} scope="col" className="px-3 py-2 font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entities.data.items.map((entity) => (
                      <tr
                        className="border-t border-border align-top"
                        key={`${entity.namespace}:${entity.nativeId}`}
                      >
                        <th scope="row" className="px-3 py-3 text-left font-medium">
                          {entity.labels.length ? entity.labels.join(" · ") : "Label not recorded"}
                        </th>
                        <td className="px-3 py-3 text-xs">
                          {entity.namespace} / {entity.nativeId}
                        </td>
                        <td className="px-3 py-3 tabular-nums">{displayCount(entity.records)}</td>
                        <td className="px-3 py-3 text-xs">
                          {entity.sources.map(sourceLabel).join(" · ")}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            className={actionClass}
                            type="button"
                            onClick={() =>
                              onSearch(
                                changeMonitoringFilters(search, {
                                  view: "signals",
                                  q: undefined,
                                  entityNamespace: entity.namespace,
                                  entityId: entity.nativeId,
                                }),
                              )
                            }
                          >
                            View evidence
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={search.page}
                next={entities.data.nextOffset}
                onPage={(page) => onSearch({ ...search, page })}
              />
            </>
          )}
        </section>
      )}
      {search.view === "investigations" && (
        <RegulatoryWorkspacePanel
          workspace={workspace}
          query={query}
          selectedEvents={selected}
          onApply={apply}
          onOpen={open}
        />
      )}
      {search.view === "coverage" &&
        (overview.isPending ? (
          <Pending>Loading source coverage…</Pending>
        ) : overview.data && !overview.isError ? (
          <RegulatoryCoverage overview={overview.data} />
        ) : null)}
      <p className="text-xs leading-5 text-muted-foreground">
        Recorded source evidence supports review. It does not establish complete monitoring, current
        regulatory status, causation, liability, case value or a legal deadline.
      </p>
      {search.recordSource && search.recordId && (
        <RegulatoryEvidenceDrawer
          key={`${search.recordSource}:${search.recordId}:${search.eventId ?? "latest"}`}
          source={search.recordSource as RegulatorySourceId}
          nativeId={search.recordId}
          eventId={search.eventId}
          onClose={() =>
            onSearch({
              ...search,
              recordSource: undefined,
              recordId: undefined,
              eventId: undefined,
            })
          }
          review={(event) => <RegulatoryReviewEditor workspace={workspace} event={event} />}
        />
      )}
    </div>
  );
}

function Pagination({
  page,
  next,
  onPage,
}: {
  page: number;
  next: number | null;
  onPage: (page: number) => void;
}) {
  return (
    <nav
      aria-label="Result pages"
      className="flex items-center justify-between gap-3 border-t border-border p-3 text-xs"
    >
      <button className={actionClass} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ArrowLeft className="size-3.5" aria-hidden />
        Previous
      </button>
      <span>
        Page {page} · {PAGE_SIZE} per page
      </span>
      <button
        className={actionClass}
        disabled={next === null || next > 10000}
        onClick={() => {
          if (next !== null) onPage(Math.floor(next / PAGE_SIZE) + 1);
        }}
      >
        Next
        <ArrowRight className="size-3.5" aria-hidden />
      </button>
    </nav>
  );
}

function Filters({
  search,
  overview,
  onSearch,
}: Props & { overview: RegulatoryOverview | undefined }) {
  const [q, setQ] = useState(search.q ?? "");
  const [source, setSource] = useState(search.source ?? "");
  const [family, setFamily] = useState(search.sourceFamily ?? "");
  const [eventType, setEventType] = useState(search.eventType ?? "");
  const [from, setFrom] = useState(search.from ?? "");
  const [to, setTo] = useState(search.to ?? "");
  const [basis, setBasis] = useState(search.dateBasis);
  return (
    <details className={panelClass}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Filters{" "}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {queryLabels(monitoringQuery(search)).join(" · ")}
        </span>
      </summary>
      <form
        className="border-t border-border p-3"
        aria-label="Structured monitoring filters"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(
            changeMonitoringFilters(search, {
              q,
              source,
              sourceFamily: family as MonitoringSearch["sourceFamily"],
              eventType,
              from,
              to,
              dateBasis: basis,
            }),
          );
        }}
      >
        <div className="grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(10rem,1.5fr)_repeat(3,minmax(8rem,1fr))]">
          <label className="text-xs font-medium">
            Search text
            <input
              className={`${fieldClass} mt-1`}
              value={q}
              maxLength={300}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Product, subject or document text"
            />
          </label>
          <label className="text-xs font-medium">
            Source family
            <select
              className={`${fieldClass} mt-1`}
              value={family}
              onChange={(e) => {
                setFamily(e.target.value);
                setSource("");
              }}
            >
              <option value="">All source families</option>
              <option value="fda">FDA</option>
              <option value="nhtsa">NHTSA</option>
              <option value="cpsc">CPSC</option>
              <option value="federal_register">Federal Register</option>
            </select>
          </label>
          <label className="text-xs font-medium">
            Collection
            <select
              className={`${fieldClass} mt-1`}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setFamily("");
              }}
            >
              <option value="">All collections</option>
              {overview?.sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.latestCompletedAt ? "" : " · no completed capture"}
                </option>
              ))}
              {source && !overview?.sources.some((item) => item.id === source) && (
                <option value={source}>{source}</option>
              )}
            </select>
          </label>
          <label className="text-xs font-medium">
            Change type
            <select
              className={`${fieldClass} mt-1`}
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              <option value="">All changes</option>
              {REGULATORY_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EVENT_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-2 grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_auto_auto]">
          <label className="text-xs font-medium">
            From
            <input
              type="date"
              className={`${fieldClass} mt-1`}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-xs font-medium">
            To
            <input
              type="date"
              className={`${fieldClass} mt-1`}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="text-xs font-medium">
            Date basis
            <select
              className={`${fieldClass} mt-1`}
              value={basis}
              onChange={(e) => setBasis(e.target.value as typeof basis)}
            >
              <option value="detected">First detected</option>
              <option value="published">Publisher date</option>
            </select>
          </label>
          <button className={actionClass} type="submit">
            <Search className="size-3.5" aria-hidden />
            Apply filters
          </button>
          <button
            className={actionClass}
            type="button"
            onClick={() => onSearch(normalizeMonitoringSearch({ view: search.view }))}
          >
            Clear filters
          </button>
        </div>
        {search.entityNamespace && (
          <p className="mt-2 break-words text-xs">
            Exact entity: {search.entityNamespace} / {search.entityId ?? "ID not recorded"}{" "}
            <button
              type="button"
              className="ml-2 min-h-8 text-primary underline"
              onClick={() =>
                onSearch(
                  changeMonitoringFilters(search, {
                    entityNamespace: undefined,
                    entityId: undefined,
                  }),
                )
              }
            >
              Clear entity
            </button>
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Dates retain their recorded meaning. First detected is a monitor observation, not an
          incident date; publication can precede capture.
        </p>
      </form>
    </details>
  );
}
