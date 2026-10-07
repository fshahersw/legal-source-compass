import type { Json } from "./json";
import { restGet, rpcPost } from "./rest.server";
import {
  candidateRecordIds,
  candidateIdChunks,
  inFilter,
  resolveSearchIdentities,
  type SearchRecord,
} from "./searchIdentity";
import {
  rankSearchMatches,
  searchCourtId,
  searchIntent,
  searchQueryFilters,
  searchState,
} from "./searchQuality";
import { exactCourtLocations } from "@/lib/corpus/courtLocations";

const SEARCH_CANDIDATES = 500;
const PRIORITY_CANDIDATES = 250;
/**
 * Entity datasets that get their own bounded pass, so a matter, judge, court or registry hit never depends on its
 * ordinal inside the 500 lowest-ordinal matches of a corpus-wide pass (corpus_query orders by ordinal when p_sort is null).
 */
const PRIORITY_DATASETS = [
  "mdls",
  "sw_matters_v1",
  "expert_rulings",
  "judges",
  "cl_people",
  "court_spine",
] as const;

type MdlJudgeIds = { mdlJudgePersonIds: Set<string>; mdlJudgeEntityIds: Set<string> };
let mdlJudgeCache: { at: number; ids: MdlJudgeIds } | null = null;

/**
 * Native ids of the judges who preside over an MDL (mdls.filters.cl_person_id and .entity_id); cached for ten minutes.
 * Only used to rank a person-intent query, never to link or merge anything.
 */
async function mdlJudgeIds(): Promise<MdlJudgeIds> {
  if (mdlJudgeCache && Date.now() - mdlJudgeCache.at < 10 * 60_000) return mdlJudgeCache.ids;
  const r = await restGet<{ person: unknown; entity: unknown }[]>(
    "corpus_records?select=person:filters->cl_person_id,entity:filters->entity_id&dataset=eq.mdls&limit=1000",
  );
  const many = (v: unknown) => (Array.isArray(v) ? v : [v]);
  const ids: MdlJudgeIds = { mdlJudgePersonIds: new Set(), mdlJudgeEntityIds: new Set() };
  for (const row of r.rows) {
    for (const v of many(row.person))
      if ((typeof v === "string" || typeof v === "number") && /^\d{1,12}$/.test(String(v)))
        ids.mdlJudgePersonIds.add(String(v));
    for (const v of many(row.entity))
      if (typeof v === "string" && /^judge-entity-[a-f0-9]{8,64}$/.test(v))
        ids.mdlJudgeEntityIds.add(v);
  }
  mdlJudgeCache = { at: Date.now(), ids };
  return ids;
}

export async function queryPublishedDataset(
  data: {
    dataset: string;
    q: string;
    filters: Record<string, string>;
    offset: number;
  },
  pageSize: number,
) {
  const res = await rpcPost<{
    items: Record<string, Json>[];
    total: number | null;
    total_capped: boolean;
  }>("corpus_query_bounded", {
    p_q: data.q.trim() || null,
    p_dataset: data.dataset,
    p_filters: data.filters,
    p_limit: pageSize,
    p_offset: data.offset,
    p_count_cap: 10000,
  });
  // An empty page is an authoritative result, including when publication has not been cleared.
  return {
    items: res.items ?? [],
    total: res.total ?? null,
    capped: !!res.total_capped,
    pageSize,
    mode: "listing" as const,
  };
}

export async function searchPublishedCorpus(q: string, offset: number, pageSize: number) {
  const catalog = await restGet<{ id: string; imported_records: number | null }[]>(
    "corpus_datasets?select=id,imported_records&ready=eq.true&order=id.asc",
  );
  const datasets = catalog.rows.map((d) => d.id);
  const empty = {
    matches: [],
    unresolved: 0,
    total: 0,
    returned: 0,
    hasMore: false,
    rankedCandidates: 0,
    nativeCandidates: 0,
    groupedSourceRecords: 0,
    candidateLimit: SEARCH_CANDIDATES,
    candidateCapped: false,
  };
  if (!datasets.length) return empty;
  const priority = PRIORITY_DATASETS.filter((id) => datasets.includes(id));
  // A leading honorific ("Judge Rodgers") is intent to find a person; titles never contain it, so the database is
  // asked for the name alone and ranking uses the intent (people datasets, then MDL transferee judges).
  const intent = searchIntent(q);
  const dbQuery = intent.query;
  // Every pass stays inside ready datasets. Re-score a stable bounded pool before pagination.
  const [context, ...passes] = await Promise.all([
    intent.honorific ? mdlJudgeIds().catch(() => ({})) : Promise.resolve({}),
    ...[datasets, ...priority.map((id) => [id])].map(async (scope, index) => {
      const limit = index === 0 ? SEARCH_CANDIDATES : PRIORITY_CANDIDATES;
      const result = await rpcPost<{ items: Record<string, unknown>[]; total: number | null }>(
        "corpus_query",
        {
          p_q: dbQuery,
          p_datasets: scope,
          p_filters: searchQueryFilters(dbQuery),
          p_limit: limit,
          p_offset: 0,
          p_sort: null,
        },
      );
      return { scope, limit, items: result.items ?? [], total: result.total ?? null };
    }),
  ]);
  const items = passes.flatMap((pass) => pass.items);
  const ids = candidateRecordIds(items);
  const records: SearchRecord[] = [];
  // Bound URL size as well as row count; reused IDs may occur in multiple published datasets.
  const lookupPrefix =
    "corpus_records?select=id,dataset,title,state,source_url,category,item&id=in.";
  const lookupSuffix = `&dataset=in.${inFilter(datasets)}&order=dataset.asc,id.asc`;
  for (const chunk of candidateIdChunks(ids, 7000 - lookupPrefix.length - lookupSuffix.length)) {
    const path = `${lookupPrefix}${inFilter(chunk)}${lookupSuffix}`;
    for (let start = 0; start < chunk.length * datasets.length; start += 500) {
      const page = await restGet<SearchRecord[]>(path, { range: [start, start + 499] });
      records.push(...page.rows);
      if (page.rows.length < 500) break;
    }
  }
  const resolved = passes.map((pass) =>
    resolveSearchIdentities(
      pass.items,
      records.filter((record) => pass.scope.includes(record.dataset)),
    ),
  );
  const quality = rankSearchMatches(
    resolved.flatMap((pass) => pass.matches),
    q,
    context,
  );
  const pageMatches = quality.ranked.slice(offset, offset + pageSize);
  const courtIds = [...new Set(pageMatches.map(searchCourtId).filter((id): id is string => !!id))];
  let courtLocations = new Map<string, string>();
  if (datasets.includes("court_spine") && courtIds.length) {
    const courts = await restGet<{ id: string; state: string | null }[]>(
      `corpus_records?select=id,state&dataset=eq.court_spine&id=in.${inFilter(courtIds)}&order=id.asc&limit=500`,
    );
    courtLocations = exactCourtLocations(
      courts.rows.map((court) => ({ id: court.id, state: court.state ?? "" })),
    );
  }
  const matches = pageMatches.map((match) => ({ ...match, ...searchState(match, courtLocations) }));
  return {
    matches,
    unresolved: resolved.reduce((sum, pass) => sum + pass.unresolved, 0),
    total: passes[0]!.total,
    returned: matches.length,
    hasMore: offset + matches.length < quality.ranked.length,
    rankedCandidates: quality.ranked.length,
    nativeCandidates: quality.nativeRecords,
    groupedSourceRecords: quality.groupedSourceRecords,
    candidateLimit: SEARCH_CANDIDATES + priority.length * PRIORITY_CANDIDATES,
    candidateCapped: passes.some((pass) =>
      pass.total === null ? pass.items.length === pass.limit : pass.total > pass.limit,
    ),
  };
}
