/**
 * Read-only corpus reads for the government domain registries (gov_domains, gov_domains_summary). Server only.
 * One bounded PostgREST read per question, matched by exact entry id; nothing is guessed from a name.
 */
import { restGet } from "./rest.server";
import {
  GOV_DOMAINS_DATASET,
  GOV_DOMAINS_SUMMARY_DATASET,
  buildLookupResult,
  candidateEntries,
  matchRegistry,
  parseGovFacts,
  parseGovRow,
  parseHostInput,
  parseSummaryAll,
  parseSummaryState,
  type GovFacts,
  type GovLookupResult,
  type GovRow,
  type GovSnapshot,
  type GovSummaryAll,
  type GovSummaryState,
} from "./govDomainsModel";

const enc = encodeURIComponent;
const cs = (v: unknown) => enc(JSON.stringify(v));
const PAGE = 1000;
const MAX_ROWS = 5000;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** The registry snapshot (summary record "all"), or null when the datasets are not published. */
export async function readGovSummary(): Promise<{
  all: GovSummaryAll | null;
  states: GovSummaryState[];
}> {
  return cached("summary", async () => {
    const { rows } = await restGet<{ id: string; s: unknown }[]>(
      `corpus_records?select=id,s:item->summary&dataset=eq.${GOV_DOMAINS_SUMMARY_DATASET}&order=id.asc&limit=200`,
    );
    const all = parseSummaryAll(rows.find((r) => r.id === "all")?.s);
    const states = rows.flatMap((r) => {
      const s = parseSummaryState(r.s);
      return s ? [s] : [];
    });
    return { all, states };
  });
}

export async function readGovSnapshot(): Promise<GovSnapshot | null> {
  return (await readGovSummary()).all?.snapshot ?? null;
}

/** Entries whose listing covers only pages of a host (about a hundred); small enough to read once and match in memory. */
async function readPathEntries(): Promise<GovFacts[]> {
  return cached("path-entries", async () => {
    const { rows } = await restGet<{ id: string; g: unknown }[]>(
      `corpus_records?select=id,g:item->gov&dataset=eq.${GOV_DOMAINS_DATASET}&filters=cs.${cs({ entry_kind: ["path"] })}&order=id.asc&limit=1000`,
    );
    return rows.flatMap((r) => {
      const f = parseGovFacts(r.id, r.g);
      return f && f.path ? [f] : [];
    });
  });
}

async function readEntries(ids: string[]): Promise<Map<string, GovFacts>> {
  const out = new Map<string, GovFacts>();
  if (!ids.length) return out;
  const { rows } = await restGet<{ id: string; g: unknown }[]>(
    `corpus_records?select=id,g:item->gov&dataset=eq.${GOV_DOMAINS_DATASET}&id=in.(${ids.map(enc).join(",")})&limit=${ids.length}`,
  );
  for (const r of rows) {
    const f = parseGovFacts(r.id, r.g);
    if (f) out.set(f.id, f);
  }
  return out;
}

/**
 * Look up hosts or http(s) addresses. All candidate entries of all inputs are fetched in one read; the match is then made
 * in memory by the pure model. `snapshot` is null when the summary dataset is not available.
 */
export async function lookupGovDomains(
  inputs: string[],
): Promise<{ results: GovLookupResult[]; snapshot: GovSnapshot | null }> {
  const parsed = inputs.map((input) => ({ input, p: parseHostInput(input) }));
  const wanted = new Set<string>();
  for (const { p } of parsed)
    if (p.ok) for (const id of candidateEntries(p.host, p.ip)) wanted.add(id);
  const [entries, paths, snapshot] = await Promise.all([
    readEntries([...wanted]),
    parsed.some(({ p }) => p.ok) ? readPathEntries() : Promise.resolve([] as GovFacts[]),
    readGovSnapshot().catch(() => null),
  ]);
  const results = parsed.map(({ input, p }) =>
    buildLookupResult(
      input,
      p,
      p.ok ? matchRegistry(p, entries, paths) : { hit: null, pathScoped: [] },
      snapshot,
    ),
  );
  return { results, snapshot };
}

export type StateGovRows = { rows: GovRow[]; total: number; truncated: boolean };

/** Every registered domain whose publisher-given state is this state (compact rows, paged). */
export async function readStateGovRows(usps: string): Promise<StateGovRows> {
  return cached(`state:${usps}`, async () => {
    const rows: GovRow[] = [];
    let total: number | null = null;
    for (let start = 0; start < MAX_ROWS; start += PAGE) {
      const r = await restGet<{ id: string; r: unknown }[]>(
        `corpus_records?select=id,r:item->row&dataset=eq.${GOV_DOMAINS_DATASET}&filters=cs.${cs({ state: [usps] })}&order=id.asc`,
        { count: start === 0, range: [start, start + PAGE - 1] },
      );
      if (start === 0) total = r.total;
      for (const x of r.rows) {
        const row = parseGovRow(x.id, x.r);
        if (row) rows.push(row);
      }
      if (r.rows.length < PAGE) break;
    }
    const count = total ?? rows.length;
    return { rows, total: count, truncated: rows.length < count };
  });
}
