import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { AgencyMark } from "@/components/corpus/EntityArtwork";
import { Stat } from "@/components/corpus/BarList";
import { DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import {
  AGENCY_TYPES,
  getAgencyCounts,
  listAgencies,
  listAgencyDocs,
  type AgencyCount,
} from "@/lib/external/agency.functions";
import { isDepartment, SAFETY_AGENCY } from "@/lib/external/agencyTree";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/agencies/$id")({
  remountDeps: ({ params }) => ({ id: params.id }),
  head: () =>
    pageHead(
      "Agency profile",
      "Federal Register documents, rules, proposed rules and notices filed by this agency, with safety records where the corpus has them.",
    ),
  component: AgencyPage,
});

const TABS = ["Overview", "Rules & notices", "All documents", "Safety & enforcement"] as const;

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

function AgencyProvenance({ id }: { id: string }) {
  const source = useDatasets();
  const dataset = source.data?.find((row) => row.id === "federal_register_history");
  return (
    <section className="mt-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">Source and coverage</h2>
      <dl className="mt-3 grid gap-3 text-[12px] sm:grid-cols-2">
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
      </dl>
      {source.error ? (
        <ReadFailure
          label="Source metadata"
          retry={() => void source.refetch()}
          busy={source.isFetching}
        />
      ) : (
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          {dataset?.qualification ??
            (source.isPending
              ? "Loading source coverage…"
              : "Source coverage qualification: Not recorded")}
        </p>
      )}
    </section>
  );
}

function AgencyPage() {
  const { id } = Route.useParams();
  const la = useServerFn(listAgencies),
    lc = useServerFn(getAgencyCounts),
    ld = useServerFn(listAgencyDocs);
  const all = useQuery({ queryKey: ["agencies"], queryFn: () => la(), staleTime: 5 * 60_000 });
  const a = all.data?.find((x) => x.id === id);
  const counts = useQuery({
    queryKey: ["agency-counts", id],
    queryFn: () => lc({ data: { id } }),
    staleTime: 5 * 60_000,
    enabled: !!a,
  });
  const [type, setType] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const docs = useQuery({
    queryKey: ["agency-docs", id, type],
    queryFn: () => ld({ data: { id, ...(type ? { type } : {}) } }),
    staleTime: 10 * 60_000,
    enabled: !!a && tab === "Rules & notices",
  });
  const name = a?.name ?? "Agency";
  const safety = a ? SAFETY_AGENCY[a.name] : undefined;
  const num = (v: AgencyCount | undefined) =>
    counts.error
      ? "Unavailable"
      : counts.isPending
        ? "Loading…"
        : v?.capped
          ? "Too large to count"
          : (v?.total ?? "Not recorded");

  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Law & Safety", to: "/law" },
        { label: "Agencies", to: "/agencies" },
        { label: name },
      ]}
      title={name}
      emblem={<AgencyMark name={name} />}
      description={
        a && isDepartment(a.name)
          ? "Department totals include documents its component agencies file: the publisher names the department and the component on the same document."
          : "Federal Register documents that name this agency."
      }
    >
      {all.error ? (
        <ReadFailure
          label="Agency directory"
          retry={() => void all.refetch()}
          busy={all.isFetching}
        />
      ) : null}
      {all.isPending ? (
        <p role="status" className="text-[13px]">
          Loading agency profile…
        </p>
      ) : null}
      {!a && !all.isPending && !all.error ? (
        <p className="text-[13px]">This agency is not in the Federal Register agency list.</p>
      ) : null}
      {a ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Federal Register documents"
              value={a.count ?? "Not recorded"}
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
          <div className="mt-5 flex flex-wrap gap-1 border-b border-border text-[13px]">
            {TABS.filter((t) => t !== "Safety & enforcement" || safety).map((t) => (
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
          <div className="mt-4">
            {tab === "Overview" ? (
              <div className="space-y-2 text-[13px]">
                <p>
                  Document types for this agency, counted from the saved Federal Register index.
                  Other types (corrections, presidential documents, uncategorized) make up the rest
                  of the total.
                </p>
                <p className="text-[12px] text-muted-foreground">
                  A per-year breakdown is not available: the index does not offer a year filter for
                  agency counts.
                </p>
                {safety ? (
                  <p>
                    <Link to="/safety" search={{ agency: safety }} className="underline">
                      Open {safety} safety records →
                    </Link>
                  </p>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    No safety dataset for this agency in the corpus.
                  </p>
                )}
                <AgencyProvenance id={a.id} />
              </div>
            ) : null}
            {tab === "Rules & notices" ? (
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
              </div>
            ) : null}
            {tab === "All documents" ? (
              <DatasetBrowser
                dataset="federal_register_history"
                initialFilters={{ agency: id }}
                compact
              />
            ) : null}
            {tab === "Safety & enforcement" && safety ? (
              <p className="text-[13px]">
                <Link to="/safety" search={{ agency: safety }} className="underline">
                  Open {safety} recalls, approvals and enforcement records →
                </Link>
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
