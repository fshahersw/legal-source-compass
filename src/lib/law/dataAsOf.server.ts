/**
 * When each dataset was last refreshed (corpus_datasets.updated_at, as its UTC date). Sections show this as their
 * "as of" date so an older snapshot never looks current; today's date stays only the reference for windows such as
 * "last 12 months" or comment deadlines. One indexed read by primary key; a missing row is null ("Not recorded").
 */
import { restGet } from "@/lib/external/rest.server";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/**
 * The refresh date of each requested dataset id; ids the catalog does not list map to null. A failed read also maps
 * every id to null (the section still renders, with its as-of date "Not recorded"), and is logged.
 */
export async function datasetRefreshDates<K extends string>(
  ids: readonly K[],
): Promise<Record<K, string | null>> {
  const rows = await restGet<{ id: string; updated_at: string | null }[]>(
    `corpus_datasets?select=id,updated_at&id=in.(${ids.join(",")})`,
  ).then(
    (r) => r.rows,
    (e: unknown) => {
      console.error("dataset refresh dates", e);
      return [];
    },
  );
  const byId = new Map(rows.map((row) => [row.id, row.updated_at]));
  return Object.fromEntries(
    ids.map((id) => {
      const v = byId.get(id);
      return [id, typeof v === "string" && ISO_DAY.test(v) ? v.slice(0, 10) : null];
    }),
  ) as Record<K, string | null>;
}
