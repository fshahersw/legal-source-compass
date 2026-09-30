import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ExternalBadge, ExternalError } from "@/components/corpus/ExternalBadge";
import { listJudges } from "@/lib/external/corpus.functions";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/judges")({
  head: () => pageHead("Judges", "Judge directory from the connected litigation corpus: courts, system and source links."),
  component: JudgesPage,
});

function JudgesPage() {
  const fn = useServerFn(listJudges);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ["judges", q, offset], queryFn: () => fn({ data: { q, state: "", offset } }), placeholderData: keepPreviousData });
  const d = query.data;
  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Judges" }]} title="Judges" description="Judge directory records as stored in your corpus; service terms are as published, not re-verified.">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input aria-label="Search judges" placeholder="Search judge name" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} className="max-w-sm" />
        <ExternalBadge />
        {d?.total != null ? <span className="text-[12px] text-muted-foreground">{d.total.toLocaleString()} matching</span> : null}
      </div>
      {query.error ? <ExternalError error={query.error} /> : null}
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">System</th><th className="px-3 py-2">Court</th><th className="px-3 py-2">State</th><th className="px-3 py-2">MDLs</th><th className="px-3 py-2">Source</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {query.isLoading ? <tr><td colSpan={6} className="px-3 py-3 text-muted-foreground">Loading…</td></tr> : null}
            {d?.rows.map((j) => (
              <tr key={j.id}>
                <td className="px-3 py-1.5 font-medium">{j.title}</td>
                <td className="px-3 py-1.5">{j.system ?? "—"}</td>
                <td className="max-w-[22rem] truncate px-3 py-1.5">{j.courts?.join("; ") || "—"}</td>
                <td className="px-3 py-1.5">{j.state ?? "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{j.mdl_total ?? "—"}</td>
                <td className="px-3 py-1.5">{j.source_url ? <a className="underline" href={j.source_url} target="_blank" rel="noreferrer">Open</a> : "—"}</td>
              </tr>
            ))}
            {d && d.rows.length === 0 ? <tr><td colSpan={6} className="px-3 py-3 text-muted-foreground">No judges match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <Pager offset={offset} size={d?.pageSize ?? 50} total={d?.total ?? null} onChange={setOffset} />
    </AppShell>
  );
}

export function Pager({ offset, size, total, onChange }: { offset: number; size: number; total: number | null; onChange: (o: number) => void }) {
  return (
    <div className="mt-3 flex items-center gap-2 text-[12px]">
      <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - size))}>Previous</Button>
      <span className="text-muted-foreground">{total ? `${offset + 1}–${Math.min(offset + size, total)} of ${total.toLocaleString()}` : ""}</span>
      <Button size="sm" variant="outline" disabled={total == null || offset + size >= total} onClick={() => onChange(offset + size)}>Next</Button>
    </div>
  );
}
