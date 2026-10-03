import { rpcPost } from "./rest.server";
import { toCourtRow, toJudgeRow } from "./directoryTree";
import { DIRECTORY_PAGE_SIZE } from "./directoryPaging";

export async function readDirectoryPage(dataset: "court_spine" | "judges", offset: number) {
  const result = await rpcPost<{ items: Record<string, unknown>[] }>("corpus_query_bounded", {
    p_q: null,
    p_dataset: dataset,
    p_filters: {},
    p_limit: DIRECTORY_PAGE_SIZE,
    p_offset: offset,
    p_count_cap: 0,
  });
  const items = result.items ?? [];
  if (items.length > DIRECTORY_PAGE_SIZE)
    throw new Error("The directory returned an oversized page.");
  const rows = dataset === "court_spine" ? items.map(toCourtRow) : items.map(toJudgeRow);
  return {
    rows,
    nextOffset: items.length === DIRECTORY_PAGE_SIZE ? offset + DIRECTORY_PAGE_SIZE : null,
    pageSize: DIRECTORY_PAGE_SIZE,
  };
}
