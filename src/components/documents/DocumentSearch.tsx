import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, Search, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DOC_TYPES,
  MAX_PAGE,
  SOURCE_LABEL,
  TYPE_LABEL,
  documentTitle,
  fmtCount,
  fmtDay,
  searchable,
  typeLabel,
  type DocHit,
  type DocSearchState,
  type DocSort,
  type DocType,
} from "@/lib/documents/documents";
import type { DocumentSearchPage } from "@/lib/documents/documents.functions";
import { documentSearchQuery, documentsStatusQuery } from "./documentQueries";
import { DocumentPdfSheet, type OpenDocument } from "./DocumentPdfSheet";
import { NotBuilt, Problem, SnippetText, TextStatusTag } from "./DocumentParts";

type Nav = (next: DocSearchState) => void;
const selectClass =
  "h-8 min-w-0 rounded-md border border-border bg-background px-2 text-[12px] text-foreground";
const SORT_LABEL: Record<DocSort, string> = {
  relevance: "Best match",
  newest: "Newest first",
  oldest: "Oldest first",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading filings">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-md bg-muted/50" />
      ))}
    </div>
  );
}

function StatusLine() {
  const q = useQuery(documentsStatusQuery);
  if (!q.data?.available) return null;
  const d = q.data;
  return (
    <p className="text-[12px] text-muted-foreground">
      {fmtCount(d.documents)} filings from {fmtCount(d.mdls)} MDLs in {fmtCount(d.courts)} courts ·{" "}
      {fmtCount(d.pagesIndexed)} pages of text searchable
    </p>
  );
}

function Hit({
  r,
  page,
  courtName,
  mdlName,
  open,
}: {
  r: DocHit;
  page: DocumentSearchPage & { available: true };
  courtName: string | null;
  mdlName: string | null;
  open: (o: OpenDocument) => void;
}) {
  const pages = r.snippets.map((s) => s.page);
  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => open({ doc: r, page: pages[0] ?? null, pages })}
          className="min-w-0 text-left text-[13px] font-medium leading-snug text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <FileText className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          {documentTitle(r)}
        </button>
        <TextStatusTag status={r.textStatus} />
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        {typeLabel(r.docType)} · {r.filedDate ? fmtDay(r.filedDate) : "Date not recorded"} ·{" "}
        {courtName ?? r.courtId ?? "Court not recorded"} ·{" "}
        <Link
          to="/matters/$id"
          params={{ id: r.mdl }}
          className="underline-offset-2 hover:underline"
        >
          {mdlName ? `MDL ${r.mdl}: ${mdlName}` : `MDL No. ${r.mdl}`}
        </Link>
        {r.docketNumber ? (
          <>
            {" "}
            · <span className="whitespace-nowrap font-mono">{r.docketNumber}</span>
          </>
        ) : null}
        {r.entryNumber !== null ? ` · entry ${r.entryNumber}` : ""} · {SOURCE_LABEL[r.sourceSystem]}
      </p>
      {r.snippets.length ? (
        <ul className="space-y-1">
          {r.snippets.map((s) => (
            <li key={s.page} className="flex gap-2 text-[12px] leading-5">
              <button
                type="button"
                onClick={() => open({ doc: r, page: s.page, pages })}
                className="h-5 shrink-0 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Open ${documentTitle(r)} at page ${s.page}`}
              >
                p. {s.page}
              </button>
              <span className="min-w-0 text-foreground/90">
                <SnippetText snippet={s} />
              </span>
            </li>
          ))}
        </ul>
      ) : page.mode === "text" && searchable(r.textStatus) ? (
        <p className="text-[11px] text-muted-foreground">
          Matched, but no passage could be cut from the page.
        </p>
      ) : null}
      {page.mode === "text" && r.matchedPages && r.matchedPages > r.snippets.length ? (
        <p className="text-[11px] text-muted-foreground">
          Matches on {fmtCount(r.matchedPages)} pages; the best {r.snippets.length} are shown.
        </p>
      ) : null}
    </li>
  );
}

function Results({
  s,
  nav,
  open,
}: {
  s: DocSearchState;
  nav: Nav;
  open: (o: OpenDocument) => void;
}) {
  const q = useQuery(documentSearchQuery(s));
  if (q.isPending) return <Skeleton />;
  if (q.isError)
    return (
      <Problem onRetry={() => void q.refetch()}>The document search could not be run.</Problem>
    );
  const d = q.data;
  if (!d.available) return <NotBuilt />;
  const page = d.page;
  const first = d.offset + 1;
  const last = d.offset + d.rows.length;
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground" aria-live="polite">
        {d.rows.length
          ? `${d.capped ? "Over" : ""} ${fmtCount(d.total)} filing${d.total === 1 ? "" : "s"} ${
              d.mode === "text" ? "match" : "listed"
            } · showing ${fmtCount(first)}–${fmtCount(last)}${
              d.mode === "text" ? " · " + SORT_LABEL[d.sort].toLowerCase() : ", newest first"
            }`.trim()
          : null}
        {d.capped
          ? " The words match more than 20,000 pages, so counts and filters cover the first 20,000; add a word, a court or a date to narrow."
          : ""}
        {d.droppedUnavailable
          ? ` ${fmtCount(d.droppedUnavailable)} filing${d.droppedUnavailable === 1 ? " is" : "s are"} no longer open and ${d.droppedUnavailable === 1 ? "was" : "were"} left out.`
          : ""}
        {d.malformed ? ` ${fmtCount(d.malformed)} unreadable rows were left out.` : ""}
      </p>
      {d.rows.length ? (
        <ol className="divide-y divide-border/70 rounded-md border border-border bg-surface">
          {d.rows.map((r) => (
            <Hit
              key={r.id}
              r={r}
              page={d}
              courtName={r.courtId ? (d.courtNames[r.courtId] ?? null) : null}
              mdlName={d.mdlNames[r.mdl] ?? null}
              open={open}
            />
          ))}
        </ol>
      ) : (
        <Problem>
          {s.q
            ? `No searchable page matches “${s.q}”${s.court || s.mdl || s.type || s.from || s.to ? " with these filters" : ""}. Try fewer words, another form of a word, or remove a filter. Scanned filings without text are not searched.`
            : "No filing matches these filters."}
        </Problem>
      )}
      {page > 1 || d.hasMore ? (
        <div className="flex items-center gap-2 pt-1 text-[12px]">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => nav({ ...s, page: page - 1 > 1 ? page - 1 : undefined })}
          >
            Previous
          </Button>
          <span className="text-muted-foreground">Page {page}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={!d.hasMore || page >= MAX_PAGE}
            onClick={() => nav({ ...s, page: page + 1 })}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Filters({ s, nav }: { s: DocSearchState; nav: Nav }) {
  const q = useQuery(documentSearchQuery(s));
  const d = q.data?.available ? q.data : null;
  const courts = new Map<string, string>();
  const mdls = new Map<string, string>();
  for (const f of d?.facets.court ?? [])
    courts.set(f.key, `${d?.courtNames[f.key] ?? f.key} (${fmtCount(f.count)})`);
  if (s.court && !courts.has(s.court)) courts.set(s.court, d?.courtNames[s.court] ?? s.court);
  for (const f of d?.facets.mdl ?? [])
    mdls.set(
      f.key,
      `MDL ${f.key}${d?.mdlNames[f.key] ? `: ${d.mdlNames[f.key]}` : ""} (${fmtCount(f.count)})`,
    );
  if (s.mdl && !mdls.has(s.mdl)) mdls.set(s.mdl, `MDL ${s.mdl}`);
  const typeCounts = new Map((d?.facets.type ?? []).map((f) => [f.key, f.count]));
  const set = (patch: Partial<DocSearchState>) => nav({ ...s, ...patch, page: undefined });
  const filtered = !!(s.court || s.mdl || s.type || s.from || s.to);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Field label="Court">
        <select
          className={selectClass}
          value={s.court ?? ""}
          onChange={(e) => set({ court: e.target.value || undefined })}
        >
          <option value="">All courts</option>
          {[...courts].map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="MDL">
        <select
          className={selectClass}
          value={s.mdl ?? ""}
          onChange={(e) => set({ mdl: e.target.value || undefined })}
        >
          <option value="">All MDLs</option>
          {[...mdls].map(([k, v]) => (
            <option key={k} value={k}>
              {v.length > 90 ? `${v.slice(0, 88)}…` : v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Type">
        <select
          className={selectClass}
          value={s.type ?? ""}
          onChange={(e) => set({ type: (e.target.value || undefined) as DocType | undefined })}
        >
          <option value="">All types</option>
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
              {typeCounts.has(t) ? ` (${fmtCount(typeCounts.get(t))})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Filed from">
        <input
          type="date"
          className={selectClass}
          value={s.from ?? ""}
          onChange={(e) => set({ from: e.target.value || undefined })}
        />
      </Field>
      <Field label="Filed to">
        <input
          type="date"
          className={selectClass}
          value={s.to ?? ""}
          onChange={(e) => set({ to: e.target.value || undefined })}
        />
      </Field>
      <Field label="Order">
        <select
          className={selectClass}
          value={s.sort ?? (s.q ? "relevance" : "newest")}
          onChange={(e) => set({ sort: e.target.value as DocSort })}
        >
          {(s.q
            ? (["relevance", "newest", "oldest"] as const)
            : (["newest", "oldest"] as const)
          ).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      {filtered ? (
        <button
          type="button"
          onClick={() => nav({ q: s.q, sort: s.sort })}
          className="col-span-full inline-flex w-fit items-center gap-1 rounded text-[12px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="size-3" aria-hidden /> Clear filters
        </button>
      ) : null}
    </div>
  );
}

/** The search page body of /litigation/documents: words, filters, page-numbered passages and the viewer. */
export function DocumentSearch({ s, nav }: { s: DocSearchState; nav: Nav }) {
  const [text, setText] = useState(s.q ?? "");
  const [open, setOpen] = useState<OpenDocument | null>(null);
  useEffect(() => setText(s.q ?? ""), [s.q]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim().slice(0, 300) || undefined;
    nav({
      ...s,
      q,
      page: undefined,
      sort: q ? s.sort : s.sort === "relevance" ? undefined : s.sort,
    });
  };
  return (
    <div className="space-y-3">
      <StatusLine />
      <form role="search" onSubmit={submit} className="flex gap-2">
        <label className="sr-only" htmlFor="documents-q">
          Search the text of court filings
        </label>
        <Input
          id="documents-q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder='Words in the filings, e.g. "bellwether trial" or preemption -remand'
          className="h-9 text-[13px]"
        />
        <Button type="submit" size="sm" className="h-9">
          <Search aria-hidden /> Search
        </Button>
      </form>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Searches the text of the court filings the matter pages list and that are open to view
        (English word forms; “quoted phrases”, or, -word). Filings the docket source marks as held
        or sealed are listed but not searched or quoted; scanned filings are searched once their
        text is recognised.
      </p>
      <Filters s={s} nav={nav} />
      <Results s={s} nav={nav} open={setOpen} />
      <DocumentPdfSheet open={open} onClose={() => setOpen(null)} />
    </div>
  );
}
