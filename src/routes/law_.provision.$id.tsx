import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { pageHead } from "@/lib/corpus/head";
import { stateByName } from "@/lib/corpus/geo";
import { getLawProvision, listLawProvisions } from "@/lib/external/corpus.functions";
import { formatLawText, markerDepth } from "@/lib/external/formatLawText";
import { kindLabel } from "@/lib/external/lawTree";

type S = { node?: number | undefined; i?: number | undefined };
const num = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN; return Number.isInteger(n) && n >= 0 && n < 1e9 ? n : undefined; };
const provQuery = (id: string) => queryOptions({ queryKey: ["law-provision", id], queryFn: () => getLawProvision({ data: { id } }), staleTime: Infinity });

export const Route = createFileRoute("/law_/provision/$id")({
  validateSearch: (s: Record<string, unknown>): S => ({ node: num(s["node"]), i: num(s["i"]) }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(provQuery(params.id)),
  head: ({ loaderData }) => {
    const t = [loaderData?.citation, loaderData?.title].filter(Boolean).join(" — ") || "Law provision";
    return pageHead(t, `${t}: saved text and official source link.`);
  },
  component: ProvisionPage,
  errorComponent: () => <p className="p-6 text-[13px]">This provision could not be loaded. Try again shortly.</p>,
});

function ProvisionPage() {
  const { id } = Route.useParams();
  const { node, i } = Route.useSearch();
  const { data: p } = useSuspenseQuery(provQuery(id));
  const listFn = useServerFn(listLawProvisions);
  const idx = i ?? null;
  const around = useQuery({
    queryKey: ["law-prov-around", node, idx],
    enabled: node != null && idx != null,
    queryFn: () => listFn({ data: { node: Number(node), offset: Math.max(0, idx! - 1), limit: 3 } }),
  });
  const [copied, setCopied] = useState(false);
  const [copiedCite, setCopiedCite] = useState(false);

  if (!p) return <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Law & regulation", to: "/law" }, { label: "Not found" }]} title="Provision not found"><p className="text-[13px] text-muted-foreground">The corpus has no record “{id}”.</p></AppShell>;

  const usps = p.state ? stateByName.get(p.state)?.usps : undefined;
  const federal = !usps;
  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [{ label: "Atlas", to: "/" }, { label: "Law & regulation", to: "/law" }];
  crumbs.push(federal ? { label: "Federal", to: "/law", search: { scope: "federal" } } : { label: p.state!, to: "/law", search: { scope: "states", state: usps! } });
  if (p.kind) crumbs.push({ label: kindLabel(p.kind), to: "/law", search: federal ? { scope: "federal", kind: p.kind } : { scope: "states", state: usps!, kind: p.kind } });
  crumbs.push({ label: p.citation ?? "Provision" });

  const cite = p.citation ?? (/^cfr:\d+:/.test(p.id) ? p.id.replace(/^cfr:(\d+):/, "$1 CFR ") : null);
  const paras = p.text ? formatLawText(p.text) : [];
  const rows = around.data ?? [];
  const pos = idx != null ? idx - Math.max(0, idx - 1) : -1;
  const prev = pos > 0 ? rows[pos - 1] : undefined;
  const next = pos >= 0 ? rows[pos + 1] : undefined;
  const nav = (r: { id: string; citation: string | null; title: string | null } | undefined, d: number, label: string) =>
    r ? <Link to="/law/provision/$id" params={{ id: r.id }} search={{ node, i: idx! + d }} className="min-w-0 truncate rounded border border-border px-2 py-1 text-[12px] hover:bg-muted">{label} {r.citation ?? r.title}</Link> : <span />;

  return (
    <AppShell breadcrumbs={crumbs} title={p.title ?? p.citation ?? "Provision"} description={[p.citation, p.state ?? "Federal", p.kind ? kindLabel(p.kind) : null, p.status?.replace(/_/g, " ")].filter(Boolean).join(" · ")}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {p.sourceUrl ? (
          <Button asChild size="sm"><a href={p.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 size-3.5" />Official source</a></Button>
        ) : null}
        {p.text ? (
          <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(paras.join("\n\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy className="mr-1 size-3.5" />{copied ? "Copied" : "Copy text"}</Button>
        ) : null}
          {cite ? <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(cite); setCopiedCite(true); setTimeout(() => setCopiedCite(false), 1500); }}><Copy className="mr-1 size-3.5" />{copiedCite ? "Copied" : "Copy citation"}</Button> : null}
          {(() => { const m = /(\d+)\s*C\.?F\.?R\.?\s*(?:§+\s*)?(\d+)(?:\.(\d+[a-z]?))?/i.exec(cite ?? ""); if (!m || p.state) return null; const u = m[3] ? `https://www.ecfr.gov/current/title-${m[1]}/section-${m[2]}.${m[3]}` : `https://www.ecfr.gov/current/title-${m[1]}/part-${m[2]}`; return <>
            <Button asChild size="sm" variant="outline"><a href={u} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 size-3.5" />Current eCFR</a></Button>
            <Button asChild size="sm" variant="outline"><Link to="/data/$dataset" params={{ dataset: "federal_register_history" }} search={{ q: `${m[1]} CFR ${m[2]}` }}>Federal Register for part {m[2]} →</Link></Button>
          </>; })()}
        <span className="text-[12px] text-muted-foreground">{p.text && p.sourceUrl ? "Text saved · official source linked" : p.text ? "Text saved · no source link recorded" : p.sourceUrl ? "No saved text — open the official source" : ""}</span>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        {paras.length ? (
          <div className="max-w-3xl space-y-2 text-[14px] leading-relaxed">
            {paras.map((t, k) => <p key={k} style={{ paddingLeft: `${markerDepth(t) * 1.25}rem` }}>{t}</p>)}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">{p.sourceUrl ? "The corpus has no saved text for this provision. Use “Official source” to read it on the publisher's site." : "No text or source link recorded for this provision."}</p>
        )}
      </section>

      {node && idx != null ? <div className="mt-4 flex items-center justify-between gap-3">{nav(prev, -1, "←")}{nav(next, 1, "→")}</div> : null}

      {p.quality ? <p className="mt-4 text-[11px] text-muted-foreground">{p.quality}. Text is the publisher snapshot stored in the corpus, not re-checked against the live site.</p> : null}
      <details className="mt-3 text-[12px] text-muted-foreground">
        <summary className="cursor-pointer">Technical details</summary>
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          <dt>Record id</dt><dd className="break-all font-mono">{p.id}</dd>
          <dt>Dataset</dt><dd>{p.dataset}</dd>
          {p.file?.id ? <><dt>Source file</dt><dd className="break-all">{p.file.id}{p.file.bytes ? ` · ${p.file.bytes.toLocaleString()} bytes` : ""}</dd></> : null}
          {p.file?.sha256 ? <><dt>SHA-256</dt><dd className="break-all font-mono">{p.file.sha256}</dd></> : null}
        </dl>
      </details>
    </AppShell>
  );
}
