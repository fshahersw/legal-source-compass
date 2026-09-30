import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { BarList } from "@/components/corpus/BarList";
import { Input } from "@/components/ui/input";
import { pageHead } from "@/lib/corpus/head";
import { distinct, filterRegistry, loadRegistryIndex, loadRegistryJurisdiction } from "@/lib/atlas/registryV22";

type S = { j?: string | undefined; task?: string | undefined; q?: string | undefined };
const str = (v: unknown) => (typeof v === "string" && v.length <= 120 ? v : undefined);

export const Route = createFileRoute("/sources/registry-v22")({
  validateSearch: (s: Record<string, unknown>): S => ({ j: str(s["j"]), task: str(s["task"]), q: str(s["q"]) }),
  head: () => pageHead("Litigation source registry V2.2", "4,846 U.S. litigation sources by jurisdiction and research task, with source type, access and format."),
  component: Page,
});

function Page() {
  const { j, task, q } = Route.useSearch();
  const navigate = useNavigate({ from: "/sources/registry-v22" });
  const set = (p: Partial<S>) => navigate({ search: (prev) => ({ ...prev, ...p }) });
  const idx = useQuery({ queryKey: ["reg22-index"], queryFn: loadRegistryIndex, staleTime: Infinity });
  const recs = useQuery({ queryKey: ["reg22", j], queryFn: () => loadRegistryJurisdiction(j!), enabled: !!j, staleTime: Infinity });
  const [official, setOfficial] = useState(false);
  const [limit, setLimit] = useState(75);
  const all = recs.data ?? [];
  const tasks = useMemo(() => distinct(all, (r) => r.taskFamilies), [all]);
  const rows = useMemo(() => filterRegistry(all, { q, task, officialOnly: official }), [all, q, task, official]);
  const juris = Object.entries(idx.data?.jurisdictions ?? {}).sort((a, b) => b[1].count - a[1].count);
  const name = j ? idx.data?.jurisdictions[j]?.name ?? j : undefined;
  const meta = idx.data?.metadata;

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Sources", to: "/" }, ...(j ? [{ label: "Registry V2.2", to: "/sources/registry-v22" }, { label: name ?? j }] : [{ label: "Registry V2.2" }])]}
      title={name ? `${name} litigation sources` : "Litigation source registry V2.2"}
      description={`${(idx.data?.recordCount ?? 4846).toLocaleString()} sources${meta?.["verifiedThrough"] ? ` · registry states verified through ${String(meta["verifiedThrough"])} (imported, not re-checked)` : ""}`}
    >
      {!j ? (
        idx.isLoading ? <p className="text-[12px] text-muted-foreground">Loading…</p> : (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {juris.map(([code, v]) => (
              <Link key={code} to="/sources/registry-v22" search={{ j: code }} className="rounded-lg border border-border bg-surface p-3 shadow-card hover:bg-muted">
                <div className="text-[13px] font-medium">{v.name || code}</div>
                <div className="text-[11px] text-muted-foreground">{v.count.toLocaleString()} sources</div>
              </Link>
            ))}
          </div>
        )
      ) : recs.isLoading ? <p className="text-[12px] text-muted-foreground">Loading sources…</p> : (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <BarList title="By research task" rows={tasks.map((t) => ({ label: t, count: all.filter((r) => r.taskFamilies.includes(t)).length })).sort((a, b) => b.count - a.count)} limit={8} unit="sources" />
            <BarList title="By source type" rows={distinct(all, (r) => [r.sourceType]).map((t) => ({ label: t, count: all.filter((r) => r.sourceType === t).length })).sort((a, b) => b.count - a.count)} limit={8} unit="sources" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} placeholder="Search title, URL, topic" className="h-8 max-w-xs text-[12px]" />
            <select value={task ?? ""} onChange={(e) => set({ task: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
              <option value="">All tasks</option>{tasks.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} /> Official only</label>
            <span className="text-[11px] text-muted-foreground">{rows.length.toLocaleString()} of {all.length.toLocaleString()}</span>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {rows.slice(0, limit).map((r) => (
              <li key={r.id} className="p-3 text-[12px]">
                <a href={r.url} target="_blank" rel="noreferrer" className="flex items-start gap-1 font-medium underline"><span className="break-words">{r.title}</span><ExternalLink className="mt-0.5 size-3 shrink-0" /></a>
                <div className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{r.url}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{r.topicPath.slice(1).join(" › ")}</div>
                {r.description ? <p className="mt-1">{r.description}</p> : null}
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  {[r.sourceType, r.resourceType, r.access, ...r.formats].filter(Boolean).map((t, i) => <span key={i} className="rounded bg-muted px-1.5 py-0.5">{t}</span>)}
                  {r.verifiedDate ? <span className="px-1 text-muted-foreground">registry check {r.verifiedDate}</span> : null}
                </div>
              </li>
            ))}
          </ul>
          {rows.length > limit ? <button type="button" className="text-[12px] underline" onClick={() => setLimit(limit + 75)}>Show more</button> : null}
        </div>
      )}
    </AppShell>
  );
}
