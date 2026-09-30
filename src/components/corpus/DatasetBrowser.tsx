import { sectionOf } from "@/lib/external/groups";
import { Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { getRecordDetail, listDatasets, queryDataset, type DatasetInfo } from "@/lib/external/catalog.functions";
import { fileUrl, normalizeItem, resolveLink, type NormItem } from "@/lib/external/groups";
import { datasetDisplayName, displayValue, fieldLabel } from "@/lib/external/domainRegistry";

const ENTITY_ROUTES: Record<string, "/courts/$id" | "/judges/$id" | "/matters/$id"> = { court_spine: "/courts/$id", judges: "/judges/$id", mdls: "/matters/$id" };

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
  const [open, setOpen] = useState<NormItem | null>(null);
  const navigate = useNavigate();
  const openRow = (i: NormItem) => {
    const page = ENTITY_ROUTES[dataset];
    if (page) navigate({ to: page, params: { id: i.id.replace(/^mdl:/, "") } });
    else if (sectionOf(dataset) === "law") navigate({ to: "/law/provision/$id", params: { id: i.id } });
    else setOpen(i);
  };
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
              <tr key={i.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openRow(i)}>
                {hasPhoto ? <td className="px-3 py-1">{i.photo ? <Photo src={i.photo} className="size-8 rounded" /> : null}</td> : null}
                <td className="max-w-[30rem] px-3 py-1.5">
                  <div className="truncate font-medium" title={i.title}>{i.title}</div>
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
      <RecordDrawer item={open} dataset={dataset} onClose={() => setOpen(null)} aliases={ds.aliases} />
    </div>
  );
}

export function RecordDrawer({ item, dataset, onClose, aliases }: { item: ({ id: string; title: string } & { [K in keyof NormItem]?: NormItem[K] | undefined }) | null; dataset: string | null; onClose: () => void; aliases: Record<string, string> }) {
  const fn = useServerFn(getRecordDetail);
  const q = useQuery({ queryKey: ["corpus-detail", dataset, item?.id], queryFn: () => fn({ data: { id: item!.id, dataset } }), enabled: !!item });
  const d = q.data;
  const photo = d?.photo ?? item?.photo ?? null;
  const links = [...(d?.links ?? []), ...(item?.links ?? [])].filter((l, i, a) => a.findIndex((x) => x.url === l.url) === i);
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="eyebrow">{dataset ? datasetDisplayName(dataset, null) : "Record"}</div>
          <SheetTitle className="text-left text-lg leading-snug">{d?.title ?? item?.title}</SheetTitle>
          {d?.subtitle ?? item?.subtitle ? <p className="text-[12px] text-muted-foreground">{d?.subtitle ?? item?.subtitle}</p> : null}
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6 text-[13px]">
          {photo ? <Photo src={photo} className="h-40 w-32 rounded-md border border-border" /> : null}
          {links.filter((l) => l.url.startsWith("/") && /image|seal|photo|portrait/i.test(l.label)).slice(0, 4).map((l) => (
            <img key={l.url} src={fileUrl(l.url)} alt={l.label} className="max-h-40 rounded-md border border-border bg-surface object-contain p-1" />
          ))}
          {item?.badges?.length ? <div className="flex flex-wrap gap-1">{item.badges.map((b) => <Badge key={b} variant="secondary">{b}</Badge>)}</div> : null}
          {q.isLoading ? <p className="text-muted-foreground">Loading detail…</p> : null}
          {q.error ? <ExternalError error={q.error} /> : null}
          {item && dataset ? <Link to="/records/$dataset/$id" params={{ dataset, id: item.id }} className="inline-block text-[12px] font-medium text-primary hover:underline">Open full page →</Link> : null}
          {d?.qualification ? <details className="text-[12px] text-muted-foreground"><summary className="cursor-pointer">About this record</summary><p className="mt-1 leading-relaxed">{d.qualification}</p></details> : null}
          {(d?.facts.length ? d.facts : Object.entries(item?.cells ?? {})).length ? (
            <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-3 gap-y-1">
              {(d?.facts.length ? d.facts : Object.entries(item?.cells ?? {})).map(([k, v], i) => (
                <div key={`${k}-${i}`} className="contents"><dt className="text-muted-foreground">{fieldLabel(k)}</dt><dd className="break-words">{displayValue(v)}</dd></div>
              ))}
            </dl>
          ) : null}
          {links.length ? (
            <div><div className="eyebrow mb-1">Links</div><ul className="space-y-1">{links.map((l) => <li key={l.url}><CorpusLink url={l.url} label={l.label} aliases={aliases} /></li>)}</ul></div>
          ) : null}
          {item?.sourceUrl && !links.some((l) => l.url === item.sourceUrl) ? <CorpusLink url={item.sourceUrl} label="Open source" aliases={aliases} /> : null}
          {d?.sections.map((s, si) => (
            <div key={si}>
              <div className="eyebrow mb-1">{s.title ?? `Related (${s.items.length})`}</div>
              <ul className="space-y-2">
                {s.items.slice(0, 50).map((raw, ii) => {
                  const n = normalizeItem(raw);
                  return (
                    <li key={ii} className="rounded border border-border p-2">
                      <div className="font-medium">{n.title}</div>
                      {n.subtitle ? <div className="text-[11px] text-muted-foreground">{n.subtitle}</div> : null}
                      {n.links.length ? <div className="mt-1 flex flex-wrap gap-x-3">{n.links.map((l) => <CorpusLink key={l.url} url={l.url} label={l.label} aliases={aliases} />)}</div> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {d?.text ? (
            <div><div className="eyebrow mb-1">Stored text{d.textTruncated ? " (preview)" : ""}</div><p className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/30 p-2 text-[12px] leading-relaxed">{d.text}</p></div>
          ) : null}
          {!q.isLoading && !d && !q.error ? <p className="text-[12px] text-muted-foreground">The corpus has no separate detail for this record; the listing fields are shown above.</p> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
