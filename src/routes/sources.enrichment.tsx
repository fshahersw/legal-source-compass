import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/atlas/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getEnrichmentSnapshot } from "@/lib/external/enrichment.functions";
import { pageHead } from "@/lib/corpus/head";
import { downloadText } from "@/lib/atlas/exports";
import { CATEGORY_LABELS, TAXONOMY_VERSION } from "@/lib/corpus/taxonomy";
import { RelationshipCoverage } from "@/components/corpus/RelationshipCoverage";

export const Route = createFileRoute("/sources/enrichment")({
  head: () =>
    pageHead(
      "Corpus enrichment",
      "Metadata collection coverage, source versions, native mappings, category review, and cited limitations research.",
    ),
  component: EnrichmentPage,
});

const number = (value: number | null | undefined) =>
  value == null ? "Not recorded" : value.toLocaleString("en-US");
const jurisdiction = (value: number | string[] | null | undefined) =>
  Array.isArray(value) ? value.join(", ") || "Not recorded" : number(value);
const STATUS_LABELS = {
  partial: "Partial coverage",
  running: "Collection in progress",
  verified: "Verified checkpoint",
  "complete-snapshot": "Snapshot collected",
  "research-review": "Research review",
} as const;

function EnrichmentPage() {
  const fn = useServerFn(getEnrichmentSnapshot);
  const query = useQuery({
    queryKey: ["enrichment-checkpoint", "enrichment_20261002"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  const data = query.data;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Sources", to: "/sources/library" },
        { label: "Enrichment" },
      ]}
      title="Corpus enrichment"
      description="Collection coverage, source versions and review evidence. Counts refer to their stated record grains and snapshots; collection progress does not establish legal completeness."
    >
      <div className="mb-5 flex flex-wrap gap-3 text-[13px]">
        <Link to="/limitations" className="font-medium text-primary underline">
          Cited limitations calculator
        </Link>
        <Link to="/insights" className="text-primary underline">
          Research workbench
        </Link>
        <Link
          to="/data/$dataset"
          params={{ dataset: "ecfr_hierarchy" }}
          className="text-primary underline"
        >
          National regulatory hierarchy
        </Link>
        <Link
          to="/data/$dataset"
          params={{ dataset: "ecfr_authority_notes" }}
          className="text-primary underline"
        >
          Regulatory authority and version notes
        </Link>
        <Link
          to="/data/$dataset"
          params={{ dataset: "cl_master_entries" }}
          className="text-primary underline"
        >
          Master docket entries
        </Link>
        <Link to="/sources/analysis" className="text-primary underline">
          Master docket timelines
        </Link>
        <Link
          to="/data/$dataset"
          params={{ dataset: "mass_tort_authority_evidence" }}
          className="text-primary underline"
        >
          Mass-tort authority and treatment evidence
        </Link>
        <PrivateDataLink href="/data/quality/taxonomy-review-2026-10-02.json" className="text-primary underline">
          Download identity and taxonomy review
        </PrivateDataLink>
      </div>
      {query.isLoading ? (
        <p role="status" className="text-[13px]">
          Loading the published metadata checkpoint…
        </p>
      ) : null}
      {query.error ? (
        <p role="alert" className="text-[13px] text-destructive">
          The published checkpoint could not be loaded: {query.error.message}
        </p>
      ) : null}
      {data ? (
        <>
          <section className="mb-5 rounded-lg border border-primary/25 bg-primary/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Badge variant="outline">{STATUS_LABELS[data.status]}</Badge>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Updated {data.updatedAt || "Not recorded"} · {data.schemaVersion} · Metadata only
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadText(
                    "corpus-enrichment-checkpoint.json",
                    "application/json",
                    JSON.stringify(data, null, 2),
                  )
                }
              >
                Download checkpoint
              </Button>
            </div>
          </section>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {[
              [
                "HTTP-source observations",
                data.counts?.httpSourceObservations ??
                  data.counts?.observations ??
                  data.counts?.sourceRecords,
              ],
              ["Local-file occurrences", data.counts?.localFileOccurrences],
              ["Source-qualified identities", data.counts?.canonicalEntities],
              ["Source payload versions", data.counts?.sourceVersions],
              ["Source-qualified relationship edges", data.counts?.nativeRelationships],
              ["Source-recorded edges", data.counts?.sourceRecordedRelationships],
              ["Local producer / extraction pointers", data.counts?.localPointerRelationships],
              ["PDFs downloaded", data.counts?.pdfDownloads],
            ].map(([label, count]) => (
              <div key={String(label)} className="rounded-lg border border-border bg-surface p-3">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="mt-1 text-lg font-semibold">
                  {number(count as number | null | undefined)}
                </div>
              </div>
            ))}
          </div>
          <p className="mb-6 text-[12px] text-muted-foreground">
            HTTP observations and local-file occurrences are separate evidence rows. Identities,
            payload versions and relationship edges include their recorded source namespaces;
            repeated versions can repeat a relationship. These counts do not measure unique cases or
            verified legal outcomes. Local pointers retain producer and extraction qualifications.
          </p>
          {data.relationshipCoverage?.length ? (
            <RelationshipCoverage rows={data.relationshipCoverage} />
          ) : null}
          {data.coverage?.some((c) => c.id === "ecfr_authority_notes") ? (
            <section className="mb-6 rounded-lg border border-border bg-surface p-4">
              <h2 className="text-[16px] font-semibold">Version-sensitive regulatory research</h2>
              <p className="mt-2 text-[13px] leading-relaxed">
                FDA identifies February 2, 2026 as the effective date of the QMSR amendments to 21
                CFR Part 820. The retained February 1 and September 30 snapshots let you inspect the
                different headings, authorities and source notes. The snapshot date alone does not
                establish which version governs a device, event or claim.
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
                <PrivateDataLink
                  href="/data/quality/ecfr-acquisition-2026-10-02.json"
                  className="text-primary underline"
                >
                  Regulatory source hashes and coverage
                </PrivateDataLink>
                <Link
                  to="/records/$dataset/$id"
                  params={{
                    dataset: "ecfr_authority_notes",
                    id: "ecfr:notes:title-21/part-820/as-of-2026-02-01",
                  }}
                  className="text-primary underline"
                >
                  Part 820 before QMSR
                </Link>
                <Link
                  to="/records/$dataset/$id"
                  params={{
                    dataset: "ecfr_authority_notes",
                    id: "ecfr:notes:title-21/part-820/as-of-2026-09-30",
                  }}
                  className="text-primary underline"
                >
                  Part 820 later snapshot
                </Link>
                <a
                  href="https://www.fda.gov/medical-devices/postmarket-requirements-devices/quality-management-system-regulation-qmsr"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  FDA effective-date explanation
                </a>
              </div>
            </section>
          ) : null}
          {data.mdlAssociations?.length ? (
            <section className="mb-6 rounded-lg border border-border bg-surface p-4">
              <h2 className="text-[16px] font-semibold">Native MDL administrative associations</h2>
              <p className="my-2 text-[13px] text-muted-foreground">
                FJC records preserve the publisher’s explicit MDL number. Exact docket-to-FJC links
                are historical administrative evidence; these counts are not a current member-case
                census. Master entries are docket-sheet rows, not member cases or legal outcomes.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-2">MDL</th>
                      <th className="p-2">FJC records</th>
                      <th className="p-2">Native docket links</th>
                      <th className="p-2">Master entries captured / observed</th>
                      <th className="p-2">Master entry scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mdlAssociations.map((row) => (
                      <tr key={row.mdlNumber} className="border-b border-border/50">
                        <td className="p-2">
                          {row.profileId ? (
                            <Link
                              to="/matters/$id"
                              params={{ id: row.profileId }}
                              className="text-primary underline"
                            >
                              MDL {row.mdlNumber}
                            </Link>
                          ) : (
                            <span>MDL {row.mdlNumber}</span>
                          )}
                          <div>{row.label}</div>
                        </td>
                        <td className="p-2">
                          <strong>{number(row.administrativeRecords)}</strong>
                          {row.administrativeRecords != null ? (
                            <div aria-hidden="true" className="mt-1 h-1 bg-muted">
                              <div
                                className="h-1 bg-primary"
                                style={{
                                  width: `${(100 * row.administrativeRecords) / Math.max(1, ...data.mdlAssociations!.map((r) => r.administrativeRecords ?? 0))}%`,
                                }}
                              />
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2">
                          {number(row.nativeDocketLinks)}
                          {data.coverage?.some((c) => c.id === "cl_docket_metadata") &&
                          (row.publicMetadataRecords ?? 0) > 0 ? (
                            <div>
                              <Link
                                to="/data/$dataset"
                                params={{ dataset: "cl_docket_metadata" }}
                                search={{ f: { mdl_number: row.mdlNumber } }}
                                className="text-primary underline"
                              >
                                {number(row.publicMetadataRecords)} public metadata records
                              </Link>
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2">
                          {number(row.masterEntriesCaptured)} / {number(row.masterEntriesObserved)}
                          {data.coverage?.some((c) => c.id === "cl_master_entries") &&
                          (row.masterEntriesCaptured ?? 0) > 0 &&
                          /\/dockets\/([0-9]+)\/$/.test(row.sourceUrl) ? (
                            <div>
                              <Link
                                to="/data/$dataset"
                                params={{ dataset: "cl_master_entries" }}
                                search={{
                                  f: {
                                    native_docket_id:
                                      row.sourceUrl.match(/\/dockets\/([0-9]+)\/$/)![1]!,
                                  },
                                }}
                                className="text-primary underline"
                              >
                                Browse eligible entry metadata
                              </Link>
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2">
                          <a
                            href={row.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                          >
                            {row.masterScope === "complete"
                              ? "All API pages captured"
                              : "Partial API pages"}
                          </a>
                          <div className="text-muted-foreground">
                            {row.sourceAsOf || "Date not recorded"}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          <section className="mb-6">
            <h2 className="mb-2 text-[16px] font-semibold">Coverage by source and snapshot</h2>
            <div className="space-y-3">
              {data.coverage?.map((coverage) => (
                <article
                  key={coverage.id}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[14px] font-semibold">{coverage.label}</h3>
                    <Badge variant="outline">{STATUS_LABELS[coverage.status]}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {number(coverage.records)} records · Source as of{" "}
                    {coverage.sourceAsOf || "Not recorded"}
                  </p>
                  {coverage.qualification ? (
                    <p className="mt-2 text-[13px] leading-relaxed">{coverage.qualification}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
                    {/^[a-z0-9_]{1,80}$/.test(coverage.id) ? (
                      <Link
                        to="/data/$dataset"
                        params={{ dataset: coverage.id }}
                        className="text-primary underline"
                      >
                        Open metadata collection
                      </Link>
                    ) : null}
                    {coverage.sourceUrls?.map((url, i) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary underline"
                        title={url}
                      >
                        Source {i + 1}
                      </a>
                    ))}
                  </div>
                </article>
              )) ?? (
                <p className="text-[13px] text-muted-foreground">
                  Source coverage has not been recorded in this checkpoint.
                </p>
              )}
            </div>
          </section>
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-[15px] font-semibold">Deduplication and identity review</h2>
              <dl className="mt-3 space-y-1 text-[13px]">
                <div>
                  Records compared: <strong>{number(data.deduplication?.recordsCompared)}</strong>
                </div>
                <div>
                  Exact duplicate groups in the stated scope:{" "}
                  <strong>{number(data.deduplication?.exactDuplicateGroups)}</strong>
                </div>
                <div>
                  Explicit person aliases in the audit:{" "}
                  <strong>{number(data.deduplication?.explicitAliases)}</strong>
                </div>
                <div>Review version: {data.deduplication?.version || "Not recorded"}</div>
              </dl>
              {data.deduplication?.summary ? (
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                  {data.deduplication.summary}
                </p>
              ) : null}
            </section>
            <section className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-[15px] font-semibold">Legal review and calculator coverage</h2>
              <dl className="mt-3 space-y-1 text-[13px]">
                <div>
                  Statutory / federal source captures:{" "}
                  <strong>{number(data.legalReview?.sources)}</strong>
                </div>
                <div>
                  Cited rule records: <strong>{number(data.legalReview?.rules)}</strong>
                </div>
                <div>
                  Jurisdictions with primary statutory text:{" "}
                  {jurisdiction(data.legalReview?.jurisdictionsCovered)}
                </div>
                <div>
                  Jurisdictions with conditional baselines:{" "}
                  {jurisdiction(data.legalReview?.calculatorJurisdictions)}
                </div>
              </dl>
              {data.legalReview?.qualification ? (
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                  {data.legalReview.qualification}
                </p>
              ) : null}
              <Link
                to="/limitations"
                className="mt-3 inline-block text-[13px] text-primary underline"
              >
                Open cited calculator
              </Link>
            </section>
          </div>
          {data.qualifications?.length ? (
            <section className="mb-5 rounded-lg border border-border bg-muted/30 p-4">
              <h2 className="text-[15px] font-semibold">Coverage qualifications</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-[13px] leading-relaxed">
                {data.qualifications.map((qualification, i) => (
                  <li key={i}>{qualification}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : !query.isLoading && !query.error ? (
        <p
          role="status"
          className="mb-5 rounded-lg border border-border bg-muted/30 p-4 text-[13px]"
        >
          The next aggregate checkpoint has not been cleared for publication. Source data remains
          subject to the recorded collection and review status.
        </p>
      ) : null}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-[15px] font-semibold">Category mapping</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Version {data?.categoryMap?.version || TAXONOMY_VERSION}.{" "}
          {data?.categoryMap?.summary ||
            "Recorded content categories use an explicit crosswalk. Publisher classification, legal authority and currentness are separate fields. Unmatched categories remain visible."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
            <Badge key={id} variant="outline">
              {label}
            </Badge>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
