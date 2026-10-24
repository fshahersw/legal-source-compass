import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { SectionReadout } from "@/components/corpus/SectionReadout";
import { SectionTools } from "@/components/corpus/SectionTools";
import {
  getProjectedOutline,
  getStateCodeSection,
  searchStateCodes,
} from "@/lib/law/stateCode.functions";
import {
  showRecorded,
  type HierarchyStep,
  type SectionHierarchyStep,
  type StateCodeListing,
} from "@/lib/law/stateCodeContract";
import { levelLabel, sectionHeadingLabel, type LevelLabel } from "@/lib/law/stateCodeHeading";

type OutlineSection = {
  native_id: string;
  citation: string | null;
  heading: string | null;
  status_note: string | null;
};

function levelName(level: string): string {
  return level.replace(/_/g, " ");
}

/** Publisher groupings that are headings by nature and never numbered (Nevada, California "heading" levels). */
const UNNUMBERED_LEVELS = new Set(["heading", "subheading"]);

/** A code is known by its name ("Agriculture Code"); other levels by kind and number ("Title 1-A"). */
function primaryLabel(label: LevelLabel, level: string): string {
  if (level === "code" || !label.number) return label.name ?? label.designation;
  return label.designation;
}

/** Short position label for breadcrumbs and "Up to …". */
function stepLabel(step: HierarchyStep): string {
  return primaryLabel(levelLabel(step.level, step.number, step.heading), step.level);
}

function sectionLabel(item: OutlineSection): string {
  return item.citation ?? item.heading ?? item.native_id;
}

/** The section heading under its citation, without a copy of the citation's own number. */
function sectionNote(item: OutlineSection): string | null {
  if (!item.citation) return null;
  const note = sectionHeadingLabel(item.citation, item.heading);
  return note && note !== item.citation ? note : null;
}

function StatusTag({ status }: { status: string | null }) {
  return status ? (
    <span className="ml-1.5 rounded border border-border px-1 py-px align-middle text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {status}
    </span>
  ) : null;
}

export function ProjectionCodeBrowser({
  listing,
  path,
  section,
  onNavigate,
}: {
  listing: StateCodeListing;
  path: HierarchyStep[];
  section?: string | undefined;
  onNavigate: (next: { path: HierarchyStep[]; section?: string | undefined }) => void;
}) {
  const outlineFn = useServerFn(getProjectedOutline);
  const sectionFn = useServerFn(getStateCodeSection);
  const searchFn = useServerFn(searchStateCodes);
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [filter, setFilter] = useState("");
  const readerRef = useRef<HTMLDivElement>(null);
  const outline = useQuery({
    queryKey: ["projected-outline", listing.state, path],
    queryFn: () => outlineFn({ data: { state: listing.state, path } }),
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
  const data =
    outline.data?.available && outline.data.kind !== "unsupported_path" ? outline.data : null;
  const unsupported = outline.data?.available && outline.data.kind === "unsupported_path";
  const level = data?.kind === "groups" ? data.level : null;
  const sections: OutlineSection[] = useMemo(
    () => (data?.kind === "sections" ? data.sections : (data?.directSections ?? [])),
    [data],
  );
  const groups = data?.kind === "groups" ? data.groups : [];
  const mixedLevels = new Set(groups.map((g) => g.level ?? level)).size > 1;
  const needle = filter.trim().toLowerCase();
  const shownGroups = needle
    ? groups.filter((g) => `${g.number ?? ""} ${g.heading ?? ""}`.toLowerCase().includes(needle))
    : groups;
  const shownSections = needle
    ? sections.filter((s) =>
        `${s.citation ?? ""} ${s.heading ?? ""}`.toLowerCase().includes(needle),
      )
    : sections;
  const sectionSteps: SectionHierarchyStep[] = useMemo(() => {
    const release = detail.data?.outlinePath;
    if (release?.length) return release.map((step) => ({ ...step, heading: step.heading ?? null }));
    const steps = detail.data?.hierarchy ?? [];
    const declared = listing.levels;
    return declared ? steps.filter((step) => declared.includes(step.level)) : steps;
  }, [detail.data, listing.levels]);
  const samePath =
    sectionSteps.length === path.length &&
    sectionSteps.every((step, i) =>
      step.node_id && path[i]?.node_id
        ? path[i]?.node_id === step.node_id
        : path[i]?.level === step.level && path[i]?.number === step.number,
    );
  const index = section ? sections.findIndex((s) => s.native_id === section) : -1;
  const previous = index > 0 ? sections[index - 1] : null;
  const next = index >= 0 && index < sections.length - 1 ? sections[index + 1] : null;

  useEffect(() => {
    setFilter("");
  }, [path]);
  useEffect(() => {
    if (section && readerRef.current && window.innerWidth < 1024)
      readerRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [section]);

  const crumbs = (
    <nav aria-label="Code outline position" className="flex flex-wrap items-center gap-1 text-xs">
      <button
        type="button"
        className={`rounded px-1.5 py-0.5 ${path.length ? "text-primary underline-offset-4 hover:underline" : "font-semibold"}`}
        onClick={() => onNavigate({ path: [], section: undefined })}
      >
        {listing.codeName}
      </button>
      {path.map((step, i) => (
        <span key={`${step.level}-${step.number ?? ""}-${i}`} className="flex items-center gap-1">
          <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
          <button
            type="button"
            title={step.heading ?? undefined}
            className={`max-w-[16rem] truncate rounded px-1.5 py-0.5 ${
              i === path.length - 1
                ? "font-semibold"
                : "text-primary underline-offset-4 hover:underline"
            }`}
            onClick={() => onNavigate({ path: path.slice(0, i + 1), section: undefined })}
          >
            {stepLabel(step)}
          </button>
        </span>
      ))}
    </nav>
  );

  return (
    <section className="space-y-4" aria-label={`${listing.name} code browser`}>
      <div className="rounded-xl border border-border bg-card shadow-xs p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-heading font-semibold text-foreground">Browse statutes</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Source version: {listing.currency || listing.edition || "Not recorded"}. This source
              edition does not establish the law currently in force.
            </p>
            {listing.note ? (
              <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {listing.note}
              </p>
            ) : null}
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Source version</summary>
              <p className="mt-2 leading-relaxed">
                {listing.sectionCount == null
                  ? "Section count: Not recorded"
                  : `${listing.sectionCount.toLocaleString()} sections`}
                {" · "}Edition: {showRecorded(listing.edition)}
                {" · "}Currency: {showRecorded(listing.currency)}
              </p>
            </details>
            {listing.sourceUrl ? (
              <a
                href={listing.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-primary underline underline-offset-4"
              >
                Source site
              </a>
            ) : null}
          </div>
          <form
            className="flex w-full max-w-md gap-2"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(draft.trim());
            }}
          >
            <label className="sr-only" htmlFor="projected-code-search">
              Search citation or heading across this code
            </label>
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                aria-hidden
              />
              <input
                id="projected-code-search"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Citation or heading, e.g. 5524 or limitation"
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
        {found.isFetching ? (
          <p className="mt-2 text-sm text-muted-foreground">Searching citation and heading…</p>
        ) : null}
        {found.error ? (
          <div className="mt-2">
            <ExternalError error={found.error} />
          </div>
        ) : null}
        {found.data ? (
          <ul
            className="mt-3 max-h-72 divide-y divide-border overflow-auto rounded-md border border-border"
            aria-label="Search results"
          >
            <li className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
              <span>{found.data.total.toLocaleString()} matching sections</span>
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setSubmitted("");
                  setDraft("");
                }}
              >
                Clear
              </button>
            </li>
            {found.data.hits
              .filter((hit) => hit.kind === "projection")
              .map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                      hit.id === section ? "bg-muted" : ""
                    }`}
                    aria-current={hit.id === section ? "true" : undefined}
                    onClick={() => onNavigate({ path, section: hit.id })}
                  >
                    <span className="font-medium">{hit.citation ?? hit.heading}</span>
                    {hit.citation && sectionHeadingLabel(hit.citation, hit.heading) ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {sectionHeadingLabel(hit.citation, hit.heading)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        <div className="flex flex-col rounded-xl border border-border bg-card shadow-xs shadow-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
          <div className="space-y-2 border-b border-border p-3">
            {crumbs}
            {path.length ? (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                onClick={() => onNavigate({ path: path.slice(0, -1), section: undefined })}
              >
                <ChevronLeft className="size-3" aria-hidden />
                Up to {path.length === 1 ? "the code" : stepLabel(path[path.length - 2]!)}
              </button>
            ) : null}
            {groups.length + sections.length > 12 ? (
              <>
                <label className="sr-only" htmlFor="projected-outline-filter">
                  Filter this list
                </label>
                <input
                  id="projected-outline-filter"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={`Filter ${groups.length + sections.length} entries at this level`}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
              </>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2" data-testid="code-outline">
            {outline.isLoading ? (
              <p className="p-2 text-sm text-muted-foreground">Loading outline…</p>
            ) : null}
            {outline.error ? (
              <div className="p-2">
                <ExternalError error={outline.error} />
              </div>
            ) : null}
            {outline.data && !outline.data.available ? (
              <p className="p-2 text-sm text-muted-foreground">
                This source edition is not available to browse.
              </p>
            ) : null}
            {unsupported ? (
              <div
                className="space-y-2 p-2 text-sm text-muted-foreground"
                data-testid="outline-unsupported"
              >
                <p>
                  This outline position is unavailable. Open the section from search, use the
                  neighbouring-section links, or go up a level.
                </p>
              </div>
            ) : null}
            {data && groups.length ? (
              <>
                <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {mixedLevels ? "Divisions" : levelName(level ?? "")}
                  {data.kind === "groups" && data.truncated
                    ? ` · showing 2,000 of ${data.total.toLocaleString()}`
                    : ` · ${groups.length.toLocaleString()}`}
                </p>
                <ul className="space-y-0.5" aria-label={`${levelName(level ?? "")} list`}>
                  {shownGroups.map((group, i) => {
                    const groupLevel = group.level ?? level ?? "";
                    const label = levelLabel(groupLevel, group.number, group.heading);
                    const primary = primaryLabel(label, groupLevel);
                    const secondary =
                      groupLevel === "code"
                        ? label.name
                          ? label.number
                          : null
                        : label.number
                          ? label.name
                          : label.name && !UNNUMBERED_LEVELS.has(groupLevel)
                            ? `${label.kind} · number not recorded`
                            : null;
                    return (
                      <li
                        key={`${group.node_id ?? group.number ?? ""}-${group.heading ?? ""}-${i}`}
                      >
                        <button
                          type="button"
                          title={
                            group.variants?.length
                              ? `Also printed as: ${group.variants.join(" | ")}`
                              : undefined
                          }
                          className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            if (!groupLevel) return;
                            onNavigate({
                              path: [
                                ...path,
                                {
                                  level: groupLevel,
                                  number: group.number,
                                  ...(group.node_id ? { node_id: group.node_id } : {}),
                                  heading: group.heading,
                                },
                              ],
                              section: undefined,
                            });
                          }}
                        >
                          <span className="min-w-0">
                            <span
                              className={
                                label.status ? "font-medium text-muted-foreground" : "font-medium"
                              }
                            >
                              {primary}
                            </span>
                            <StatusTag status={label.status} />
                            {secondary ? (
                              <span className="block text-xs text-muted-foreground">
                                {secondary}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                            {group.count.toLocaleString()}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {needle && !shownGroups.length ? (
                    <li className="px-2 py-1.5 text-xs text-muted-foreground">
                      No {levelName(level ?? "")} matches the filter.
                    </li>
                  ) : null}
                </ul>
              </>
            ) : null}
            {data && sections.length ? (
              <>
                <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sections
                  {data.kind === "sections" && data.truncated
                    ? ` · showing 5,000 of ${data.total.toLocaleString()}`
                    : data.kind === "groups" && data.directTruncated
                      ? ` · showing 5,000 of ${data.directTotal.toLocaleString()}`
                      : ` · ${sections.length.toLocaleString()}`}
                </p>
                <ul className="space-y-0.5" aria-label="Section list">
                  {shownSections.map((item) => {
                    const active = item.native_id === section;
                    return (
                      <li key={item.native_id}>
                        <button
                          type="button"
                          aria-current={active ? "true" : undefined}
                          className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                            active ? "bg-muted font-medium ring-1 ring-border" : ""
                          }`}
                          onClick={() => onNavigate({ path, section: item.native_id })}
                        >
                          <span>{sectionLabel(item)}</span>
                          {sectionNote(item) ? (
                            <span className="block text-xs text-muted-foreground">
                              {sectionNote(item)}
                            </span>
                          ) : null}
                          {item.status_note ? (
                            <span className="block text-xs italic text-muted-foreground">
                              {item.status_note}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                  {needle && !shownSections.length ? (
                    <li className="px-2 py-1.5 text-xs text-muted-foreground">
                      No section matches the filter.
                    </li>
                  ) : null}
                </ul>
              </>
            ) : null}
            {data && !groups.length && !sections.length ? (
              path.length && data.read === "v2" ? (
                <div
                  className="space-y-2 p-2 text-sm text-muted-foreground"
                  data-testid="outline-empty"
                >
                  <p>No outline entries are available at this position.</p>
                  <p className="text-xs">
                    Try searching a citation or heading, or use a section's "Show in outline" link.
                  </p>
                </div>
              ) : (
                <p className="p-2 text-sm text-muted-foreground" data-testid="outline-empty">
                  Nothing is recorded below this level.
                </p>
              )
            ) : null}
          </div>
        </div>

        <div
          ref={readerRef}
          className="min-w-0 scroll-mt-4 rounded-xl border border-border bg-card shadow-xs p-4 shadow-card"
        >
          {!section ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Choose a section from the outline, or search a citation or heading above.</p>
              <p className="text-xs">
                Text follows the recorded source edition. Check the linked source and its
                qualifications before relying on it.
              </p>
            </div>
          ) : null}
          {section && (previous || next) ? (
            <nav
              className="mb-3 flex items-center justify-between gap-2 text-xs"
              aria-label="Neighbouring sections"
            >
              {previous ? (
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1 text-primary underline-offset-4 hover:underline"
                  onClick={() => onNavigate({ path, section: previous.native_id })}
                >
                  <ChevronLeft className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{sectionLabel(previous)}</span>
                </button>
              ) : (
                <span />
              )}
              {next ? (
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1 text-primary underline-offset-4 hover:underline"
                  onClick={() => onNavigate({ path, section: next.native_id })}
                >
                  <span className="truncate">{sectionLabel(next)}</span>
                  <ChevronRight className="size-3 shrink-0" aria-hidden />
                </button>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
          {detail.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading section…</p>
          ) : null}
          {detail.error ? <ExternalError error={detail.error} /> : null}
          {detail.data && section ? (
            <div className="space-y-4">
              {sectionSteps.length ? (
                <p
                  className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
                  data-testid="section-position"
                >
                  {sectionSteps.map((step, i) => {
                    const label = levelLabel(step.level, step.number, step.heading);
                    const primary = primaryLabel(label, step.level);
                    const rest = primary === label.designation ? label.name : null;
                    return (
                      <span
                        key={`${step.node_id ?? step.level}-${step.number ?? ""}-${i}`}
                        className="flex items-center gap-1"
                      >
                        {i > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
                        <span>{primary}</span>
                        {rest ? <span>· {rest}</span> : null}
                        <StatusTag status={label.status} />
                      </span>
                    );
                  })}
                  {!samePath ? (
                    <button
                      type="button"
                      className="ml-1 text-primary underline-offset-4 hover:underline"
                      onClick={() =>
                        onNavigate({
                          path: sectionSteps.map((step) => ({
                            level: step.level,
                            number: step.number,
                            ...(step.node_id ? { node_id: step.node_id } : {}),
                            heading: step.heading,
                          })),
                          section,
                        })
                      }
                    >
                      Show in outline
                    </button>
                  ) : null}
                </p>
              ) : null}
              <SectionTools fields={detail.data} state={listing.state} nativeId={section} />
              <SectionReadout fields={detail.data} />
            </div>
          ) : null}
          {section && detail.data === null && !detail.isLoading && !detail.error ? (
            <p className="text-sm text-muted-foreground">
              No public section is recorded for this link.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
