/** Pure parsing and grouping for the supplied source registry (registry_v06_1.jsonl). Raw lines are kept verbatim. */
import { stateByUsps } from "@/lib/corpus/geo";

export type RegistryEntry = {
  id: string; parent_id: string; name: string; url: string; domain: string; jurisdiction: string; layer: string;
  record_category: string; section: string; subsection: string; source_type: string; content_kind: string; access: string;
  backend: string; description: string; caveat: string; verified_date: string; http_status: string; notes: string; task_family: string;
  raw: string;
};

export function parseRegistry(text: string): { entries: RegistryEntry[]; invalidLines: number } {
  const entries: RegistryEntry[] = [];
  let invalidLines = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (typeof o["id"] !== "string" || typeof o["url"] !== "string") { invalidLines++; continue; }
      const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : o[k] == null ? "" : String(o[k]));
      entries.push({
        id: s("id"), parent_id: s("parent_id"), name: s("name"), url: s("url"), domain: s("domain"), jurisdiction: s("jurisdiction"),
        layer: s("layer"), record_category: s("record_category"), section: s("section"), subsection: s("subsection"),
        source_type: s("source_type"), content_kind: s("content_kind"), access: s("access"), backend: s("backend"),
        description: s("description"), caveat: s("caveat"), verified_date: s("verified_date"), http_status: s("http_status"),
        notes: s("notes"), task_family: s("task_family"), raw: line,
      });
    } catch { invalidLines++; }
  }
  return { entries, invalidLines };
}

export function jurisdictionLabel(code: string) {
  if (code === "us") return "Federal / national";
  if (code === "multi") return "Multi-state";
  if (!code) return "Unspecified";
  return stateByUsps.get(code.toUpperCase())?.name ?? code.toUpperCase();
}

export const humanize = (s: string) => (s ? s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Uncategorized");

export function countBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Status line exactly as recorded by the registry — historical, not a fresh check. */
export function statusLabel(e: RegistryEntry) {
  if (!e.http_status && !e.verified_date) return "Not checked in registry";
  return `Registry check${e.verified_date ? ` ${e.verified_date}` : ""}: ${e.http_status || "no status"}`;
}

export const isReachable = (e: RegistryEntry) => /^2\d\d$/.test(e.http_status);

/** Coverage matrix: jurisdiction × record category, with gaps where a category has no registry source. */
export function coverageMatrix(entries: RegistryEntry[]) {
  const cats = countBy(entries.filter((e) => e.record_category), (e) => e.record_category).map(([c]) => c);
  const byJ = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!e.record_category) continue;
    const m = byJ.get(e.jurisdiction) ?? new Map<string, number>();
    m.set(e.record_category, (m.get(e.record_category) ?? 0) + 1);
    byJ.set(e.jurisdiction, m);
  }
  const rows = [...byJ.entries()].map(([j, m]) => ({ jurisdiction: j, counts: m, total: [...m.values()].reduce((a, b) => a + b, 0), missing: cats.filter((c) => !m.has(c)) }))
    .sort((a, b) => jurisdictionLabel(a.jurisdiction).localeCompare(jurisdictionLabel(b.jurisdiction)));
  return { categories: cats, rows };
}
