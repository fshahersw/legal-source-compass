import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ExternalError } from "@/components/corpus/ExternalBadge";
import {
  Chip,
  EmptyState,
  FilterField,
  HeldBadge,
  LinkOut,
  Loading,
  Panel,
  RangePager,
  Scope,
  selectClass,
} from "@/components/matters/common";
import { PdfViewer } from "@/components/matters/PdfViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { documentCopies, formatBytes, type MatterDocument } from "@/lib/matters/documents";
import { groupEntriesByMonth } from "@/lib/matters/entries";
import { getMatterTimeline, getMatterTimelineArchive } from "@/lib/matters/matters.functions";
import {
  EMPTY_TIMELINE_FILTER,
  WITHHELD_NOTES,
  archiveCounts,
  entryProviderLabel,
  isFiltered,
  recapLabel,
  type EntryArchive,
  type RegistryEntry,
  type TimelineDocuments,
  type TimelineFilter,
} from "@/lib/matters/timeline";
import type { MatterOverviewPayload, TimelineArchivePayload } from "@/lib/matters/types";

/** Characters of docket text shown before "Show full text". */
const CLAMP_CHARS = 260;
/** Documents listed under an entry before "show all". */
const ENTRY_DOCS = 4;

type Archive = TimelineArchivePayload | null | undefined;

/** The label of an archive document in the entry it belongs to: the court's own document number and description when known. */
function documentLabel(entry: RegistryEntry, doc: MatterDocument, via: string): string {
  if (via === "document_id") {
    const ref = entry.documents.find((d) => d.nativeDocumentId === doc.nativeDocumentId);
    if (ref) {
      const number =
        ref.documentNumber || (entry.entryNumber !== null ? String(entry.entryNumber) : null);
      const head = number ? `Document ${number}` : "Document";
      const att = ref.attachmentNumber !== null ? ` · attachment ${ref.attachmentNumber}` : "";
      return `${head}${att}${ref.description ? ` — ${ref.description}` : ""}`;
    }
  }
  return doc.label;
}

function EntryDocuments({
  entry,
  archive,
  onView,
}: {
  entry: RegistryEntry;
  archive: Archive;
  onView: (d: MatterDocument) => void;
}) {
  const [all, setAll] = useState(false);
  if (entry.withheld === "sealed_document") return null;
  const match: EntryArchive | undefined =
    archive && archive.connected ? archive.byEntry[entry.id] : undefined;
  const docs = match?.documents ?? [];
  const shown = all ? docs : docs.slice(0, ENTRY_DOCS);
  // A missing match is not proof of absence when archive lookup is incomplete.
  // Do not show a missing count beside a matched copy from another provider.
  const noneArchived = !!match && !docs.length && match.notArchived > 0;
  if (!docs.length && !noneArchived) return null;
  return (
    <div className="space-y-1">
      {docs.length ? (
        <ul className="divide-y divide-border rounded-md border border-border text-[12px]">
          {shown.map(({ doc, via }) => (
            <li
              key={`${doc.sourceSystem}:${doc.nativeDocumentId}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 py-1.5"
            >
              {/* A file name has no break points, so it may wrap anywhere rather than push the page wider. */}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium">{documentLabel(entry, doc, via)}</span>
                <span className="ml-2 text-muted-foreground">
                  {documentCopies(doc).length > 1
                    ? `Same verified bytes in ${documentCopies(doc).length} source records`
                    : doc.sourceLabel}
                  {doc.availability === "open" && doc.bytes !== null
                    ? ` · ${formatBytes(doc.bytes)}`
                    : ""}
                </span>
              </span>
              {doc.availability === "open" ? (
                documentCopies(doc).length > 1 ? (
                  <details className="w-full sm:w-auto">
                    <summary className="cursor-pointer text-right text-[11px] text-primary">
                      Same file also recorded at {documentCopies(doc).length - 1} other source{" "}
                      {documentCopies(doc).length === 2 ? "location" : "locations"}
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {documentCopies(doc).map((copy) => (
                        <li
                          key={`${copy.sourceSystem}:${copy.nativeCaseId}:${copy.nativeDocumentId}`}
                          className="flex items-center justify-end gap-2 text-[10px]"
                        >
                          <span className="font-mono text-muted-foreground">
                            {copy.sourceSystem === doc.sourceSystem &&
                            copy.nativeCaseId === doc.nativeCaseId &&
                            copy.nativeDocumentId === doc.nativeDocumentId
                              ? "This entry's source record"
                              : `Same file also recorded at ${copy.sourceLabel}`}{" "}
                            · {copy.nativeCaseId ? `${copy.nativeCaseId} / ` : ""}
                            {copy.nativeDocumentId}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[12px]"
                            onClick={() => onView(copy)}
                            aria-label={`View ${copy.sourceLabel} ${copy.nativeDocumentId}`}
                          >
                            <Eye aria-hidden /> View
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[12px]"
                    onClick={() => onView(doc)}
                  >
                    <Eye aria-hidden /> View
                  </Button>
                )
              ) : (
                <HeldBadge />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {docs.length > ENTRY_DOCS ? (
          <button
            type="button"
            aria-expanded={all}
            className="text-primary underline-offset-2 hover:underline"
            onClick={() => setAll((v) => !v)}
          >
            {all ? "Show fewer documents" : `Show all ${docs.length} documents`}
          </button>
        ) : null}
        {noneArchived ? (
          <span>
            {archive && archive.connected && !archive.complete
              ? "PDF match not verified"
              : "No archived PDF"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  mdl,
  archive,
  onView,
}: {
  entry: RegistryEntry;
  mdl: string;
  archive: Archive;
  onView: (d: MatterDocument) => void;
}) {
  const [open, setOpen] = useState(false);
  const text = entry.description;
  const long = !!text && text.length > CLAMP_CHARS;
  const counts =
    archive && archive.connected ? archiveCounts(archive.byEntry[entry.id]?.documents ?? []) : null;
  const recap = recapLabel(entry.availability);
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 border-t border-border py-2.5 first:border-t-0 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
      <div className="text-right">
        <div className="font-mono text-[13px] font-semibold tabular-nums">
          {entry.entryNumber !== null ? `#${entry.entryNumber}` : "—"}
        </div>
        <div
          className="font-mono text-[11px] text-muted-foreground"
          title={entry.time ?? undefined}
        >
          {entry.date ?? "Date not recorded"}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {entry.entryNumber === null ? "unnumbered" : "filed"}
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.documentCount !== null && entry.documentCount > 0 ? (
            <Chip
              tone="success"
              title="Documents CourtListener lists for this entry (attachments included)."
            >
              {entry.documentCount} {entry.documentCount === 1 ? "document" : "documents"} listed
            </Chip>
          ) : null}
          {entry.documentCount !== null && entry.documentCount > 0 && recap ? (
            <Chip title="CourtListener's RECAP archive of PACER documents; not the firm's PDF archive.">
              {recap}
            </Chip>
          ) : null}
          {counts && (counts.open > 0 || counts.held > 0) ? (
            <Chip
              tone={counts.open > 0 ? "primary" : "warning"}
              title="Verified PDFs the firm's archive holds for this entry."
            >
              Archive: {counts.open} open{counts.held ? ` · ${counts.held} held` : ""}
            </Chip>
          ) : null}
          {entry.provider && entry.provider !== "courtlistener" ? (
            <Chip title="This entry comes from the source named here, not from CourtListener.">
              {entryProviderLabel(entry.provider)}
            </Chip>
          ) : null}
          {entry.descriptionTruncated ? (
            <Chip title="This is an excerpt. Open the source link for the full docket text.">
              Excerpt
            </Chip>
          ) : null}
          {entry.withheld ? (
            <Chip tone="warning" title={WITHHELD_NOTES[entry.withheld]}>
              {entry.withheld === "sealed_document" ? "Sealed document" : "Text withheld"}
            </Chip>
          ) : null}
        </div>
        {text ? (
          <p
            className={`whitespace-pre-line break-words text-[13px] leading-snug ${long && !open ? "line-clamp-3" : ""}`}
          >
            {text}
          </p>
        ) : entry.withheld ? (
          <p className="text-[12px] text-muted-foreground">{WITHHELD_NOTES[entry.withheld]}</p>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No docket text recorded for this entry.
          </p>
        )}
        <EntryDocuments entry={entry} archive={archive} onView={onView} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          {long ? (
            <button
              type="button"
              aria-expanded={open}
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Show less" : "Show more"}
            </button>
          ) : null}
          {entry.entryNumber !== null ? (
            <Link
              to="/matters/$id"
              params={{ id: mdl }}
              search={{ tab: "documents", entry: entry.entryNumber }}
              className="text-primary underline-offset-2 hover:underline"
            >
              Documents for entry {entry.entryNumber}
            </Link>
          ) : null}
          {entry.sourceUrl ? (
            <LinkOut href={entry.sourceUrl}>
              {entryProviderLabel(entry.provider) ?? "Source"}
            </LinkOut>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** What the registry captured and published for this matter's timeline, in words. */
function CoverageNote({ payload }: { payload: MatterOverviewPayload }) {
  const reg = payload.registry;
  const rec = reg?.record ?? null;
  const caps = (reg?.entries ?? []).filter((e) => e.captured !== null);
  const captured = caps.reduce((n, e) => n + (e.captured ?? 0), 0);
  const behind = rec && rec.entriesPublished !== null && captured > rec.entriesPublished;
  return (
    <Scope title="Scope">
      Docket text is shown exactly as the court record prints it. Entries are the master docket's
      CourtListener entries collected by the matter registry or, for a docket CourtListener does not
      publish, what GovInfo and the court's own page publish (a partial list by construction). Text
      that mentions sealing, restriction, in camera, ex parte or redaction is not published: those
      entries keep their number, date and document count and say so. A sealed document is never
      listed.{" "}
      {caps.length
        ? caps.map((e, i) => (
            <span key={`${e.provider}-${e.docketKey ?? i}`}>
              {entryProviderLabel(e.provider) ?? e.provider} entries captured:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {e.captured!.toLocaleString()}
              </span>
              {e.providerTotal !== null
                ? ` of ${e.providerTotal.toLocaleString()} reported by the provider`
                : " (provider total not recorded)"}
              {e.complete === true
                ? ", complete at capture"
                : e.complete === false
                  ? ", capture continues"
                  : ""}
              {e.observedAt ? `, observed ${e.observedAt.slice(0, 10)}` : ""}.{" "}
            </span>
          ))
        : null}
      {behind
        ? `${rec.entriesPublished!.toLocaleString()} of the ${captured.toLocaleString()} captured entries are published so far; the rest follow as the projection runs. `
        : ""}
      {rec &&
      rec.entriesWithheld !== null &&
      rec.entriesPublished !== null &&
      rec.entriesWithheld > 0
        ? `${rec.entriesWithheld.toLocaleString()} of ${rec.entriesPublished.toLocaleString()} published entries have no text under that rule (the rule is deliberately broad: it also catches words such as “unsealed” or “motion to seal”). `
        : ""}
      Documents listed here are the ones the source lists; the archive chips show which of them the
      verified PDF archive holds.
    </Scope>
  );
}

export function RegistryTimeline({
  payload,
  fallback,
}: {
  payload: MatterOverviewPayload;
  /** Shown when the registry has published no entries for this matter at all. */
  fallback: ReactNode;
}) {
  const mdl = payload.overview.mdl;
  const timelineFn = useServerFn(getMatterTimeline);
  const archiveFn = useServerFn(getMatterTimelineArchive);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<TimelineFilter>({
    q: "",
    from: null,
    to: null,
    documents: "any",
    docketKey: null,
  });
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [offset, setOffset] = useState(0);
  const [viewed, setViewed] = useState<MatterDocument | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const text = draft.trim();
      setFilter((f) => (f.q === text ? f : { ...f, q: text }));
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft]);
  const patch = (next: Partial<TimelineFilter>) => {
    setFilter((f) => ({ ...f, ...next }));
    setOffset(0);
  };

  const page = useQuery({
    queryKey: ["matter-timeline", mdl, filter, order, offset],
    queryFn: () => timelineFn({ data: { id: mdl, ...filter, order, offset } }),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  });
  const entries = page.data?.entries;
  const items = useMemo(
    () =>
      (entries ?? []).map((e) => ({
        id: e.id,
        provider: e.provider,
        docketKey: e.docketKey,
        entryNumber: e.entryNumber,
        withheld: e.withheld,
        documentIds: e.documentIds,
      })),
    [entries],
  );
  const archive = useQuery({
    queryKey: ["matter-timeline-archive", mdl, items.map((i) => i.id).join(",")],
    enabled: items.length > 0,
    queryFn: () => archiveFn({ data: { id: mdl, items } }),
    staleTime: 10 * 60_000,
  });
  const groups = useMemo(() => groupEntriesByMonth(entries ?? []), [entries]);

  const dockets = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of payload.registry?.entries ?? []) {
      if (!e.docketKey || !e.captured) continue;
      const known = payload.registry?.caseIds.find((c) => c.docketKey === e.docketKey);
      seen.set(e.docketKey, known?.docketNumber ?? e.docketKey);
    }
    return [...seen.entries()];
  }, [payload.registry]);

  if (page.isLoading) return <Loading what="docket entries" />;
  if (page.error) return <ExternalError error={page.error} />;
  const data = page.data;
  if (!data || (data.total === 0 && !isFiltered(filter))) return <>{fallback}</>;
  const filtered = isFiltered(filter);
  const archiveNote =
    archive.data && !archive.data.connected ? (
      <p className="text-[12px] text-muted-foreground">
        Archive status is unavailable: {archive.data.reason}
      </p>
    ) : null;

  return (
    <Panel
      id="docket"
      title="Docket entries"
      note="The master docket's entries from the matter registry, newest first, with the documents the archive holds for each."
      aside={
        <Chip tone="primary">
          {data.total.toLocaleString()} {filtered ? "match" : "entries"}
        </Chip>
      }
    >
      <div className="space-y-3">
        <CoverageNote payload={payload} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_auto]">
          <FilterField label="Search docket text">
            <Input
              aria-label="Search docket text"
              className="h-8 text-[12px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. bellwether, Daubert, case management"
            />
          </FilterField>
          <FilterField label="Filed from">
            <Input
              type="date"
              aria-label="Filed from"
              className="h-8 text-[12px]"
              value={filter.from ?? ""}
              max={filter.to ?? undefined}
              onChange={(e) => patch({ from: e.target.value || null })}
            />
          </FilterField>
          <FilterField label="Filed to">
            <Input
              type="date"
              aria-label="Filed to"
              className="h-8 text-[12px]"
              value={filter.to ?? ""}
              min={filter.from ?? undefined}
              onChange={(e) => patch({ to: e.target.value || null })}
            />
          </FilterField>
          <FilterField label="Documents">
            <select
              className={selectClass}
              aria-label="Documents"
              value={filter.documents}
              onChange={(e) => patch({ documents: e.target.value as TimelineDocuments })}
            >
              <option value="any">Any entry</option>
              <option value="listed">Has documents listed</option>
              <option value="free">Has a free PDF (RECAP or official)</option>
            </select>
          </FilterField>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {dockets.length > 1 ? (
            <FilterField label="Docket">
              <select
                className={selectClass}
                value={filter.docketKey ?? ""}
                onChange={(e) => patch({ docketKey: e.target.value || null })}
              >
                <option value="">All dockets</option>
                {dockets.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </FilterField>
          ) : null}
          <FilterField label="Order">
            <select
              className={selectClass}
              value={order}
              onChange={(e) => {
                setOrder(e.target.value as "newest" | "oldest");
                setOffset(0);
              }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </FilterField>
          {filtered || draft ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                setDraft("");
                setFilter({ ...EMPTY_TIMELINE_FILTER });
                setOffset(0);
              }}
            >
              Clear filters
            </Button>
          ) : null}
          <p className="ml-auto pb-1 text-[12px] text-muted-foreground" aria-live="polite">
            <span className="font-medium text-foreground tabular-nums">
              {data.total.toLocaleString()}
            </span>{" "}
            {filtered ? "entries match" : "entries"}
          </p>
        </div>
        {archive.isLoading ? (
          <p role="status" className="text-[12px] text-muted-foreground">
            Checking which documents of these entries are in the archive…
          </p>
        ) : null}
        {archiveNote}
        {entries && entries.length ? (
          <div className={page.isFetching ? "opacity-70 transition-opacity" : ""}>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h3 className="sticky top-0 z-[1] -mx-1 border-b border-border bg-surface/95 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {g.label}{" "}
                  <span className="font-normal normal-case">· {g.entries.length} on this page</span>
                </h3>
                <ol>
                  {g.entries.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      mdl={mdl}
                      archive={archive.data}
                      onView={setViewed}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState>No entry matches these filters.</EmptyState>
        )}
        <RangePager
          offset={data.offset}
          pageSize={data.pageSize}
          shown={entries?.length ?? 0}
          total={data.total}
          onOffset={setOffset}
        />
      </div>
      <PdfViewer doc={viewed} onClose={() => setViewed(null)} />
    </Panel>
  );
}
