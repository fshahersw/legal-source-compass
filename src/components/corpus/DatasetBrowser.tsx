import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { listDatasets, queryDataset, type DatasetInfo } from "@/lib/external/catalog.functions";
import { fileUrl, normalizeItem, resolveLink, recordDestination } from "@/lib/external/groups";
import { datasetDisplayName, displayValue, fieldLabel } from "@/lib/external/domainRegistry";


export function useDatasets() {
  const fn = useServerFn(listDatasets);
  const q = useQuery({ queryKey: ["corpus-datasets"], queryFn: () => fn(), staleTime: 10 * 60_000 });
  const aliases = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of q.data ?? []) {
      m[d.id] = d.id;
      for (const a of d.aliases) m[a] = d.id;
    }
    return m;
  }, [q.data]);
  return { ...q, aliases };
}

/** Renders a corpus link as an in-app link, a file link or an external link. Unmapped links are labelled, not hidden. */
export function CorpusLink({ url, label, aliases }: { url: string; label: string; aliases: Record<string, string> }) {
  const r = resolveLink(url, aliases);
  const cls = "inline-flex items-center gap-1 text-[12px] text-primary underline-offset-2 hover:underline";
  if (r.kind === "external") return <a className={cls} href={r.href} target="_blank" rel="noreferrer">{label}<ExternalLink className="size-3" /></a>;
  if (r.kind === "file") return <a className={cls} href={r.href} target="_blank" rel="noreferrer"><FileText className="size-3" />{label}</a>;
  if (r.kind === "provision") return <Link className={cls} to="/law/provision/$id" params={{ id: r.id }} search={{ dataset: r.dataset }}>{label}</Link>;
  if (r.kind === "entity") {
    if (r.type === "mdl") return <Link className={cls} to="/matters/$id" params={{ id: r.id }}>{label}</Link>;
    if (r.type === "court") return <Link className={cls} to="/courts/$id" params={{ id: r.id }}>{label}</Link>;
    return <Link className={cls} to="/judges/$id" params={{ id: r.id }}>{label}</Link>;
  }
  if (r.kind === "search") return <Link className={cls} to="/search" search={{ q: r.q }}>{label}</Link>;
  if (r.kind === "dataset") return <Link className={cls} to="/data/$dataset" params={{ dataset: r.dataset }} search={{ q: r.q || undefined, f: Object.keys(r.filters).length ? r.filters : undefined }}>{label}</Link>;
  return <span className="text-[12px] text-muted-foreground" title={r.raw}>{label} (link not mapped in this app)</span>;
}

function Photo({ src, className }: { src: string; className: string }) {
  const [bad, setBad] = useState(false);
  const href = src.startsWith("/") ? fileUrl(src) : src;
  if (bad) return <div className={`${className} grid place-items-center bg-muted text-[9px] text-muted-foreground`}>no file</div>;
  return <img src={href} alt="" loading="lazy" onError={() => setBad(true)} className={`${className} object-cover`} />;
}

export function DatasetBrowser({
  dataset,
  initialQ = "",
  initialFilters = {},
  onStateChange,
  compact = false,
}: {
  compact?: boolean;
  dataset: string;
  initialQ?: string;
  initialFilters?: Record<string, string>;
  onStateChange?: (s: { q: string; filters: Record<string, string> }) => void;
}) {
  const ds = useDatasets();
  const info: DatasetInfo | undefined = ds.data?.find((d) => d.id === dataset);
  const fn = useServerFn(queryDataset);
  const [q, setQ] = useState(initialQ);
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ["corpus-ds", dataset, q, filters, offset],
    queryFn: () => fn({ data: { dataset, q, filters, offset } }),
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => (query.data?.items ?? []).map((i) => normalizeItem(i)), [query.data]);
  const columns = useMemo(() => {
    if (info?.columns.length) return info.columns.filter((c) => !["title", "name"].includes(c.key)).map((c) => ({ ...c, label: c.label && c.label !== c.key ? c.label : fieldLabel(c.key) }));
    const keys = new Set<string>();
    for (const i of items.slice(0, 20)) for (const k of Object.keys(i.cells)) keys.add(k);
    return [...keys].slice(0, 5).map((k) => ({ key: k, label: fieldLabel(k) }));
  }, [info, items]);
  const hasPhoto = items.some((i) => i.photo);
  const update = (nq: string, nf: Record<string, string>) => {
    setQ(nq); setFilters(nf); setOffset(0); onStateChange?.({ q: nq, filters: nf });
  };
  const d = query.data;
  const total = d?.total ?? null;

  return (
    <div>
      {info?.ready === false ? <p role="status" className="mb-3 rounded-lg border border-border bg-muted/50 p-3 text-[13px]">This collection is imported but has not been cleared for publication. Its imported count is an inventory measure; records are unavailable in the published listing.</p> : null}
      {info?.qualification && !compact ? <details className="mb-3 max-w-4xl text-[12px] text-muted-foreground"><summary className="cursor-pointer">About this data</summary><p className="mt-1 leading-relaxed">{info.qualification}</p></details> : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input aria-label={`Search ${datasetDisplayName(dataset, info?.label)}`} placeholder={`Search ${datasetDisplayName(dataset, info?.label).toLowerCase()}`} value={q} onChange={(e) => update(e.target.value, filters)} className="h-8 max-w-xs text-[13px]" />
        {info?.filters.map((f) => (
          <select
            key={f.name}
            aria-label={f.label}
            value={filters[f.name] ?? ""}
            onChange={(e) => { const nf = { ...filters }; if (e.target.value) nf[f.name] = e.target.value; else delete nf[f.name]; update(q, nf); }}
            className="h-8 max-w-[14rem] rounded-md border border-input bg-surface px-2 text-[12px]"
          >
            <option value="">{f.label}: all</option>
            {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}{o.count != null ? ` (${o.count.toLocaleString()})` : ""}</option>)}
          </select>
        ))}
        {Object.entries(filters).filter(([k]) => !info?.filters.some((f) => f.name === k)).map(([k, v]) => (
          <Badge key={k} variant="secondary" className="gap-1">{k}: {v}<button aria-label={`Clear ${k}`} onClick={() => { const nf = { ...filters }; delete nf[k]; update(q, nf); }}>×</button></Badge>
        ))}
        <span className="ml-auto text-[12px] text-muted-foreground">
          {total != null ? `${total.toLocaleString()}${d?.capped ? "+" : ""} matching` : info?.records != null ? `${info.records.toLocaleString()} imported records` : ""}
        </span>
      </div>
      {query.error ? <ExternalError error={query.error} /> : null}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {hasPhoto ? <th className="w-10 px-3 py-2" /> : null}
              <th className="px-3 py-2">Title</th>
              {columns.map((c) => <th key={c.key} className="px-3 py-2">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {query.isLoading ? <tr><td colSpan={columns.length + 2} className="px-3 py-3 text-muted-foreground">Loading…</td></tr> : null}
            {items.map((i) => (
              <tr key={i.id} className="hover:bg-muted/50">
                {hasPhoto ? <td className="px-3 py-1">{i.photo ? <Photo src={i.photo} className="size-8 rounded" /> : null}</td> : null}
                <td className="max-w-[30rem] px-3 py-1.5">
                  <CorpusRecordLink dataset={dataset} id={i.id} className="block truncate font-medium text-primary hover:underline">{i.title}</CorpusRecordLink>
                  {i.subtitle ? <div className="truncate text-[11px] text-muted-foreground">{i.subtitle}</div> : null}
                </td>
                {columns.map((c) => <td key={c.key} className="max-w-[16rem] truncate px-3 py-1.5" title={i.cells[c.key]}>{displayValue(i.cells[c.key])}</td>)}
              </tr>
            ))}
            {d && items.length === 0 ? <tr><td colSpan={columns.length + 2} className="px-3 py-3 text-muted-foreground">No records match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12px]">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
        <span className="text-muted-foreground">{items.length ? `${offset + 1}–${offset + items.length}` : ""}</span>
        <Button size="sm" variant="outline" disabled={items.length < 50 || (total != null && offset + 50 >= total)} onClick={() => setOffset(offset + 50)}>Next</Button>
      </div>
    </div>
  );
}


/** Permanent, copyable links use the same exact collection mapping in listings and search. */
export function CorpusRecordLink({ dataset, id, className, children }: { dataset: string; id: string; className?: string; children: React.ReactNode }) {
  const r = recordDestination(dataset, id);
  if (r.kind === "court") return <Link className={className} to="/courts/$id" params={{ id: r.id }}>{children}</Link>;
  if (r.kind === "judge") return <Link className={className} to="/judges/$id" params={{ id: r.id }}>{children}</Link>;
  if (r.kind === "mdl") return <Link className={className} to="/matters/$id" params={{ id: r.id }}>{children}</Link>;
  if (r.kind === "provision") return <Link className={className} to="/law/provision/$id" params={{ id: r.id }} search={{ dataset: r.dataset }}>{children}</Link>;
  return <Link className={className} to="/records/$dataset/$id" params={{ dataset: r.dataset, id: r.id }}>{children}</Link>;
}
