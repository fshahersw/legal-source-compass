import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { HubLinks, SectionHub } from "@/components/atlas/hub/SectionHub";
import { FederalLawCollections, LawLanding } from "@/components/corpus/LawLanding";
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
  head: () =>
    pageHead(
      "Law & government",
      "Federal and state law, legislation and Congress, rulemaking, time limits and agencies.",
    ),
  beforeLoad: ({ search }) => {
    if (search.view === "tx-code") {
      throw redirect({ to: "/law/codes/$state", params: { state: "TX" }, search: { q: "" } });
    }
  },
  component: LawPage,
});

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
    { label: "Home", to: "/" },
    { label: "Law & government", to: "/law" },
  ];
  const scopeLabel =
    s.scope === "federal"
      ? "Federal law"
      : s.scope === "states"
        ? "State law"
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
  const landing = (
    <SectionHub section="law">
      <LawLanding
        datasets={lawDs}
        metadataState={datasets.error ? "error" : datasets.isLoading ? "loading" : "ready"}
        onRetry={() => void datasets.refetch()}
      />
    </SectionHub>
  );
  if (!s.scope && !s.ds && !s.view) body = landing;
  else if (err) body = <ExternalError error={err} />;
  else if (s.scope !== "states" && datasets.isLoading)
    body = <p className="text-[13px] text-muted-foreground">Loading law collections…</p>;
  else if (s.scope === "states" && stateSources.isLoading)
    body = <p className="text-[13px] text-muted-foreground">Loading state law sources…</p>;
  else if (s.ds) body = <DatasetBrowser key={s.ds} dataset={s.ds} />;
  else if (!s.scope) {
    body = landing;
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
        <HubLinks
          title="Federal codes"
          links={[
            {
              to: "/law/uscode",
              label: "United States Code",
              description:
                "Official text from the Law Revision Counsel, title by title, with enacting and amending laws.",
              counts: [
                { dataset: "us_code_titles", label: "titles" },
                { dataset: "us_code_sections", label: "sections" },
              ],
            },
            {
              to: "/law/cfr",
              label: "Code of Federal Regulations",
              description:
                "Full current eCFR text of every section, with change history and the issuing agencies.",
              counts: [{ dataset: "ecfr_sections_full", label: "sections" }],
            },
            {
              to: "/law",
              search: { scope: "federal", ds: "public_laws_enacted" },
              label: "Public laws",
              description: "Public laws enacted, from the Statutes at Large and slip laws.",
              counts: [{ dataset: "public_laws_enacted", label: "public laws" }],
            },
          ]}
        />
        <FederalLawCollections datasets={lawDs} />
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
          {
            key: "calculators",
            label: "Litigation calculators",
            note: "Post-judgment interest (28 U.S.C. § 1961), inflation, present value, life expectancy, state rates",
            link: { to: "/law/calculators" },
          },
          {
            key: "constitutions",
            label: "State constitutions",
            note: "41 states from official publishers, article by article",
            link: { to: "/law/constitutions", search: { q: "" } },
          },
          {
            key: "uscode",
            label: "United States Code",
            note: "Official text from the Law Revision Counsel, with enacting and amending laws",
            link: { to: "/law/uscode", search: { q: "" } },
          },
          {
            key: "legislation",
            label: "Legislation",
            note: "Federal bills since 2003 and current state bills, with status, sponsors and official links",
            link: { to: "/law/legislation" },
          },
          {
            key: "caselaw",
            label: "Case law",
            note: "Supreme Court, federal appeals and state high courts: opinions, citator, search",
            link: { to: "/cases" },
          },
          {
            key: "cfr",
            label: "Code of Federal Regulations",
            note: "Full eCFR text of every section, with change history",
            link: { to: "/law/cfr" },
          },
          {
            key: "regulations",
            label: "State administrative codes",
            note: "Tables of contents, 12 states",
            link: { to: "/law/regulations", search: { q: "" } },
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
      <div className="space-y-4">
        <HubLinks
          title="State law across the states"
          links={[
            {
              to: "/law/codes",
              label: "State codes",
              description: "Read each state's statutes title by title, chapter by chapter.",
            },
            {
              to: "/law/constitutions",
              label: "State constitutions",
              description: "Article and section text from the official publishers.",
              counts: [{ dataset: "state_constitution_sections", label: "sections" }],
            },
            {
              to: "/law/regulations",
              label: "State administrative codes",
              description: "Titles, agencies and chapters as listed by each official publisher.",
              counts: [{ dataset: "state_regulation_index", label: "entries" }],
            },
            {
              to: "/data/court_rule_sections",
              label: "Court rules",
              description:
                "Court rules rule by rule from official sources; each court's own rules are on its court page.",
              counts: [{ dataset: "court_rule_sections", label: "rules" }],
            },
          ]}
        />
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
              link: {
                to: "/places/$state",
                params: { state: state.usps },
                search: { tab: "sources" },
              },
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
      : (scopeLabel ?? "Law & government");
  return (
    <AppShell
      breadcrumbs={crumbs}
      title={title}
      {...(s.ds || s.state || s.group
        ? {}
        : {
            description:
              s.scope === "federal"
                ? "The United States Code, the Code of Federal Regulations, public laws and the federal record sets."
                : s.scope === "states"
                  ? "State codes, constitutions, administrative codes and court rules, and each state's official law sources."
                  : "Federal and state law, legislation and Congress, rulemaking, time limits and agencies, from the official publishers.",
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
