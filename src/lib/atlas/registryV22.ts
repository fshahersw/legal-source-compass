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
  const r = await fetch("/data/registry-v22/index.json");
  if (!r.ok) throw new Error("Registry index could not be loaded.");
  return (await r.json()) as RegistryV22Index;
}

export async function loadRegistryJurisdiction(code: string): Promise<RegistryV22Record[]> {
  const r = await fetch(`/data/registry-v22/${codeFile(code)}.json`);
  if (!r.ok) throw new Error("Registry records could not be loaded.");
  const t = await r.text();
  return t.trimStart().startsWith("<") ? [] : (JSON.parse(t) as RegistryV22Record[]);
}
