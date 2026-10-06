import { fetchBundleSnapshot } from "@/lib/private-data/client";
/** Read-only source catalog (catalog.json, split per jurisdiction under private/data/catalog/). No invented rows. */

export type CatalogEntry = {
  id: string;
  title: string;
  url: string;
  host?: string;
  jurisdiction: string;
  jurisdiction_label?: string;
  category?: string;
  tags?: string[];
  layer?: string;
  access_method?: string;
  access_requirements?: string;
  verification_status?: string;
  source_as_of?: string;
  notes?: string;
  description?: string;
  caveat?: string;
  source_type?: string;
  content_kind?: string;
  section?: string;
  subsection?: string;
};
export type CatalogIndex = { summary: Record<string, unknown>; jurisdictions: { jurisdiction: string; label: string; count: number }[] };
export type StateCourtSection = { section: string; links: { title: string; url: string }[] };
export type StateCourts = { source: string; states: Record<string, StateCourtSection[]> };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchBundleSnapshot(path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status}).`);
  const t = await res.text();
  if (t.trimStart().startsWith("<")) throw new Error(`${path} is missing from this build.`);
  return JSON.parse(t) as T;
}

export const loadCatalogIndex = () => getJson<CatalogIndex>("/data/catalog/index.json");
export const loadCatalogJurisdiction = (j: string) => getJson<CatalogEntry[]>(`/data/catalog/${encodeURIComponent(j.toLowerCase())}.json`);
let courts: Promise<StateCourts> | null = null;
export const loadStateCourts = () => (courts ??= getJson<StateCourts>("/data/state-courts.json"));

export type CatalogFilter = { q?: string | undefined; category?: string | undefined; access?: string | undefined; layer?: string | undefined };

export function filterCatalog(rows: CatalogEntry[], f: CatalogFilter): CatalogEntry[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.category || r.category === f.category) &&
      (!f.access || r.access_method === f.access) &&
      (!f.layer || r.layer === f.layer) &&
      (!q || [r.title, r.url, r.host, r.section, r.subsection].some((v) => (v ?? "").toLowerCase().includes(q))),
  );
}

export function countField(rows: CatalogEntry[], key: "category" | "access_method" | "layer"): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) { const v = r[key] ?? "Not recorded"; m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

/** Federal court id from an official uscourts.gov host, e.g. http://www.akd.uscourts.gov/ → "akd". Exact host pattern only. */
export function uscourtsId(url: string): string | null {
  try {
    const m = new URL(url).hostname.toLowerCase().match(/^(?:www\.)?([a-z0-9]+)\.uscourts\.gov$/);
    return m ? m[1]! : null;
  } catch { return null; }
}

/** Every catalog row (all jurisdiction files). */
export async function loadAllCatalog(): Promise<CatalogEntry[]> {
  const idx = await loadCatalogIndex();
  const parts = await Promise.all(idx.jurisdictions.map((j) => loadCatalogJurisdiction(j.jurisdiction)));
  return parts.flat();
}

type LibSource = { id: string; url: string; title: string; domain: string; jurisdiction: string; heading_category: string; source_family: string; occurrences: number };

/**
 * Library rows = bundle sources, plus catalog rows whose exact URL is not already there.
 * Existing rows are copied (never mutated) and gain a `catalog_record` when the URL matches exactly.
 */
export function mergeCatalog<S extends LibSource>(sources: S[], catalog: CatalogEntry[]): { rows: S[]; added: number; matched: number } {
  const byUrl = new Map<string, CatalogEntry[]>();
  for (const c of catalog) byUrl.set(c.url, [...(byUrl.get(c.url) ?? []), c]);
  const seen = new Set<string>();
  let matched = 0;
  const rows = sources.map((s) => {
    seen.add(s.url);
    const records = byUrl.get(s.url);
    if (!records?.length) return s;
    matched++;
    const existing = (s as unknown as Record<string, unknown>)["category_values"];
    return { ...s, catalog_record: records[0], catalog_records: records,
      category_values: [...new Set([...(Array.isArray(existing) ? existing.map(String) : [s.heading_category]).filter(Boolean), ...records.map((c) => c.category ?? "").filter(Boolean)])] };
  });
  let added = 0;
  for (const records of byUrl.values()) {
    const c = records[0]!;
    if (seen.has(c.url)) continue;
    added++;
    rows.push({
      id: `catalog:${c.id}`,
      url: c.url,
      title: c.title ?? "",
      domain: c.host ?? "",
      jurisdiction: c.jurisdiction === "us" ? "Federal" : c.jurisdiction_label ?? c.jurisdiction,
      heading_category: c.category ?? "",
      source_family: "",
      occurrences: records.length,
      origin: "Source catalog",
      catalog_record: c,
      catalog_records: records,
      category_values: [...new Set(records.map((r) => r.category ?? "").filter(Boolean))],
    } as unknown as S);
  }
  return { rows, added, matched };
}
