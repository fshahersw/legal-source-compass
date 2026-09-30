import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { loadRegistry } from "@/lib/registry/registry";

/** Court page: registry matters whose court_id exactly matches this court. */
export function RegistryMatters({ courtId }: { courtId: string }) {
  const q = useQuery({ queryKey: ["matter-registry"], queryFn: loadRegistry, staleTime: Infinity });
  if (!q.data) return null;
  const matters = q.data.mattersByCourt.get(courtId) ?? [];
  if (!matters.length) return null;
  return (
    <section className="mb-5 rounded-lg border border-border bg-surface p-3 shadow-card">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="eyebrow">Case registry</h2>
        <span className="text-[12px] text-muted-foreground">{matters.length} verified {matters.length === 1 ? "matter" : "matters"} with parties, outcomes and documents</span>
      </div>
      <ul className="divide-y divide-border text-[12px]">{matters.map((m) => (
        <li key={m.matter_id} className="flex flex-wrap items-baseline gap-3 py-1.5">
          <Link to="/registry/$id" params={{ id: m.matter_id }} className="min-w-0 flex-1 truncate font-medium underline decoration-dotted">{m.case_name}</Link>
          <span className="font-mono text-[11px]">{m.docket_number}</span>
          <span className="text-[11px] text-muted-foreground">{m.case_status ?? "Not recorded"}{m.date_filed ? ` · filed ${m.date_filed}` : ""}</span>
        </li>))}</ul>
    </section>
  );
}
