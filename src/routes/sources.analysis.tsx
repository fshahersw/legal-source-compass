import { createFileRoute, Link } from "@tanstack/react-router";
import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { BarList, Stat } from "@/components/corpus/BarList";
import { pageHead } from "@/lib/corpus/head";
import {
  ENTRY_ANALYSIS_URL,
  entryScopeLabel,
  loadEntryAnalysis,
  summarizeEntryScopes,
} from "@/lib/corpus/entryAnalysis";

export const Route = createFileRoute("/sources/analysis")({
  head: () =>
    pageHead(
      "Master docket timelines",
      "Source-backed filing-year counts and native court associations from completed and partial metadata snapshots.",
    ),
  component: EntryAnalysisPage,
});

function EntryAnalysisPage() {
  const snapshot = useQuery({
    queryKey: ["native-entry-analysis", "2026-10-02"],
    queryFn: loadEntryAnalysis,
    staleTime: Infinity,
  });
  const [coverage, setCoverage] = useState("complete");
  const [court, setCourt] = useState("");
  const [docket, setDocket] = useState("");
  const data = snapshot.data;
  const options = useMemo(
    () =>
      (data?.scopes ?? []).filter(
        (scope) =>
          coverage === "all" || (coverage === "complete" ? scope.complete : !scope.complete),
      ),
    [data, coverage],
  );
  const courtOptions = useMemo(
    () =>
      [...new Map(options.map((scope) => [scope.court.nativeId, scope.court.name])).entries()].sort(
        ([, a], [, b]) => a.localeCompare(b),
      ),
    [options],
  );
  const docketOptions = options.filter((scope) => !court || scope.court.nativeId === court);
  const selected = docketOptions.filter((scope) => !docket || scope.nativeDocketId === docket);
  const summary = useMemo(() => summarizeEntryScopes(selected), [selected]);
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Sources", to: "/sources/library" },
        { label: "Master docket timelines" },
      ]}
      title="Master docket timelines"
      description="Explore filing years and source court associations. Each count is a native docket entry in a dated metadata snapshot."
    >
      {snapshot.isLoading ? (
        <p role="status">Loading the source-backed timeline snapshot…</p>
      ) : snapshot.error ? (
        <p role="alert">
          The analysis snapshot could not be loaded.{" "}
          <button className="underline" onClick={() => snapshot.refetch()}>
            Retry
          </button>
        </p>
      ) : data ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-surface p-4 text-[13px] shadow-card">
            <p>
              {data.completeScopeCount} completed entry collections and {data.partialScopeCount}{" "}
              partial collections · {data.totals.capturedEntries.toLocaleString()} captured native
              entries · {data.totals.eligibleEntries.toLocaleString()} privacy-eligible ·{" "}
              {data.totals.excludedEntries} excluded.
            </p>
            <p className="mt-2 text-muted-foreground">
              Captured {data.snapshot.first.slice(0, 10)} UTC, from{" "}
              {data.snapshot.first.slice(11, 19)} to {data.snapshot.last.slice(11, 19)}. Completed
              means terminal source pagination at capture. Partial collections are samples and
              cannot establish complete filing volume. Court association does not determine
              governing state law.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-surface p-4 text-[13px]">
            <label className="grid gap-1">
              Collection scope
              <select
                className="rounded border border-input bg-background p-2"
                value={coverage}
                onChange={(e) => {
                  setCoverage(e.target.value);
                  setCourt("");
                  setDocket("");
                }}
              >
                <option value="complete">
                  Completed collections only ({data.completeScopeCount})
                </option>
                <option value="partial">Partial collections only ({data.partialScopeCount})</option>
                <option value="all">All captured collections ({data.scopeCount})</option>
              </select>
            </label>
            <label className="grid gap-1">
              Source docket court
              <select
                className="max-w-full rounded border border-input bg-background p-2"
                value={court}
                onChange={(e) => {
                  setCourt(e.target.value);
                  setDocket("");
                }}
              >
                <option value="">All source courts</option>
                {courtOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Native docket
              <select
                className="rounded border border-input bg-background p-2"
                value={docket}
                onChange={(e) => setDocket(e.target.value)}
              >
                <option value="">All selected dockets</option>
                {docketOptions.map((scope) => (
                  <option key={scope.nativeDocketId} value={scope.nativeDocketId}>
                    {entryScopeLabel(scope)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selected.some((scope) => !scope.complete) ? (
            <p
              role="note"
              className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-[13px]"
            >
              This selection includes partial entry collections. Recent acquisition order and uneven
              scope sizes can distort comparisons; these charts do not show total filing activity.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Eligible native entries"
              value={summary.eligibleEntries}
              note={`${selected.length} selected docket collections`}
            />
            <Stat
              label="Privacy exclusions"
              value={summary.excludedEntries}
              note={`${summary.capturedEntries.toLocaleString()} entries captured in selected scopes`}
            />
            <Stat
              label="Dated native entries"
              value={summary.datedEntries}
              note={`${summary.missingDateEntries} missing · ${summary.invalidDateEntries} nonparseable dates`}
            />
            <Stat
              label="Observed filing range"
              value={summary.firstDate ?? "Not recorded"}
              note={
                summary.lastDate ? `through ${summary.lastDate}` : "No eligible native filing dates"
              }
            />
          </div>
          {summary.afterCaptureDateEntries ? (
            <p role="note">
              {summary.afterCaptureDateEntries} source filing dates fall after the last capture date
              and require source review.
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <BarList
              title="Native entry filing years"
              rows={summary.filingYears}
              limit={summary.filingYears.length}
              unit="privacy-eligible, dated native entries in the selected collections; calendar years"
            />
            <BarList
              title="Source court association"
              rows={summary.courts}
              limit={summary.courts.length}
              unit="privacy-eligible native entries; source court location is not applicable law"
            />
          </div>
          <section className="space-y-3" aria-label="Native docket evidence and coverage">
            <h2 className="eyebrow">Inspect collection coverage and evidence</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-[12px]">
                <caption className="sr-only">
                  Exact native docket entry counts, privacy eligibility, filing-date range and court
                  source
                </caption>
                <thead className="bg-muted">
                  <tr>
                    {[
                      "Native docket",
                      "Source court",
                      "Collection",
                      "Captured",
                      "Eligible",
                      "Excluded",
                      "Eligible filing range",
                      "Evidence",
                    ].map((label) => (
                      <th key={label} className="p-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected.map((scope) => (
                    <tr key={scope.nativeDocketId} className="border-t border-border">
                      <td className="p-3">{entryScopeLabel(scope)}</td>
                      <td className="p-3">
                        {scope.court.name}
                        <span className="block text-muted-foreground">
                          Native court {scope.court.nativeId}
                        </span>
                      </td>
                      <td className="p-3">{scope.complete ? "Completed at capture" : "Partial"}</td>
                      <td className="p-3 font-mono">{scope.capturedEntries.toLocaleString()}</td>
                      <td className="p-3 font-mono">{scope.eligibleEntries.toLocaleString()}</td>
                      <td className="p-3 font-mono">{scope.excludedEntries}</td>
                      <td className="p-3">
                        {scope.filingRange.first
                          ? `${scope.filingRange.first} – ${scope.filingRange.last}`
                          : "Not recorded"}
                      </td>
                      <td className="space-y-1 p-3">
                        {scope.eligibleEntries ? (
                          <Link
                            className="block text-primary underline"
                            to="/data/$dataset"
                            params={{ dataset: "cl_master_entries" }}
                            search={{ f: { native_docket_id: scope.nativeDocketId } }}
                          >
                            Browse eligible entries
                          </Link>
                        ) : (
                          <span className="block text-muted-foreground">Entry rows withheld</span>
                        )}
                        <a
                          className="block text-primary underline"
                          href={scope.sourceDocketUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Source docket
                        </a>
                        {scope.court.officialUrl ? (
                          <a
                            className="block text-primary underline"
                            href={scope.court.officialUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Source-listed court website
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section
            className="rounded-lg border border-border bg-surface p-4 text-[13px]"
            aria-label="Timeline methods and provenance"
          >
            <h2 className="eyebrow mb-2">Methods and source provenance</h2>
            <p>{data.qualification}</p>
            <p className="mt-2 text-muted-foreground">
              Missing or nonparseable filing dates are counted separately and never assigned a year.
              Source court names come from the September 30, 2026 native court-reference export
              joined by exact court ID. Sealed and source-blocked entries contribute only exclusion
              totals; their dates are omitted. A filing timeline does not identify merits,
              disposition, case outcomes or judicial treatment.
            </p>
            <p className="mt-3">
              <PrivateDataLink className="text-primary underline" href={ENTRY_ANALYSIS_URL} download>
                Download aggregate data and source-file hashes
              </PrivateDataLink>
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer">Inspect native source checksums</summary>
              <p className="mt-2 break-all font-mono text-[11px]">
                Entry observation signature: {data.sourceSignatureSha256}
              </p>
              <ul className="mt-2 space-y-2">
                {data.sourceFiles.map((source, index) => (
                  <li key={index} className="break-all text-[11px]">
                    {source.kind} · {source.bytes.toLocaleString()} bytes
                    <br />
                    <span className="font-mono">SHA-256 {source.sha256}</span>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
