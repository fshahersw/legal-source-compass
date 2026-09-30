import { mdlForMatter, type CatalogMatter } from "./catalogMatters";

export type YearStatus = { year: string; active: number; closed: number };
export type RoleRow = { firm: string; anchor: number; competitor: number; other: number };
export type Median = { label: string; median: number; n: number };
export type DefendantRow = { label: string; count: number; mdls: string[] };

const DAY = 86_400_000;
export function daysToClose(m: CatalogMatter): number | null {
  if (!m.date_filed || !m.date_terminated) return null;
  const a = Date.parse(m.date_filed), b = Date.parse(m.date_terminated);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / DAY);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2]! : Math.round((s[n / 2 - 1]! + s[n / 2]!) / 2);
}

export function byYearStatus(rows: CatalogMatter[]): YearStatus[] {
  const m = new Map<string, YearStatus>();
  for (const r of rows) {
    const y = (r.date_filed ?? "").slice(0, 4);
    if (!/^\d{4}$/.test(y)) continue;
    const e = m.get(y) ?? { year: y, active: 0, closed: 0 };
    if (r.status === "active") e.active++; else e.closed++;
    m.set(y, e);
  }
  return [...m.values()].sort((a, b) => a.year.localeCompare(b.year));
}

export function defendants(rows: CatalogMatter[], masterMap: Record<string, string>): DefendantRow[] {
  const m = new Map<string, { count: number; mdls: Set<string> }>();
  for (const r of rows) {
    if (!r.defendant) continue;
    const e = m.get(r.defendant) ?? { count: 0, mdls: new Set<string>() };
    e.count++;
    const mdl = mdlForMatter(r, masterMap);
    if (mdl) e.mdls.add(mdl);
    m.set(r.defendant, e);
  }
  return [...m.entries()].map(([label, e]) => ({ label, count: e.count, mdls: [...e.mdls].sort() })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Firm × role; each case's roles array is aligned with its firms array when lengths match. */
export function firmRoles(rows: CatalogMatter[]): RoleRow[] {
  const m = new Map<string, RoleRow>();
  for (const r of rows) {
    const firms = r.firms ?? [];
    const roles = r.roles ?? [];
    firms.forEach((f, i) => {
      const role = roles.length === firms.length ? roles[i] : roles.length === 1 ? roles[0] : undefined;
      const e = m.get(f) ?? { firm: f, anchor: 0, competitor: 0, other: 0 };
      if (role === "anchor") e.anchor++; else if (role === "competitor") e.competitor++; else e.other++;
      m.set(f, e);
    });
  }
  return [...m.values()].sort((a, b) => b.anchor + b.competitor + b.other - (a.anchor + a.competitor + a.other));
}

export function medianCloseBy(rows: CatalogMatter[], key: (m: CatalogMatter) => string[]): Median[] {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const d = daysToClose(r);
    if (d == null) continue;
    for (const k of key(r)) m.set(k, [...(m.get(k) ?? []), d]);
  }
  return [...m.entries()].map(([label, xs]) => ({ label, median: median(xs), n: xs.length }));
}

export const closedWithDates = (rows: CatalogMatter[]) => rows.filter((r) => daysToClose(r) != null).length;

/** Court id → USPS state via the court directory; courts not in it are left out (never guessed). */
export function byState(rows: CatalogMatter[], courtState: Map<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const s = r.court ? courtState.get(r.court) : undefined;
    if (s) out.set(s, (out.get(s) ?? 0) + 1);
  }
  return out;
}
