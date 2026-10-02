import { restGet, rpcPost } from "./rest.server";
import {
  candidateRecordIds,
  inFilter,
  resolveSearchIdentities,
  type SearchRecord,
} from "./searchIdentity";

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
  if (!datasets.length) return { matches: [], unresolved: 0, total: 0, returned: 0 };
  const result = await rpcPost<{
    items: Record<string, unknown>[];
    total: number | null;
  }>("corpus_query", {
    p_q: q.trim(),
    p_datasets: datasets,
    p_filters: {},
    p_limit: pageSize,
    p_offset: offset,
    p_sort: null,
  });
  const items = result.items ?? [];
  const ids = candidateRecordIds(items);
  const records: SearchRecord[] = [];
  if (ids.length) {
    const path = `corpus_records?select=id,dataset,title,state,source_url,category,item&id=in.${inFilter(ids)}&dataset=in.${inFilter(datasets)}&order=dataset.asc,id.asc`;
    // A reused id can exist in every dataset. Page the bounded candidate set instead of taking the first match.
    const candidateBound = ids.length * datasets.length;
    for (let start = 0; start < candidateBound; start += 500) {
      const page = await restGet<SearchRecord[]>(path, {
        range: [start, start + 499],
      });
      records.push(...page.rows);
      if (page.rows.length < 500) break;
    }
  }
  return {
    ...resolveSearchIdentities(items, records),
    total: result.total ?? null,
    returned: items.length,
  };
}
