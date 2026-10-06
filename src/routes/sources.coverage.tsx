import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { pageHead } from "@/lib/corpus/head";
import { coverageMatrix, humanize, jurisdictionLabel } from "@/lib/atlas/registry";
import { useRegistry } from "@/lib/atlas/useRegistry";
import { useAtlas } from "@/lib/atlas/store";
import { valuesOf } from "@/lib/atlas/bundle";
import { directoryJurisdictionCounts, registryQuality } from "@/lib/corpus/quality";
import { DatabaseQuality, DirectoryQuality } from "@/components/corpus/CorpusQuality";
import { BarList, Stat } from "@/components/corpus/BarList";
import { Button } from "@/components/ui/button";
import { SourceSupplements } from "@/components/corpus/SourceSupplements";
import { LegalCoverage } from "@/components/legal/LegalCoverage";

export const Route = createFileRoute("/sources/coverage")({
  head: () =>
    pageHead(
      "Quality & coverage",
      "Reproducible corpus counts, source quality, publication status and jurisdiction coverage, with explicit dates and denominators.",
    ),
  component: CoveragePage,
});

function CoveragePage() {
  const reg = useRegistry();
  const atlas = useAtlas();
  const [jurisdiction, setJurisdiction] = useState("");
  const [categoryPage, setCategoryPage] = useState(0);
  const m = useMemo(() => coverageMatrix(reg.data?.entries ?? []), [reg.data]);
  const quality = useMemo(() => registryQuality(reg.data?.entries ?? []), [reg.data]);
  const directory = useMemo(
    () =>
      directoryJurisdictionCounts(
        (atlas.bundle?.sources ?? []).map((s) => ({
          jurisdictions: valuesOf(s, "jurisdiction"),
        })),
      ),
    [atlas.bundle],
  );
  const cats = m.categories.slice(categoryPage * 12, categoryPage * 12 + 12);
  const rows = m.rows.filter((r) => !jurisdiction || r.jurisdiction === jurisdiction);
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Sources", to: "/sources/library" },
        { label: "Quality & coverage" },
      ]}
      title="Quality & coverage"
      description="Counts, categories and relationships from the supplied files and current corpus collection counts. A registry gap is not proof that a legal source does not exist."
    >
      <div className="space-y-7">
        <LegalCoverage />
        <DirectoryQuality sources={atlas.bundle?.sources ?? []} status={atlas.status} />
        <DatabaseQuality />
        <SourceSupplements />
        <section className="space-y-3" aria-label="Registry quality and coverage">
          <h2 className="eyebrow">Registry observations · historical checks</h2>
          {reg.isLoading ? (
            <p role="status" className="text-[13px] text-muted-foreground">
              Loading registry coverage…
            </p>
          ) : reg.error ? (
            <p role="alert" className="text-[13px] text-muted-foreground">
              Registry measures: Not recorded.{" "}
              <button className="underline" onClick={() => reg.refetch()}>
                Retry
              </button>
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat
                  label="Registry URLs"
                  value={quality.uniqueUrls}
                  note={quality.rows.toLocaleString() + " parsed rows"}
                />
                <Stat
                  label="Record types tracked"
                  value={m.categories.length}
                  note={m.rows.length + " categorized jurisdictions"}
                />
                <Stat
                  label="Rows without a category"
                  value={quality.withoutCategory}
                  note="Includes navigation and parent resources; types are not guessed"
                />
                <Stat
                  label="Recorded non-2xx responses"
                  value={quality.recordedNon2xx}
                  note={
                    "Historical observations; " +
                    quality.withoutCheckDate.toLocaleString() +
                    " rows lack a check date"
                  }
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <BarList
                  title="HTTP status as recorded in the registry"
                  rows={quality.statuses}
                  unit="historical observations, including redirects and crawler blocks"
                />
                <div className="rounded-lg border border-border bg-surface p-4 text-[13px] shadow-card">
                  <h3 className="eyebrow mb-2">Interpret the gaps</h3>
                  <p>
                    The latest dated registry check is {quality.latestCheckDate ?? "Not recorded"}.
                    A 403, 401 or timeout can reflect crawler access restrictions. It does not show
                    that a source is unavailable to the public or that its law is outdated.
                  </p>
                  <p className="mt-2">
                    Directory columns count tagged URLs. Registry columns count categorized URLs.
                    These populations are not added together.
                  </p>
                  <PrivateDataLink
                    className="mt-3 inline-block text-[12px] text-primary hover:underline"
                    href="/data/quality/bundled-audit.json"
                    download
                  >
                    Download bundled audit and file hashes
                  </PrivateDataLink>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <label className="flex items-center gap-2">
                  Jurisdiction
                  <select
                    aria-label="Coverage jurisdiction"
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    className="rounded border border-input bg-surface p-1"
                  >
                    <option value="">All jurisdictions</option>
                    {m.rows.map((r) => (
                      <option key={r.jurisdiction} value={r.jurisdiction}>
                        {jurisdictionLabel(r.jurisdiction)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={categoryPage === 0}
                    onClick={() => setCategoryPage((p) => p - 1)}
                  >
                    Previous types
                  </Button>
                  <span>
                    Types {categoryPage * 12 + 1}–
                    {Math.min((categoryPage + 1) * 12, m.categories.length)} of{" "}
                    {m.categories.length}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(categoryPage + 1) * 12 >= m.categories.length}
                    onClick={() => setCategoryPage((p) => p + 1)}
                  >
                    Next types
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
                <table className="w-full text-[12px]">
                  <caption className="sr-only">
                    Jurisdiction coverage; each count has its own population
                  </caption>
                  <thead className="bg-muted/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="p-2">Jurisdiction</th>
                      <th className="p-2">Tagged directory URLs</th>
                      <th className="p-2">Categorized registry URLs</th>
                      {cats.map((c) => (
                        <th key={c} className="p-2">
                          {humanize(c)}
                        </th>
                      ))}
                      <th className="p-2">Unrepresented types</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => {
                      const name = jurisdictionLabel(r.jurisdiction);
                      return (
                        <tr key={r.jurisdiction}>
                          <td className="p-2 font-medium">
                            <Link
                              to="/sources/registry"
                              search={{ j: r.jurisdiction }}
                              className="hover:underline"
                            >
                              {name}
                            </Link>
                          </td>
                          <td className="p-2 font-mono">
                            {atlas.status === "ready"
                              ? (directory.get(name) ?? 0).toLocaleString()
                              : atlas.status === "loading"
                                ? "…"
                                : "Not recorded"}
                          </td>
                          <td className="p-2 font-mono">{r.total.toLocaleString()}</td>
                          {cats.map((c) => {
                            const n = r.counts.get(c) ?? 0;
                            return (
                              <td
                                key={c}
                                className={
                                  "p-2 font-mono " + (n ? "" : "bg-muted/60 text-muted-foreground")
                                }
                              >
                                {n ? (
                                  <Link
                                    to="/sources/registry"
                                    search={{ j: r.jurisdiction, cat: c }}
                                    className="hover:underline"
                                  >
                                    {n}
                                  </Link>
                                ) : (
                                  "0"
                                )}
                              </td>
                            );
                          })}
                          <td className="p-2 text-muted-foreground">
                            <details>
                              <summary className="cursor-pointer">{r.missing.length}</summary>
                              {r.missing.map((c) => (
                                <div key={c}>{humanize(c)}</div>
                              ))}
                            </details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
