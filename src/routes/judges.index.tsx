import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { SectionPage } from "@/components/corpus/SectionPage";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { Input } from "@/components/ui/input";
import { pageHead } from "@/lib/corpus/head";
import { fileUrl } from "@/lib/external/groups";
import { countBy, judgeCourts, NOT_RECORDED, type JudgeRow } from "@/lib/external/directoryTree";
import { useJudgeDirectory } from "@/lib/external/useDirectory";

type S = { ds?: string | undefined; view?: string | undefined; system?: string | undefined; state?: string | undefined; court?: string | undefined };
const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : undefined);

export const Route = createFileRoute("/judges/")({
  validateSearch: (s: Record<string, unknown>): S => ({ ds: str(s["ds"]), view: str(s["view"]), system: str(s["system"]), state: str(s["state"]), court: str(s["court"]) }),
  head: () => pageHead("Judges", "Browse judges top-down: federal or state, then state and court, then each judge's full profile."),
  component: JudgesPage,
});

const lbl = (k: string, none: string) => (k === NOT_RECORDED ? none : k);

function JudgesPage() {
  const s = Route.useSearch();
  const dir = useJudgeDirectory();
  if (s.view === "list" || s.ds) return <SectionPage section="judges" path="/judges" ds={s.ds} />;

  const rows = dir.data ?? [];
  let level = rows;
  if (s.system) level = level.filter((r) => r.system === s.system);
  if (s.state) level = level.filter((r) => r.state === s.state);
  if (s.court) level = level.filter((r) => judgeCourts(r).includes(s.court!));

  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [{ label: "Atlas", to: "/" }, { label: "Judges", to: "/judges" }];
  if (s.system) crumbs.push({ label: s.system, to: "/judges", search: { system: s.system } });
  if (s.state) crumbs.push({ label: lbl(s.state, "No state recorded"), to: "/judges", search: { system: s.system ?? "", state: s.state } });
  if (s.court) crumbs.push({ label: lbl(s.court, "Court not recorded") });
  const last = crumbs[crumbs.length - 1]!; if (crumbs.length > 2) { delete last.to; delete last.search; }

  const base = { system: s.system, state: s.state };
  let body: React.ReactNode;
  if (dir.isLoading) body = <p className="text-[13px] text-muted-foreground">Loading the judge directory…</p>;
  else if (dir.error) body = <p className="text-[13px] text-destructive">The judge directory could not be loaded. Try again shortly.</p>;
  else if (!s.system) {
    body = <FolderGrid title="Court system" hint={`${rows.length.toLocaleString()} judges`} items={[
      ...countBy(rows, (r) => r.system).map((c) => ({ key: c.key, label: c.key, count: c.count, link: { to: "/judges", search: { system: c.key } } })),
      { key: "az", label: "A–Z by name", note: "Judges and counsel name index", link: { to: "/people", search: { kind: "judges", letter: "A" } } },
      { key: "list", label: "All judges (list)", note: "Flat searchable list and judge datasets", link: { to: "/judges", search: { view: "list" } } },
    ]} />;
  } else if (!s.state) {
    body = <FolderGrid title="Pick a state" hint={`${level.length.toLocaleString()} judges`} items={countBy(level, (r) => r.state).map((c) => ({ key: c.key, label: lbl(c.key, "No state recorded"), count: c.count, link: { to: "/judges", search: { ...base, state: c.key } } }))} />;
  } else if (!s.court) {
    body = <FolderGrid title="Pick a court" hint={`${level.length.toLocaleString()} judges · a judge on several courts appears in each`} items={[{ key: "*", label: "All judges here", count: level.length, link: { to: "/judges", search: { ...base, court: "*" } } }, ...countBy(level, judgeCourts).map((c) => ({ key: c.key, label: lbl(c.key, "Court not recorded"), count: c.count, link: { to: "/judges", search: { ...base, court: c.key } } }))]} />;
  } else body = <JudgeList rows={s.court === "*" ? rows.filter((r) => r.system === s.system && r.state === s.state) : level} />;

  return (
    <AppShell breadcrumbs={crumbs} title={s.court && s.court !== "*" ? lbl(s.court, "Court not recorded") : s.state ? `${lbl(s.state, "No state recorded")} judges` : s.system ? `${s.system} judges` : "Judges"} description="Open a folder to narrow down, then open a judge for the full profile.">
      {body}
    </AppShell>
  );
}

function JudgeList({ rows }: { rows: JudgeRow[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? rows.filter((r) => r.name.toLowerCase().includes(t)) : rows).slice().sort((a, b) => a.name.localeCompare(b.name)); }, [rows, q]);
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search these judges" className="h-8 max-w-xs text-[12px]" />
        <span className="text-[12px] text-muted-foreground">{shown.length.toLocaleString()} judges</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.slice(0, 300).map((r) => (
          <Link key={r.id} to="/judges/$id" params={{ id: r.id }} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2 shadow-card hover:bg-muted">
            {r.photo ? <img src={fileUrl(r.photo)} alt="" loading="lazy" className="size-9 shrink-0 rounded object-cover" /> : <span className="size-9 shrink-0 rounded bg-muted" />}
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{r.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{r.courts.join(" · ") || "Court not recorded"}</span>
            </span>
          </Link>
        ))}
      </div>
      {shown.length > 300 ? <p className="text-[12px] text-muted-foreground">Showing the first 300 — search to narrow.</p> : null}
    </section>
  );
}
