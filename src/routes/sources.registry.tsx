import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { Input } from "@/components/ui/input";
import { pageHead } from "@/lib/corpus/head";
import { countBy, humanize, jurisdictionLabel, statusLabel, isReachable, type RegistryEntry } from "@/lib/atlas/registry";
import { useRegistry } from "@/lib/atlas/useRegistry";

type S = { j?: string | undefined; layer?: string | undefined; cat?: string | undefined; q?: string | undefined };
const str = (v: unknown) => (typeof v === "string" && v.length <= 120 ? v : undefined);

export const Route = createFileRoute("/sources/registry")({
  validateSearch: (s: Record<string, unknown>): S => ({ j: str(s["j"]), layer: str(s["layer"]), cat: str(s["cat"]), q: str(s["q"]) }),
  head: () => pageHead("Source registry", "Official and secondary legal sources organized by jurisdiction, layer and record category."),
  component: RegistryPage,
});

function RegistryPage() {
  const { j, layer, cat, q } = Route.useSearch();
  const navigate = useNavigate({ from: "/sources/registry" });
  const set = (p: Partial<S>) => navigate({ search: (prev) => ({ ...prev, ...p }) });
  const reg = useRegistry();
  const all = reg.data?.entries ?? [];
  const children = useMemo(() => {
    const m = new Map<string, RegistryEntry[]>();
    for (const e of all) if (e.parent_id) m.set(e.parent_id, [...(m.get(e.parent_id) ?? []), e]);
    return m;
  }, [all]);
  const inJ = j ? all.filter((e) => e.jurisdiction === j) : all;
  const inLayer = layer ? inJ.filter((e) => e.layer === layer) : inJ;
  const inCat = cat != null ? inLayer.filter((e) => e.record_category === cat) : inLayer;
  const term = (q ?? "").toLowerCase().trim();
  const rows = term ? inCat.filter((e) => `${e.name} ${e.url} ${e.description} ${e.section}`.toLowerCase().includes(term)) : inCat.filter((e) => !e.parent_id || !all.some((p) => p.id === e.parent_id && inCat.includes(p)));
  const [limit, setLimit] = useState(100);

  const crumbs = [{ label: "Atlas", to: "/" }, { label: "Sources", to: "/sources/library" }, { label: "Registry", to: "/sources/registry" }];
  if (j) crumbs.push({ label: jurisdictionLabel(j), to: "" });
  return (
    <AppShell breadcrumbs={crumbs.map((c) => (c.to ? c : { label: c.label }))} title={j ? `${jurisdictionLabel(j)} sources` : "Source registry"} description={`${all.length.toLocaleString()} registry entries · narrow by jurisdiction, then layer, then record type`}>
      {reg.error ? <p className="text-[13px] text-destructive">{String(reg.error)}</p> : null}
      {reg.isLoading ? <p className="text-[13px] text-muted-foreground">Loading registry…</p> : null}
      <div className="grid gap-5 lg:grid-cols-[15rem_1fr]">
        <aside className="max-h-[75vh] overflow-auto rounded-lg border border-border bg-surface p-2 shadow-card">
          <div className="eyebrow mb-1 px-1">Jurisdiction</div>
          <Choice active={!j} onClick={() => set({ j: undefined, layer: undefined, cat: undefined })} label="All" count={all.length} />
          {countBy(all, (e) => e.jurisdiction).sort((a, b) => jurisdictionLabel(a[0]).localeCompare(jurisdictionLabel(b[0]))).map(([code, n]) => (
            <Choice key={code} active={j === code} onClick={() => set({ j: code, layer: undefined, cat: undefined })} label={jurisdictionLabel(code)} count={n} />
          ))}
        </aside>
        <div className="min-w-0">
          <Chips title="Layer" items={countBy(inJ, (e) => e.layer)} active={layer} onPick={(v) => set({ layer: v, cat: undefined })} />
          <Chips title="Record type" items={countBy(inLayer, (e) => e.record_category)} active={cat} onPick={(v) => set({ cat: v })} />
          <div className="mb-3 flex items-center gap-3">
            <Input aria-label="Search registry" placeholder="Search names, URLs, descriptions" defaultValue={q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} className="h-8 max-w-sm text-[13px]" />
            <span className="text-[12px] text-muted-foreground">{inCat.length.toLocaleString()} sources · {inCat.filter(isReachable).length.toLocaleString()} answered 2xx at last registry check</span>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
            {rows.slice(0, limit).map((e) => <Row key={e.id} e={e} kids={children.get(e.id) ?? []} />)}
            {!rows.length && reg.data ? <li className="p-3 text-[13px] text-muted-foreground">No registry sources match.</li> : null}
          </ul>
          {rows.length > limit ? <button className="mt-2 text-[12px] text-primary" onClick={() => setLimit(limit + 200)}>Show more ({(rows.length - limit).toLocaleString()} remaining)</button> : null}
        </div>
      </div>
    </AppShell>
  );
}

function Choice({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return <button onClick={onClick} className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[12px] ${active ? "bg-muted font-semibold" : "hover:bg-muted/60"}`}><span className="truncate">{label}</span><span className="text-muted-foreground">{count.toLocaleString()}</span></button>;
}

function Chips({ title, items, active, onPick }: { title: string; items: [string, number][]; active: string | undefined; onPick: (v: string | undefined) => void }) {
  if (items.length <= 1 && !active) return null;
  return (
    <div className="mb-3">
      <div className="eyebrow mb-1">{title}</div>
      <div className="flex flex-wrap gap-1">
        <button onClick={() => onPick(undefined)} className={`rounded border px-1.5 py-0.5 text-[12px] ${active == null ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>All</button>
        {items.map(([v, n]) => <button key={v} onClick={() => onPick(v)} className={`rounded border px-1.5 py-0.5 text-[12px] ${active === v ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>{humanize(v)} · {n.toLocaleString()}</button>)}
      </div>
    </div>
  );
}

function Row({ e, kids }: { e: RegistryEntry; kids: RegistryEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium hover:underline"><span className="truncate">{e.name || e.url}</span><ExternalLink className="size-3 shrink-0" /></a>
          <div className="truncate text-[11px] text-muted-foreground">{e.domain} · {humanize(e.record_category || e.layer)} · {e.content_kind.toUpperCase()} · {humanize(e.source_type)}</div>
          {e.description ? <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{e.description}</p> : null}
        </div>
        <span className={`shrink-0 text-[11px] ${isReachable(e) ? "text-muted-foreground" : "text-destructive"}`}>{statusLabel(e)}</span>
      </div>
      {kids.length ? <button className="mt-1 text-[12px] text-primary" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} {kids.length} linked sub-sources</button> : null}
      {open ? <ul className="mt-1 space-y-0.5 border-l border-border pl-3">{kids.map((k) => <li key={k.id}><a href={k.url} target="_blank" rel="noreferrer" className="text-[12px] hover:underline">{k.name || k.url}</a> <span className="text-[11px] text-muted-foreground">{k.content_kind}</span></li>)}</ul> : null}
    </li>
  );
}
