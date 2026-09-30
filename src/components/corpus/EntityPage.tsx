import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { CorpusLink, DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import { getEntity } from "@/lib/external/entity.functions";
import { buildEntityView, type EntitySection } from "@/lib/external/entityView";
import { fileUrl, resolveLink } from "@/lib/external/groups";

export const entityQuery = (dataset: string, id: string) =>
  queryOptions({ queryKey: ["entity", dataset, id], queryFn: async (): Promise<{ raw: Record<string, unknown> | null }> => { const r = await getEntity({ data: { dataset, id } }); return { raw: r.json ? (JSON.parse(r.json) as Record<string, unknown>) : null }; }, staleTime: 5 * 60_000 });

export function EntityPage({ dataset, id, crumbs }: { dataset: string; id: string; crumbs: { label: string; to?: string }[] }) {
  const { data } = useSuspenseQuery(entityQuery(dataset, id));
  const { aliases } = useDatasets();
  if (!data.raw) return <AppShell breadcrumbs={crumbs} title="Record not found"><p className="text-[13px] text-muted-foreground">The corpus has no record “{id}”.</p></AppShell>;
  const v = buildEntityView(data.raw);
  const key = v.facts.slice(0, 8);
  const rest = v.facts.slice(8);
  const nav = v.sections.map((s) => ({ key: s.key, label: s.label }));
  return (
    <AppShell breadcrumbs={[...crumbs, { label: v.title }]} title={v.title} {...(v.subtitle ? { description: v.subtitle } : {})}>
      <div className="mb-5 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:flex-row">
        {v.photo ? <Img src={v.photo} className="h-36 w-28 shrink-0 rounded-md border border-border object-cover" /> : null}
        {v.links.filter((l) => l.url.startsWith("/") && /seal|image|logo/i.test(l.label)).slice(0, 1).map((l) => <Img key={l.url} src={l.url} className="h-28 w-28 shrink-0 object-contain" />)}
        <dl className="grid flex-1 grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {key.map(([k, val], i) => <div key={i} className="min-w-0"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="break-words">{val}</dd></div>)}
        </dl>
      </div>
      {v.links.length ? <div className="mb-5 flex flex-wrap gap-x-4 gap-y-1">{v.links.map((l) => <CorpusLink key={l.url} url={l.url} label={l.label} aliases={aliases} />)}</div> : null}
      {nav.length > 1 ? (
        <nav aria-label="On this page" className="sticky top-0 z-10 -mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-border bg-background px-1 py-2">
          {nav.map((n) => <a key={n.key} href={`#${n.key}`} className="whitespace-nowrap rounded px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">{n.label}</a>)}
        </nav>
      ) : null}
      <div className="space-y-6">
        {rest.length ? <Section id="more" label="More details"><dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">{rest.map(([k, val], i) => <div key={i}><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="break-words">{val}</dd></div>)}</dl></Section> : null}
        {v.sections.map((s) => <SectionView key={s.key} s={s} aliases={aliases} />)}
        {v.text ? <Section id="text" label="Stored text"><p className="max-h-96 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed">{v.text}</p></Section> : null}
      </div>
      {v.empty.length ? <p className="mt-6 text-[11px] text-muted-foreground">Not recorded for this entry: {v.empty.join(", ")}.</p> : null}
      {v.technical.length ? (
        <details className="mt-4 text-[12px]">
          <summary className="cursor-pointer text-muted-foreground">Technical details and provenance</summary>
          <dl className="mt-2 grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-3 gap-y-1">{v.technical.map(([k, val], i) => <div key={i} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{val}</dd></div>)}</dl>
        </details>
      ) : null}
    </AppShell>
  );
}

function Section({ id, label, children, right }: { id: string; label: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-14">
      <div className="mb-2 flex items-baseline justify-between gap-2"><h2 className="text-[15px] font-semibold">{label}</h2>{right}</div>
      <div className="rounded-lg border border-border bg-surface p-3 shadow-card">{children}</div>
    </section>
  );
}

function SectionView({ s, aliases }: { s: EntitySection; aliases: Record<string, string> }) {
  const [all, setAll] = useState(false);
  if (s.kind === "facts") return <Section id={s.key} label={s.label}><dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">{s.facts.map(([k, v], i) => <div key={i}><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl></Section>;
  if (s.kind === "list") return <Section id={s.key} label={s.label}><ul className="list-disc space-y-1 pl-5 text-[13px]">{s.items.map((t, i) => <li key={i}>{t}</li>)}</ul></Section>;
  if (s.kind === "items") return (
    <Section id={s.key} label={`${s.label} (${s.items.length})`}>
      <ul className="divide-y divide-border text-[13px]">{s.items.slice(0, all ? undefined : 25).map((it, i) => (
        <li key={i} className="py-1.5"><div className="font-medium">{it.title}</div>{it.subtitle ? <div className="text-[11px] text-muted-foreground">{it.subtitle}</div> : null}
          {it.links.length ? <div className="flex flex-wrap gap-x-3">{it.links.map((l) => <CorpusLink key={l.url} url={l.url} label={l.label} aliases={aliases} />)}</div> : null}</li>))}</ul>
      {s.items.length > 25 && !all ? <button className="mt-2 text-[12px] text-primary" onClick={() => setAll(true)}>Show all {s.items.length}</button> : null}
    </Section>
  );
  if (s.kind === "table") return (
    <Section id={s.key} label={`${s.label} (${s.rows.length.toLocaleString()})`}>
      <div className="overflow-x-auto"><table className="w-full text-[12px]">
        {s.columns.some(Boolean) ? <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr>{s.columns.map((c, i) => <th key={i} className="px-2 py-1">{c}</th>)}</tr></thead> : null}
        <tbody className="divide-y divide-border">{s.rows.slice(0, all ? undefined : 25).map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className="max-w-[22rem] px-2 py-1 align-top">{j === 0 && s.links[i] ? <CorpusLink url={s.links[i]!} label={c} aliases={aliases} /> : <span className="break-words">{c}</span>}</td>)}</tr>))}</tbody>
      </table></div>
      {s.rows.length > 25 && !all ? <button className="mt-2 text-[12px] text-primary" onClick={() => setAll(true)}>Show all {s.rows.length.toLocaleString()}</button> : null}
    </Section>
  );
  const r = s.link ? resolveLink(s.link, aliases) : null;
  const embed = r?.kind === "dataset" ? r : null;
  return (
    <Section id={s.key} label={`${s.label}${s.total != null ? ` (${s.total.toLocaleString()})` : ""}`} right={s.link && !embed ? <CorpusLink url={s.link} label="See all" aliases={aliases} /> : null}>
      {embed ? <DatasetBrowser key={s.link!} dataset={embed.dataset} initialQ={embed.q} initialFilters={embed.filters} compact />
        : <ul className="divide-y divide-border text-[13px]">{s.sample.map((it, i) => (
          <li key={i} className="py-1.5">{it.link ? <CorpusLink url={it.link} label={it.title} aliases={aliases} /> : <span className="font-medium">{it.title}</span>}{it.subtitle ? <span className="ml-2 text-[11px] text-muted-foreground">{it.subtitle}</span> : null}</li>))}</ul>}
    </Section>
  );
}

function Img({ src, className }: { src: string; className: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return <img src={src.startsWith("/") ? fileUrl(src) : src} alt="" className={className} onError={() => setBad(true)} />;
}

export function EntityError({ error }: { error: Error }) {
  return <p role="alert" className="p-6 text-[13px] text-destructive">Could not load this record: {error.message}</p>;
}
