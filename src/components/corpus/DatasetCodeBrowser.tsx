import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { SectionReadout } from "@/components/corpus/SectionReadout";
import { SectionTools } from "@/components/corpus/SectionTools";
import {
  getStateCodeChapters,
  getStateCodeSection,
  getStateCodeSectionList,
  getStateCodeTitles,
  searchStateCodes,
  type StateCodeListing,
} from "@/lib/law/stateCode.functions";
import { showRecorded, type StateCodeHit } from "@/lib/law/stateCodeContract";

const MISSING = "__not_recorded__";

export function DatasetCodeBrowser({
  listing,
  title,
  chapter,
  section,
  onNavigate,
}: {
  listing: StateCodeListing;
  title?: string | undefined;
  chapter?: string | undefined;
  section?: string | undefined;
  onNavigate: (next: {
    title?: string | undefined;
    chapter?: string | undefined;
    section?: string | undefined;
  }) => void;
}) {
  const titlesFn = useServerFn(getStateCodeTitles);
  const chaptersFn = useServerFn(getStateCodeChapters);
  const sectionsFn = useServerFn(getStateCodeSectionList);
  const sectionFn = useServerFn(getStateCodeSection);
  const searchFn = useServerFn(searchStateCodes);
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");

  const titles = useQuery({
    queryKey: ["state-code-titles", listing.state, listing.datasetId],
    queryFn: () => titlesFn({ data: { state: listing.state } }),
    staleTime: 60_000,
  });
  const chapters = useQuery({
    queryKey: ["state-code-chapters", listing.state, title],
    queryFn: () => chaptersFn({ data: { state: listing.state, title: title! } }),
    enabled: !!title,
  });
  const sectionList = useQuery({
    queryKey: ["state-code-sections", listing.state, title, chapter],
    queryFn: () =>
      sectionsFn({
        data: { state: listing.state, title: title!, chapter: chapter === MISSING ? "" : chapter! },
      }),
    enabled: !!title && chapter !== undefined,
  });
  const detail = useQuery({
    queryKey: ["state-code-section", listing.state, section],
    queryFn: () => sectionFn({ data: { state: listing.state, id: section! } }),
    enabled: !!section,
  });
  const found = useQuery({
    queryKey: ["state-code-search", listing.state, submitted],
    queryFn: () => searchFn({ data: { state: listing.state, q: submitted } }),
    enabled: submitted.trim().length >= 2,
  });

  const openHit = (hit: StateCodeHit) => {
    if (hit.kind !== "dataset") return;
    onNavigate({
      title: hit.titleValue ?? undefined,
      chapter: hit.chapterLabel == null ? undefined : hit.chapterLabel || MISSING,
      section: hit.id,
    });
  };

  return (
    <section className="space-y-4" aria-label={`${listing.name} code browser`}>
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-lg font-semibold text-foreground">{listing.codeName}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {listing.sectionCount == null
            ? "Section count: Not recorded"
            : `${listing.sectionCount.toLocaleString()} sections`}
          {" · "}Edition: {showRecorded(listing.edition)}
          {" · "}Currency: {showRecorded(listing.currency)}
        </p>
        {listing.note ? (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {listing.note}
          </p>
        ) : null}
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(draft.trim());
          }}
        >
          <label className="sr-only" htmlFor="code-search">
            Search citation or heading
          </label>
          <input
            id="code-search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Citation or heading"
            className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            Search
          </button>
        </form>
        {found.error ? (
          <div className="mt-2">
            <ExternalError error={found.error} />
          </div>
        ) : null}
        {found.isFetching ? (
          <p className="mt-2 text-sm text-muted-foreground">Searching citation and heading…</p>
        ) : null}
        {found.data ? (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">
              {found.data.total.toLocaleString()} matching sections
            </p>
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {found.data.hits
                .filter((hit) => hit.kind === "dataset")
                .map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => openHit(hit)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{hit.heading}</span>
                      {hit.chapterLabel ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {hit.chapterLabel}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              {found.data.hits.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  No sections matched that citation or heading.
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(15rem,22rem)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card">
          {titles.error ? <ExternalError error={titles.error} /> : null}
          <label className="block text-sm font-semibold" htmlFor="code-title">
            Title
          </label>
          <select
            id="code-title"
            value={title ?? ""}
            onChange={(event) =>
              onNavigate({
                title: event.target.value || undefined,
                chapter: undefined,
                section: undefined,
              })
            }
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{titles.isLoading ? "Loading titles…" : "Choose a title"}</option>
            {(titles.data ?? []).map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
                {item.count == null ? "" : ` · ${item.count.toLocaleString()}`}
              </option>
            ))}
          </select>
          {titles.data && titles.data.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Title divisions are not recorded in this code's published listing. Search by citation
              or heading.
            </p>
          ) : null}
          {title ? (
            <>
              <label className="block pt-2 text-sm font-semibold" htmlFor="code-chapter">
                Chapter
              </label>
              <select
                id="code-chapter"
                value={(() => {
                  const labels = chapters.data?.chapters ?? [];
                  const current = chapter === MISSING ? "" : chapter;
                  const index =
                    current === undefined ? -1 : labels.findIndex((item) => item.label === current);
                  return index >= 0 ? String(index) : "";
                })()}
                onChange={(event) => {
                  const item = chapters.data?.chapters[Number(event.target.value)];
                  onNavigate({
                    title,
                    chapter: item ? item.label || MISSING : undefined,
                    section: undefined,
                  });
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">
                  {chapters.isLoading ? "Loading chapters…" : "Choose a chapter"}
                </option>
                {(chapters.data?.chapters ?? []).map((item, index) => (
                  <option key={`${index}-${item.count}`} value={String(index)}>
                    {(item.label || "Not recorded").replace(/\s+/g, " ")} ·{" "}
                    {item.count.toLocaleString()}
                  </option>
                ))}
              </select>
              {chapters.data?.truncated ? (
                <p className="text-xs text-muted-foreground">
                  Chapter list stopped at 100,000 sections. Narrow the title.
                </p>
              ) : null}
              {chapters.error ? <ExternalError error={chapters.error} /> : null}
            </>
          ) : null}
          {title && chapter !== undefined ? (
            <>
              <label className="block pt-2 text-sm font-semibold" htmlFor="code-section">
                Section
              </label>
              <select
                id="code-section"
                value={section ?? ""}
                onChange={(event) =>
                  onNavigate({ title, chapter, section: event.target.value || undefined })
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">
                  {sectionList.isLoading ? "Loading sections…" : "Choose a section"}
                </option>
                {(sectionList.data?.sections ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                    {item.status && item.status !== "Section text" ? ` · ${item.status}` : ""}
                  </option>
                ))}
              </select>
              {sectionList.data?.truncated ? (
                <p className="text-xs text-muted-foreground">
                  Showing the first 100,000 sections in this chapter, in published order.
                </p>
              ) : null}
              {sectionList.error ? <ExternalError error={sectionList.error} /> : null}
            </>
          ) : null}
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card">
          {!section ? (
            <p className="text-sm text-muted-foreground">
              Choose a title, chapter, and section to read the published text.
            </p>
          ) : null}
          {detail.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading section…</p>
          ) : null}
          {detail.error ? <ExternalError error={detail.error} /> : null}
          {detail.data ? (
            <div className="space-y-4">
              <SectionTools fields={detail.data} state={listing.state} />
              <SectionReadout fields={detail.data} />
            </div>
          ) : null}
          {section && detail.data === null && !detail.isLoading && !detail.error ? (
            <p className="text-sm text-muted-foreground">No section is recorded for this link.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
