import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BarList, Stat } from "./BarList";
import { useDatasets } from "./DatasetBrowser";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { classifySource, CATEGORY_LABELS } from "@/lib/corpus/taxonomy";
import { valuesOf } from "@/lib/atlas/bundle";
import { directoryQuality } from "@/lib/corpus/quality";
import type { Source } from "@/lib/atlas/types";

export type DatabaseAudit = {
  schemaVersion: number;
  capturedAt: string;
  basis: string;
  totals: {
    records: number;
    readyRecords: number;
    heldRecords: number;
    datasets: number;
    readyDatasets: number;
    heldDatasets: number;
  };
  datasets: {
    id: string;
    label: string;
    ready: boolean;
    actualRecords: number;
    metadataRecords: number;
    expectedRecords: number;
    updatedAt: string;
  }[];
  categoryStateCounts: {
    category: string | null;
    state: string | null;
    records: number;
  }[];
  identity: {
    duplicateIdGroups: number;
    recordsWithDuplicateIds: number;
    basis: string;
  };
  qualifications: {
    id: string;
    ready: boolean;
    qualification: string | null;
    asOf: unknown;
  }[];
  relationships: {
    source_dataset: string;
    source_rows: number;
    missing_docket_id: number;
    missing_entry_number: number;
    missing_court_id: number;
    missing_court_mapping: number;
  }[];
};

export async function loadDatabaseAudit(): Promise<DatabaseAudit> {
  const response = await fetch("/data/quality/database-audit.json");
  if (!response.ok) throw new Error(`Database audit file: HTTP ${response.status}`);
  const data = (await response.json()) as DatabaseAudit;
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.datasets) ||
    !Array.isArray(data.categoryStateCounts) ||
    !Number.isInteger(data.totals?.records)
  )
    throw new Error("Database audit format is invalid.");
  return data;
}

export function DirectoryQuality({ sources, status }: { sources: Source[]; status: string }) {
  const quality = useMemo(
    () =>
      directoryQuality(
        sources.map((s) => ({
          id: s.id,
          url: s.url,
          domain: s.domain,
          jurisdictions: valuesOf(s, "jurisdiction"),
          headings: valuesOf(s, "heading_category"),
          occurrences: s.occurrences,
        })),
      ),
    [sources],
  );
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sources)
      for (const category of classifySource(valuesOf(s, "heading_category")))
        counts.set(CATEGORY_LABELS[category], (counts.get(CATEGORY_LABELS[category]) ?? 0) + 1);
    return [...counts]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [sources]);
  if (status !== "ready")
    return (
      <p className="text-[13px] text-muted-foreground">
        {status === "loading"
          ? "Loading directory quality measures…"
          : "Directory quality measures: Not recorded."}
      </p>
    );
  return (
    <section className="space-y-3" aria-label="Directory quality">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Directory URLs"
          value={quality.uniqueUrls}
          note={`${quality.occurrences.toLocaleString()} mentions in the supplied files`}
        />
        <Stat
          label="Sources with several jurisdictions"
          value={quality.multipleJurisdictions}
          note="Counted once in every exact tagged jurisdiction"
        />
        <Stat
          label="Sources without a jurisdiction tag"
          value={quality.withoutJurisdiction}
          note="A missing tag does not establish a missing source"
        />
        <Stat
          label="URL / domain issues"
          value={quality.issues.length}
          note="Syntax, protocol and imported domain only"
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <BarList
          title="Resource groups from imported headings"
          rows={groups}
          unit="source URLs; groups can overlap"
        />
        <BarList
          title="Directory sources by tagged jurisdiction"
          rows={quality.jurisdictions}
          unit="source URLs; jurisdictions can overlap"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        The crosswalk uses explicit heading matches. Broad legal-resource trees stay mixed; topical
        regulator headings do not become regulations. Original headings remain unchanged. URL syntax
        does not establish live reachability.
      </p>
    </section>
  );
}

export function DatabaseQuality({ audit }: { audit: DatabaseAudit }) {
  const [visibility, setVisibility] = useState("all");
  const [categoryState, setCategoryState] = useState("all");
  const live = useDatasets();
  const current = useMemo(() => new Map((live.data ?? []).map((d) => [d.id, d])), [live.data]);
  const datasets = audit.datasets.filter(
    (d) => visibility === "all" || (visibility === "ready" ? d.ready : !d.ready),
  );
  const states = [
    ...new Set(audit.categoryStateCounts.map((r) => r.state).filter((s): s is string => !!s)),
  ].sort();
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of audit.categoryStateCounts)
      if (categoryState === "all" || row.state === categoryState)
        counts.set(
          row.category ?? "Not recorded",
          (counts.get(row.category ?? "Not recorded") ?? 0) + row.records,
        );
    return [...counts]
      .map(([label, count]) => ({ label: label.replace(/_/g, " "), count }))
      .sort((a, b) => b.count - a.count);
  }, [audit, categoryState]);
  const percent = audit.totals.records
    ? (audit.totals.readyRecords / audit.totals.records) * 100
    : 0;
  return (
    <section className="space-y-4" aria-label="Database quality audit">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">
          Connected corpus · exact count audit {audit.capturedAt.slice(0, 10)} UTC
        </h2>
        <a
          className="text-[12px] text-primary hover:underline"
          href="/data/quality/database-audit.json"
          download
        >
          Download count audit JSON
        </a>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Imported records"
          value={audit.totals.records}
          note="Exact count; collections are not deduplicated against each other"
        />
        <Stat
          label="Ready collections"
          value={audit.totals.readyDatasets}
          note={`${audit.totals.readyRecords.toLocaleString()} records marked ready`}
        />
        <Stat
          label="Collections held from publication"
          value={audit.totals.heldDatasets}
          note={`${audit.totals.heldRecords.toLocaleString()} imported records`}
        />
        <Stat
          label="IDs reused across collections"
          value={audit.identity.duplicateIdGroups}
          note="Link by dataset + ID; these are not proven duplicates"
        />
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-[12px]">
          <span>Records by publication status at the audit</span>
          <span className="font-mono">{percent.toFixed(1)}% marked ready</span>
        </div>
        <div
          className="flex h-5 overflow-hidden rounded bg-muted"
          role="img"
          aria-label={`${audit.totals.readyRecords.toLocaleString()} ready; ${audit.totals.heldRecords.toLocaleString()} held records`}
        >
          <div className="bg-primary" style={{ width: `${percent}%` }} />
          <div className="bg-amber-500/60" style={{ width: `${100 - percent}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Release readiness is separate from legal currency and substantive accuracy.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <BarList
          title="Largest imported collections"
          rows={[...audit.datasets]
            .sort((a, b) => b.actualRecords - a.actualRecords)
            .map((d) => ({
              label: datasetDisplayName(d.id, d.label),
              count: d.actualRecords,
            }))}
          unit="records in this database snapshot"
        />
        <div className="min-w-0 space-y-2">
          <label className="flex flex-wrap items-center gap-2 text-[12px]">
            Raw database state value
            <select
              aria-label="Database category state"
              value={categoryState}
              onChange={(e) => setCategoryState(e.target.value)}
              className="min-w-0 max-w-full rounded border border-input bg-surface p-1"
            >
              <option value="all">All imported records</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <BarList
            title="Imported records by native category"
            rows={categoryCounts}
            unit="records including held collections; native categories retained"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="eyebrow">Every collection · count reconciliation</h3>
        <select
          aria-label="Collection publication status"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          className="rounded border border-input bg-surface p-1 text-[12px]"
        >
          <option value="all">All collections</option>
          <option value="ready">Ready at audit</option>
          <option value="held">Held at audit</option>
        </select>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Counts below come from the dated audit.{" "}
        {live.isLoading
          ? "Checking current publication metadata…"
          : live.error
            ? "Current publication metadata is unavailable; its status is Not recorded."
            : "The last column shows current publication metadata."}{" "}
        Source dates and collection import dates serve different purposes.
      </p>
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full text-left text-[12px]">
          <caption className="sr-only">Exact collection counts and publication status</caption>
          <thead className="sticky top-0 bg-muted text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="p-2">Collection</th>
              <th className="p-2">Exact records</th>
              <th className="p-2">Expected</th>
              <th className="p-2">Reconciles</th>
              <th className="p-2">At audit</th>
              <th className="p-2">Current status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...datasets]
              .sort((a, b) => b.actualRecords - a.actualRecords)
              .map((d) => {
                const now = current.get(d.id);
                const changed = now?.records != null && now.records !== d.metadataRecords;
                return (
                  <tr key={d.id}>
                    <td className="p-2">
                      <Link
                        className="text-primary hover:underline"
                        to="/data/$dataset"
                        params={{ dataset: d.id }}
                      >
                        {datasetDisplayName(d.id, d.label)}
                      </Link>
                    </td>
                    <td className="p-2 font-mono">{d.actualRecords.toLocaleString()}</td>
                    <td className="p-2 font-mono">{d.expectedRecords.toLocaleString()}</td>
                    <td className="p-2">
                      {d.actualRecords === d.metadataRecords &&
                      d.actualRecords === d.expectedRecords
                        ? "Yes"
                        : "Mismatch"}
                      {changed ? " · metadata changed" : ""}
                    </td>
                    <td className="p-2">{d.ready ? "Ready" : "Held"}</td>
                    <td className="p-2">
                      {now?.ready === true
                        ? "Ready"
                        : now?.ready === false
                          ? "Held"
                          : "Not recorded"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <details className="text-[12px] text-muted-foreground">
        <summary className="cursor-pointer">Source dates and population qualifications</summary>
        <div className="mt-2 space-y-2">
          {audit.qualifications.map((q) => (
            <p key={q.id}>
              <strong>{datasetDisplayName(q.id, null)}:</strong>{" "}
              {q.qualification || "Source qualification is not recorded."}
            </p>
          ))}
        </div>
      </details>
      <details className="text-[12px]">
        <summary className="cursor-pointer text-muted-foreground">
          Audited MDL docket and court relationships
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="p-2">Collection</th>
                <th className="p-2">Rows</th>
                <th className="p-2">Missing docket ID</th>
                <th className="p-2">Missing entry number</th>
                <th className="p-2">Missing court ID</th>
                <th className="p-2">Unmapped court ID</th>
              </tr>
            </thead>
            <tbody>
              {audit.relationships.map((r) => (
                <tr key={r.source_dataset}>
                  <td className="p-2">{datasetDisplayName(r.source_dataset, null)}</td>
                  <td className="p-2 font-mono">{r.source_rows.toLocaleString()}</td>
                  <td className="p-2">{r.missing_docket_id}</td>
                  <td className="p-2">
                    {r.source_dataset === "mdl_case_inventory"
                      ? "Not applicable: case level"
                      : r.missing_entry_number}
                  </td>
                  <td className="p-2">{r.missing_court_id}</td>
                  <td className="p-2">{r.missing_court_mapping}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Only native IDs were compared. A populated or mapped key establishes structural coverage,
          not the substantive correctness of a relationship.
        </p>
      </details>
    </section>
  );
}
