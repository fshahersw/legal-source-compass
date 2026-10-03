import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ExternalError } from "@/components/corpus/ExternalBadge";
import {
  Chip,
  DataTable,
  EmptyState,
  FilterField,
  HeldBadge,
  LinkOut,
  Loading,
  NotRecorded,
  Panel,
  RangePager,
  Scope,
  StatTile,
  selectClass,
  td,
  th,
} from "@/components/matters/common";
import { PdfViewer } from "@/components/matters/PdfViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SOURCE_LABELS,
  REGISTRY_SOURCES,
  formatBytes,
  matterPdfUrl,
  type Availability,
  type DocumentSort,
  type MatterDocument,
  type RegistrySource,
} from "@/lib/matters/documents";
import { getMatterDocuments, getMatterDocumentsPage } from "@/lib/matters/matters.functions";
import type { JpmlReport } from "@/lib/matters/overview";
import type { CaseIdPlanEntry } from "@/lib/matters/registry";
import type { LegacyDocument, MatterOverviewPayload } from "@/lib/matters/types";

const PAGE = 50;

/** The provider case ids the registry was asked for, each marked as recorded by the matter registry or derived. */
function CaseIdList({ ids }: { ids: CaseIdPlanEntry[] }) {
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-0.5">
      {ids.map((c) => (
        <span key={c.id} className="whitespace-nowrap">
          <span className="font-mono">{c.id}</span>{" "}
          <span className="text-muted-foreground">
            ({c.basis === "registry" ? "matter registry" : "derived from the docket number"})
          </span>
        </span>
      ))}
    </span>
  );
}

function RegistryTable({
  docs,
  onView,
}: {
  docs: MatterDocument[];
  onView: (d: MatterDocument) => void;
}) {
  return (
    <DataTable caption="Verified PDF documents on the master docket">
      <thead>
        <tr>
          <th className={th} scope="col">
            Document
          </th>
          <th className={th} scope="col">
            Source
          </th>
          <th className={`${th} text-right`} scope="col">
            Size
          </th>
          <th className={th} scope="col">
            Status
          </th>
          <th className={th} scope="col">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {docs.map((d) => {
          const open = d.availability === "open";
          return (
            <tr key={`${d.sourceSystem}:${d.nativeDocumentId}`} className="hover:bg-muted/40">
              <td className={td}>
                <div className="font-medium">{d.label}</div>
                <div
                  className="max-w-[28rem] truncate font-mono text-[10px] text-muted-foreground"
                  title={d.nativeDocumentId}
                >
                  {d.sourceSystem === "docketbird" ? d.nativeDocumentId : (d.nativeCaseId ?? "")}
                </div>
                {d.printedDate ? (
                  <div className="text-[11px] text-muted-foreground">
                    Date printed in the file name: {d.printedDate}
                  </div>
                ) : null}
              </td>
              <td className={`${td} whitespace-nowrap`}>{d.sourceLabel}</td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                {open ? formatBytes(d.bytes) : <span className="text-muted-foreground">—</span>}
              </td>
              <td className={td}>{open ? <Chip tone="success">Open</Chip> : <HeldBadge />}</td>
              <td className={`${td} whitespace-nowrap text-right`}>
                {open ? (
                  <span className="inline-flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[12px]"
                      onClick={() => onView(d)}
                    >
                      <Eye aria-hidden /> View
                    </Button>
                    {matterPdfUrl(d) ? (
                      <a
                        className="text-[12px] text-primary underline-offset-2 hover:underline"
                        href={matterPdfUrl(d, true) ?? undefined}
                      >
                        Download
                      </a>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">No link</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

function RegistrySection({
  payload,
  entry,
  onEntry,
  viewKey,
  onView,
}: {
  payload: MatterOverviewPayload;
  entry: number | null;
  onEntry: (n: number | null) => void;
  viewKey: string | null;
  onView: (key: string | null) => void;
}) {
  const fn = useServerFn(getMatterDocumentsPage);
  const mdl = payload.overview.mdl;
  const [filter, setFilter] = useState<{
    q: string;
    source: RegistrySource | "";
    availability: Availability | "";
    caseId: string;
  }>({ q: "", source: "", availability: "", caseId: "" });
  const [draft, setDraft] = useState("");
  const [sort, setSort] = useState<DocumentSort>("entry-desc");
  const [offset, setOffset] = useState(0);
  // A document opened by a link (?view=...) is looked up once, on the first read; a document opened from a row is
  // already in hand, so opening and closing the viewer never asks the server for the page again.
  const [initialView] = useState(viewKey);
  const [clicked, setClicked] = useState<MatterDocument | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const text = draft.trim();
      setFilter((f) => (f.q === text ? f : { ...f, q: text }));
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft]);
  const q = useQuery({
    queryKey: ["matter-documents-page", mdl, filter, entry, sort, offset, initialView],
    queryFn: () => fn({ data: { id: mdl, ...filter, entry, sort, offset, view: initialView } }),
    placeholderData: keepPreviousData,
    staleTime: 3 * 60_000,
  });
  const set = (patch: Partial<typeof filter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setOffset(0);
  };
  const data = q.data;
  const keyOf = (d: MatterDocument) => `${d.sourceSystem}|${d.nativeDocumentId}`;
  const viewed =
    viewKey && clicked && keyOf(clicked) === viewKey
      ? clicked
      : viewKey && data && data.connected && data.viewed && keyOf(data.viewed) === viewKey
        ? data.viewed
        : null;

  if (q.isLoading)
    return (
      <Panel id="registry" title="Verified PDFs">
        <Loading what="the verified PDF registry" />
      </Panel>
    );
  if (q.error)
    return (
      <Panel id="registry" title="Verified PDFs">
        <ExternalError error={q.error} />
      </Panel>
    );
  if (!data) return null;
  if (!data.connected)
    return (
      <Panel
        id="registry"
        title="Verified PDFs"
        note="PDF originals held in the private archive, listed from the verified registry."
      >
        <EmptyState>
          {data.reason}
          {data.caseIds.length ? (
            <span className="mt-1 block text-[11px]">
              Case ids asked for: <CaseIdList ids={data.caseIds} />
            </span>
          ) : null}
        </EmptyState>
      </Panel>
    );
  const s = data.summary;
  const { page } = data;
  const facets = page.facets;
  const caseIdsWithDocs = data.caseIds.filter((c) => (facets.byCase[c.id] ?? 0) > 0);
  const active = !!(
    filter.q ||
    filter.source ||
    filter.availability ||
    filter.caseId ||
    entry !== null
  );
  return (
    <Panel
      id="registry"
      title="Verified PDFs"
      note={
        <>
          Originals held in the private archive, listed from the verified registry for this
          matter&apos;s master and JPML dockets. Case id
          {data.caseIds.length === 1 ? "" : "s"} asked for: <CaseIdList ids={data.caseIds} />.{" "}
          {data.caseIds.some((c) => c.basis === "derived")
            ? "A derived id comes from an exact match on court and docket number; the matter registry does not cover this matter yet."
            : "Each id is an explicit provider id the matter registry records for the docket."}
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Verified PDFs"
            value={s.total.toLocaleString()}
            note={
              Object.entries(s.bySource)
                .map(([k, n]) => `${SOURCE_LABELS[k as RegistrySource] ?? k} ${n.toLocaleString()}`)
                .join(" · ") || undefined
            }
          />
          <StatTile
            label="Open"
            value={s.open.toLocaleString()}
            note={s.openBytes !== null ? `${formatBytes(s.openBytes)} in the archive` : undefined}
          />
          <StatTile
            label="Held"
            value={s.held.toLocaleString()}
            note="Seal or availability not confirmed; listed without a link"
          />
          <StatTile
            label={active ? "Matching" : "Listed"}
            value={page.total.toLocaleString()}
            note={
              data.truncated
                ? `First ${data.loaded.toLocaleString()} of ${s.total.toLocaleString()} read from the archive`
                : active
                  ? `of ${data.loaded.toLocaleString()} documents`
                  : "All documents read"
            }
          />
        </div>
        <Scope title="Held">
          A held item is listed so the docket is not silently incomplete, but it has no link, size
          or hash. It is held when the source did not confirm that the document is unsealed and
          available (for example a search-only locator).
        </Scope>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <FilterField label="Search">
            <Input
              aria-label="Search verified PDFs"
              className="h-8 text-[12px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Entry number or file name"
            />
          </FilterField>
          {caseIdsWithDocs.length > 1 ? (
            <FilterField label="Case id">
              <select
                className={selectClass}
                value={filter.caseId}
                onChange={(e) => set({ caseId: e.target.value })}
              >
                <option value="">All case ids</option>
                {caseIdsWithDocs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} ({(facets.byCase[c.id] ?? 0).toLocaleString()})
                  </option>
                ))}
              </select>
            </FilterField>
          ) : null}
          <FilterField label="Source">
            <select
              className={selectClass}
              value={filter.source}
              onChange={(e) => set({ source: e.target.value as RegistrySource | "" })}
            >
              <option value="">All sources</option>
              {REGISTRY_SOURCES.filter(
                (src) => (facets.bySource[src] ?? 0) > 0 || filter.source === src,
              ).map((src) => (
                <option key={src} value={src}>
                  {SOURCE_LABELS[src]} ({(facets.bySource[src] ?? 0).toLocaleString()})
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Status">
            <select
              className={selectClass}
              value={filter.availability}
              onChange={(e) => set({ availability: e.target.value as Availability | "" })}
            >
              <option value="">Open and held</option>
              <option value="open">Open ({facets.availability.open.toLocaleString()})</option>
              <option value="held">Held ({facets.availability.held.toLocaleString()})</option>
            </select>
          </FilterField>
          <FilterField label="Docket entry number">
            <Input
              aria-label="Docket entry number"
              inputMode="numeric"
              className="h-8 text-[12px]"
              value={entry ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                onEntry(/^\d{1,7}$/.test(v) ? Number(v) : null);
                setOffset(0);
              }}
              placeholder="Any"
            />
          </FilterField>
          <FilterField label="Sort">
            <select
              className={selectClass}
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as DocumentSort);
                setOffset(0);
              }}
            >
              <option value="entry-desc">Entry number, newest first</option>
              <option value="entry-asc">Entry number, oldest first</option>
              <option value="name">Name</option>
            </select>
          </FilterField>
        </div>
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground tabular-nums">
            {page.total.toLocaleString()}
          </span>{" "}
          of {data.loaded.toLocaleString()} documents match
          {active || draft ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-2 h-7 px-2"
              onClick={() => {
                setFilter({ q: "", source: "", availability: "", caseId: "" });
                setDraft("");
                onEntry(null);
                setOffset(0);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </p>
        {page.rows.length ? (
          <div className={q.isFetching ? "opacity-70 transition-opacity" : ""}>
            <RegistryTable
              docs={page.rows}
              onView={(d) => {
                setClicked(d);
                onView(keyOf(d));
              }}
            />
          </div>
        ) : (
          <EmptyState>No document matches these filters.</EmptyState>
        )}
        {page.total > page.pageSize ? (
          <RangePager
            offset={page.offset}
            pageSize={page.pageSize}
            shown={page.rows.length}
            total={page.total}
            onOffset={setOffset}
          />
        ) : null}
      </div>
      <PdfViewer
        doc={viewed}
        onClose={() => {
          setClicked(null);
          onView(null);
        }}
      />
    </Panel>
  );
}

function LegacySection({ rows }: { rows: LegacyDocument[] }) {
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const [offset, setOffset] = useState(0);
  const types = useMemo(
    () => [...new Set(rows.map((r) => r.docType).filter((t): t is string => !!t))].sort(),
    [rows],
  );
  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!type || r.docType === type) &&
        (!q ||
          `${r.description ?? ""} ${r.entryNumber ?? ""} ${r.docType ?? ""}`
            .toLowerCase()
            .includes(q)),
    );
  }, [rows, text, type]);
  const page = filtered.slice(offset, offset + PAGE);
  if (!rows.length) return null;
  return (
    <Panel
      id="saved-documents"
      title="Docket documents in the saved sample"
      note="Entry descriptions and RECAP links from the firm-focused docket sample. Only categorized documents are listed; the source snapshot holds more uncategorized records that were excluded."
      aside={<Chip>{rows.length.toLocaleString()} documents</Chip>}
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <FilterField label="Search description">
            <Input
              aria-label="Search saved documents"
              className="h-8 text-[12px]"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setOffset(0);
              }}
            />
          </FilterField>
          <FilterField label="Type">
            <select
              className={selectClass}
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t} ({rows.filter((r) => r.docType === t).length.toLocaleString()})
                </option>
              ))}
            </select>
          </FilterField>
        </div>
        <DataTable caption="Docket documents in the saved sample">
          <thead>
            <tr>
              <th className={th} scope="col">
                Entry
              </th>
              <th className={th} scope="col">
                Filed
              </th>
              <th className={th} scope="col">
                Type
              </th>
              <th className={th} scope="col">
                Description
              </th>
              <th className={`${th} text-right`} scope="col">
                Pages
              </th>
              <th className={th} scope="col">
                Document
              </th>
            </tr>
          </thead>
          <tbody>
            {page.map((r) => (
              <tr key={r.id} className="hover:bg-muted/40">
                <td className={`${td} font-mono tabular-nums`}>
                  {r.entryNumber ?? <NotRecorded />}
                </td>
                <td className={`${td} whitespace-nowrap font-mono`}>{r.date ?? <NotRecorded />}</td>
                <td className={`${td} whitespace-nowrap`}>{r.docType ?? <NotRecorded />}</td>
                <td className={`${td} max-w-[34rem]`}>
                  <span className="line-clamp-3" title={r.description ?? undefined}>
                    {r.description ?? <NotRecorded />}
                  </span>
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {r.pageCount ?? <NotRecorded />}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {r.recapUrl ? (
                    <LinkOut href={r.recapUrl}>RECAP PDF</LinkOut>
                  ) : (
                    <HeldBadge reason="Not recorded as a free, unsealed document, so no link is provided." />
                  )}
                  {r.docketEntryUrl ? (
                    <div className="text-[11px]">
                      <LinkOut href={r.docketEntryUrl}>Docket entry</LinkOut>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        {filtered.length > PAGE ? (
          <RangePager
            offset={offset}
            pageSize={PAGE}
            shown={page.length}
            total={filtered.length}
            onOffset={setOffset}
          />
        ) : null}
      </div>
    </Panel>
  );
}

function ReportsSection({ reports }: { reports: JpmlReport[] }) {
  if (!reports.length) return null;
  return (
    <Panel
      id="jpml-statistics"
      title="JPML statistics reports"
      note="Panel-wide caseload tables that list this MDL. They are not documents filed in the matter."
      aside={<Chip>{reports.length} reports</Chip>}
    >
      <ul className="divide-y divide-border text-[12px]">
        {reports.map((r) => (
          <li
            key={r.documentId}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5"
          >
            <span className="min-w-0">
              <span className="font-medium">
                {r.title.replace(/^JPML MDL Statistics Report - /, "")}
              </span>
              <span className="ml-2 text-muted-foreground">
                {[
                  r.periodLabel,
                  r.pages ? `${r.pages} pages` : null,
                  r.bytes ? formatBytes(r.bytes) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="flex items-center gap-3">
              {r.reportDate ? (
                <span className="font-mono text-muted-foreground">{r.reportDate}</span>
              ) : null}
              {r.officialUrl ? (
                <LinkOut href={r.officialUrl}>jpml.uscourts.gov</LinkOut>
              ) : (
                <NotRecorded />
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Stored copies of these reports are not published; the official JPML link is the source.
      </p>
    </Panel>
  );
}

export function DocumentsPanel({
  payload,
  entry,
  onEntry,
  viewKey,
  onView,
}: {
  payload: MatterOverviewPayload;
  entry: number | null;
  onEntry: (n: number | null) => void;
  viewKey: string | null;
  onView: (key: string | null) => void;
}) {
  const fn = useServerFn(getMatterDocuments);
  const q = useQuery({
    queryKey: ["matter-documents", payload.overview.mdl],
    queryFn: () => fn({ data: { id: payload.overview.mdl } }),
    staleTime: 5 * 60_000,
  });
  return (
    <div className="space-y-4">
      <RegistrySection
        payload={payload}
        entry={entry}
        onEntry={onEntry}
        viewKey={viewKey}
        onView={onView}
      />
      {q.data ? <LegacySection rows={q.data.legacy.rows} /> : null}
      {q.data ? <ReportsSection reports={q.data.reports} /> : null}
    </div>
  );
}
