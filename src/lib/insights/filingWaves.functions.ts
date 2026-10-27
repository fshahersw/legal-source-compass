/**
 * Read of the gross new-filing waves (dataset fjc_civil_mdls, 953 records; MDL captions from dataset mdls by exact
 * MDL number). Read-only, memoized for 10 minutes; failures are not cached.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "@/lib/external/rest.server";
import { readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync, READ_TTL_MS } from "./readers/cache";
import {
  buildFilingWaves,
  COHORT_MIN_CASES,
  isProductMdl,
  parseMdlFyRow,
  type FilingWaves,
} from "./filingWaves";

const read = memoAsync(READ_TTL_MS, async (): Promise<FilingWaves> => {
  const raw = await readAllRows<unknown>(
    "corpus_records?select=id,c:item->cells,fy:item->profile->by_fy,nos:item->profile->nos&dataset=eq.fjc_civil_mdls&order=ordinal.asc",
    { max: 3_000 },
  );
  const rows = raw.flatMap((r) => {
    const row = parseMdlFyRow(r);
    return row ? [row] : [];
  });
  // Captions only for the cohort, joined on the exact MDL number (dataset mdls ids are the bare number).
  const cohort = rows
    .filter((r) => isProductMdl(r) && r.cases >= COHORT_MIN_CASES)
    .map((r) => r.mdl);
  const titles = new Map<number, string>();
  for (let i = 0; i < cohort.length; i += 150) {
    const ids = cohort.slice(i, i + 150).join(",");
    const res = await restGet<{ id: string; title: string | null }[]>(
      `corpus_records?select=id,title&dataset=eq.mdls&id=in.(${ids})&limit=200`,
    );
    for (const t of res.rows)
      if (/^\d{1,5}$/.test(t.id) && typeof t.title === "string" && t.title)
        titles.set(Number(t.id), t.title.slice(0, 200));
  }
  return buildFilingWaves(rows.map((r) => ({ ...r, title: titles.get(r.mdl) ?? null })));
});

export const getFilingWaves = createServerFn({ method: "GET" }).handler(
  async (): Promise<FilingWaves> =>
    read().catch((e: unknown) => {
      console.error("filing waves", e);
      throw new Error("The FJC MDL filing counts could not be read just now.");
    }),
);
