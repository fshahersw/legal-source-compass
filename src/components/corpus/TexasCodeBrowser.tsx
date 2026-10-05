import { useEffect, useMemo, useState } from "react";
import {
  loadTexasBrowseCodes,
  loadTexasChapterContents,
  loadTexasCode,
  verifiedSectionExcerpt,
  type TexasBrowseCode,
  type TexasBrowseCodes,
  type TexasChapter,
  type TexasCodeIndex,
  type TexasSection,
} from "@/lib/law/texasBrowse";

function capturedDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return (
    date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) +
    " UTC"
  );
}

function chapterLabel(chapter: TexasChapter, duplicateTitle: boolean): string {
  const context =
    duplicateTitle || chapter.legacy_filename_variant ? ` · ${chapter.publisher_member}` : "";
  const variant = chapter.legacy_filename_variant ? " · legacy filename variant" : "";
  return `${chapter.title}${context}${variant}`;
}

export function TexasCodeBrowser() {
  const [codes, setCodes] = useState<TexasBrowseCodes | null>(null);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState("");
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

  useEffect(() => {
    let active = true;
    loadTexasBrowseCodes()
      .then((value) => {
        if (active) setCodes(value);
      })
      .catch((error: unknown) => {
        if (active)
          setCodesError(
            error instanceof Error ? error.message : "Texas code index could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

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
    setSelectedChapterId("");
    setChapterData(null);
    setSelectedSectionId("");
    setShowSection(false);
    loadTexasCode(selectedCode, ref)
      .then((value) => {
        if (active) setCodeIndex(value);
      })
      .catch((error: unknown) => {
        if (active)
          setCodeError(
            error instanceof Error ? error.message : "Texas chapter index could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [codes, selectedCode]);

  useEffect(() => {
    const chapter = codeIndex?.chapters.find((item) => item.id === selectedChapterId);
    if (!chapter) {
      setChapterData(null);
      return;
    }
    let active = true;
    setChapterData(null);
    setChapterError(null);
    setSelectedSectionId("");
    setExcerpt(null);
    setShowSection(false);
    loadTexasChapterContents(chapter)
      .then((value) => {
        if (active) setChapterData(value);
      })
      .catch((error: unknown) => {
        if (active)
          setChapterError(
            error instanceof Error ? error.message : "Texas source text could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [codeIndex, selectedChapterId]);

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

  const selectedCodeRef = codes?.codes.find((code) => code.code === selectedCode);
  const selectedChapter = codeIndex?.chapters.find((chapter) => chapter.id === selectedChapterId);
  const selectedSection = chapterData?.sections.find((section) => section.id === selectedSectionId);
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

  return (
    <section className="space-y-4" aria-label="Texas code browser">
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-lg font-semibold text-foreground">Browse Texas code text</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {codes?.publisher_coverage_claim.replace(/ Not independently certified current\.$/, "") ??
            "Loading publisher coverage statement…"}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {codes
            ? `${codes.codes.length} code titles · ${codes.codes.reduce((total, code) => total + code.chapter_count, 0).toLocaleString()} source documents · ${codes.codes.reduce((total, code) => total + code.section_count, 0).toLocaleString()} section occurrences`
            : "Loading code index…"}
        </p>
      </div>

      {codesError ? (
        <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {codesError}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(15rem,22rem)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card">
          <label className="block text-sm font-semibold" htmlFor="tx-code-select">
            Code title
          </label>
          <select
            id="tx-code-select"
            value={selectedCode}
            onChange={(event) => setSelectedCode(event.target.value)}
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
              <label className="block pt-2 text-sm font-semibold" htmlFor="tx-chapter-select">
                Chapter / source version
              </label>
              <select
                id="tx-chapter-select"
                value={selectedChapterId}
                onChange={(event) => setSelectedChapterId(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose a source document</option>
                {[...codeIndex.chapters]
                  .sort((a, b) =>
                    a.publisher_member.localeCompare(b.publisher_member, "en", { numeric: true }),
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
              {selectedCodeRef ? (
                <p className="text-xs text-muted-foreground">
                  {selectedCodeRef.section_count.toLocaleString()} section occurrences in this code
                  listing.
                </p>
              ) : null}
            </>
          ) : null}
          {chapterError ? (
            <p role="alert" className="text-sm text-destructive">
              {chapterError}
            </p>
          ) : null}
          {chapterData && chapterData.sections.length ? (
            <>
              <label className="block pt-2 text-sm font-semibold" htmlFor="tx-section-select">
                Section heading
              </label>
              <select
                id="tx-section-select"
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
                    {selectedChapter.publisher_member} · Captured{" "}
                    {capturedDate(selectedChapter.captured_at)}
                  </p>
                </div>
                <a
                  href={selectedChapter.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary underline underline-offset-4"
                >
                  Publisher archive
                </a>
              </div>
              {selectedSection ? (
                <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="text-sm font-semibold">{selectedSection.title}</p>
                  {selectedSection.hierarchy ? (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {Object.values(selectedSection.hierarchy).join(" › ")}
                    </p>
                  ) : null}
                  <a
                    href={selectedSection.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-primary underline underline-offset-4"
                  >
                    {selectedSection.source_url === selectedChapter.source_url
                      ? "Publisher archive"
                      : "Open section source"}
                  </a>
                </div>
              ) : null}
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground">
                  Source details
                </summary>
                <dl className="mt-2 grid gap-1 sm:grid-cols-[9rem_1fr]">
                  <dt>Source reference</dt>
                  <dd className="break-all">{selectedChapter.id}</dd>
                  <dt>Publisher filename</dt>
                  <dd className="break-all">
                    {selectedChapter.publisher_member}
                    {selectedChapter.legacy_filename_variant ? " · legacy filename variant" : ""}
                  </dd>
                  <dt>Text SHA-256</dt>
                  <dd className="break-all font-mono">{selectedChapter.text.sha256}</dd>
                  <dt>Capture time</dt>
                  <dd>{selectedChapter.captured_at} (retrieval time)</dd>
                  <dt>Publisher edition</dt>
                  <dd>{codes?.publisher_coverage_claim}</dd>
                  <dt>Currentness</dt>
                  <dd>Publisher coverage is not an independent currentness review.</dd>
                  <dt>Publisher archive</dt>
                  <dd>
                    <a
                      href={selectedChapter.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Open publisher archive
                    </a>
                  </dd>
                </dl>
              </details>
              {chapterData ? (
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
                  {showSection && selectedSectionId ? (
                    excerptError ? (
                      <p role="alert" className="text-sm text-destructive">
                        {excerptError}
                      </p>
                    ) : excerpt ? (
                      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 text-sm leading-relaxed">
                        {excerpt}
                      </pre>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Verifying selected section text…
                      </p>
                    )
                  ) : (
                    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 text-sm leading-relaxed">
                      {chapterData.text}
                    </pre>
                  )}
                </div>
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
