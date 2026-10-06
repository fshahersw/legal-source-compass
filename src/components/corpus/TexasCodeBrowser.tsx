import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SectionReadout } from "@/components/corpus/SectionReadout";
import { searchStateCodes } from "@/lib/law/stateCode.functions";
import { showRecorded, type SectionFields } from "@/lib/law/stateCodeContract";
import {
  loadBrowseChapter,
  loadBrowseCode,
  loadBrowseCodes,
  verifiedSectionExcerpt,
  type LoadedBrowseCodes,
  type TexasBrowseCode,
  type TexasChapter,
  type TexasCodeIndex,
  type TexasSection,
} from "@/lib/law/texasBrowse";

function capturedDate(value: string | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return (
    date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) +
    " UTC"
  );
}

function chapterLabel(chapter: TexasChapter, duplicateTitle: boolean): string {
  const context =
    duplicateTitle && chapter.publisher_member ? ` · ${chapter.publisher_member}` : "";
  const variant = chapter.legacy_filename_variant ? " · legacy filename variant" : "";
  return `${chapter.title}${context}${variant}`;
}

function sectionFields(
  section: TexasSection,
  edition: string | null,
  currency: string | null,
): SectionFields {
  const history = [section.history, section.source_note].filter(
    (part): part is string => !!part && !!part.trim(),
  );
  return {
    citation: section.citation,
    heading: section.title || null,
    text: null,
    history: history.length ? [...new Set(history)].join("\n") : null,
    edition,
    currency,
    sourceUrl: section.source_url || null,
    status: null,
  };
}

export function TexasCodeBrowser({
  state = "TX",
  edition = null,
  currency = null,
  note = null,
  initial,
}: {
  state?: string;
  edition?: string | null;
  currency?: string | null;
  note?: string | null;
  initial?: {
    code?: string | undefined;
    chapter?: string | undefined;
    section?: string | undefined;
  };
}) {
  const searchFn = useServerFn(searchStateCodes);
  const [codes, setCodes] = useState<LoadedBrowseCodes | null>(null);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState(initial?.code ?? "");
  const [codeIndex, setCodeIndex] = useState<TexasCodeIndex | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState("");
  const [chapterData, setChapterData] = useState<{ text: string; sections: TexasSection[] } | null>(
    null,
  );
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const [excerptError, setExcerptError] = useState<string | null>(null);
  const [showSection, setShowSection] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const pending = useRef<{ chapter: string; section: string } | null>(
    initial?.chapter ? { chapter: initial.chapter, section: initial.section ?? "" } : null,
  );

  const found = useQuery({
    queryKey: ["state-code-search", state, submitted],
    queryFn: () => searchFn({ data: { state, q: submitted } }),
    enabled: submitted.trim().length >= 2,
  });

  useEffect(() => {
    let active = true;
    loadBrowseCodes(state)
      .then((value) => {
        if (active) setCodes(value);
      })
      .catch((error: unknown) => {
        if (active)
          setCodesError(
            error instanceof Error ? error.message : "State code index could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [state]);

  useEffect(() => {
    if (!codes || !selectedCode) {
      setCodeIndex(null);
      return;
    }
    const ref = codes.codes.find((item) => item.code === selectedCode);
    if (!ref) {
      setCodeIndex(null);
      setCodeError("Choose a code from the list.");
      return;
    }
    let active = true;
    setCodeIndex(null);
    setCodeError(null);
    if (!pending.current) {
      setSelectedChapterId("");
      setChapterData(null);
      setSelectedSectionId("");
      setShowSection(false);
    }
    loadBrowseCode(state, ref, { root: codes.root, textRoot: codes.textRoot })
      .then((value) => {
        if (!active) return;
        setCodeIndex(value);
        if (
          pending.current &&
          value.chapters.some((chapter) => chapter.id === pending.current?.chapter)
        ) {
          setSelectedChapterId(pending.current.chapter);
        }
      })
      .catch((error: unknown) => {
        if (active)
          setCodeError(
            error instanceof Error ? error.message : "Chapter index could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [codes, selectedCode, state]);

  useEffect(() => {
    const chapter = codeIndex?.chapters.find((item) => item.id === selectedChapterId);
    if (!chapter || !codes) {
      setChapterData(null);
      return;
    }
    let active = true;
    setChapterData(null);
    setChapterError(null);
    const keepSection = pending.current?.section;
    if (!keepSection) {
      setSelectedSectionId("");
      setExcerpt(null);
      setShowSection(false);
    }
    loadBrowseChapter(chapter, { root: codes.root, schema: codes.schema_version, state })
      .then((value) => {
        if (!active) return;
        setChapterData(value);
        if (keepSection && value.sections.some((row) => row.id === keepSection)) {
          setSelectedSectionId(keepSection);
          setShowSection(true);
          pending.current = null;
        }
      })
      .catch((error: unknown) => {
        if (active)
          setChapterError(
            error instanceof Error ? error.message : "Source text could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [codeIndex, codes, selectedChapterId, state]);

  useEffect(() => {
    const row = chapterData?.sections.find((section) => section.id === selectedSectionId);
    if (!row || !chapterData) {
      setExcerpt(null);
      setExcerptError(null);
      return;
    }
    let active = true;
    setExcerpt(null);
    setExcerptError(null);
    verifiedSectionExcerpt(chapterData.text, row)
      .then((value) => {
        if (active) setExcerpt(value);
      })
      .catch((error: unknown) => {
        if (active)
          setExcerptError(
            error instanceof Error ? error.message : "Section text verification failed.",
          );
      });
    return () => {
      active = false;
    };
  }, [chapterData, selectedSectionId]);

  const openHit = (code: string, chapterId: string, sectionId: string) => {
    pending.current = { chapter: chapterId, section: sectionId };
    if (selectedCode !== code) setSelectedCode(code);
    else if (selectedChapterId !== chapterId) setSelectedChapterId(chapterId);
    else {
      setSelectedSectionId(sectionId);
      setShowSection(true);
      pending.current = null;
    }
  };

  const selectedChapter = codeIndex?.chapters.find((chapter) => chapter.id === selectedChapterId);
  const selectedSection = chapterData?.sections.find((section) => section.id === selectedSectionId);
  const editionText = edition ?? codes?.publisher_coverage_claim ?? null;
  const titleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chapter of codeIndex?.chapters ?? []) {
      const key = chapter.title.trim().toLocaleLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [codeIndex]);
  const repeatedCitationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const section of chapterData?.sections ?? []) {
      if (section.citation) counts.set(section.citation, (counts.get(section.citation) ?? 0) + 1);
    }
    return counts;
  }, [chapterData]);
  const sectionCount = codes?.codes.reduce((total, code) => total + code.section_count, 0) ?? null;

  return (
    <section className="space-y-4" aria-label={`${state} code browser`}>
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-lg font-semibold text-foreground">Browse {state} code text</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {sectionCount == null
            ? "Loading section count…"
            : `${sectionCount.toLocaleString()} section occurrences`}
          {" · "}Edition: {showRecorded(editionText)}
          {" · "}Currency: {showRecorded(currency)}
        </p>
        {note || codes?.publisher_coverage_claim ? (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {note ?? codes?.publisher_coverage_claim}
          </p>
        ) : null}
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(draft.trim());
          }}
        >
          <label className="sr-only" htmlFor="snapshot-code-search">
            Search citation or heading
          </label>
          <input
            id="snapshot-code-search"
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
        {found.isFetching ? (
          <p className="mt-2 text-sm text-muted-foreground">Searching citation and heading…</p>
        ) : null}
        {found.error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {found.error instanceof Error ? found.error.message : "Search failed."}
          </p>
        ) : null}
        {found.data ? (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">
              {found.data.total.toLocaleString()} matching sections
            </p>
            <ul className="mt-2 max-h-64 divide-y divide-border overflow-auto rounded-md border border-border">
              {found.data.hits
                .filter((hit) => hit.kind === "snapshot" && hit.code && hit.chapterId)
                .map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => openHit(hit.code!, hit.chapterId!, hit.id)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{hit.citation ?? hit.heading}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {hit.heading}
                      </span>
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

      {codesError ? (
        <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {codesError}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(15rem,22rem)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card">
          <label className="block text-sm font-semibold" htmlFor="code-title-select">
            Code title
          </label>
          <select
            id="code-title-select"
            value={selectedCode}
            onChange={(event) => {
              pending.current = null;
              setSelectedCode(event.target.value);
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Choose a code</option>
            {codes?.codes.map((code: TexasBrowseCode) => (
              <option key={code.code} value={code.code}>
                {code.code_name} · {code.chapter_count.toLocaleString()} source documents
              </option>
            ))}
          </select>
          {codeError ? (
            <p role="alert" className="text-sm text-destructive">
              {codeError}
            </p>
          ) : null}
          {codeIndex ? (
            <>
              <label className="block pt-2 text-sm font-semibold" htmlFor="code-chapter-select">
                Chapter / source version
              </label>
              <select
                id="code-chapter-select"
                value={selectedChapterId}
                onChange={(event) => {
                  pending.current = null;
                  setSelectedChapterId(event.target.value);
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose a source document</option>
                {[...codeIndex.chapters]
                  .sort((a, b) =>
                    (a.publisher_member ?? a.title).localeCompare(
                      b.publisher_member ?? b.title,
                      "en",
                      { numeric: true },
                    ),
                  )
                  .map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapterLabel(
                        chapter,
                        (titleCounts.get(chapter.title.trim().toLocaleLowerCase()) ?? 0) > 1,
                      )}
                    </option>
                  ))}
              </select>
            </>
          ) : null}
          {chapterError ? (
            <p role="alert" className="text-sm text-destructive">
              {chapterError}
            </p>
          ) : null}
          {chapterData && chapterData.sections.length ? (
            <>
              <label className="block pt-2 text-sm font-semibold" htmlFor="code-section-select">
                Section heading
              </label>
              <select
                id="code-section-select"
                value={selectedSectionId}
                onChange={(event) => {
                  setSelectedSectionId(event.target.value);
                  setShowSection(Boolean(event.target.value));
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Full chapter</option>
                {chapterData.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.citation ?? section.title}
                    {section.citation && (repeatedCitationCounts.get(section.citation) ?? 0) > 1
                      ? ` · occurrence ${section.occurrence}`
                      : ""}
                  </option>
                ))}
              </select>
              {excerptError ? (
                <p role="alert" className="text-sm text-destructive">
                  {excerptError}
                </p>
              ) : null}
            </>
          ) : chapterData ? (
            <p className="text-xs text-muted-foreground">
              No section headings were indexed for this source document. The captured document text
              is available.
            </p>
          ) : null}
        </div>

        <div className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card">
          {!selectedChapter ? (
            <p className="text-sm text-muted-foreground">
              Choose a code title and source document to read the captured text.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">{selectedChapter.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedChapter.publisher_member ?? "Publisher filename not recorded"} ·
                    Retrieved {capturedDate(selectedChapter.captured_at)}
                  </p>
                </div>
                <a
                  href={selectedChapter.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary underline underline-offset-4"
                >
                  Publisher source
                </a>
              </div>
              {selectedSection ? (
                <div className="mt-4">
                  {selectedSectionId ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setShowSection(false)}
                        aria-pressed={!showSection}
                        className={`rounded-md border px-3 py-1.5 text-sm ${!showSection ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                      >
                        Full chapter
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSection(true)}
                        aria-pressed={showSection}
                        className={`rounded-md border px-3 py-1.5 text-sm ${showSection ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                      >
                        Selected section
                      </button>
                    </div>
                  ) : null}
                  {showSection ? (
                    excerptError ? (
                      <p role="alert" className="text-sm text-destructive">
                        {excerptError}
                      </p>
                    ) : excerpt ? (
                      <SectionReadout
                        fields={sectionFields(selectedSection, editionText, currency)}
                        text={excerpt}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Verifying selected section text…
                      </p>
                    )
                  ) : (
                    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 text-sm leading-relaxed">
                      {chapterData?.text}
                    </pre>
                  )}
                </div>
              ) : chapterData ? (
                <pre className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 text-sm leading-relaxed">
                  {chapterData.text}
                </pre>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Loading and verifying captured source text…
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
