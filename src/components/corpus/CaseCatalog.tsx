import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BarList, Stat } from "@/components/corpus/BarList";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { filterMatters, loadCatalog, mdlForMatter, summarizeMatters, type MatterFilter } from "@/lib/atlas/catalogMatters";
import { surnameLetter } from "@/lib/external/directoryTree";
import { useCourtDirectory, useJudgeMatcher } from "@/lib/external/useDirectory";
import { CaseAnalytics } from "@/components/corpus/CaseAnalytics";
import { defendants } from "@/lib/atlas/caseAnalytics";

const PAGE = 25;

/** Tracked cases from the uploaded case catalog, optionally scoped to one court or MDL. */
export function CaseCatalog({ scope }: { scope?: { court?: string | undefined; mdl?: string | undefined } | undefined }) {
  const match = useJudgeMatcher();
  const q = useQuery({ queryKey: ["catalog-matters"], queryFn: loadCatalog, staleTime: Infinity });
  const [f, setF] = useState<MatterFilter>({});
  const [page, setPage] = useState(0);
  const [state, setState] = useState<string | undefined>();
  const [view, setView] = useState<"list" | "analytics">("list");
  const courtsDir = useCourtDirectory();
  const stateCourts = useMemo(() => (state && courtsDir.data ? new Set(courtsDir.data.filter((c) => c.state === state).map((c) => c.id)) : undefined), [state, courtsDir.data]);
  const base = useMemo(() => (q.data ? filterMatters(q.data.rows, { court: scope?.court, mdl: scope?.mdl }, q.data.masterMap) : []), [q.data, scope?.court, scope?.mdl]);
  const rows = useMemo(() => (q.data ? filterMatters(base, { ...f, courts: stateCourts }, q.data.masterMap).sort((a, b) => (b.date_filed ?? "").localeCompare(a.date_filed ?? "")) : []), [base, f, q.data, stateCourts]);
  const s = useMemo(() => summarizeMatters(base), [base]);
  const defs = useMemo(() => (q.data ? defendants(base, q.data.masterMap) : []), [base, q.data]);
  const set = (p: MatterFilter) => { setF((prev) => ({ ...prev, ...p })); setPage(0); };

  if (q.isLoading) return <p className="text-[12px] text-muted-foreground">Loading case catalog…</p>;
  if (q.error || !q.data) return <p className="text-[12px] text-destructive">The case catalog could not be loaded. <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button></p>;
  if (base.length === 0) return <p className="text-[12px] text-muted-foreground">No cases from the case catalog are recorded here.</p>;
  const map = q.data.masterMap;
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Cases" value={s.total} />
        <Stat label="Active" value={s.active} />
        <Stat label="Judges" value={s.byJudge.length} />
        <Stat label="Firms" value={s.byFirm.length} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <BarList title="Firms of record" rows={s.byFirm} limit={8} unit="cases" />
        <BarList title="Assigned judges" rows={s.byJudge} limit={8} unit="cases" />
      </div>
      <div className="inline-flex rounded-md border border-border p-0.5 text-[12px]">
        {(["list", "analytics"] as const).map((v) => <button key={v} type="button" onClick={() => setView(v)} className={`rounded px-3 py-1 capitalize ${view === v ? "bg-muted font-medium" : "text-muted-foreground"}`}>{v === "list" ? "Cases" : "Analytics"}</button>)}
      </div>
      {view === "analytics" ? <CaseAnalytics rows={rows} masterMap={map} compact={!!scope} onPick={(p) => { if (p.state) { setState(p.state); setPage(0); } else set({ defendant: p.defendant, firm: p.firm ?? f.firm }); setView("list"); }} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={f.q ?? ""} onChange={(e) => set({ q: e.target.value })} placeholder="Search case, party, firm, judge" className="h-8 max-w-xs text-[12px]" />
        <select value={f.firm ?? ""} onChange={(e) => set({ firm: e.target.value || undefined })} className="h-8 max-w-[14rem] rounded-md border border-input bg-background px-2 text-[12px]">
          <option value="">All firms</option>{s.byFirm.map((x) => <option key={x.label} value={x.label}>{x.label} ({x.count})</option>)}
        </select>
        <select value={f.judge ?? ""} onChange={(e) => set({ judge: e.target.value || undefined })} className="h-8 max-w-[14rem] rounded-md border border-input bg-background px-2 text-[12px]">
          <option value="">All judges</option>{s.byJudge.map((x) => <option key={x.label} value={x.label}>{x.label} ({x.count})</option>)}
        </select>
        <select value={f.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
          <option value="">Any status</option><option value="active">Active</option><option value="terminated">Terminated</option>
        </select>
        <select value={f.defendant ?? ""} onChange={(e) => set({ defendant: e.target.value || undefined })} className="h-8 max-w-[14rem] rounded-md border border-input bg-background px-2 text-[12px]">
          <option value="">All defendants</option>{defs.map((x) => <option key={x.label} value={x.label}>{x.label} ({x.count})</option>)}
        </select>
        <select value={f.role ?? ""} onChange={(e) => set({ role: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
          <option value="">Any firm role</option><option value="anchor">Anchor</option><option value="competitor">Competitor</option>
        </select>
        {state ? <button type="button" onClick={() => setState(undefined)} className="rounded bg-muted px-2 py-1 text-[11px]">State: {state} ×</button> : null}
        <span className="text-[11px] text-muted-foreground">{rows.length.toLocaleString()} cases</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
            <tr><th className="px-2 py-1.5">Filed</th><th className="px-2 py-1.5">Case</th><th className="px-2 py-1.5">Court</th><th className="px-2 py-1.5">Judge</th><th className="px-2 py-1.5">Firms</th><th className="px-2 py-1.5">MDL</th><th className="px-2 py-1.5">Status</th></tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const mdl = mdlForMatter(m, map);
              return (
                <tr key={m.docket_id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono">{m.date_filed ?? "—"}</td>
                  <td className="max-w-sm px-2 py-1.5">
                    {m.courtlistener_docket_url ? <a href={m.courtlistener_docket_url} target="_blank" rel="noreferrer" className="underline">{m.case_name ?? m.docket_number}</a> : m.case_name}
                    <div className="font-mono text-[10px] text-muted-foreground">{m.docket_number}{m.defendant ? ` · v. ${m.defendant}` : ""}</div>
                  </td>
                  <td className="px-2 py-1.5">{m.court ? <Link to="/courts/$id" params={{ id: m.court }} className="underline">{m.court}</Link> : "—"}</td>
                  <td className="px-2 py-1.5">{m.judge ? <JudgeName name={m.judge} match={match} onFilter={() => set({ judge: m.judge ?? undefined })} /> : "—"}</td>
                  <td className="px-2 py-1.5">{(m.firms ?? []).map((x) => <button key={x} type="button" onClick={() => set({ firm: x })} className="mr-1 mb-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px] hover:bg-secondary">{x}</button>)}</td>
                  <td className="px-2 py-1.5">{mdl ? <Link to="/matters/$id" params={{ id: mdl }} className="underline">MDL {mdl}</Link> : m.mdl_master_docket_id ? <span className="text-muted-foreground" title="Master docket not in the docket documents file">unlinked</span> : "—"}</td>
                  <td className="px-2 py-1.5 capitalize">{m.status ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > PAGE ? (
        <div className="flex items-center gap-2 text-[12px]">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page + 1} of {Math.ceil(rows.length / PAGE)}</span>
          <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      ) : null}
    </div>
  );
}

function JudgeName({ name, match, onFilter }: { name: string; match: ((n: string) => string | null) | null; onFilter: () => void }) {
  const id = match?.(name);
  return (
    <span className="inline-flex items-center gap-1">
      {id ? <Link to="/judges/$id" params={{ id }} className="underline decoration-dotted">{name}</Link> : <Link to="/people" search={{ kind: "judges", letter: surnameLetter(name), offset: 0 }} className="underline decoration-dotted" title="No single exact profile match; opens the A–Z index">{name}</Link>}
      <button type="button" onClick={onFilter} className="text-[10px] text-muted-foreground hover:text-foreground" title="Show only this judge's cases">filter</button>
    </span>
  );
}
