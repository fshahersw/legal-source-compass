/**
 * The corpussite saved case catalog (insights-data.js), parsed without changing its source rows.
 * Court-location views may add explicit derivation fields while retaining recorded_state.
 * Aggregations here are counts of catalog rows, not a national census —
 * the catalog's own `qualification` text must be shown alongside them.
 */
export type StateLocationTag = {
  recorded_state?: string;
  state_basis?: "exact_court_location" | "recorded_state" | "unresolved";
  state_conflict?: boolean;
};
export type Matter = StateLocationTag & {
  year: string; mdl: string; mdl_name: string; firms: string[];
  court: string; state: string; kind: string; status: string;
};
export type Master = StateLocationTag & { year: string; kind: string; number: string; office: string; entries: number; copies: number; court: string; state: string };
export type Alias = { name: string; also: string[] };
export type Insights = {
  qualification: string;
  matters: Matter[];
  parties: { mdl: string; role: string; name: string }[];
  counsel: { mdl: string; firm: string }[];
  citation_edges: number;
  cited: { id: string; cites: number }[];
  masters: Master[];
  firm_aliases: Alias[];
  attorney_aliases: Alias[];
  maps: Record<string, unknown>;
};

export function parseInsights(raw: unknown): Insights {
  const d = raw as Partial<Insights>;
  if (!d || typeof d.qualification !== "string" || !Array.isArray(d.matters) || !Array.isArray(d.masters))
    throw new Error("Not a corpussite insights catalog (missing qualification/matters/masters).");
  return d as Insights;
}

export type Count = { label: string; count: number };

export function countBy<T>(rows: T[], key: (r: T) => string | string[], blank = "(unspecified)"): Count[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = key(r);
    const vals = Array.isArray(v) ? (v.length ? [...new Set(v)] : [blank]) : [v || blank];
    for (const x of vals) m.set(x, (m.get(x) ?? 0) + 1);
  }
  return [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Exact alias → canonical name, using only the alias lists the catalog ships. */
export function aliasResolver(aliases: Alias[]): (name: string) => string {
  const map = new Map<string, string>();
  for (const a of aliases) {
    map.set(a.name, a.name);
    for (const x of a.also) map.set(x, a.name);
  }
  return (n) => map.get(n) ?? n;
}

export function firmCounts(ins: Insights): Count[] {
  const canon = aliasResolver(ins.firm_aliases);
  return countBy(ins.matters, (m) => m.firms.map(canon));
}

export function mattersByYear(ins: Insights): Count[] {
  return countBy(ins.matters, (m) => m.year).sort((a, b) => a.label.localeCompare(b.label));
}

export function mattersForState(ins: Insights, usps: string): Matter[] {
  return ins.matters.filter((m) => m.state === usps);
}
