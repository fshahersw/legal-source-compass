import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { Stat } from "@/components/corpus/BarList";
import { DatasetBrowser } from "@/components/corpus/DatasetBrowser";
import { AGENCY_TYPES, getAgencyCounts, listAgencies, listAgencyDocs } from "@/lib/external/agency.functions";
import { isDepartment, SAFETY_AGENCY } from "@/lib/external/agencyTree";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/agencies/$id")({
  head: () => pageHead("Agency profile", "Federal Register documents, rules, proposed rules and notices filed by this agency, with safety records where the corpus has them."),
  component: AgencyPage,
});

const TABS = ["Overview", "Rules & notices", "All documents", "Safety & enforcement"] as const;

function AgencyPage() {
  const { id } = Route.useParams();
  const la = useServerFn(listAgencies), lc = useServerFn(getAgencyCounts), ld = useServerFn(listAgencyDocs);
  const all = useQuery({ queryKey: ["agencies"], queryFn: () => la(), staleTime: Infinity });
  const counts = useQuery({ queryKey: ["agency-counts", id], queryFn: () => lc({ data: { id } }), staleTime: Infinity });
  const [type, setType] = useState("");
  const docs = useQuery({ queryKey: ["agency-docs", id, type], queryFn: () => ld({ data: { id, ...(type ? { type } : {}) } }), staleTime: 10 * 60_000 });
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const a = all.data?.find((x) => x.id === id);
  const name = a?.name ?? "Agency";
  const safety = a ? SAFETY_AGENCY[a.name] : undefined;
  const num = (v: number | null | undefined) => (counts.isLoading ? "…" : v == null ? "Too large to count" : v);

  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Law & Safety", to: "/law" }, { label: "Agencies", to: "/agencies" }, { label: name }]} title={name} description={a && isDepartment(a.name) ? "Department totals include documents its component agencies file: the publisher names the department and the component on the same document." : "Federal Register documents that name this agency."}>
      {all.data && !a ? <p className="text-[13px]">This agency is not in the Federal Register agency list.</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Federal Register documents" value={a?.count ?? "…"} note="In the Federal Register history" />
            <Stat label="Rules" value={num(counts.data?.["Rule"])} note="Documents typed as a rule" />
            <Stat label="Proposed rules" value={num(counts.data?.["Proposed Rule"])} />
            <Stat label="Notices" value={num(counts.data?.["Notice"])} />
          </div>
          <div className="mt-5 flex flex-wrap gap-1 border-b border-border text-[13px]">
            {TABS.filter((t) => t !== "Safety & enforcement" || safety).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-1.5 ${tab === t ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}>{t}</button>
            ))}
          </div>
          <div className="mt-4">
            {tab === "Overview" ? (
              <div className="space-y-2 text-[13px]">
                <p>Document types for this agency, counted from the saved Federal Register index. Other types (corrections, presidential documents, uncategorized) make up the rest of the total.</p>
                <p className="text-[12px] text-muted-foreground">A per-year breakdown is not available: the index does not offer a year filter for agency counts.</p>
                {safety ? <p><Link to="/safety" search={{ agency: safety }} className="underline">Open {safety} safety records →</Link></p> : <p className="text-[12px] text-muted-foreground">No safety dataset for this agency in the corpus.</p>}
              </div>
            ) : null}
            {tab === "Rules & notices" ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[12px]">Type
                  <select value={type} onChange={(e) => setType(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
                    <option value="">All types</option>{AGENCY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <p className="text-[11px] text-muted-foreground">The 12 most recent documents in the saved index.</p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground"><tr><th className="px-2 py-1.5">Document</th><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Published</th><th className="px-2 py-1.5">Citation</th><th className="px-2 py-1.5">CFR parts</th></tr></thead>
                    <tbody>
                      {docs.isLoading ? <tr><td className="px-2 py-2 text-muted-foreground" colSpan={5}>Loading…</td></tr> : (docs.data ?? []).map((d) => (
                        <tr key={d.id} className="border-t border-border align-top">
                          <td className="max-w-md px-2 py-1.5">{d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="underline">{d.title}</a> : d.title}</td>
                          <td className="px-2 py-1.5">{d.type || "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">{d.published || "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">{d.citation || "—"}</td>
                          <td className="px-2 py-1.5 font-mono text-[11px]">{d.cfr || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {tab === "All documents" ? <DatasetBrowser dataset="federal_register_history" initialFilters={{ agency: id }} compact /> : null}
            {tab === "Safety & enforcement" && safety ? <p className="text-[13px]"><Link to="/safety" search={{ agency: safety }} className="underline">Open {safety} recalls, approvals and enforcement records →</Link></p> : null}
          </div>
        </>
      )}
    </AppShell>
  );
}
