import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { Input } from "@/components/ui/input";
import { ExternalBadge, ExternalError } from "@/components/corpus/ExternalBadge";
import { listMdls } from "@/lib/external/corpus.functions";
import { pageHead } from "@/lib/corpus/head";
import { Pager } from "./judges";

export const Route = createFileRoute("/mdls")({
  head: () => pageHead("MDLs", "JPML multidistrict litigation records from the connected corpus, with the JPML report's own action counts."),
  component: MdlsPage,
});

function judgeName(j: unknown) {
  return j && typeof j === "object" && "name_as_printed" in j ? String((j as { name_as_printed: unknown }).name_as_printed) : "—";
}

function MdlsPage() {
  const fn = useServerFn(listMdls);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ["mdls", q, offset], queryFn: () => fn({ data: { q, state: "", offset } }), placeholderData: keepPreviousData });
  const d = query.data;
  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "MDLs" }]} title="Multidistrict litigation" description="Action counts are as listed in the JPML report stored in your corpus, not recalculated here.">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input aria-label="Search MDLs" placeholder="Search MDL number or title" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} className="max-w-sm" />
        <ExternalBadge />
        {d?.total != null ? <span className="text-[12px] text-muted-foreground">{d.total.toLocaleString()} matching</span> : null}
      </div>
      {query.error ? <ExternalError error={query.error} /> : null}
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">MDL</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Court</th><th className="px-3 py-2">Transferee judge</th><th className="px-3 py-2 text-right">JPML actions</th><th className="px-3 py-2 text-right">Pending</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {query.isLoading ? <tr><td colSpan={7} className="px-3 py-3 text-muted-foreground">Loading…</td></tr> : null}
            {d?.rows.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-1.5 font-mono">{m.id}</td>
                <td className="max-w-[28rem] truncate px-3 py-1.5" title={m.title}>{m.title}</td>
                <td className="px-3 py-1.5">{m.status ?? "—"}</td>
                <td className="px-3 py-1.5">{m.court_name ?? "—"}</td>
                <td className="px-3 py-1.5">{judgeName(m.transferee_judge)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{m.total_actions?.toLocaleString() ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{m.actions_pending?.toLocaleString() ?? "—"}</td>
              </tr>
            ))}
            {d && d.rows.length === 0 ? <tr><td colSpan={7} className="px-3 py-3 text-muted-foreground">No MDLs match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <Pager offset={offset} size={d?.pageSize ?? 50} total={d?.total ?? null} onChange={setOffset} />
    </AppShell>
  );
}
