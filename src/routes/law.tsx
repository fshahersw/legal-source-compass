import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { SectionPage } from "@/components/corpus/SectionPage";
import { FolderGrid, type FolderItem } from "@/components/corpus/FolderGrid";
import { DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { STATES, stateByUsps } from "@/lib/corpus/geo";
import { loadStateLawDirectory, type StateLawDirectoryEntry } from "@/lib/corpus/lawSources";
import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { FullCodeEntry } from "@/components/corpus/FullCodeEntry";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { sectionOf } from "@/lib/external/groups";
import { LAW_GROUP_LABELS, lawGroup, STATE_DATASETS, type LawGroup } from "@/lib/external/lawTree";

type S = {
  ds?: string | undefined;
  view?: string | undefined;
  scope?: string | undefined;
  state?: string | undefined;
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
    group: str(s["group"]),
  }),
  head: () => pageHead("Law & regulation", "Browse law by jurisdiction."),
  beforeLoad: ({ search }) => {
    if (search.view === "tx-code") {
      throw redirect({ to: "/law/codes/$state", params: { state: "TX" }, search: { q: "" } });
    }
  },
  component: LawPage,
});

const FED_GROUPS: LawGroup[] = ["statutes", "regulations", "register", "notices", "other"];
const stName = (c: string) => (c === "FEDERAL" ? "Federal" : (stateByUsps.get(c)?.name ?? c));

function LawPage() {
  const s = Route.useSearch();
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
  const dsFolder = (
    d: { id: string; label: string; records: number | null; ready: boolean | null },
    extra: Partial<S>,
  ): FolderItem => ({
    key: d.id,
    label: datasetDisplayName(d.id, d.label),
    count: d.records ?? undefined,
    note:
      d.ready === false
        ? "Not currently available"
        : d.ready === true
          ? "Available records"
          : "Availability not recorded",
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
  if (s.ds)
    crumbs.push({ label: datasetDisplayName(s.ds, lawDs.find((d) => d.id === s.ds)?.label) });
  const last = crumbs[crumbs.length - 1]!;
  if (crumbs.length > 2) {
    delete last.to;
    delete last.search;
  }

  let body: React.ReactNode;
  const savedLawError = datasets.error;
  const err = s.scope === "states" ? stateSources.error : savedLawError;
  if (err) body = <ExternalError error={err} />;
  else if (s.scope !== "states" && datasets.isLoading)
    body = <p className="text-[13px] text-muted-foreground">Loading law collections…</p>;
  else if (s.scope === "states" && stateSources.isLoading)
    body = <p className="text-[13px] text-muted-foreground">Loading state law sources…</p>;
  else if (s.ds) body = <DatasetBrowser key={s.ds} dataset={s.ds} />;
  else if (!s.scope) {
    body = (
      <div className="space-y-4">
        <FolderGrid
          title="Jurisdiction"
          items={[
            {
              key: "federal",
              label: "Federal",
              note: "Browse available collections",
              link: { to: "/law", search: { scope: "federal" } },
            },
            {
              key: "states",
              label: "States",
              note: "Official state sources, by state",
              link: { to: "/law", search: { scope: "states" } },
            },
            {
              key: "reference",
              label: "Reference tools",
              note: "Limitations calculator and citations",
              link: { to: "/law", search: { scope: "reference" } },
            },
            {
              key: "codes",
              label: "State codes",
              note: "Full codes that have been captured",
              link: { to: "/law/codes" },
            },
            {
              key: "list",
              label: "All law datasets (list)",
              note: "Law record sets in one list",
              link: { to: "/law", search: { view: "list" } },
            },
          ]}
        />
      </div>
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
    body = (
      <div className="space-y-3">
        <p className="text-[13px] text-muted-foreground">
          Choose a state to browse its official sources and saved statutes.
        </p>
        <FolderGrid
          title="States and DC"
          items={[...STATES]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((state) => ({
              key: state.usps,
              label: state.name,
              link: { to: "/law", search: { scope: "states", state: state.usps } },
            }))}
        />
      </div>
    );
  } else {
    const codeIndex = lawDs.find((d) => d.id === "state_codes");
    const hasCodeIndex = !!codeIndex?.filters.some(
      (f) =>
        f.name === "state" && f.options?.some((o) => o.value === s.state && (o.count ?? 0) > 0),
    );
    const own = lawDs.filter(
      (d) => STATE_DATASETS[d.id] === s.state || (hasCodeIndex && d.id === "state_codes"),
    );
    const stateResource = stateSources.data?.find((item) => item.code === s.state);
    body = (
      <div className="space-y-5">
        {stateResource ? <StateLawSources entry={stateResource} /> : null}
        <FullCodeEntry state={s.state} />
        {savedLawError ? (
          <ExternalError error={savedLawError} />
        ) : datasets.isLoading ? (
          <p className="text-[12px] text-muted-foreground">Loading saved law records…</p>
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

  const title = s.ds
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
            description: "Browse law by jurisdiction.",
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
          <p className="mt-2 text-[11px] text-muted-foreground">Selected statute extracts.</p>
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
