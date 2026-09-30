import { createServerFn } from "@tanstack/react-start";
import { rpcPost } from "./rest.server";
import { toCourtRow, toJudgeRow, type CourtRow, type JudgeRow } from "./directoryTree";

const PAGE = 500;

async function loadAll(dataset: string, max: number) {
  const out: Record<string, any>[] = [];
  for (let base = 0; base < max; base += PAGE * 6) {
    const pages = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        rpcPost<{ items: Record<string, any>[] }>("corpus_query_bounded", { p_q: null, p_dataset: dataset, p_filters: {}, p_limit: PAGE, p_offset: base + i * PAGE, p_count_cap: 0 }).then((r) => r.items ?? []),
      ),
    );
    for (const p of pages) out.push(...p);
    if (pages.some((p) => p.length < PAGE)) break;
  }
  return out;
}

/** Whole court directory as compact rows (≈5.4k), read-only. */
export const listCourtDirectory = createServerFn({ method: "GET" }).handler(async (): Promise<CourtRow[]> => (await loadAll("court_spine", 20000)).map(toCourtRow));

/** Whole judge directory as compact rows (≈10.7k), read-only. */
export const listJudgeDirectory = createServerFn({ method: "GET" }).handler(async (): Promise<JudgeRow[]> => (await loadAll("judges", 40000)).map(toJudgeRow));
