import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Copy, ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { getStateLawSection, getStateLawTree, searchStateLaw } from "@/lib/law/stateLaw.functions";
import {
  STATUS_BASIS_LABEL,
  STATUS_LABEL,
  currencyLine,
  nodeLabel,
  shortDate,
  snippetSegments,
  type StateLawEdition,
  type StateLawNode,
  type StateLawSectionBrief,
  type StateLawStatus,
} from "@/lib/law/stateLawContract";

export type InForceNav = {
  node?: string | undefined;
  sec?: string | undefined;
  lq?: string | undefined;
};

const STATUS_TONE: Record<StateLawStatus, string> = {
  in_force: "border-primary/40 text-primary",
  future_effective: "border-border bg-muted text-foreground",
  repealed: "border-destructive/40 text-destructive",
  expired: "border-destructive/40 text-destructive",
  reserved: "border-border text-muted-foreground",
  renumbered: "border-border text-muted-foreground",
  transferred: "border-border text-muted-foreground",
  not_recorded: "border-dashed border-border text-muted-foreground",
};

export function StatusBadge({ status }: { status: StateLawStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function retrievedLine(e: StateLawEdition): string {
  const from = shortDate(e.retrievedFrom);
  const to = shortDate(e.retrievedTo);
  if (!from) return "Retrieval date: Not recorded";
  const span = to && to !== from ? `${from} – ${to}` : from;
  return e.sourceMode === "retained_original"
    ? `Publisher pages read ${span} (re-parsed from this project's retained, hash-checked copies)`
    : `Publisher pages read ${span}`;
}

function EditionHeader({ edition }: { edition: StateLawEdition }) {
  const counts = Object.entries(edition.byStatus).filter(([, n]) => (n ?? 0) > 0) as [
    StateLawStatus,
    number,
  ][];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-heading font-semibold text-foreground">{edition.codeName}</h2>
        {edition.editionLabel ? (
          <span className="text-xs text-muted-foreground">{edition.editionLabel}</span>
        ) : null}
      </div>
      <dl className="grid max-w-3xl gap-x-4 gap-y-1 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Publisher</dt>
        <dd>
          {edition.publisher ?? "Not recorded"}
          {edition.publisherUrl ? (
            <a
              href={edition.publisherUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-2 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              Official source <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </dd>
        <dt className="text-muted-foreground">Currency (publisher)</dt>
        <dd className="leading-relaxed" data-testid="currency-statement">
          {edition.currencyStatement ? (
            <>
              {edition.currencyStatement}
              {edition.currencyThrough ? ` (through ${shortDate(edition.currencyThrough)})` : ""}
            </>
          ) : edition.currencyThrough ? (
            `Publisher states the text is current through ${shortDate(edition.currencyThrough)}`
          ) : (
            "No currency statement from the publisher"
          )}
          {!edition.currencyStatement && edition.sourceLastModified ? (
            <span className="block text-muted-foreground">
              Source files: {edition.sourceLastModified}
            </span>
          ) : null}
        </dd>
        <dt className="text-muted-foreground">Retrieved</dt>
        <dd>{retrievedLine(edition)}</dd>
        <dt className="text-muted-foreground">Sections</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          <span className="tabular-nums">
            {edition.sections == null ? "Not recorded" : edition.sections.toLocaleString()}
          </span>
          {counts.map(([status, n]) => (
            <span key={status} className="inline-flex items-center gap-1">
              <StatusBadge status={status} />
              <span className="tabular-nums text-muted-foreground">{n.toLocaleString()}</span>
            </span>
          ))}
        </dd>
      </dl>
      {edition.termsNote ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">About this source</summary>
          <p className="mt-1 max-w-3xl leading-relaxed">{edition.termsNote}</p>
          {edition.updateCadence ? (
            <p className="mt-1 max-w-3xl leading-relaxed">
              Publisher update cadence: {edition.updateCadence}
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function SectionButton({
  item,
  active,
  onOpen,
}: {
  item: StateLawSectionBrief;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${active ? "bg-muted" : ""}`}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span
          className={
            item.status === "in_force" ? "font-medium" : "font-medium text-muted-foreground"
          }
        >
          {item.citation}
        </span>
        {item.status !== "in_force" ? <StatusBadge status={item.status} /> : null}
      </span>
      {item.heading ? (
        <span className="block text-xs text-muted-foreground">{item.heading}</span>
      ) : null}
      {item.version ? (
        <span className="block text-[11px] italic text-muted-foreground">{item.version}</span>
      ) : null}
    </button>
  );
}

export function InForceCodeBrowser({
  state,
  nav,
  onNavigate,
}: {
  state: string;
  nav: InForceNav;
  onNavigate: (next: InForceNav) => void;
}) {
  const treeFn = useServerFn(getStateLawTree);
  const sectionFn = useServerFn(getStateLawSection);
  const searchFn = useServerFn(searchStateLaw);
  const [draft, setDraft] = useState(nav.lq ?? "");
  const [offset, setOffset] = useState(0);
  const [copied, setCopied] = useState(false);

  const section = useQuery({
    queryKey: ["state-law-section", state, nav.sec],
    queryFn: () => sectionFn({ data: { state, id: nav.sec! } }),
    enabled: !!nav.sec,
  });
  const openSection = section.data?.available ? section.data : null;
  const node = nav.node ?? openSection?.section.nodeId ?? null;
  const tree = useQuery({
    queryKey: ["state-law-tree", state, node, offset],
    queryFn: () => treeFn({ data: { state, node, offset } }),
  });
  const found = useQuery({
    queryKey: ["state-law-search", state, nav.lq],
    queryFn: () => searchFn({ data: { state, q: nav.lq!, offset: 0, status: null } }),
    enabled: (nav.lq ?? "").trim().length >= 2,
  });

  useEffect(() => setOffset(0), [node]);
  useEffect(() => setDraft(nav.lq ?? ""), [nav.lq]);

  const t = tree.data?.available ? tree.data : null;
  const edition = t?.edition ?? openSection?.edition ?? null;
  const singleCode = (edition?.codes.length ?? 0) === 1;
  // The root button already names a single-code state's code, so its code node is not repeated.
  const crumbs: StateLawNode[] = t
    ? [...t.breadcrumb, ...(t.node ? [t.node] : [])].filter(
        (c) => !(singleCode && c.level === "code"),
      )
    : [];
  const go = (next: InForceNav) => onNavigate({ lq: nav.lq, ...next });
  const searchData = found.data?.available ? found.data : null;
  const exactId = searchData?.exact?.sectionId ?? null;
  const exactCitation = searchData?.exact?.citation ?? null;

  if (tree.isLoading)
    return <p className="text-sm text-muted-foreground">Loading the in-force edition…</p>;
  if (tree.error) return <ExternalError error={tree.error} />;
  if (tree.data && !tree.data.available && tree.data.reason !== "unknown_node")
    return (
      <p className="text-sm text-muted-foreground" data-testid="inforce-empty">
        {tree.data.reason === "not_installed"
          ? "The in-force statute layer has not been loaded yet."
          : "No in-force edition from the official publisher has been loaded for this state yet."}
      </p>
    );

  return (
    <section className="space-y-4" aria-label="In-force statutes">
      <div className="rounded-xl border border-border bg-card shadow-xs p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {edition ? (
            <EditionHeader edition={edition} />
          ) : (
            <p className="text-sm">Edition: Not recorded</p>
          )}
          <form
            className="flex w-full max-w-md gap-2"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              go({ node: nav.node, sec: nav.sec, lq: draft.trim() || undefined });
            }}
          >
            <label className="sr-only" htmlFor="inforce-search">
              Search the text of this state's statutes
            </label>
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                aria-hidden
              />
              <input
                id="inforce-search"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Words or a citation, e.g. statute of limitations"
                className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              Search
            </button>
          </form>
        </div>
        {nav.lq ? (
          <div className="mt-3" aria-live="polite">
            {found.isFetching ? (
              <p className="text-sm text-muted-foreground">Searching the statute text…</p>
            ) : null}
            {found.error ? <ExternalError error={found.error} /> : null}
            {found.data && !found.data.available ? (
              <p className="text-sm text-muted-foreground">
                Search is not available for this state yet.
              </p>
            ) : null}
            {found.data?.available ? (
              <ul
                className="max-h-80 divide-y divide-border overflow-auto rounded-md border border-border"
                aria-label="Search results"
              >
                <li className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {found.data.totalCapped
                      ? "More than 10,000"
                      : found.data.total.toLocaleString()}{" "}
                    sections match
                    {found.data.hits.length < found.data.total
                      ? ` · showing ${found.data.hits.length}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => go({ node: nav.node, sec: nav.sec, lq: undefined })}
                  >
                    Clear
                  </button>
                </li>
                {exactId ? (
                  <li>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => go({ sec: exactId, node: undefined })}
                    >
                      <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Citation
                      </span>
                      <span className="font-medium">{exactCitation}</span>
                    </button>
                  </li>
                ) : null}
                {found.data.hits.map((hit) => (
                  <li key={hit.sectionId}>
                    <button
                      type="button"
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${hit.sectionId === nav.sec ? "bg-muted" : ""}`}
                      aria-current={hit.sectionId === nav.sec ? "true" : undefined}
                      onClick={() => go({ sec: hit.sectionId, node: undefined })}
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{hit.citation}</span>
                        <StatusBadge status={hit.status} />
                      </span>
                      {hit.heading ? (
                        <span className="block text-xs text-muted-foreground">{hit.heading}</span>
                      ) : null}
                      {hit.snippet ? (
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          {snippetSegments(hit.snippet).map((seg, i) =>
                            seg.hit ? (
                              <mark
                                key={i}
                                className="rounded-sm bg-primary/15 px-0.5 text-foreground"
                              >
                                {seg.text}
                              </mark>
                            ) : (
                              <span key={i}>{seg.text}</span>
                            ),
                          )}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
                {found.data.hits.length === 0 && !exactId ? (
                  <li className="px-3 py-3 text-sm text-muted-foreground">
                    No section text matches.
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(15rem,22rem)_minmax(0,1fr)]">
        <div className="flex flex-col rounded-xl border border-border bg-card shadow-xs shadow-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
          <div className="space-y-2 border-b border-border p-3">
            <nav
              aria-label="Outline position"
              className="flex flex-wrap items-center gap-1 text-xs"
            >
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 ${crumbs.length ? "text-primary underline-offset-4 hover:underline" : "font-semibold"}`}
                onClick={() => go({ node: undefined, sec: undefined })}
              >
                {edition?.codeName ?? "Statutes"}
              </button>
              {crumbs.map((c, i) => (
                <span key={c.nodeId} className="flex items-center gap-1">
                  <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
                  <button
                    type="button"
                    title={c.heading ?? undefined}
                    className={`max-w-[14rem] truncate rounded px-1.5 py-0.5 ${i === crumbs.length - 1 ? "font-semibold" : "text-primary underline-offset-4 hover:underline"}`}
                    onClick={() => go({ node: c.nodeId, sec: undefined })}
                  >
                    {nodeLabel(c)}
                  </button>
                </span>
              ))}
            </nav>
            {crumbs.length ? (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                onClick={() =>
                  go({
                    node: crumbs.length > 1 ? crumbs[crumbs.length - 2]!.nodeId : undefined,
                    sec: undefined,
                  })
                }
              >
                <ChevronLeft className="size-3" aria-hidden /> Up one level
              </button>
            ) : null}
            {t?.node?.heading && t.node.level !== "code" ? (
              <p className="text-xs text-muted-foreground">{t.node.heading}</p>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2" data-testid="inforce-outline">
            {tree.data && !tree.data.available ? (
              <p className="p-2 text-sm text-muted-foreground">
                This outline position does not exist in the edition.
              </p>
            ) : null}
            {t && t.children.length ? (
              <ul className="space-y-0.5" aria-label="Divisions">
                {t.children.map((c) => (
                  <li key={c.nodeId}>
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => go({ node: c.nodeId, sec: undefined })}
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{nodeLabel(c)}</span>
                        {c.heading && c.level !== "code" && c.number ? (
                          <span className="block text-xs text-muted-foreground">{c.heading}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {c.sections == null ? "–" : c.sections.toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {t && t.sections.length ? (
              <>
                <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sections · {t.totalSections.toLocaleString()}
                </p>
                <ul className="space-y-0.5" aria-label="Sections">
                  {t.sections.map((s) => (
                    <li key={s.sectionId}>
                      <SectionButton
                        item={s}
                        active={s.sectionId === nav.sec}
                        onOpen={() => go({ node: node ?? undefined, sec: s.sectionId })}
                      />
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between px-2 py-2 text-xs">
                  {t.offset > 0 ? (
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setOffset(Math.max(0, t.offset - 400))}
                    >
                      Previous 400
                    </button>
                  ) : (
                    <span />
                  )}
                  {t.truncated ? (
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setOffset(t.offset + 400)}
                    >
                      Next 400
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
            {t && !t.children.length && !t.sections.length ? (
              <p className="p-2 text-sm text-muted-foreground">
                Nothing is filed directly at this level.
              </p>
            ) : null}
          </div>
        </div>

        <article
          className="min-h-[16rem] rounded-xl border border-border bg-card shadow-xs p-4 shadow-card"
          aria-label="Section text"
          data-testid="inforce-reader"
        >
          {!nav.sec ? (
            <p className="text-sm text-muted-foreground">
              Open a section from the outline or from search.
            </p>
          ) : section.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading section…</p>
          ) : section.error ? (
            <ExternalError error={section.error} />
          ) : !openSection ? (
            <p className="text-sm text-muted-foreground">
              This section is not in the loaded edition.
            </p>
          ) : (
            <div className="space-y-3">
              <header className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-label font-semibold text-foreground">
                    {openSection.section.citation}
                  </h3>
                  <StatusBadge status={openSection.section.status} />
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                    onClick={() => {
                      void navigator.clipboard?.writeText(openSection.section.citation).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                  >
                    <Copy className="size-3" aria-hidden /> {copied ? "Copied" : "Copy citation"}
                  </button>
                </div>
                {openSection.section.heading ? (
                  <p className="text-sm font-medium">{openSection.section.heading}</p>
                ) : null}
                {openSection.section.version ? (
                  <p className="text-xs italic text-muted-foreground">
                    Version: {openSection.section.version}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {STATUS_BASIS_LABEL[openSection.section.statusBasis ?? "not_recorded"] ??
                    "Status basis: Not recorded"}
                  {openSection.section.statusMarker
                    ? ` — “${openSection.section.statusMarker}”`
                    : ""}
                </p>
                {openSection.section.effectiveStart || openSection.section.effectiveEnd ? (
                  <p className="text-xs text-muted-foreground">
                    {openSection.section.effectiveStart
                      ? `Effective ${shortDate(openSection.section.effectiveStart)}`
                      : ""}
                    {openSection.section.effectiveStart && openSection.section.effectiveEnd
                      ? " · "
                      : ""}
                    {openSection.section.effectiveEnd
                      ? `Ends ${shortDate(openSection.section.effectiveEnd)}`
                      : ""}
                  </p>
                ) : null}
              </header>
              {openSection.section.text ? (
                <div className="space-y-2 text-sm leading-relaxed" data-testid="inforce-text">
                  {openSection.section.text.split("\n").map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The publisher prints no text for this section.
                </p>
              )}
              {openSection.section.history ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Publisher's history note</summary>
                  <p className="mt-1 leading-relaxed">{openSection.section.history}</p>
                </details>
              ) : null}
              <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                {openSection.section.sourceUrl ? (
                  <a
                    href={openSection.section.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    Official source page <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : (
                  <span>Source page: Not recorded</span>
                )}
                <span>
                  Read {shortDate(openSection.section.retrievedAt) ?? "date not recorded"}
                </span>
                {openSection.section.sourceSha256 ? (
                  <span
                    title={`sha256 of the publisher bytes: ${openSection.section.sourceSha256}`}
                  >
                    Source hash {openSection.section.sourceSha256.slice(0, 12)}…
                  </span>
                ) : null}
                {edition ? <span>Currency: {currencyLine(edition)}</span> : null}
              </footer>
              <nav
                aria-label="Neighbouring sections"
                className="flex flex-wrap justify-between gap-2 text-xs"
              >
                {openSection.prev ? (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => go({ node: undefined, sec: openSection.prev!.sectionId })}
                  >
                    ← {openSection.prev.citation}
                  </button>
                ) : (
                  <span />
                )}
                {openSection.next ? (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => go({ node: undefined, sec: openSection.next!.sectionId })}
                  >
                    {openSection.next.citation} →
                  </button>
                ) : null}
              </nav>
              {openSection.otherVersions.length ? (
                <div className="rounded-md border border-border p-2">
                  <p className="text-xs font-semibold">Other printed versions of this section</p>
                  <ul className="mt-1 space-y-0.5">
                    {openSection.otherVersions.map((v) => (
                      <li key={v.sectionId}>
                        <SectionButton
                          item={v}
                          active={false}
                          onOpen={() => go({ node: undefined, sec: v.sectionId })}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
