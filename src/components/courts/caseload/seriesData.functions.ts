/**
 * Read-only server functions for the published-tables views of /courts/caseload: the U.S. Courts statistical table series
 * (datasets uscourts_tables_*, uscourts_bapcpa, uscourts_wiretap) and their index (uscourts_series_index), built by
 * scripts/enrichment/uscourts_tables.
 *
 * The index lists every series with its periods, columns, record ids, reconciliation and coverage. Until it is published the
 * list falls back to the table catalog the national dataset carries (summary:catalog), which names the same tables without the
 * coverage and reconciliation detail; the result says which one it is. Stored JSON is validated: unknown datasets and malformed
 * ids are refused, a value that is not a finite number is dropped (shown as "Not recorded"), only http(s) source links survive.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "@/lib/external/rest.server";
import {
  parseUstCatalog,
  parseUstNational,
  parseUstTable,
  type UstNationalTable,
  type UstTable,
} from "@/lib/external/uscourtsTables.functions";
import {
  INDEX_DATASET,
  NATIONAL_DATASET,
  SERIES_DATASETS,
  parseCoverageSummary,
  parseHeld,
  parseLatest,
  parsePublicationCoverage,
  parseSeriesCard,
  parseSeriesDetail,
  cardFromCatalog,
  type CoverageSummary,
  type HeldItem,
  type LatestTable,
  type PublicationCoverage,
  type SeriesCard,
  type SeriesDetail,
} from "./seriesModel";

const TABLE_KEY = /^[a-z0-9][a-z0-9-]{0,40}$/;
const COURT_ID = /^[a-z0-9]{2,8}$/;
const DATASET = z.enum(SERIES_DATASETS);

type Cache<T> = { at: number; value: T };
const TTL = 10 * 60 * 1000;
const cache = new Map<string, Cache<unknown>>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Cache<T> | undefined;
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export type SeriesList = {
  /** "index": the series index is published; "catalog": the national dataset's table catalog (no coverage detail). */
  source: "index" | "catalog";
  cards: SeriesCard[];
  /** Index rows that could not be read and were left out. */
  dropped: number;
};

const CARD_SELECT = [
  "id",
  "cells:item->cells",
  "tk:item->series->>tableKey",
  "table:item->series->>table",
  "title:item->series->>title",
  "scope:item->series->>scope",
  "geo:item->series->>geography",
  "fam:item->series->>family",
  "pubs:item->series->pubs",
  "nat:item->series->national",
  "cds:item->series->courts->>dataset",
  "ccount:item->series->courts->count",
  "latest:item->series->latest",
  "rstatus:item->series->rec->>status",
  "held:item->series->rec->held",
  "page:item->series->>page",
].join(",");

export async function loadSeriesList(): Promise<SeriesList> {
  const index = await restGet<Record<string, unknown>[]>(
    `corpus_records?select=${CARD_SELECT}&dataset=eq.${INDEX_DATASET}&id=like.series:*&order=id&limit=1000`,
  );
  if (index.rows.length) {
    const cards = index.rows.map(parseSeriesCard);
    const ok = cards.filter((c): c is SeriesCard => c != null);
    return { source: "index", cards: ok, dropped: cards.length - ok.length };
  }
  const cat = await restGet<{ id: string; catalog: unknown }[]>(
    `corpus_records?select=id,catalog:item->catalog&dataset=eq.${NATIONAL_DATASET}&id=eq.summary:catalog`,
  );
  const entries = parseUstCatalog(cat.rows[0]?.catalog);
  return { source: "catalog", cards: entries.map(cardFromCatalog), dropped: 0 };
}

export const getSeriesList = createServerFn({ method: "GET" }).handler(
  async (): Promise<SeriesList> => cached("series:list", loadSeriesList),
);

export const getSeriesDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ tableKey: z.string().regex(TABLE_KEY) }).parse(d))
  .handler(async ({ data }): Promise<SeriesDetail | null> =>
    cached(`series:detail:${data.tableKey}`, async () => {
      const r = await restGet<{ id: string; s: unknown }[]>(
        `corpus_records?select=id,s:item->series&dataset=eq.${INDEX_DATASET}&id=eq.${encodeURIComponent(`series:${data.tableKey}`)}`,
      );
      return parseSeriesDetail(r.rows[0]?.s);
    }),
  );

export type SeriesTableResult =
  | { kind: "national"; table: UstNationalTable }
  | { kind: "court"; table: UstTable }
  | { kind: "missing" };

/** One stored table record: a national table (category rows or the Total row) or one court's table. */
export const getSeriesTable = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        dataset: DATASET,
        id: z.string().regex(/^([a-z0-9]{2,8}:)?[a-z0-9][a-z0-9-]{0,40}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<SeriesTableResult> =>
    cached(`series:table:${data.dataset}:${data.id}`, async () => {
      const r = await restGet<{ id: string; ust: unknown }[]>(
        `corpus_records?select=id,ust:item->ust&dataset=eq.${data.dataset}&id=eq.${encodeURIComponent(data.id)}`,
      );
      const raw = r.rows[0]?.ust;
      if (!raw) return { kind: "missing" };
      const national = parseUstNational(raw);
      if (national) return { kind: "national", table: national };
      const court = parseUstTable(raw);
      return court ? { kind: "court", table: court } : { kind: "missing" };
    }),
  );

/** The same table for several courts (at most six), for a comparison chart. */
export const getSeriesCourts = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        dataset: DATASET,
        tableKey: z.string().regex(TABLE_KEY),
        courts: z.array(z.string().regex(COURT_ID)).min(1).max(6),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<UstTable[]> =>
    cached(
      `series:courts:${data.dataset}:${data.tableKey}:${[...data.courts].sort().join(",")}`,
      async () => {
        const ids = [...new Set(data.courts)].map((c) => `"${c}:${data.tableKey}"`).join(",");
        const r = await restGet<{ id: string; ust: unknown }[]>(
          `corpus_records?select=id,ust:item->ust&dataset=eq.${data.dataset}&id=in.(${encodeURIComponent(ids)})`,
        );
        const out: UstTable[] = [];
        for (const row of r.rows) {
          const t = parseUstTable(row.ust);
          if (t && t.court && data.courts.includes(t.court) && t.tableKey === data.tableKey)
            out.push(t);
        }
        return out.sort((a, b) => data.courts.indexOf(a.court!) - data.courts.indexOf(b.court!));
      },
    ),
  );

/** Every court's value in the table's latest period (the record "latest:<table>"), for the district comparison. */
export const getSeriesLatest = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ dataset: DATASET, tableKey: z.string().regex(TABLE_KEY) }).parse(d),
  )
  .handler(async ({ data }): Promise<LatestTable | null> =>
    cached(`series:latest:${data.dataset}:${data.tableKey}`, async () => {
      const r = await restGet<{ id: string; ust: unknown }[]>(
        `corpus_records?select=id,ust:item->ust&dataset=eq.${data.dataset}&id=eq.${encodeURIComponent(`latest:${data.tableKey}`)}`,
      );
      return parseLatest(r.rows[0]?.ust);
    }),
  );

export type CourtName = { id: string; name: string };

/** Court names as the stored records title them ("U.S. District Court, S.D. New York"), for the courts holding a table. */
export const getSeriesCourtNames = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ dataset: DATASET, tableKey: z.string().regex(TABLE_KEY) }).parse(d),
  )
  .handler(async ({ data }): Promise<CourtName[]> =>
    cached(`series:names:${data.dataset}:${data.tableKey}`, async () => {
      const r = await restGet<{ id: string; title: string }[]>(
        `corpus_records?select=id,title&dataset=eq.${data.dataset}&id=like.${encodeURIComponent(`*:${data.tableKey}`)}&limit=400`,
      );
      const out: CourtName[] = [];
      for (const row of r.rows) {
        const [court, key] = row.id.split(":");
        if (!court || key !== data.tableKey || !COURT_ID.test(court) || court === "latest")
          continue;
        const name = typeof row.title === "string" ? row.title.split(" - Table ")[0]?.trim() : "";
        if (name) out.push({ id: court, name });
      }
      return out;
    }),
  );

export const getCoverageSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<CoverageSummary | null> =>
    cached("series:coverage", async () => {
      const r = await restGet<{ id: string; c: unknown }[]>(
        `corpus_records?select=id,c:item->coverage&dataset=eq.${INDEX_DATASET}&id=eq.summary:coverage`,
      );
      return parseCoverageSummary(r.rows[0]?.c);
    }),
);

export const getPublicationCoverage = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ code: z.string().regex(/^[A-Z]{2,8}$/) }).parse(d))
  .handler(async ({ data }): Promise<PublicationCoverage | null> =>
    cached(`series:pub:${data.code}`, async () => {
      const r = await restGet<{ id: string; p: unknown }[]>(
        `corpus_records?select=id,p:item->publication&dataset=eq.${INDEX_DATASET}&id=eq.${encodeURIComponent(`pub:${data.code}`)}`,
      );
      return parsePublicationCoverage(r.rows[0]?.p);
    }),
  );

export const getHeldTables = createServerFn({ method: "GET" }).handler(
  async (): Promise<HeldItem[]> =>
    cached("series:held", async () => {
      const r = await restGet<{ id: string; h: unknown }[]>(
        `corpus_records?select=id,h:item->held&dataset=eq.${INDEX_DATASET}&id=eq.summary:held`,
      );
      return parseHeld(r.rows[0]?.h);
    }),
);
