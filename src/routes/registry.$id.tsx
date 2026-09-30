import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { pageHead } from "@/lib/corpus/head";
import { formatBytes, loadMatterDocs, loadRegistry } from "@/lib/registry/registry";

export const Route = createFileRoute("/registry/$id")({
  head: () => pageHead("Registry matter", "Verified matter detail: parties, outcome and docket documents."),
  component: MatterPage,
  notFoundComponent: () => <p className="p-6 text-[13px]">Matter not found in the registry.</p>,
});

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-lg border border-border bg-surface p-3 shadow-card">
      <div className="mb-2 flex flex-wrap items-baseline gap-2"><h2 className="eyebrow">{title}</h2>{hint ? <span className="text-[12px] text-muted-foreground">{hint}</span> : null}</div>
      {children}
    </section>
  );
}

function MatterPage() {
  const { id } = Route.useParams();
  const reg = useQuery({ queryKey: ["matter-registry"], queryFn: loadRegistry, staleTime: Infinity });
  const docs = useQuery({ queryKey: ["matter-docs", id], queryFn: () => loadMatterDocs(id), staleTime: Infinity });

  if (reg.error) return <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Case registry", to: "/registry" }, { label: "Matter" }]} title="Registry matter"><p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[13px]">The case registry could not be loaded. {reg.error.message}</p></AppShell>;
  if (!reg.data) return <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Case registry", to: "/registry" }, { label: "Matter" }]} title="Registry matter"><p className="text-[13px] text-muted-foreground">Loading…</p></AppShell>;

  const m = reg.data.matters.find((x) => x.matter_id === id);
  if (!m) return <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Case registry", to: "/registry" }, { label: "Matter" }]} title="Registry matter"><p className="text-[13px]">Matter not found in the registry.</p></AppShell>;

  const parties = reg.data.partiesByMatter.get(id) ?? [];
  const outcomes = reg.data.outcomesByMatter.get(id) ?? [];
  const byType = new Map<string, string[]>();
  for (const p of parties) for (const t of p.party_types.length ? p.party_types : ["Other"]) {
    const list = byType.get(t) ?? [];
    list.push(p.name);
    byType.set(t, list);
  }
  const courtName = reg.data.courts.get(m.court_id)?.name ?? m.court_id;

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Case registry", to: "/registry" }, { label: m.case_name }]}
      title={m.case_name}
      description={`Docket ${m.docket_number} · ${courtName}`}
    >
      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-border bg-surface p-3 text-[12px] shadow-card sm:grid-cols-4">
        <div><dt className="text-[11px] text-muted-foreground">Court</dt><dd><Link to="/courts/$id" params={{ id: m.court_id }} className="underline decoration-dotted">{courtName}</Link></dd></div>
        <div><dt className="text-[11px] text-muted-foreground">Status</dt><dd>{m.case_status ?? "Not recorded"}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground">Filed</dt><dd>{m.date_filed ?? "Not recorded"}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground">Terminated</dt><dd>{m.date_terminated ?? "—"}</dd></div>
      </dl>

      <Section title="Parties" hint={`${parties.length} recorded`}>
        {parties.length ? (
          <div className="space-y-2">{[...byType.entries()].map(([type, names]) => (
            <div key={type}><div className="text-[11px] text-muted-foreground">{type} ({names.length})</div><div className="text-[13px]">{names.join("; ")}</div></div>
          ))}</div>
        ) : <p className="text-[12px] text-muted-foreground">Not recorded</p>}
      </Section>

      <Section title="Outcome" hint={outcomes.length ? `${outcomes.length} recorded` : undefined}>
        {outcomes.length ? (
          <ul className="divide-y divide-border text-[12px]">{outcomes.map((o) => (
            <li key={o.outcome_id} className="flex flex-wrap items-baseline gap-3 py-1.5">
              <span className="font-medium">{(o.outcome_type ?? "Outcome").replace(/_/g, " ")}</span>
              <span className="text-muted-foreground">{o.date_terminated ?? "date not recorded"}</span>
              {o.evidence_level ? <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground">{o.evidence_level.replace(/_/g, " ")}</span> : null}
            </li>))}</ul>
        ) : <p className="text-[12px] text-muted-foreground">Not recorded</p>}
      </Section>

      <Section title="Docket documents" hint={docs.isLoading ? "Loading…" : docs.data ? `${docs.data.length.toLocaleString()} verified documents — details only; the files live in private storage` : undefined}>
        {docs.error ? <p role="alert" className="text-[12px] text-destructive">Documents could not be loaded.</p> : null}
        {docs.data && docs.data.length === 0 ? <p className="text-[12px] text-muted-foreground">No documents recorded for this matter.</p> : null}
        {docs.data && docs.data.length ? (
          <div className="overflow-x-auto"><table className="w-full text-[12px]">
            <thead className="text-left text-[11px] text-muted-foreground"><tr><th className="px-2 py-1">Description</th><th className="px-2 py-1">Size</th><th className="px-2 py-1">Verified</th></tr></thead>
            <tbody className="divide-y divide-border">{docs.data.slice(0, 200).map((d) => (
              <tr key={d.document_id}>
                <td className="px-2 py-1">{d.description ?? "Not recorded"}</td>
                <td className="px-2 py-1 whitespace-nowrap">{formatBytes(d.byte_count)}</td>
                <td className="px-2 py-1">{d.verification_status ? <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground">{d.verification_status.replace(/_/g, " ")}</span> : "—"}</td>
              </tr>))}</tbody>
          </table>
          {docs.data.length > 200 ? <p className="mt-2 text-[11px] text-muted-foreground">Showing first 200 of {docs.data.length.toLocaleString()} documents.</p> : null}
          </div>
        ) : null}
      </Section>
    </AppShell>
  );
}
