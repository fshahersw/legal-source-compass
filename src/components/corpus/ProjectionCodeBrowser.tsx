import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { SectionReadout } from "@/components/corpus/SectionReadout";
import {
  getProjectedOutline,
  getStateCodeSection,
  searchStateCodes,
} from "@/lib/law/stateCode.functions";
import {
  showRecorded,
  type HierarchyStep,
  type StateCodeListing,
} from "@/lib/law/stateCodeContract";

function stepLabel(step: HierarchyStep): string {
  const number = step.number ?? "Not recorded";
  return `${step.level} ${number}`;
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
  const level = outline.data?.available ? outline.data.level : null;

  return (
    <section className="space-y-4" aria-label={`${listing.name} code browser`}>
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-lg font-semibold">{listing.codeName}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {listing.sectionCount == null
            ? "Section count: Not recorded"
            : `${listing.sectionCount.toLocaleString()} sections`}
          {" · "}Edition: {showRecorded(listing.edition)}
          {" · "}Currency: {showRecorded(listing.currency)}
          {listing.note ? ` · ${listing.note}` : ""}
        </p>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(draft.trim());
          }}
        >
          <label className="sr-only" htmlFor="projected-code-search">
            Search citation or heading
          </label>
          <input
            id="projected-code-search"
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
          <div className="mt-2">
            <ExternalError error={found.error} />
          </div>
        ) : null}
        {found.data ? (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {found.data.total.toLocaleString()} matching sections
            </li>
            {found.data.hits
              .filter((hit) => hit.kind === "projection")
              .map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => onNavigate({ path, section: hit.id })}
                  >
                    <span className="font-medium">{hit.citation ?? hit.heading}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {hit.heading}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(15rem,22rem)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card">
          {path.length ? (
            <button
              type="button"
              className="text-sm text-primary underline"
              onClick={() => onNavigate({ path: path.slice(0, -1), section: undefined })}
            >
              Back to {path.length === 1 ? "the code" : stepLabel(path[path.length - 2]!)}
            </button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {path.length ? path.map(stepLabel).join(" · ") : "Start of this code"}
          </p>
          {outline.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {outline.error ? <ExternalError error={outline.error} /> : null}
          {outline.data && !outline.data.available ? (
            <p className="text-sm text-muted-foreground">
              This state's code is not in the public projection.
            </p>
          ) : null}
          {outline.data?.available && outline.data.kind === "groups" ? (
            <>
              {outline.data.directSections.length ? (
                <>
                  <label className="block text-sm font-semibold" htmlFor="projected-section">
                    Section
                  </label>
                  <select
                    id="projected-section"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={section ?? ""}
                    onChange={(event) =>
                      onNavigate({ path, section: event.target.value || undefined })
                    }
                  >
                    <option value="">Choose a section</option>
                    {outline.data.directSections.map((item) => (
                      <option key={item.native_id} value={item.native_id}>
                        {item.citation ?? item.heading ?? item.native_id}
                        {item.status_note ? ` · ${item.status_note}` : ""}
                      </option>
                    ))}
                  </select>
                  {outline.data.directTruncated ? (
                    <p className="text-xs text-muted-foreground">
                      Showing 5,000 of {outline.data.directTotal.toLocaleString()} sections at this
                      level.
                    </p>
                  ) : null}
                </>
              ) : null}
              <label className="block text-sm font-semibold" htmlFor="projected-level">
                {level}
              </label>
              <select
                id="projected-level"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value=""
                onChange={(event) => {
                  const group =
                    outline.data?.available && outline.data.kind === "groups"
                      ? outline.data.groups[Number(event.target.value)]
                      : undefined;
                  if (!group || !level) return;
                  onNavigate({
                    path: [...path, { level, number: group.number }],
                    section: undefined,
                  });
                }}
              >
                <option value="">Choose {level}</option>
                {outline.data.groups.map((group, index) => (
                  <option
                    key={`${group.number ?? ""}-${group.heading ?? ""}-${index}`}
                    value={String(index)}
                  >
                    {(group.number ?? "Not recorded") + (group.heading ? ` ${group.heading}` : "")}{" "}
                    · {group.count.toLocaleString()}
                  </option>
                ))}
              </select>
              {outline.data.truncated ? (
                <p className="text-xs text-muted-foreground">
                  Showing 2,000 of {outline.data.total.toLocaleString()} groups.
                </p>
              ) : null}
            </>
          ) : null}
          {outline.data?.available && outline.data.kind === "sections" ? (
            <>
              <label className="block text-sm font-semibold" htmlFor="projected-section">
                Section
              </label>
              <select
                id="projected-section"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={section ?? ""}
                onChange={(event) => onNavigate({ path, section: event.target.value || undefined })}
              >
                <option value="">Choose a section</option>
                {outline.data.sections.map((item) => (
                  <option key={item.native_id} value={item.native_id}>
                    {item.citation ?? item.heading ?? item.native_id}
                    {item.status_note ? ` · ${item.status_note}` : ""}
                  </option>
                ))}
              </select>
              {outline.data.truncated ? (
                <p className="text-xs text-muted-foreground">
                  Showing 5,000 of {outline.data.total.toLocaleString()} sections, in citation-path
                  order.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card">
          {!section ? (
            <p className="text-sm text-muted-foreground">
              Choose a section to read the published text.
            </p>
          ) : null}
          {detail.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading section…</p>
          ) : null}
          {detail.error ? <ExternalError error={detail.error} /> : null}
          {detail.data ? <SectionReadout fields={detail.data} /> : null}
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
