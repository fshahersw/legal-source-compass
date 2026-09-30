import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { Input } from "@/components/ui/input";
import { pageHead } from "@/lib/corpus/head";
import { loadRegistry, searchMatters } from "@/lib/registry/registry";

export const Route = createFileRoute("/registry/")({
  head: () => pageHead("Case registry", "73 verified matters with parties, attorneys, outcomes and docket documents."),
  component: RegistryPage,
});

function RegistryPage() {
  const q = useQuery({ queryKey: ["matter-registry"], queryFn: loadRegistry, staleTime: Infinity });
  const [search, setSearch] = useState("");
  const rows = q.data ? searchMatters(q.data.matters, search) : [];

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Case registry" }]}
      title="Case registry"
      description="A verified matter registry: parties, attorneys, outcomes and docket documents for each case. Documents are listed with their details; the files themselves live in private storage and can't be opened from here."
    >
      {q.error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[13px]">The case registry could not be loaded. {q.error.message}</p> : null}
      {q.isLoading ? <p className="text-[13px] text-muted-foreground">Loading registry…</p> : null}
      {q.data ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search case name, docket number, court or status" className="h-8 max-w-sm text-[12px]" aria-label="Search registry matters" />
            <span className="text-[12px] text-muted-foreground">
              {rows.length} of {q.data.matters.length} matters · {q.data.attorneys.length} attorneys · {q.data.courts.size} courts
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
            <table className="w-full text-[12px]">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr><th className="px-3 py-2">Case</th><th className="px-3 py-2">Docket</th><th className="px-3 py-2">Court</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Filed</th><th className="px-3 py-2">Terminated</th><th className="px-3 py-2">Parties</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((m) => (
                  <tr key={m.matter_id} className="hover:bg-muted/50">
                    <td className="px-3 py-1.5"><Link to="/registry/$id" params={{ id: m.matter_id }} className="font-medium underline decoration-dotted">{m.case_name}</Link></td>
                    <td className="px-3 py-1.5 font-mono">{m.docket_number}</td>
                    <td className="px-3 py-1.5"><Link to="/courts/$id" params={{ id: m.court_id }} className="underline decoration-dotted">{q.data.courts.get(m.court_id)?.name ?? m.court_id}</Link></td>
                    <td className="px-3 py-1.5">{m.case_status ?? "Not recorded"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{m.date_filed ?? "Not recorded"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{m.date_terminated ?? "—"}</td>
                    <td className="px-3 py-1.5">{q.data.partiesByMatter.get(m.matter_id)?.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
