import { rpcPost } from "./rest.server";
import { DIRECTORY_PAGE_SIZE } from "./directoryPaging";
import { toCourtRow, toJudgeRow } from "./directoryTree";
import { canonicalState, filterStateJudges } from "@/lib/corpus/stateHub";
export async function readStateDirectoryPage(
  dataset: "court_spine" | "judges",
  state: string,
  offset: number,
) {
  const identity = canonicalState(state);
  if (!identity) throw new Error("Unknown state.");
  const result = await rpcPost<{ items: Record<string, unknown>[] }>("corpus_query_bounded", {
    p_q: null,
    p_dataset: dataset,
    p_filters: { state: dataset === "judges" ? identity.name : identity.usps },
    p_limit: DIRECTORY_PAGE_SIZE,
    p_offset: offset,
    p_count_cap: 0,
  });
  const items = result.items ?? [];
  if (items.length > DIRECTORY_PAGE_SIZE)
    throw new Error("The directory returned an oversized page.");
  const rows = dataset === "court_spine" ? items.map(toCourtRow) : items.map(toJudgeRow);
  const matched =
    dataset === "court_spine"
      ? items.map(toCourtRow).filter((row) => canonicalState(row.state)?.usps === identity.usps)
      : filterStateJudges(items.map(toJudgeRow), identity.usps);
  if (matched.length !== rows.length)
    throw new Error("Directory jurisdiction mismatch; results have been withheld.");
  return {
    rows,
    nextOffset: items.length === DIRECTORY_PAGE_SIZE ? offset + DIRECTORY_PAGE_SIZE : null,
    pageSize: DIRECTORY_PAGE_SIZE,
  };
}
