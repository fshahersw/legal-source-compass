import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { BarList } from "@/components/corpus/BarList";
import { Input } from "@/components/ui/input";
import { pageHead } from "@/lib/corpus/head";
import { distinct, filterRegistry, loadRegistryIndex, loadRegistryJurisdiction, taskCounts, taskLabel } from "@/lib/atlas/registryV22";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { stateByUsps } from "@/lib/corpus/geo";

type S = { j?: string | undefined; task?: string | undefined; q?: string | undefined; all?: string | undefined };
const str = (v: unknown) => (typeof v === "string" && v.length <= 120 ? v : undefined);

export const Route = createFileRoute("/sources/registry-v22")({
  validateSearch: (s: Record<string, unknown>): S => ({ j: str(s["j"]), task: str(s["task"]), q: str(s["q"]), all: str(s["all"]) }),
  head: () => pageHead("Litigation source registry V2.2", "U.S. litigation sources by jurisdiction and research task, with source type, access and format."),
  component: Page,
});

function Page() {
  const { j, task, q, all: showAll } = Route.useSearch();
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
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Sources", to: "/sources/library" }, ...(j ? [{ label: "Registry V2.2", to: "/sources/registry-v22" }, ...(task || showAll ? [{ label: name ?? j, to: `/sources/registry-v22?j=${encodeURIComponent(j)}` }, { label: task ? taskLabel(task) : "All sources" }] : [{ label: name ?? j }])] : [{ label: "Registry V2.2" }])]}
      title={name ? `${name} litigation sources` : "Litigation source registry V2.2"}
      description={`${(j ? all.length : idx.data?.recordCount ?? 4846).toLocaleString()} sources${meta?.["verifiedThrough"] ? ` · registry states verified through ${String(meta["verifiedThrough"])} (imported, not re-checked)` : ""}`}
    >
      {!j ? (
        idx.isLoading ? <p className="text-[12px] text-muted-foreground">Loading…</p> : (
          <div className="space-y-5">
            {[["Federal & multi-jurisdiction", juris.filter(([c]) => !stateByUsps.has(c) && ["US", "MULTI", "OTHER", "NONE"].includes(c))], ["States & DC", juris.filter(([c]) => stateByUsps.has(c)).sort((x, y) => x[1].name.localeCompare(y[1].name))], ["Territories", juris.filter(([c]) => !stateByUsps.has(c) && !["US", "MULTI", "OTHER", "NONE"].includes(c))]].map(([title, list]) => (
              <FolderGrid key={title as string} title={title as string} items={(list as typeof juris).map(([code, v]) => ({ key: code, label: v.name || code, count: v.count, link: { to: "/sources/registry-v22", search: { j: code } } }))} />
            ))}
          </div>
        )
      ) : recs.isLoading ? <p className="text-[12px] text-muted-foreground">Loading sources…</p> : !task && !showAll && !q ? (
        <div className="space-y-4">
          {stateByUsps.has(j) ? <Link to="/places/$state" params={{ state: j }} className="text-[12px] underline">Back to {name} on the map</Link> : null}
          <FolderGrid title="Open a research task" hint={`${all.length.toLocaleString()} sources · a source can sit in more than one task`} items={[{ key: "all", label: "All sources", count: all.length, link: { to: "/sources/registry-v22", search: { j, all: "1" } } }, ...taskCounts(all).map((t) => ({ key: t.task, label: taskLabel(t.task), count: t.count, link: { to: "/sources/registry-v22", search: { j, task: t.task } } }))]} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <BarList title="By research task" rows={tasks.map((t) => ({ label: taskLabel(t), count: all.filter((r) => r.taskFamilies.includes(t)).length })).sort((a, b) => b.count - a.count)} limit={8} unit="sources" />
            <BarList title="By source type" rows={distinct(all, (r) => [r.sourceType]).map((t) => ({ label: t, count: all.filter((r) => r.sourceType === t).length })).sort((a, b) => b.count - a.count)} limit={8} unit="sources" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} placeholder="Search title, URL, topic" className="h-8 max-w-xs text-[12px]" />
            <select value={task ?? ""} onChange={(e) => set({ task: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
              <option value="">All tasks</option>{tasks.map((t) => <option key={t} value={t}>{taskLabel(t)}</option>)}
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
