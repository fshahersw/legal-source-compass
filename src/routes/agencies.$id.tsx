import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { Stat } from "@/components/corpus/BarList";
import { DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import { LoadingBlock } from "@/components/enforcement/parts";
import { AgencyProfileView } from "@/components/agencies/AgencyProfileView";
import { AgencyMassTortPanel } from "@/components/agencies/AgencyMassTortPanel";
import {
  AGENCY_TYPES,
  getAgencyCounts,
  listAgencies,
  listAgencyDocs,
  type AgencyCount,
} from "@/lib/external/agency.functions";
import { getAgencyProfile } from "@/lib/external/agencyProfile.functions";
import { isDepartment, SAFETY_AGENCY } from "@/lib/external/agencyTree";
import { pageHead } from "@/lib/corpus/head";
import { AgencyOversightPanel } from "@/components/enforcement/oversight/AgencyOversightPanel";
import { AgencyBuildingPhoto } from "@/components/visuals/AgencyBuildingPhoto";
import { AgencyEmblem, AgencyMarkCaption } from "@/components/visuals/AgencyEmblem";

export const Route = createFileRoute("/agencies/$id")({
  remountDeps: ({ params }) => ({ id: params.id }),
  head: () =>
    pageHead(
      "Agency profile",
      "Rulemaking by year and administration, significant rules, open comment periods, the Unified Agenda pipeline, budget and state spending, CFR footprint and structure for one federal agency.",
    ),
  component: AgencyPage,
});

const TABS = ["Overview", "Documents", "Unified Agenda"] as const;

const SOURCES: { label: string; url: string; note: string }[] = [
  {
    label: "Federal Register API",
    url: "https://www.federalregister.gov/developers/documentation/api/v1",
    note: "Agency directory and structure, document counts, significant rules, comment periods",
  },
  {
    label: "Unified Agenda (reginfo.gov)",
    url: "https://www.reginfo.gov/public/do/eAgendaXmlReport",
    note: "Regulatory pipeline by stage and priority",
  },
  {
    label: "eCFR",
    url: "https://www.ecfr.gov/api/admin/v1/agencies.json",
    note: "CFR chapters assigned to each agency",
  },
  {
    label: "USAspending API",
    url: "https://api.usaspending.gov/docs/endpoints",
    note: "Budgetary resources, obligations, outlays, state award obligations",
  },
  {
    label: "Census Bureau population estimates (Vintage 2025)",
    url: "https://www.census.gov/data/tables/time-series/demo/popest/2020s-state-total.html",
    note: "Per-resident denominator",
  },
  {
    label: "U.S. Government Manual, 2025 edition (GovInfo)",
    url: "https://www.govinfo.gov/app/details/GOVMAN-2025-12-31",
    note: "Mission, units and legal authority as printed",
  },
];

function ReadFailure({ label, retry, busy }: { label: string; retry: () => void; busy: boolean }) {
  return (
    <div
      role="alert"
      className="my-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[13px]"
    >
      <p>{label} could not be loaded. Try again to load the recorded values.</p>
      <button
        type="button"
        className="mt-2 underline disabled:opacity-50"
        onClick={retry}
        disabled={busy}
      >
        {busy ? "Retrying…" : `Retry ${label.toLowerCase()}`}
      </button>
    </div>
  );
}

function AgencyProvenance({ id, asOf }: { id: string; asOf: string | null }) {
  const source = useDatasets();
  const dataset = source.data?.find((row) => row.id === "federal_register_history");
  return (
    <section className="mt-4 rounded-md border border-border bg-surface p-3">
      <h2 className="text-heading font-semibold text-foreground">Source and coverage</h2>
      <dl className="mt-2 grid gap-3 text-[12px] sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Federal Register agency ID</dt>
          <dd className="mt-1 font-mono">{id}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Source collection</dt>
          <dd className="mt-1">
            {source.error
              ? "Unavailable"
              : source.isPending
                ? "Loading…"
                : (dataset?.label ?? "Not recorded")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Agency analytics as of</dt>
          <dd className="mt-1 font-mono">{asOf ?? "Not recorded"}</dd>
        </div>
      </dl>
      {source.error ? (
        <ReadFailure
          label="Source metadata"
          retry={() => void source.refetch()}
          busy={source.isFetching}
        />
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          {dataset?.qualification ??
            (source.isPending
              ? "Loading source coverage…"
              : "Source coverage qualification: Not recorded")}
        </p>
      )}
      <ul className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2">
        {SOURCES.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              {s.label}
            </a>
            <span className="text-muted-foreground"> · {s.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AgencyPage() {
  const { id } = Route.useParams();
  const la = useServerFn(listAgencies),
    lc = useServerFn(getAgencyCounts),
    ld = useServerFn(listAgencyDocs),
    lp = useServerFn(getAgencyProfile);
  const all = useQuery({ queryKey: ["agencies"], queryFn: () => la(), staleTime: 5 * 60_000 });
  const prof = useQuery({
    queryKey: ["agency-profile", id],
    queryFn: () => lp({ data: { id } }),
    staleTime: 10 * 60_000,
  });
  const listed = all.data?.find((x) => x.id === id);
  const profile = prof.data?.profile ?? null;
  const known = !!listed || !!profile;
  const [type, setType] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [browseAll, setBrowseAll] = useState(false);
  // Corpus index counts are the fallback when the agency profile dataset has no record for this agency.
  const counts = useQuery({
    queryKey: ["agency-counts", id],
    queryFn: () => lc({ data: { id } }),
    staleTime: 5 * 60_000,
    enabled: !!listed && !profile && !prof.isPending,
  });
  const docs = useQuery({
    queryKey: ["agency-docs", id, type],
    queryFn: () => ld({ data: { id, ...(type ? { type } : {}) } }),
    staleTime: 10 * 60_000,
    enabled: known && tab === "Documents",
  });
  const name = profile?.name ?? listed?.name ?? "Agency";
  const safety = SAFETY_AGENCY[name];
  const num = (v: AgencyCount | undefined) =>
    counts.error
      ? "Unavailable"
      : counts.isPending
        ? "Loading…"
        : v?.capped
          ? "Too large to count"
          : (v?.total ?? "Not recorded");
  const loading = prof.isPending || (all.isPending && !profile);
  const absent = !known && !loading && !all.error && !prof.error;

  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Agencies", to: "/agencies" },
        { label: name },
      ]}
      title={name}
      emblem={<AgencyEmblem agencyId={id} name={name} ready={known && !loading} />}
      description={
        known && isDepartment(name)
          ? "Department totals include documents its component agencies file: the publisher names the department and the component on the same document."
          : "Federal Register documents, regulatory pipeline, spending and structure for this agency."
      }
    >
      {all.error && !profile ? (
        <ReadFailure
          label="Agency directory"
          retry={() => void all.refetch()}
          busy={all.isFetching}
        />
      ) : null}
      {prof.error ? (
        <ReadFailure
          label="Agency analytics"
          retry={() => void prof.refetch()}
          busy={prof.isFetching}
        />
      ) : null}
      {loading ? (
        <>
          <p role="status" className="mb-2 text-[13px]">
            Loading agency profile…
          </p>
          <LoadingBlock label="Loading agency profile" />
        </>
      ) : null}
      {absent ? (
        <p className="text-[13px]">This agency is not in the Federal Register agency list.</p>
      ) : null}
      {known && !loading ? (
        <>
          <AgencyMarkCaption agencyId={id} className="mb-2" />
          <AgencyBuildingPhoto agencyId={id} name={name} />
          <div className="flex flex-wrap gap-1 border-b border-border text-[13px]">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-1.5 ${tab === t ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {tab === "Overview" ? (
              <div className="space-y-2 text-[13px]">
                <AgencyMassTortPanel frId={id} />
                {profile && prof.data ? (
                  <AgencyProfileView
                    data={prof.data}
                    after={<AgencyOversightPanel agencyId={id} />}
                  />
                ) : (
                  <>
                    <p className="rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-muted-foreground">
                      Agency analytics are not recorded for this agency; counts below come from the
                      saved Federal Register index.
                    </p>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Stat
                        label="Federal Register documents"
                        value={listed?.count ?? "Not recorded"}
                        note="In the Federal Register history"
                      />
                      <Stat
                        label="Rules"
                        value={num(counts.data?.["Rule"])}
                        note="Documents typed as a rule"
                      />
                      <Stat label="Proposed rules" value={num(counts.data?.["Proposed Rule"])} />
                      <Stat label="Notices" value={num(counts.data?.["Notice"])} />
                    </div>
                    {counts.error ? (
                      <ReadFailure
                        label="Document counts"
                        retry={() => void counts.refetch()}
                        busy={counts.isFetching}
                      />
                    ) : null}
                    {safety ? (
                      <p>
                        <Link to="/safety" search={{ agency: safety }} className="underline">
                          Open {safety} safety records →
                        </Link>
                      </p>
                    ) : null}
                    <AgencyOversightPanel agencyId={id} />
                  </>
                )}
                <AgencyProvenance id={id} asOf={prof.data?.trends?.asOf ?? null} />
              </div>
            ) : null}
            {tab === "Documents" ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[12px]">
                  Type
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-[12px]"
                  >
                    <option value="">All types</option>
                    {AGENCY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[11px] text-muted-foreground">
                  The 12 most recent documents in the saved index.
                </p>
                {docs.error ? (
                  <ReadFailure
                    label="Agency documents"
                    retry={() => void docs.refetch()}
                    busy={docs.isFetching}
                  />
                ) : null}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5">Document</th>
                        <th className="px-2 py-1.5">Type</th>
                        <th className="px-2 py-1.5">Published</th>
                        <th className="px-2 py-1.5">Citation</th>
                        <th className="px-2 py-1.5">CFR parts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docs.error ? (
                        <tr>
                          <td className="px-2 py-2 text-muted-foreground" colSpan={5}>
                            Documents unavailable.
                          </td>
                        </tr>
                      ) : docs.isPending ? (
                        <tr>
                          <td className="px-2 py-2 text-muted-foreground" colSpan={5}>
                            Loading…
                          </td>
                        </tr>
                      ) : !docs.data?.length ? (
                        <tr>
                          <td className="px-2 py-2 text-muted-foreground" colSpan={5}>
                            No matching documents in the saved index.
                          </td>
                        </tr>
                      ) : (
                        (docs.data ?? []).map((d) => (
                          <tr key={d.id} className="border-t border-border align-top">
                            <td className="max-w-md px-2 py-1.5">
                              {d.url ? (
                                <a
                                  href={d.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  {d.title}
                                </a>
                              ) : (
                                d.title
                              )}
                            </td>
                            <td className="px-2 py-1.5">{d.type || "Not recorded"}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                              {d.published || "Not recorded"}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                              {d.citation || "Not recorded"}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-[11px]">
                              {d.cfr || "Not recorded"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="pt-4">
                  {browseAll ? (
                    <DatasetBrowser
                      dataset="federal_register_history"
                      initialFilters={{ agency: id }}
                      compact
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBrowseAll(true)}
                      className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
                    >
                      Browse every Federal Register document from this agency
                      {listed?.count != null ? ` (${listed.count.toLocaleString("en-US")})` : ""}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
            {tab === "Unified Agenda" ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Every action this agency (or, for a department, its components) reported in the
                  latest Unified Agenda. Filter by stage or priority; each row links to its
                  reginfo.gov entry.
                </p>
                <DatasetBrowser
                  dataset="unified_agenda_pipeline"
                  initialFilters={{ agency: id }}
                  compact
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
