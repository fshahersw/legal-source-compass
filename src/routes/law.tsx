import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { SectionPage } from "@/components/corpus/SectionPage";
import { FolderGrid, type FolderItem } from "@/components/corpus/FolderGrid";
import { DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import { LawLevel } from "@/components/corpus/LawOutline";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { STATES, stateByUsps } from "@/lib/corpus/geo";
import { loadStateLawDirectory, type StateLawDirectoryEntry } from "@/lib/corpus/lawSources";
import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { getLawOutlineStatus, listLawCollections } from "@/lib/external/corpus.functions";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { sectionOf } from "@/lib/external/groups";
import {
  kindLabel,
  LAW_GROUP_LABELS,
  lawGroup,
  STATE_DATASETS,
  type LawGroup,
} from "@/lib/external/lawTree";

type S = {
  ds?: string | undefined;
  view?: string | undefined;
  scope?: string | undefined;
  state?: string | undefined;
  kind?: string | undefined;
  group?: string | undefined;
};
const str = (v: unknown) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : undefined;

export const Route = createFileRoute("/law")({
  validateSearch: (s: Record<string, unknown>): S => ({
    ds: str(s["ds"]),
    view: str(s["view"]),
    scope: str(s["scope"]),
    state: str(s["state"]),
    kind: str(s["kind"]),
    group: str(s["group"]),
  }),
  head: () =>
    pageHead(
      "Law & regulation",
      "Browse law top-down: federal or a state, then type of law, then collection and provision.",
    ),
  component: LawPage,
});

const FED_GROUPS: LawGroup[] = ["statutes", "regulations", "register", "notices", "other"];
const stName = (c: string) => (c === "FEDERAL" ? "Federal" : (stateByUsps.get(c)?.name ?? c));

/** Shown wherever the categorized outline would be: it is held until it passes publication checks. */
function OutlineHeld({ reason }: { reason: string | null }) {
  return (
    <p
      role="note"
      className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground"
    >
      <span className="mr-1 font-semibold text-foreground">Categorized outline not published.</span>
      {reason ?? "The categorized law catalog and outline have not passed publication checks."} Law
      record sets are listed by dataset below; none of the held outline is shown.
    </p>
  );
}

const NO_COLLECTIONS: Awaited<ReturnType<typeof listLawCollections>> = [];

function LawPage() {
  const s = Route.useSearch();
  const collFn = useServerFn(listLawCollections);
  const statusFn = useServerFn(getLawOutlineStatus);
  const colls = useQuery({
    queryKey: ["law-collections"],
    queryFn: () => collFn(),
    staleTime: 60_000,
  });
  const status = useQuery({
    queryKey: ["law-outline-status"],
    queryFn: () => statusFn(),
    staleTime: 60_000,
  });
  const datasets = useDatasets();
  const stateSources = useQuery({
    queryKey: ["state-law-directory"],
    queryFn: loadStateLawDirectory,
    staleTime: 60_000,
    enabled: s.scope === "states",
  });
  if (s.view === "list" || s.ds === "outline")
    return <SectionPage section="law" path="/law" ds={s.ds === "outline" ? undefined : s.ds} />;

  const lawDs = (datasets.data ?? []).filter((d) => sectionOf(d.id) === "law");
  const coll = colls.data ?? NO_COLLECTIONS;
  const outlineOn = status.data?.available === true;
  const dsFolder = (
    d: { id: string; label: string; records: number | null; ready: boolean | null },
    extra: Partial<S>,
  ): FolderItem => ({
    key: d.id,
    label: datasetDisplayName(d.id, d.label),
    count: d.records ?? undefined,
    note: d.ready === false ? "Imported · not cleared for publication" : "Imported records",
    link: { to: "/law", search: { ...extra, ds: d.id } },
  });

  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [
    { label: "Atlas", to: "/" },
    { label: "Law & regulation", to: "/law" },
  ];
  const scopeLabel =
    s.scope === "federal"
      ? "Federal"
      : s.scope === "states"
        ? "States"
        : s.scope === "reference"
          ? "Reference tools"
          : s.scope === "mixed"
            ? "Mixed federal & state law"
            : undefined;
  if (scopeLabel) crumbs.push({ label: scopeLabel, to: "/law", search: { scope: s.scope! } });
  if (s.state)
    crumbs.push({
      label: stName(s.state),
      to: "/law",
      search: { scope: "states", state: s.state },
    });
  if (s.group)
    crumbs.push({
      label: LAW_GROUP_LABELS[s.group as LawGroup] ?? s.group,
      to: "/law",
      search: { scope: s.scope ?? "federal", group: s.group },
    });
  if (s.kind) crumbs.push({ label: kindLabel(s.kind) });
  if (s.ds)
    crumbs.push({ label: datasetDisplayName(s.ds, lawDs.find((d) => d.id === s.ds)?.label) });
  const last = crumbs[crumbs.length - 1]!;
  if (crumbs.length > 2) {
    delete last.to;
    delete last.search;
  }

  let body: React.ReactNode;
  const savedLawError = colls.error ?? status.error ?? datasets.error;
  const err = s.scope === "states" ? stateSources.error : savedLawError;
  if (err) body = <ExternalError error={err} />;
  else if (s.scope !== "states" && (colls.isLoading || status.isLoading || datasets.isLoading))
    body = <p className="text-[13px] text-muted-foreground">Loading law collections…</p>;
  else if (s.scope === "states" && stateSources.isLoading)
    body = <p className="text-[13px] text-muted-foreground">Loading state law sources…</p>;
  else if (s.ds) body = <DatasetBrowser key={s.ds} dataset={s.ds} />;
  else if (s.kind) {
    const code = s.scope === "federal" ? "FEDERAL" : (s.state ?? "");
    const c = coll.find((x) => x.state === code && x.kind === s.kind);
    body = outlineOn ? (
      <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
        <h2 className="eyebrow mb-2">
          {stName(code)} · {kindLabel(s.kind)}
          {c ? ` · ${c.provisions.toLocaleString()} provisions` : ""}
        </h2>
        <LawLevel key={`${code}-${s.kind}`} state={code} kind={s.kind} parent={0} />
      </div>
    ) : (
      <OutlineHeld reason={status.data?.reason ?? null} />
    );
  } else if (!s.scope) {
    const fedProv = coll.filter((c) => c.state === "FEDERAL").reduce((a, c) => a + c.provisions, 0);
    body = (
      <div className="space-y-4">
        {outlineOn ? null : <OutlineHeld reason={status.data?.reason ?? null} />}
        <FolderGrid
          title="Jurisdiction"
          items={[
            {
              key: "federal",
              label: "Federal",
              note: outlineOn
                ? "Outline provisions · record sets listed separately"
                : "Record sets · outline held",
              count: outlineOn ? fedProv : undefined,
              link: { to: "/law", search: { scope: "federal" } },
            },
            {
              key: "states",
              label: "States",
              note: "Official sources for all 50 states and DC",
              link: { to: "/law", search: { scope: "states" } },
            },
            {
              key: "reference",
              label: "Reference tools",
              note: "Limitations calculator and citations",
              link: { to: "/law", search: { scope: "reference" } },
            },
            {
              key: "mixed",
              label: "Mixed federal & state law",
              note: "Multiple jurisdictions and legal types",
              link: { to: "/law", search: { scope: "mixed" } },
            },
            {
              key: "list",
              label: "All law datasets (list)",
              note: "Every law record set in one list",
              link: { to: "/law", search: { view: "list" } },
            },
          ]}
        />
      </div>
    );
  } else if (s.scope === "mixed") {
    body = (
      <FolderGrid
        title="Mixed federal & state law"
        items={lawDs
          .filter((d) => lawGroup(d.id) === "mixed")
          .map((d) => dsFolder(d, { scope: "mixed" }))}
      />
    );
  } else if (s.scope === "federal" && s.group) {
    body = (
      <FolderGrid
        title={LAW_GROUP_LABELS[s.group as LawGroup] ?? s.group}
        items={lawDs
          .filter((d) => lawGroup(d.id) === s.group)
          .map((d) => dsFolder(d, { scope: "federal", group: s.group }))}
      />
    );
  } else if (s.scope === "federal") {
    body = (
      <div className="space-y-5">
        {outlineOn ? (
          <FolderGrid
            title="Type of law"
            hint="law outlines by collection"
            items={coll
              .filter((c) => c.state === "FEDERAL")
              .sort((a, b) => b.provisions - a.provisions)
              .map((c) => ({
                key: c.kind,
                label: kindLabel(c.kind),
                count: c.provisions,
                link: { to: "/law", search: { scope: "federal", kind: c.kind } },
              }))}
          />
        ) : (
          <OutlineHeld reason={status.data?.reason ?? null} />
        )}
        <FolderGrid
          title="Federal record sets"
          items={FED_GROUPS.map((g) => ({
            key: g,
            label: LAW_GROUP_LABELS[g],
            count: lawDs
              .filter((d) => lawGroup(d.id) === g)
              .reduce((a, d) => a + (d.records ?? 0), 0),
            link: { to: "/law", search: { scope: "federal", group: g } },
          }))}
        />
      </div>
    );
  } else if (s.scope === "reference") {
    body = (
      <FolderGrid
        title="Reference tools"
        items={[
          {
            key: "limitations",
            label: "Statute of limitations",
            note: "Calculator, cited rules and state coverage",
            link: { to: "/limitations" },
          },
          ...lawDs
            .filter(
              (d) =>
                lawGroup(d.id) === "reference" &&
                !["limitation_periods", "statutory_limitations_review"].includes(d.id),
            )
            .map((d) => dsFolder(d, { scope: "reference" })),
        ]}
      />
    );
  } else if (!s.state) {
    const directory = stateSources.data ?? [];
    body = (
      <div className="space-y-3">
        <p className="text-[13px] text-muted-foreground">
          Choose a state to open its official code and available saved statutes.
        </p>
        <FolderGrid
          title="States and DC"
          items={[...STATES]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((state) => {
              const entry = directory.find((item) => item.code === state.usps);
              return {
                key: state.usps,
                label: state.name,
                note: entry?.codeLink?.label ?? "Official source directory",
                link: { to: "/law", search: { scope: "states", state: state.usps } },
              };
            })}
        />
      </div>
    );
  } else {
    const own = lawDs.filter((d) => STATE_DATASETS[d.id] === s.state);
    const stateResource = stateSources.data?.find((item) => item.code === s.state);
    body = (
      <div className="space-y-5">
        {stateResource ? <StateLawSources entry={stateResource} /> : null}
        {savedLawError ? (
          <ExternalError error={savedLawError} />
        ) : colls.isLoading || status.isLoading || datasets.isLoading ? (
          <p className="text-[12px] text-muted-foreground">Loading saved law records…</p>
        ) : null}
        {outlineOn ? (
          <FolderGrid
            title="Type of law"
            items={coll
              .filter((c) => c.state === s.state)
              .sort((a, b) => b.provisions - a.provisions)
              .map((c) => ({
                key: c.kind,
                label: kindLabel(c.kind),
                count: c.provisions,
                link: { to: "/law", search: { scope: "states", state: s.state, kind: c.kind } },
              }))}
          />
        ) : coll.some((item) => item.state === s.state) ? (
          <OutlineHeld reason={status.data?.reason ?? null} />
        ) : null}
        {own.length ? (
          <FolderGrid
            title="State code datasets"
            items={own.map((d) => dsFolder(d, { scope: "states", state: s.state }))}
          />
        ) : null}
      </div>
    );
  }

  const title = s.kind
    ? kindLabel(s.kind)
    : s.ds
      ? datasetDisplayName(s.ds, lawDs.find((d) => d.id === s.ds)?.label)
      : s.state
        ? `${stName(s.state)} law`
        : (scopeLabel ?? "Law & regulation");
  return (
    <AppShell
      breadcrumbs={crumbs}
      title={title}
      {...(s.scope === "states"
        ? {}
        : {
            description:
              "Open a folder to narrow down: jurisdiction, type of law, collection, and provision.",
          })}
    >
      {body}
    </AppShell>
  );
}

function StateLawSources({ entry }: { entry: StateLawDirectoryEntry }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold">Official law source</h2>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        {entry.codeLink ? (
          <a
            href={entry.codeLink.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline"
          >
            {entry.codeLink.label}
          </a>
        ) : (
          <a
            href={entry.directoryUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline"
          >
            State law resources
          </a>
        )}
        {entry.codeLink && entry.codeLink.url !== entry.directoryUrl ? (
          <a
            href={entry.directoryUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground underline"
            title={`DOJ directory retrieved ${entry.directoryRetrievedAt.slice(0, 10)}; linked pages may have changed.`}
          >
            DOJ state directory
          </a>
        ) : null}
      </div>
      {entry.capturedSources.length ? (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-[12px] font-medium">
            Saved statutes ({entry.capturedSources.length})
          </summary>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Selected statutes; full state code not stored.
          </p>
          <ul className="mt-2 space-y-2 text-[12px]">
            {entry.capturedSources.map((source) => (
              <li key={source.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  {source.title}
                </a>
                <PrivateDataLink
                  href={source.textPath}
                  download
                  className="text-muted-foreground underline"
                >
                  View captured text
                </PrivateDataLink>
                <span className="text-muted-foreground">
                  Captured {source.capturedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
