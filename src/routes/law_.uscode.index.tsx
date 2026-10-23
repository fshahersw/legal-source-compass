import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { Fact } from "@/components/uscode/UsCodeText";
import { LawAtlas } from "@/components/lawviz/LawAtlas";
import { pageHead } from "@/lib/corpus/head";
import {
  listUsCodeReleasePoints,
  listUsCodeTitles,
  parseCitationQuery,
  smartTitle,
  type ReleasePoint,
  type UscTitle,
} from "@/lib/external/usCode.functions";

export const Route = createFileRoute("/law_/uscode/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? search["q"].slice(0, 120) : "",
  }),
  head: () =>
    pageHead(
      "United States Code",
      "The official text of the United States Code from the Office of the Law Revision Counsel, title by title.",
    ),
  component: UsCodeIndex,
});

const fmt = (n: number) => n.toLocaleString("en-US");
const longDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : "Not recorded";

function titleNote(t: UscTitle): string {
  const gone = Object.entries(t.byStatus)
    .filter(([k]) => k !== "none")
    .reduce((a, [, n]) => a + n, 0);
  if (t.units === 0) return "No sections in this release point";
  return [
    t.positiveLaw ? "Positive law" : "Not positive law",
    gone ? `${fmt(gone)} repealed, omitted or moved` : null,
    t.changedInRelease ? "Changed in this release" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function UsCodeIndex() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/uscode/" });
  const [draft, setDraft] = useState(q);
  const listFn = useServerFn(listUsCodeTitles);
  const titles = useQuery({
    queryKey: ["us-code-titles"],
    queryFn: () => listFn(),
    staleTime: 10 * 60 * 1000,
  });
  const rows = titles.data ?? [];
  const release = rows.find((t) => t.release)?.release ?? null;
  const lawDate = rows.find((t) => t.lawDate)?.lawDate ?? null;
  const units = rows.reduce((a, t) => a + t.units, 0);
  const cited = q ? parseCitationQuery(q) : null;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "United States Code" },
      ]}
      title="United States Code"
      description="The general and permanent laws of the United States as the Office of the Law Revision Counsel of the House of Representatives publishes them, with each section's source credit, notes and the laws that enacted or amended it."
    >
      <form
        role="search"
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          const c = parseCitationQuery(text);
          if (c)
            void navigate({
              to: "/law/uscode/$title/$section",
              params: { title: c.title, section: c.key },
            });
          else void navigate({ search: { q: text } });
        }}
      >
        <label className="sr-only" htmlFor="usc-citation">
          Go to a citation
        </label>
        <input
          id="usc-citation"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Citation, e.g. 42 U.S.C. 1983"
          className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          Go
        </button>
      </form>
      {q && !cited ? (
        <p role="status" className="mb-4 text-[13px] text-muted-foreground">
          “{q}” is not a US Code citation. Type a title and section such as 42 U.S.C. 1983, or open
          a title below to search its text.
        </p>
      ) : null}
      {titles.error ? <ExternalError error={titles.error} /> : null}
      {titles.isLoading ? (
        <div
          className="h-24 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
          aria-label="Loading titles"
        />
      ) : null}
      {titles.data && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The United States Code has not been loaded into the corpus yet.
        </p>
      ) : null}
      {rows.length ? (
        <>
          <section
            aria-label="Edition"
            className="mb-4 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <dl className="m-0 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <Fact label="Release point">{release ?? "Not recorded"}</Fact>
              <Fact label="Current through">
                {release ? `Public Law ${release} (${longDate(lawDate)})` : "Not recorded"}
              </Fact>
              <Fact label="Titles">{fmt(rows.length)} (appendices counted separately)</Fact>
              <Fact label="Sections and other units">{fmt(units)}</Fact>
            </dl>
            <p className="m-0 mt-2 flex flex-wrap gap-x-4 text-[11px]">
              <a
                href="https://uscode.house.gov/download.html"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Office of the Law Revision Counsel downloads{" "}
                <ExternalLink className="size-3" aria-hidden />
              </a>
              <span className="text-muted-foreground">
                Titles marked positive law are themselves law; the others are evidence of the law as
                enacted in the Statutes at Large.
              </span>
            </p>
          </section>
          <FolderGrid
            title="Titles"
            hint={`${fmt(rows.length)} titles and appendices`}
            wrapNotes
            items={rows.map((t) => ({
              key: t.key,
              label: t.appendix
                ? `${t.number} App. ${smartTitle(t.name)}`
                : `${t.number}. ${smartTitle(t.name)}`,
              title: `${t.label}. ${smartTitle(t.name)}`,
              count: t.units,
              note: titleNote(t),
              link: {
                to: "/law/uscode/$title",
                params: { title: t.key },
                search: { q: undefined, c: undefined },
              },
            }))}
          />
          <div className="mt-6">
            <LawAtlas corpus="usc" />
          </div>
          <ReleasePoints />
        </>
      ) : null}
    </AppShell>
  );
}

function ReleasePoints() {
  const fn = useServerFn(listUsCodeReleasePoints);
  const points = useQuery({
    queryKey: ["us-code-release-points"],
    queryFn: () => fn(),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <section aria-label="Release points" className="mt-6">
      <h2 className="eyebrow">Release points</h2>
      <p className="m-0 mt-1 max-w-3xl text-[12px] text-muted-foreground">
        The Office of the Law Revision Counsel publishes a new release point each time it classifies
        new laws into the Code. Section changes are counted for the release points this site has
        downloaded; earlier versions of a section are in GovInfo's annual editions, linked from each
        section.
      </p>
      {points.error ? <ExternalError error={points.error} /> : null}
      {points.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading release points…</p>
      ) : null}
      {points.data && points.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No release points are recorded yet.</p>
      ) : null}
      {points.data?.length ? (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[40rem] text-left text-[12px]">
            <thead className="border-b border-border text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Release point
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Last law included
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Titles affected
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Section changes
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {points.data.map((p) => (
                <ReleaseRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ReleaseRow({ p }: { p: ReleasePoint }) {
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-3 py-1.5 font-mono">
        {p.url ? (
          <a href={p.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {p.id}
          </a>
        ) : (
          p.id
        )}
        {p.current ? (
          <span className="ml-2 font-sans text-[11px] text-muted-foreground">current</span>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">{p.lawDateText ?? "Not recorded"}</td>
      <td className="px-3 py-1.5">{p.titles.length ? p.titles.join(", ") : "Not stated"}</td>
      <td className="px-3 py-1.5 text-muted-foreground">
        {p.changes
          ? `${fmt(p.changes.changed)} changed, ${fmt(p.changes.added)} added, ${fmt(p.changes.repealed)} repealed or moved (vs ${p.changes.from})`
          : "Not computed"}
      </td>
    </tr>
  );
}
