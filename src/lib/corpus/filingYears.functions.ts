import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "@/lib/external/rest.server";

/** Published datasets whose rows carry their own ISO filing date, and the cell that holds it. */
const DATE_CELLS = {
  sw_matter_dockets_v1: "filed",
  sw_docket_entries_v1: "date_filed",
  cl_master_entries: "date_filed",
} as const;
export type FilingYearDataset = keyof typeof DATE_CELLS;
const DATASETS = Object.keys(DATE_CELLS) as [FilingYearDataset, ...FilingYearDataset[]];

export type FilingYears = {
  dataset: FilingYearDataset;
  /** imported_records from the dataset listing; null when the listing records no count. */
  total: number | null;
  /** Rows whose recorded date is a string starting with a year from 1900 to 2099. */
  dated: number;
  notRecorded: number | null;
  years: { year: number; count: number }[];
  readAt: string;
};

const FIRST_YEAR = 1900;
const LAST_YEAR = 2099;
const TTL_MS = 10 * 60_000;
const cache = new Map<FilingYearDataset, { at: number; value: FilingYears }>();

async function countBetween(dataset: FilingYearDataset, from: number, to: number): Promise<number> {
  const cell = encodeURIComponent(`item->cells->>${DATE_CELLS[dataset]}`);
  const bound = (y: number) => `${String(y).padStart(4, "0")}-01-01`;
  const path = `corpus_records?select=id&dataset=eq.${dataset}&${cell}=gte.${bound(from)}&${cell}=lt.${bound(to)}`;
  const r = await restGet<unknown[]>(path, { count: true, range: [0, 0] });
  return r.total ?? 0;
}

/** Exact per-year row counts read from the corpus; nothing is stored or estimated. */
export const getFilingYears = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ dataset: z.enum(DATASETS) }).parse(d))
  .handler(async ({ data }): Promise<FilingYears> => {
    const hit = cache.get(data.dataset);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const meta = await restGet<{ imported_records: number | null }[]>(
      `corpus_datasets?select=imported_records&id=eq.${data.dataset}&limit=1`,
    );
    const total = typeof meta.rows[0]?.imported_records === "number" ? meta.rows[0].imported_records : null;
    const decades: number[] = [];
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y += 10) decades.push(y);
    const decadeCounts = await Promise.all(decades.map((y) => countBetween(data.dataset, y, y + 10)));
    const years: { year: number; count: number }[] = [];
    const queue: number[] = [];
    decades.forEach((start, i) => {
      if (decadeCounts[i]! > 0) for (let y = start; y < start + 10; y++) queue.push(y);
    });
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        for (let y = queue.shift(); y !== undefined; y = queue.shift()) {
          const count = await countBetween(data.dataset, y, y + 1);
          if (count > 0) years.push({ year: y, count });
        }
      }),
    );
    years.sort((a, b) => a.year - b.year);
    const dated = years.reduce((n, r) => n + r.count, 0);
    const value: FilingYears = {
      dataset: data.dataset,
      total,
      dated,
      notRecorded: total === null ? null : Math.max(0, total - dated),
      years,
      readAt: new Date().toISOString(),
    };
    cache.set(data.dataset, { at: Date.now(), value });
    return value;
  });
