/** Read-only matter-registry bundle (user-supplied JSONL in public/data/matter-registry/). No invented rows. */

export type RegistryMatter = {
  matter_id: string;
  case_name: string;
  court_id: string;
  docket_number: string;
  case_status: string | null;
  date_filed: string | null;
  date_terminated: string | null;
  node_role: string | null;
};

export type RegistryParty = { party_id: string; matter_id: string; name: string; party_types: string[] };
export type RegistryAttorney = { attorney_id: string; name: string };
export type RegistryOutcome = {
  outcome_id: string;
  matter_id: string;
  outcome_type: string | null;
  date_terminated: string | null;
  evidence_level: string | null;
};
export type RegistryCourt = { court_id: string; name: string };
export type RegistryDoc = {
  document_id: string;
  matter_id: string;
  description: string | null;
  byte_count: number | null;
  sha256: string | null;
  verification_status: string | null;
  doc_uid: string | null;
};

export type Registry = {
  matters: RegistryMatter[];
  partiesByMatter: Map<string, RegistryParty[]>;
  outcomesByMatter: Map<string, RegistryOutcome[]>;
  attorneys: RegistryAttorney[];
  courts: Map<string, RegistryCourt>;
  mattersByCourt: Map<string, RegistryMatter[]>;
};

export function parseJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

export function buildRegistry(
  matters: RegistryMatter[],
  parties: RegistryParty[],
  attorneys: RegistryAttorney[],
  outcomes: RegistryOutcome[],
  courts: RegistryCourt[],
): Registry {
  const partiesByMatter = new Map<string, RegistryParty[]>();
  for (const p of parties) {
    const list = partiesByMatter.get(p.matter_id) ?? [];
    list.push(p);
    partiesByMatter.set(p.matter_id, list);
  }
  const outcomesByMatter = new Map<string, RegistryOutcome[]>();
  for (const o of outcomes) {
    const list = outcomesByMatter.get(o.matter_id) ?? [];
    list.push(o);
    outcomesByMatter.set(o.matter_id, list);
  }
  const courtMap = new Map(courts.map((c) => [c.court_id, c]));
  const mattersByCourt = new Map<string, RegistryMatter[]>();
  for (const m of matters) {
    const list = mattersByCourt.get(m.court_id) ?? [];
    list.push(m);
    mattersByCourt.set(m.court_id, list);
  }
  return { matters, partiesByMatter, outcomesByMatter, attorneys, courts: courtMap, mattersByCourt };
}

export function searchMatters(matters: RegistryMatter[], q: string): RegistryMatter[] {
  const term = q.trim().toLowerCase();
  if (!term) return matters;
  return matters.filter((m) => [m.case_name, m.docket_number, m.court_id, m.case_status].some((v) => (v ?? "").toLowerCase().includes(term)));
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Not recorded";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchJsonl<T>(name: string): Promise<T[]> {
  const res = await fetch(`/data/matter-registry/${name}.jsonl`);
  if (!res.ok) throw new Error(`Matter registry could not be loaded (${res.status}).`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error("Matter registry data is missing from this build.");
  return parseJsonl<T>(text);
}

let cached: Promise<Registry> | null = null;

/** Whole registry (small files only; documents load per matter). Cached for the session. */
export function loadRegistry(): Promise<Registry> {
  cached ??= (async () => {
    const [matters, parties, attorneys, outcomes, courts] = await Promise.all([
      fetchJsonl<RegistryMatter>("matters"),
      fetchJsonl<RegistryParty>("parties"),
      fetchJsonl<RegistryAttorney>("attorneys"),
      fetchJsonl<RegistryOutcome>("outcomes"),
      fetchJsonl<RegistryCourt>("courts"),
    ]);
    return buildRegistry(matters, parties, attorneys, outcomes, courts);
  })();
  return cached;
}

/** Documents for one matter (metadata only — the bundle has storage keys, not downloadable links). */
export async function loadMatterDocs(matterId: string): Promise<RegistryDoc[]> {
  const res = await fetch(`/data/matter-registry/docs/${encodeURIComponent(matterId)}.json`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Matter documents could not be loaded (${res.status}).`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) return [];
  return JSON.parse(text) as RegistryDoc[];
}
