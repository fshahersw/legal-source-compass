import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { listLawCollections, listLawNodes, listLawProvisions } from "@/lib/external/corpus.functions";
import { Link } from "@tanstack/react-router";
import { keepPreviousData } from "@tanstack/react-query";

export function LawOutline() {
  const collFn = useServerFn(listLawCollections);
  const colls = useQuery({ queryKey: ["law-collections"], queryFn: () => collFn() });
  const [sel, setSel] = useState<{ state: string; kind: string } | null>(null);
  const allStates = useMemo(() => [...new Set((colls.data ?? []).map((c) => c.state))], [colls.data]);
  const [scope, setScope] = useState<string | null>(null);
  const states = scope ? [scope] : [];
  return (
    <div>
      {colls.error ? <ExternalError error={colls.error} /> : null}
      {colls.isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-border bg-surface shadow-card">
          <div className="border-b border-border px-3 py-2">
            <div className="eyebrow mb-1">1 · Jurisdiction</div>
            <div className="flex flex-wrap gap-1">
              {allStates.map((s) => (
                <button key={s} onClick={() => { setScope(s); setSel(null); }} className={`rounded border px-1.5 py-0.5 text-[12px] ${scope === s ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>{s === "FEDERAL" ? "Federal" : s}</button>
              ))}
            </div>
          </div>
          {scope ? <div className="eyebrow px-3 pt-2">2 · Type of law</div> : <p className="px-3 py-2 text-[12px] text-muted-foreground">Choose Federal or a state, then a type of law.</p>}
          {states.map((s) => (
            <div key={s} className="border-b border-border px-3 py-2">
              <div className="eyebrow mb-1">{s}</div>
              <div className="flex flex-wrap gap-1">
                {(colls.data ?? []).filter((c) => c.state === s).map((c) => (
                  <button key={c.kind} onClick={() => setSel({ state: s, kind: c.kind })}
                    className={`rounded border px-1.5 py-0.5 text-[12px] ${sel?.state === s && sel.kind === c.kind ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
                    {c.kind.replace(/_/g, " ")} · {c.provisions.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
          {sel ? (<><h2 className="eyebrow mb-2">{sel.state} · {sel.kind.replace(/_/g, " ")}</h2><LawLevel state={sel.state} kind={sel.kind} parent={0} key={`${sel.state}-${sel.kind}`} /></>)
            : <p className="text-[13px] text-muted-foreground">Pick a collection to browse its outline.</p>}
        </div>
      </div>
    </div>
  );
}

export function LawLevel({ state, kind, parent }: { state: string; kind: string; parent: number }) {
  const fn = useServerFn(listLawNodes);
  const q = useQuery({ queryKey: ["law-nodes", state, kind, parent], queryFn: () => fn({ data: { state, kind, parent } }) });
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (q.error) return <ExternalError error={q.error} />;
  if (q.isLoading) return <p className="pl-2 text-[12px] text-muted-foreground">Loading…</p>;
  if (!q.data?.length) return <p className="pl-2 text-[12px] text-muted-foreground">No outline entries.</p>;
  return (
    <ul className="space-y-0.5 text-[13px]">
      {q.data.map((n) => (
        <li key={n.id}>
          <button
            disabled={n.total === 0}
            onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}
            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted disabled:hover:bg-transparent"
          >
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${n.total > 0 ? "" : "opacity-0"} ${open.has(n.id) ? "rotate-90" : ""}`} />
            <span className="flex-1">{n.label}</span>
            <span className="tabular-nums text-[11px] text-muted-foreground">{n.total.toLocaleString()}</span>
          </button>
          {open.has(n.id) ? <div className="ml-4 border-l border-border pl-2">{n.has_children ? <LawLevel state={state} kind={kind} parent={n.id} /> : <LawProvisions node={n.id} total={n.total} />}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** Provisions under a lowest-level heading; each opens its own page with saved text and/or the official link. */
function LawProvisions({ node, total }: { node: number; total: number }) {
  const fn = useServerFn(listLawProvisions);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const rows = useQuery({ queryKey: ["law-prov", node, offset], queryFn: () => fn({ data: { node, offset, limit: 50 } }), placeholderData: keepPreviousData });
  if (rows.error) return <ExternalError error={rows.error} />;
  const t = q.trim().toLowerCase();
  const list = (rows.data ?? []).filter((r) => !t || `${r.citation ?? ""} ${r.title ?? ""}`.toLowerCase().includes(t));
  return (
    <div className="py-1">
      <div className="mb-1 flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter this page" className="h-7 w-48 rounded-md border border-input bg-background px-2 text-[12px]" />
        <span className="text-[11px] text-muted-foreground">{rows.isLoading ? "Loading…" : `${offset + 1}–${Math.min(offset + 50, total)} of ${total.toLocaleString()}`}</span>
      </div>
      <ul className="divide-y divide-border">
        {list.map((r, i) => (
          <li key={r.id}>
            <Link to="/law/provision/$id" params={{ id: r.id }} search={{ dataset: "open_us_law", node, i: offset + i }} className="flex items-baseline gap-2 rounded px-1 py-1 hover:bg-muted">
              {r.citation ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r.citation}</span> : null}
              <span className="min-w-0 flex-1 truncate">{r.title ?? r.id}</span>
              {r.status ? <span className="shrink-0 text-[11px] text-muted-foreground">{r.status.replace(/_/g, " ")}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      {total > 50 ? (
        <div className="mt-1 flex gap-2 text-[12px]">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">Previous</button>
          <button disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">Next</button>
        </div>
      ) : null}
    </div>
  );
}
