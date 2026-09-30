/** Read-only source catalog (catalog.json, split per jurisdiction under public/data/catalog/). No invented rows. */

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
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status}).`);
  const t = await res.text();
  if (t.trimStart().startsWith("<")) throw new Error(`${path} is missing from this build.`);
  return JSON.parse(t) as T;
}

export const loadCatalogIndex = () => getJson<CatalogIndex>("/data/catalog/index.json");
export const loadCatalogJurisdiction = (j: string) => getJson<CatalogEntry[]>(`/data/catalog/${encodeURIComponent(j.toLowerCase())}.json`);
let courts: Promise<StateCourts> | null = null;
export const loadStateCourts = () => (courts ??= getJson<StateCourts>("/data/state-courts.json"));

export type CatalogFilter = { q?: string; category?: string; access?: string; layer?: string };

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

/** Exact-URL overlap with the library; no normalisation beyond identity. */
export function inLibrary(rows: CatalogEntry[], libraryUrls: Set<string>): number {
  return rows.filter((r) => libraryUrls.has(r.url)).length;
}
