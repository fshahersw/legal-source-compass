import { createFileRoute } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalBadge, ExternalError } from "@/components/corpus/ExternalBadge";
import { EXTRA_TABLES, queryTable, type ExtraTable } from "@/lib/external/tables.functions";
import { fieldLabel } from "@/lib/external/domainRegistry";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/data/tables/$table")({
  head: ({ params }) => pageHead(EXTRA_TABLES[params.table as ExtraTable]?.label ?? "Corpus table", "Supporting corpus table from the connected database, read-only."),
  component: TablePage,
  notFoundComponent: () => <p className="p-6 text-[13px]">Table not found.</p>,
});

function cell(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string") return v.length > 140 ? v.slice(0, 140) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return Array.isArray(v) ? `${v.length} items` : "…";
}

function TablePage() {
  const { table } = Route.useParams();
  const info = EXTRA_TABLES[table as ExtraTable];
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [offset, setOffset] = useState(0);
  const res = useQuery({ queryKey: ["xtable", table, term, offset], enabled: !!info, placeholderData: keepPreviousData, queryFn: () => queryTable({ data: { table: table as ExtraTable, q: term, offset } }) });
  const rows = res.data ? (JSON.parse(res.data.json) as Record<string, unknown>[]) : [];
  const cols = rows.length ? Object.keys(rows[0]!).filter((k) => rows.some((r) => typeof r[k] !== "object" || r[k] == null)).slice(0, 7) : [];
  const [open, setOpen] = useState<number | null>(null);
  if (!info) return <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Data catalog", to: "/data" }]} title="Table not found"><p className="text-[13px]">No such table.</p></AppShell>;
  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Data catalog", to: "/data" }, { label: "Supporting tables" }, { label: info.label }]} title={info.label} description={res.data?.total != null ? `${res.data.total.toLocaleString()} rows` : ""}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <ExternalBadge />
        <form onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q); }} className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${fieldLabel(info.search).toLowerCase()}`} className="h-8 w-64 rounded-md border border-border bg-background px-2 text-[13px]" />
          <button className="h-8 rounded-md border border-border px-3 text-[12px]">Search</button>
        </form>
      </div>
      {res.error ? <ExternalError error={res.error as Error} /> : null}
      {res.isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr>{cols.map((c) => <th key={c} className="px-2 py-1.5">{fieldLabel(c)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <>
                  <tr key={i} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(open === i ? null : i)}>{cols.map((c) => <td key={c} className="max-w-[20rem] px-2 py-1.5 align-top break-words">{cell(r[c])}</td>)}</tr>
                  {open === i ? <tr key={`d${i}`}><td colSpan={cols.length} className="bg-muted/30 px-3 py-2"><dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">{Object.entries(r).map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[11px] text-muted-foreground">{fieldLabel(k)}</dt><dd className="break-words">{typeof v === "object" && v ? JSON.stringify(v).slice(0, 600) : cell(v)}</dd></div>)}</dl></td></tr> : null}
                </>
              ))}
            </tbody>
          </table>
        </div>
      ) : !res.isLoading && !res.error ? <p className="text-[13px] text-muted-foreground">No rows match.</p> : null}
      <div className="mt-3 flex items-center gap-2 text-[12px]">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="rounded border border-border px-2 py-1 disabled:opacity-40">Previous</button>
        <span className="text-muted-foreground">Rows {offset + 1}–{offset + rows.length}</span>
        <button disabled={rows.length < 50} onClick={() => setOffset(offset + 50)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Next</button>
      </div>
    </AppShell>
  );
}
