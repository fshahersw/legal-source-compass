import { rpcPost } from "./rest.server";
import { toCourtRow, toJudgeRow } from "./directoryTree";
import { DIRECTORY_PAGE_SIZE } from "./directoryPaging";
import { portraitForJudge } from "@/lib/judges/portraits.server";

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
  const rows =
    dataset === "court_spine"
      ? items.map(toCourtRow)
      : items.map((item) => {
          const row = toJudgeRow(item);
          return { ...row, portrait: portraitForJudge(row.id)?.assetPath ?? null };
        });
  return {
    rows,
    nextOffset: items.length === DIRECTORY_PAGE_SIZE ? offset + DIRECTORY_PAGE_SIZE : null,
    pageSize: DIRECTORY_PAGE_SIZE,
  };
}
