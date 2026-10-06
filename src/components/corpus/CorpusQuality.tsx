import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BarList, Stat } from "./BarList";
import { useDatasets } from "./DatasetBrowser";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { classifySource, CATEGORY_LABELS } from "@/lib/corpus/taxonomy";
import { valuesOf } from "@/lib/atlas/bundle";
import { directoryQuality } from "@/lib/corpus/quality";
import type { Source } from "@/lib/atlas/types";

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

export function DatabaseQuality() {
  const [visibility, setVisibility] = useState("all");
  const live = useDatasets();
  const all = useMemo(() => live.data ?? [], [live.data]);
  const totals = useMemo(() => {
    const counted = all.filter((d) => d.records != null);
    const sum = (rows: typeof counted) => rows.reduce((a, d) => a + (d.records ?? 0), 0);
    const ready = counted.filter((d) => d.ready === true);
    const held = counted.filter((d) => d.ready === false);
    return {
      records: sum(counted),
      readyRecords: sum(ready),
      heldRecords: sum(held),
      readyDatasets: all.filter((d) => d.ready === true).length,
      heldDatasets: all.filter((d) => d.ready === false).length,
      uncounted: all.filter((d) => d.records == null).length,
    };
  }, [all]);
  if (live.isLoading)
    return (
      <p role="status" className="text-[13px] text-muted-foreground">
        Loading current collection counts…
      </p>
    );
  if (live.error)
    return (
      <p role="alert" className="text-[13px] text-muted-foreground">
        Collection counts: Not recorded.{" "}
        <button className="underline" onClick={() => live.refetch()}>
          Retry
        </button>
      </p>
    );
  const percent = totals.records ? (totals.readyRecords / totals.records) * 100 : 0;
  const rows = all
    .filter(
      (d) =>
        visibility === "all" ||
        (visibility === "ready" ? d.ready === true : visibility === "held" ? d.ready === false : false),
    )
    .sort((a, b) => (b.records ?? -1) - (a.records ?? -1));
  return (
    <section className="space-y-4" aria-label="Connected corpus collection counts">
      <h2 className="eyebrow">Connected corpus · current collection counts</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Imported records"
          value={totals.records}
          note={
            totals.uncounted
              ? `Collections are not deduplicated against each other · ${totals.uncounted} collection(s) with no recorded count`
              : "Collections are not deduplicated against each other"
          }
        />
        <Stat
          label="Ready collections"
          value={totals.readyDatasets}
          note={`${totals.readyRecords.toLocaleString()} records marked ready`}
        />
        <Stat
          label="Collections held from publication"
          value={totals.heldDatasets}
          note={`${totals.heldRecords.toLocaleString()} imported records`}
        />
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-[12px]">
          <span>Records by publication status</span>
          <span className="font-mono">{percent.toFixed(1)}% marked ready</span>
        </div>
        <div
          className="flex h-5 overflow-hidden rounded bg-muted"
          role="img"
          aria-label={`${totals.readyRecords.toLocaleString()} ready; ${totals.heldRecords.toLocaleString()} held records`}
        >
          <div className="bg-primary" style={{ width: `${percent}%` }} />
          <div className="bg-amber-500/60" style={{ width: `${100 - percent}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Release readiness is separate from legal currency and substantive accuracy.
        </p>
      </div>
      <BarList
        title="Largest imported collections"
        rows={all
          .filter((d) => d.records != null)
          .sort((a, b) => (b.records ?? 0) - (a.records ?? 0))
          .map((d) => ({ label: datasetDisplayName(d.id, d.label), count: d.records ?? 0 }))}
        unit="imported records, read from the corpus when this page loaded"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="eyebrow">Every collection</h3>
        <select
          aria-label="Collection publication status"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          className="rounded border border-input bg-surface p-1 text-[12px]"
        >
          <option value="all">All collections</option>
          <option value="ready">Ready</option>
          <option value="held">Held</option>
        </select>
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full text-left text-[12px]">
          <caption className="sr-only">Collection record counts and publication status</caption>
          <thead className="sticky top-0 bg-muted text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="p-2">Collection</th>
              <th className="p-2">Imported records</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((d) => (
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
                <td className="p-2 font-mono">
                  {d.records == null ? "Not recorded" : d.records.toLocaleString()}
                </td>
                <td className="p-2">
                  {d.ready === true ? "Ready" : d.ready === false ? "Held" : "Not recorded"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
