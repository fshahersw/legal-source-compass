import { fetchBundleSnapshot } from "@/lib/private-data/client";
/** Read-only Comprehensive U.S. Litigation Source Registry V2.2 (4,846 records), split per jurisdiction. */
export type RegistryV22Record = {
  id: string;
  title: string;
  url: string;
  domain: string;
  issuingBody: string;
  jurisdictions: string[];
  jurisdictionCodes: string[];
  primaryJurisdiction: string;
  branch: string;
  taskFamilies: string[];
  primaryTaskFamily: string;
  topicPath: string[];
  resourceType: string;
  sourceType: string;
  directness: string;
  access: string;
  currentness: string;
  formats: string[];
  verifiedDate: string;
  description: string;
  official: boolean;
  occurrenceCount: number;
  [key: string]: unknown;
};

export type RegistryV22Index = {
  metadata: Record<string, unknown>;
  recordCount: number;
  jurisdictions: Record<string, { count: number; name: string }>;
};

export function codeFile(code: string): string {
  return /^[A-Z0-9-]{2,12}$/.test(code) ? code : "OTHER";
}

export function filterRegistry(rows: RegistryV22Record[], f: { q?: string | undefined; task?: string | undefined; sourceType?: string | undefined; officialOnly?: boolean | undefined }) {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.task && !r.taskFamilies.includes(f.task)) return false;
    if (f.sourceType && r.sourceType !== f.sourceType) return false;
    if (f.officialOnly && !r.official) return false;
    if (!q) return true;
    return [r.title, r.url, r.domain, r.description, ...r.topicPath].some((v) => (v ?? "").toLowerCase().includes(q));
  });
}

export function distinct(rows: RegistryV22Record[], pick: (r: RegistryV22Record) => string[]): string[] {
  return [...new Set(rows.flatMap(pick))].filter(Boolean).sort();
}

export async function loadRegistryIndex(): Promise<RegistryV22Index> {
  const r = await fetchBundleSnapshot("/data/registry-v22/index.json");
  if (!r.ok) throw new Error("Registry index could not be loaded.");
  return (await r.json()) as RegistryV22Index;
}

export async function loadRegistryJurisdiction(code: string): Promise<RegistryV22Record[]> {
  const r = await fetchBundleSnapshot(`/data/registry-v22/${codeFile(code)}.json`);
  if (!r.ok) throw new Error("Registry records could not be loaded.");
  const t = await r.text();
  return t.trimStart().startsWith("<") ? [] : (JSON.parse(t) as RegistryV22Record[]);
}

export const TASK_LABELS: Record<string, string> = {
  "courts-procedure": "Courts & procedure",
  "regulatory-administrative": "Regulatory & administrative",
  "law-authority": "Law & authority",
  "discovery-trial": "Discovery & trial",
  "people-professional-records": "People & professional records",
  "complex-litigation": "Complex litigation",
  "evidence-acquisition": "Evidence acquisition",
  insurance: "Insurance",
};

export function taskLabel(t: string): string {
  return TASK_LABELS[t] ?? t.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Sources per research task (a source can belong to several tasks). */
export function taskCounts(rows: RegistryV22Record[]): { task: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) for (const t of new Set(r.taskFamilies)) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([task, count]) => ({ task, count })).sort((a, b) => b.count - a.count || a.task.localeCompare(b.task));
}
