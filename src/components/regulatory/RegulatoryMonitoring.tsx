import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Search, RefreshCw } from "lucide-react";
import { useViewerAccess } from "@/lib/auth/useViewerAccess";
import { RecallPatterns } from "./RecallPatterns";
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
import { SourceChangesSummary } from "./SourceChangesSummary";
import { commonReason } from "./sourceChanges";
import { FdaDashboard } from "@/components/fda-analytics/FdaDashboard";
import { RegulatoryEvidenceDrawer } from "./RegulatoryEvidenceDrawer";
import { RegulatoryCoverage } from "./RegulatoryCoverage";
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
  MONITORING_VIEW_LABELS,
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
  const { admin } = useViewerAccess();
  const overview = useQuery({
    queryKey: ["regulatory-overview"],
    queryFn: () => getRegulatoryOverview(),
    staleTime: 30000,
    enabled: search.view !== "analytics" && search.view !== "patterns",
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
        className="flex flex-wrap gap-1 border-b border-border pb-1"
      >
        {MONITORING_VIEWS.filter((view) => view !== "coverage" || admin).map((view) => (
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
            className={`${actionClass} sm:!min-h-8 sm:!px-2.5 sm:!py-1 ${search.view === view ? "!border-primary !bg-primary !text-primary-foreground hover:!bg-primary/90" : "border-transparent"}`}
          >
            {MONITORING_VIEW_LABELS[view]}
          </button>
        ))}
      </nav>
      {search.view === "patterns" && (
        <RecallPatterns
          domain={search.recallDomain ?? "fda_food"}
          onDomain={(recallDomain) => onSearch({ ...search, recallDomain })}
        />
      )}
      {search.view === "analytics" && <FdaDashboard search={search} onSearch={onSearch} />}
      {search.view === "signals" && !invalidWindow && !invalidEntity && (
        <SourceChangesSummary search={search} overview={overview.data} onSearch={onSearch} />
      )}
      {(search.view === "signals" || search.view === "entities") && (
        <>
          <RegulatoryQueryComposer query={query} onApply={apply} />
          <Filters key={binding} search={search} overview={overview.data} onSearch={onSearch} />
        </>
      )}
      {admin &&
        (search.view === "signals" || search.view === "entities" || search.view === "coverage") &&
        (overview.isError ? (
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
        ))}
      {(invalidWindow || invalidEntity) &&
        (search.view === "signals" || search.view === "entities") && (
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
              <h2 className="text-heading font-semibold text-foreground">
                Source changes to review
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                A detected change is a research lead, not a finding of injury or liability.
              </p>
            </div>
            {events.data ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {displayCount(events.data.total)}
                {events.data.totalCapped ? " (capped)" : ""} {events.data.countUnit} ·{" "}
                {events.data.dateBasis === "published" ? "publisher date" : "first detected date"}
              </span>
            ) : null}
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
              <EventList events={events.data.items} sourceLabel={sourceLabel} onOpen={open} />
              <Pagination
                page={search.page}
                next={events.data.nextOffset}
                onPage={(page) => onSearch({ ...search, page })}
              />
            </>
          )}
        </section>
      )}
      {search.view === "entities" && (
        <section className={panelClass}>
          <div className="border-b border-border p-3">
            <h2 className="text-heading font-semibold text-foreground">
              Recorded source identities
            </h2>
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
      {search.view === "coverage" &&
        (!admin ? (
          <Empty title="Coverage is available to administrators">
            Source collection coverage is shown to signed-in administrator accounts only.
          </Empty>
        ) : overview.isPending ? (
          <Pending>Loading source coverage…</Pending>
        ) : overview.data && !overview.isError ? (
          <RegulatoryCoverage overview={overview.data} />
        ) : null)}
      {(search.view === "signals" || search.view === "entities") && (
        <p className="text-xs leading-5 text-muted-foreground">
          Recorded source evidence supports review. It does not establish complete monitoring,
          current regulatory status, causation, liability, case value or a legal deadline.
        </p>
      )}
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
        />
      )}
    </div>
  );
}

const EVENT_TONE: Record<string, string> = {
  record_changed: "border-amber-500/40 bg-amber-500/10 text-foreground",
  correction: "border-amber-500/40 bg-amber-500/10 text-foreground",
  new_record: "border-primary/30 bg-primary/10 text-foreground",
  initial_record: "border-border bg-muted/40 text-muted-foreground",
  backfill: "border-border bg-muted/40 text-muted-foreground",
};

/** Compact rows: what changed, where and when; a reason shared by most rows is printed once above the list. */
function EventList({
  events,
  sourceLabel,
  onOpen,
}: {
  events: RegulatoryEvent[];
  sourceLabel: (id: string) => string;
  onOpen: (event: RegulatoryEvent) => void;
}) {
  const shared = commonReason(events);
  return (
    <>
      {shared ? (
        <p className="border-b border-border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Most rows: </span>
          {shared}
        </p>
      ) : null}
      <ul className="m-0 list-none divide-y divide-border p-0" aria-label="Detected source events">
        {events.map((event) => (
          <li
            key={event.id}
            className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2.5 hover:bg-muted/20"
          >
            <span
              className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${EVENT_TONE[event.eventType] ?? "border-border"}`}
            >
              {EVENT_LABELS[event.eventType]}
            </span>
            <div className="min-w-0 flex-[1_1_20rem]">
              <button
                type="button"
                className="text-left text-sm font-semibold text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => onOpen(event)}
              >
                {event.record.title}
              </button>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {sourceLabel(event.source)} · {event.record.document_type || "Record"} ·{" "}
                {event.nativeId} · Published {displayDate(event.record.published_on)} · Detected{" "}
                {event.detectedAt.slice(0, 10)}
              </p>
              {event.record.entity_refs.length ? (
                <p className="mt-0.5 text-xs text-foreground/80">
                  {event.record.entity_refs
                    .slice(0, 3)
                    .map((entity) => entity.label)
                    .join(" · ")}
                  {event.record.entity_refs.length > 3
                    ? ` · +${event.record.entity_refs.length - 3} more`
                    : ""}
                </p>
              ) : null}
              {event.changedFields.length ? (
                <p className="mt-1 flex flex-wrap gap-1">
                  <span className="text-[11px] text-muted-foreground">Changed:</span>
                  {event.changedFields.slice(0, 6).map((field) => (
                    <code
                      key={field}
                      className="rounded bg-muted px-1 py-px text-[11px] text-foreground"
                    >
                      {field}
                    </code>
                  ))}
                  {event.changedFields.length > 6 ? (
                    <span className="text-[11px] text-muted-foreground">
                      +{event.changedFields.length - 6} more
                    </span>
                  ) : null}
                </p>
              ) : null}
              {event.reason !== shared ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{event.reason}</p>
              ) : null}
            </div>
            <button
              type="button"
              className={`${actionClass} ml-auto shrink-0`}
              aria-label={`Open evidence for ${event.record.title}`}
              onClick={() => onOpen(event)}
            >
              Inspect
            </button>
          </li>
        ))}
      </ul>
    </>
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
