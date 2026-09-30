import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { SectionPage } from "@/components/corpus/SectionPage";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { Input } from "@/components/ui/input";
import { pageHead } from "@/lib/corpus/head";
import { stateByUsps } from "@/lib/corpus/geo";
import { countBy, NOT_RECORDED, type CourtRow } from "@/lib/external/directoryTree";
import { useCourtDirectory } from "@/lib/external/useDirectory";

type S = { ds?: string | undefined; view?: string | undefined; system?: string | undefined; state?: string | undefined; type?: string | undefined };
const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 120 ? v : undefined);

export const Route = createFileRoute("/courts/")({
  validateSearch: (s: Record<string, unknown>): S => ({ ds: str(s["ds"]), view: str(s["view"]), system: str(s["system"]), state: str(s["state"]), type: str(s["type"]) }),
  head: () => pageHead("Courts", "Browse courts top-down: federal or state, then state and court type, then each court's full page."),
  component: CourtsPage,
});

const stateLabel = (code: string) => (code === NOT_RECORDED ? "No state recorded" : stateByUsps.get(code)?.name ?? code);

function CourtsPage() {
  const s = Route.useSearch();
  const dir = useCourtDirectory();
  if (s.view === "list" || s.ds) return <SectionPage section="courts" path="/courts" ds={s.ds} />;

  const rows = dir.data ?? [];
  const federal = s.system === "Federal";
  let level = rows;
  if (s.system) level = level.filter((r) => r.system === s.system);
  if (s.state) level = level.filter((r) => r.state === s.state);
  if (s.type) level = level.filter((r) => r.type === s.type);

  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [{ label: "Atlas", to: "/" }, { label: "Courts", to: "/courts" }];
  if (s.system) crumbs.push({ label: s.system, to: "/courts", search: { system: s.system } });
  if (s.state) crumbs.push({ label: stateLabel(s.state), to: "/courts", search: { system: s.system ?? "", state: s.state } });
  if (s.type) crumbs.push({ label: s.type });
  const last = crumbs[crumbs.length - 1]!; if (crumbs.length > 2) { delete last.to; delete last.search; }

  const base = { system: s.system, state: s.state, type: s.type };
  let body: React.ReactNode;
  if (dir.isLoading) body = <p className="text-[13px] text-muted-foreground">Loading the court directory…</p>;
  else if (dir.error) body = <p className="text-[13px] text-destructive">The court directory could not be loaded. Try again shortly.</p>;
  else if (!s.system) {
    body = <FolderGrid title="Court system" hint={`${rows.length.toLocaleString()} courts`} items={[...countBy(rows, (r) => r.system).map((c) => ({ key: c.key, label: c.key, count: c.count, link: { to: "/courts", search: { system: c.key } } })), { key: "list", label: "All courts (list)", note: "Flat searchable list and court datasets", link: { to: "/courts", search: { view: "list" } } }]} />;
  } else if (!federal && !s.state) {
    body = <FolderGrid title="Pick a state" hint={`${level.length.toLocaleString()} ${s.system.toLowerCase()} courts`} items={countBy(level, (r) => r.state).map((c) => ({ key: c.key, label: stateLabel(c.key), count: c.count, link: { to: "/courts", search: { ...base, state: c.key } } }))} />;
  } else if (!s.type) {
    body = <FolderGrid title="Court type" hint={`${level.length.toLocaleString()} courts`} items={[{ key: "all", label: "All types", count: level.length, link: { to: "/courts", search: { ...base, type: "*" } } }, ...countBy(level, (r) => r.type).map((c) => ({ key: c.key, label: c.key, count: c.count, link: { to: "/courts", search: { ...base, type: c.key } } }))]} />;
  } else body = <CourtList rows={s.type === "*" ? (s.state || !federal ? rows.filter((r) => r.system === s.system && (!s.state || r.state === s.state)) : rows.filter((r) => r.system === s.system)) : level} />;

  return (
    <AppShell breadcrumbs={crumbs} title={s.type && s.type !== "*" ? s.type : s.state ? `${stateLabel(s.state)} courts` : s.system ? `${s.system} courts` : "Courts"} description="Open a folder to narrow down, then open a court for its full page.">
      {body}
    </AppShell>
  );
}

function CourtList({ rows }: { rows: CourtRow[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? rows.filter((r) => r.title.toLowerCase().includes(t)) : rows).slice().sort((a, b) => a.title.localeCompare(b.title)); }, [rows, q]);
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search these courts" className="h-8 max-w-xs text-[12px]" />
        <span className="text-[12px] text-muted-foreground">{shown.length.toLocaleString()} courts</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full text-[12.5px]">
          <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-1.5">Court</th><th className="px-3 py-1.5">Type</th><th className="px-3 py-1.5">State</th></tr></thead>
          <tbody>
            {shown.slice(0, 500).map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                <td className="px-3 py-1.5"><Link to="/courts/$id" params={{ id: r.id }} className="font-medium hover:underline">{r.title}</Link></td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.type}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{stateLabel(r.state)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 500 ? <p className="text-[12px] text-muted-foreground">Showing the first 500 — search to narrow.</p> : null}
    </section>
  );
}
