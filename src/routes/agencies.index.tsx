import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { Input } from "@/components/ui/input";
import { listAgencies } from "@/lib/external/agency.functions";
import { splitAgencies } from "@/lib/external/agencyTree";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/agencies/")({
  head: () => pageHead("Agencies", "Federal departments and agencies with their Federal Register documents, rules, regulations and safety records."),
  component: AgenciesPage,
});

function AgenciesPage() {
  const fn = useServerFn(listAgencies);
  const q = useQuery({ queryKey: ["agencies"], queryFn: () => fn(), staleTime: Infinity });
  const [term, setTerm] = useState("");
  const groups = useMemo(() => {
    const rows = (q.data ?? []).filter((a) => a.name.toLowerCase().includes(term.toLowerCase()));
    return splitAgencies(rows);
  }, [q.data, term]);
  const item = (a: { id: string; name: string; count: number }) => ({ key: a.id, label: a.name, count: a.count, note: "Federal Register documents", link: { to: "/agencies/$id", params: { id: a.id } } });
  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Law & Safety", to: "/law" }, { label: "Agencies" }]} title="Agencies" description="Departments and agencies as the Federal Register names them. Open one for its documents, rules and safety records.">
      {q.isLoading ? <p className="text-[12px] text-muted-foreground">Loading agencies…</p> : q.error ? <p className="text-[12px] text-destructive">Agencies could not be loaded.</p> : (
        <div className="space-y-5">
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Find an agency" className="h-8 max-w-xs text-[12px]" />
          <FolderGrid title="Departments" items={groups.departments.map(item)} />
          <FolderGrid title="Independent and component agencies" items={groups.others.map(item)} />
        </div>
      )}
    </AppShell>
  );
}
