import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "@tanstack/react-router";
import { UsMap } from "@/components/corpus/UsMap";
import { useCorpus } from "@/lib/corpus/store";
import { stateByFips, stateByUsps } from "@/lib/corpus/geo";
import type { CatalogMatter } from "@/lib/atlas/catalogMatters";
import { byState, byYearStatus, closedWithDates, defendants, firmRoles, medianCloseBy } from "@/lib/atlas/caseAnalytics";
import { useCourtDirectory } from "@/lib/external/useDirectory";

/** Chart/Table switch around any visual. */
export function ChartTable({ title, chart, table }: { title: string; chart: ReactNode; table: ReactNode }) {
  const [mode, setMode] = useState<"chart" | "table">("chart");
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        <div className="inline-flex rounded-md border border-border p-0.5 text-[11px]">
          {(["chart", "table"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded px-2 py-0.5 capitalize ${mode === m ? "bg-muted font-medium" : "text-muted-foreground"}`}>{m}</button>
          ))}
        </div>
      </div>
      {mode === "chart" ? chart : <div className="max-h-72 overflow-auto">{table}</div>}
    </section>
  );
}

function T({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-[12px]">
      <thead className="text-left text-[11px] text-muted-foreground"><tr>{head.map((h, i) => <th key={h} className={`px-2 py-1 ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className={`px-2 py-1 ${j ? "text-right font-mono" : ""}`}>{typeof c === "number" ? c.toLocaleString() : c}</td>)}</tr>)}</tbody>
    </table>
  );
}

type Pick = { defendant?: string; firm?: string; state?: string };

export function CaseAnalytics({ rows, masterMap, onPick, compact }: { rows: CatalogMatter[]; masterMap: Record<string, string>; onPick: (p: Pick) => void; compact?: boolean | undefined }) {
  const corpus = useCorpus();
  const courts = useCourtDirectory();
  const courtState = useMemo(() => new Map((courts.data ?? []).filter((c) => stateByUsps.has(c.state)).map((c) => [c.id, c.state])), [courts.data]);
  const a = useMemo(() => {
    const years = byYearStatus(rows);
    const defs = defendants(rows, masterMap);
    const roles = firmRoles(rows);
    const closeYear = medianCloseBy(rows, (m) => [(m.date_filed ?? "").slice(0, 4)]).filter((x) => /^\d{4}$/.test(x.label)).sort((x, y) => x.label.localeCompare(y.label));
    const closeFirm = medianCloseBy(rows, (m) => m.firms ?? []).sort((x, y) => y.n - x.n);
    return { years, defs, roles, closeYear, closeFirm, closedN: closedWithDates(rows), noDef: rows.filter((r) => !r.defendant).length };
  }, [rows, masterMap]);
  const states = useMemo(() => byState(rows, courtState), [rows, courtState]);
  const fipsValues = useMemo(() => new Map([...states].map(([u, n]) => [stateByUsps.get(u)!.fips, n])), [states]);
  const mapped = [...states.values()].reduce((s, n) => s + n, 0);
  const axis = { tick: { fontSize: 11 } };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartTable title="Cases filed per year, by status" chart={
        <div className="h-56"><ResponsiveContainer><BarChart data={a.years}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="year" {...axis} /><YAxis width={36} {...axis} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="closed" name="Closed" stackId="s" fill="var(--muted-foreground)" /><Bar dataKey="active" name="Active" stackId="s" fill="var(--primary)" /></BarChart></ResponsiveContainer></div>
      } table={<T head={["Year", "Active", "Closed", "All"]} rows={[...a.years].reverse().map((y) => [y.year, y.active, y.closed, y.active + y.closed])} />} />

      <ChartTable title="Top defendants" chart={
        <ul className="space-y-1.5">
          {a.defs.slice(0, 10).map((d) => { const max = a.defs[0]?.count ?? 1; return (
            <li key={d.label} className="grid grid-cols-[minmax(0,11rem)_1fr_3rem] items-center gap-2 text-[12px]">
              <button type="button" onClick={() => onPick({ defendant: d.label })} className="truncate text-left underline decoration-dotted" title="Show only this defendant's cases">{d.label}</button>
              <span className="h-2 rounded-sm bg-muted"><span className="block h-2 rounded-sm bg-primary" style={{ width: `${(d.count / max) * 100}%` }} /></span>
              <span className="text-right font-mono">{d.count}</span>
            </li>); })}
          <li className="pt-1 text-[11px] text-muted-foreground">{a.noDef.toLocaleString()} cases name no defendant.</li>
        </ul>
      } table={<T head={["Defendant", "Cases", "MDLs"]} rows={a.defs.map((d) => [d.label, d.count, d.mdls.length ? d.mdls.map((m) => `MDL ${m}`).join(", ") : "—"])} />} />

      <ChartTable title="Firms by role" chart={
        <div className="h-56"><ResponsiveContainer><BarChart data={a.roles.slice(0, 9)} layout="vertical" margin={{ left: 8 }}><CartesianGrid horizontal={false} stroke="var(--border)" /><XAxis type="number" {...axis} /><YAxis type="category" dataKey="firm" width={110} {...axis} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="anchor" name="Anchor" stackId="r" fill="var(--primary)" onClick={(d: { firm?: string }) => d.firm && onPick({ firm: d.firm })} /><Bar dataKey="competitor" name="Competitor" stackId="r" fill="var(--muted-foreground)" /><Bar dataKey="other" name="Role not recorded" stackId="r" fill="var(--border)" /></BarChart></ResponsiveContainer></div>
      } table={<T head={["Firm", "Anchor", "Competitor", "Not recorded"]} rows={a.roles.map((r) => [r.firm, r.anchor, r.competitor, r.other])} />} />

      <ChartTable title={`Median days to close · ${a.closedN.toLocaleString()} closed cases`} chart={
        <div className="h-56"><ResponsiveContainer><BarChart data={a.closeYear}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" {...axis} /><YAxis width={40} {...axis} /><Tooltip formatter={(v) => [`${v} days`, "Median"]} /><Bar dataKey="median" name="Median days" fill="var(--primary)" /></BarChart></ResponsiveContainer></div>
      } table={<T head={["Firm / filing year", "Median days", "Closed cases"]} rows={[...a.closeFirm.map((x) => [x.label, x.median, x.n]), ...a.closeYear.map((x) => [x.label, x.median, x.n])]} />} />

      {!compact ? (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-card lg:col-span-2">
          <h3 className="eyebrow mb-2">Cases by court state</h3>
          {corpus.geo && courts.data ? (
            <>
              <UsMap geo={corpus.geo} values={fipsValues} valueLabel="cases" onState={(f) => { const u = stateByFips.get(f)?.usps; if (u) onPick({ state: u }); }} />
              <p className="mt-1 text-[11px] text-muted-foreground">{mapped.toLocaleString()} of {rows.length.toLocaleString()} cases placed by their court's recorded state. Click a state to narrow the list. See also <Link to="/places" className="underline">the map</Link>.</p>
            </>
          ) : <p className="text-[12px] text-muted-foreground">Loading map…</p>}
        </section>
      ) : null}
    </div>
  );
}
