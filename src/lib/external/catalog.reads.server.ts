import { restGet, rpcPost } from "./rest.server";
import {
  candidateRecordIds,
  candidateIdChunks,
  inFilter,
  resolveSearchIdentities,
  type SearchRecord,
} from "./searchIdentity";
import { rankSearchMatches, searchCourtId, searchQueryFilters, searchState } from "./searchQuality";
import { exactCourtLocations } from "@/lib/corpus/courtLocations";

const SEARCH_CANDIDATES = 500;
const PRIORITY_CANDIDATES = 250;

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
    items: Record<string, unknown>[];
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
  const catalog = await restGet<{ id: string }[]>(
    "corpus_datasets?select=id&ready=eq.true&order=id.asc",
  );
  const datasets = catalog.rows.map((d) => d.id);
  const empty = { matches: [], unresolved: 0, total: 0, returned: 0, hasMore: false, rankedCandidates: 0, nativeCandidates: 0, groupedSourceRecords: 0, candidateLimit: SEARCH_CANDIDATES, candidateCapped: false };
  if (!datasets.length) return empty;
  const priority = ["mdls", "expert_rulings"].filter((id) => datasets.includes(id));
  // Every pass stays inside ready datasets. Re-score a stable bounded pool before pagination.
  const passes = await Promise.all([datasets, ...priority.map((id) => [id])].map(async (scope, index) => {
    const limit = index === 0 ? SEARCH_CANDIDATES : PRIORITY_CANDIDATES;
    const result = await rpcPost<{ items: Record<string, unknown>[]; total: number | null }>("corpus_query", {
      p_q: q.trim(), p_datasets: scope, p_filters: searchQueryFilters(q), p_limit: limit, p_offset: 0, p_sort: null,
    });
    return { scope, limit, items: result.items ?? [], total: result.total ?? null };
  }));
  const items = passes.flatMap((pass) => pass.items);
  const ids = candidateRecordIds(items);
  const records: SearchRecord[] = [];
  // Bound URL size as well as row count; reused IDs may occur in multiple published datasets.
  const lookupPrefix = "corpus_records?select=id,dataset,title,state,source_url,category,item&id=in.";
  const lookupSuffix = `&dataset=in.${inFilter(datasets)}&order=dataset.asc,id.asc`;
  for (const chunk of candidateIdChunks(ids, 7000 - lookupPrefix.length - lookupSuffix.length)) {
    const path = `${lookupPrefix}${inFilter(chunk)}${lookupSuffix}`;
    for (let start = 0; start < chunk.length * datasets.length; start += 500) {
      const page = await restGet<SearchRecord[]>(path, { range: [start, start + 499] });
      records.push(...page.rows);
      if (page.rows.length < 500) break;
    }
  }
  const resolved = passes.map((pass) => resolveSearchIdentities(pass.items, records.filter((record) => pass.scope.includes(record.dataset))));
  const quality = rankSearchMatches(resolved.flatMap((pass) => pass.matches), q);
  const pageMatches = quality.ranked.slice(offset, offset + pageSize);
  const courtIds = [...new Set(pageMatches.map(searchCourtId).filter((id): id is string => !!id))];
  let courtLocations = new Map<string, string>();
  if (datasets.includes("court_spine") && courtIds.length) {
    const courts = await restGet<{ id: string; state: string | null }[]>(`corpus_records?select=id,state&dataset=eq.court_spine&id=in.${inFilter(courtIds)}&order=id.asc&limit=500`);
    courtLocations = exactCourtLocations(courts.rows.map((court) => ({ id: court.id, state: court.state ?? "" })));
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
    candidateCapped: passes.some((pass) => pass.total === null ? pass.items.length === pass.limit : pass.total > pass.limit),
  };
}
