/**
 * Compact read-only helpers for counting corpus rows: run work with bounded concurrency, read every row of a
 * narrow projection in pages, or count the rows a filter matches. Server-only (restGet uses the service credentials).
 */
import { restGet } from "@/lib/external/rest.server";

const PAGE = 1000;

/** Run `fn` over `items` with at most `limit` calls in flight; results keep the order of `items`. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i]!, i);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Every row of a PostgREST query, 1,000 per request. The first request reports the total (exact count); the
 * remaining pages are read in parallel. `path` must carry a stable `order=` so the pages do not overlap. Throws when
 * the total exceeds `max`, so a surprise growth of a dataset is an error and never a silently truncated count.
 */
export async function readAllRows<T>(
  path: string,
  options: { max?: number; concurrency?: number } = {},
): Promise<T[]> {
  const max = options.max ?? 60_000;
  const first = await restGet<T[]>(path, { count: true, range: [0, PAGE - 1] });
  const total = first.total;
  if (total === null) throw new Error("The corpus did not report a row total.");
  if (total > max) throw new Error(`Row total ${total} exceeds the read limit of ${max}.`);
  const pages: number[] = [];
  for (let start = PAGE; start < total; start += PAGE) pages.push(start);
  const rest = await mapLimit(pages, options.concurrency ?? 4, async (start) => {
    const r = await restGet<T[]>(path, { range: [start, start + PAGE - 1] });
    return r.rows;
  });
  const rows = [first.rows, ...rest].flat();
  if (rows.length !== total)
    throw new Error(`Read ${rows.length} rows but the corpus reported ${total}.`);
  return rows;
}

/** Number of rows a query matches (an exact count with one row fetched). `path` has no `select` of its own. */
export async function countRows(path: string): Promise<number> {
  const r = await restGet<unknown[]>(`${path}${path.includes("?") ? "&" : "?"}select=id`, {
    count: true,
    range: [0, 0],
  });
  if (r.total === null) throw new Error("The corpus did not report a row count.");
  return r.total;
}

/** `corpus_records` filter on a JSON path, e.g. `item->cells->>kind`, encoded the way the other reads write it. */
export const jsonPath = (path: string) => encodeURIComponent(path);
