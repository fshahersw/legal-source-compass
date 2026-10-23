/**
 * Reads used by more than one block (overview and depth pages): each is cached once, so the overview's DOJ chart and
 * the depth page's DOJ charts share one read of the index, one pass over the SEC records and so on. Server-only.
 */
import { restGet } from "@/lib/external/rest.server";
import { parseDojOverview, type DojOverview } from "@/lib/external/enforcementActions.functions";
import {
  parseOshaEnforcement,
  type OshaEnforcement,
} from "@/lib/external/oshaEnforcement.functions";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import { isoDate, text } from "./parse";
import { countRows, jsonPath, readAllRows } from "./tally.server";

/** Heavier reads (many pages or counts) are kept longer: the datasets change only when a build is published. */
export const LONG_TTL_MS = 30 * 60 * 1000;
export const today = () => new Date().toISOString().slice(0, 10);

/** Selected keys of a dataset's `metadata.summary`. `suffix` is the JSON path after `summary`: "->>snapshot" (text) or "->by_year" (JSON). */
export async function datasetSummary<K extends string>(
  dataset: string,
  keys: Record<K, string>,
): Promise<Partial<Record<K, unknown>>> {
  const select = Object.entries(keys)
    .map(([alias, suffix]) => `${alias}:metadata->summary${String(suffix)}`)
    .join(",");
  const r = await restGet<Record<string, unknown>[]>(
    `corpus_datasets?select=${select}&id=eq.${dataset}&limit=1`,
  );
  return (r.rows[0] ?? {}) as Partial<Record<K, unknown>>;
}

/** The latest date held in a dataset, read by ordering on a JSON path (ISO dates sort as text). */
export async function latestDate(
  dataset: string,
  jsonOrder: string,
  jsonText: string,
): Promise<string | null> {
  const r = await restGet<{ d: unknown }[]>(
    `corpus_records?select=d:${jsonText}&dataset=eq.${dataset}&order=${jsonOrder}.desc.nullslast&limit=1`,
  );
  return isoDate(r.rows[0]?.d);
}

/** The DOJ press-release index (years, components, amount buckets) and the latest release date of the newest year. */
export const readDojIndex = memoAsync<{ overview: DojOverview; latest: string | null } | null>(
  LONG_TTL_MS,
  async () => {
    const r = await restGet<{ o: unknown }[]>(
      "corpus_records?select=o:item->overview&dataset=eq.doj_press_releases&id=eq.doj-index:overview&limit=1",
    );
    const overview = parseDojOverview(r.rows[0]?.o);
    if (!overview) return null;
    const last = overview.partitions[overview.partitions.length - 1];
    const latest = last
      ? await latestDate(last.dataset, "item->release->date", "item->release->>date")
      : null;
    return { overview, latest };
  },
);

/** Year, type and amount bucket of every SEC litigation release and administrative proceeding, and the latest date. */
export const readSecRows = memoAsync<{
  rows: { y: unknown; t: unknown; a: unknown }[];
  latest: string | null;
}>(LONG_TTL_MS, async () => {
  const [rows, latest] = await Promise.all([
    readAllRows<{ y: unknown; t: unknown; a: unknown }>(
      "corpus_records?select=y:filters->year->>0,t:filters->type->>0,a:filters->amount->>0&dataset=eq.sec_enforcement_actions&order=ordinal.asc,id.asc",
    ),
    latestDate("sec_enforcement_actions", "item->sec_action->date", "item->sec_action->>date"),
  ]);
  return { rows, latest };
});

/** EPA ECHO national case-series rows (`cells`) and the dataset's file date and latest complete fiscal year. */
export const readEpaSeries = memoAsync<{
  cells: unknown[];
  fileDate: string | null;
  latestCompleteFy: number | null;
}>(READ_TTL_MS, async () => {
  const [rows, summary] = await Promise.all([
    restGet<{ cells: unknown }[]>(
      "corpus_records?select=cells:item->cells&dataset=eq.epa_echo_case_series&id=like.epa-echo-series:US:*&order=ordinal.asc&limit=200",
    ),
    datasetSummary("epa_echo_case_series", {
      fileDate: "->>file_date",
      latestFy: "->>latest_complete_fy",
    }),
  ]);
  const fy = Number(text(summary.latestFy));
  return {
    cells: rows.rows.map((r) => r.cells),
    fileDate: isoDate(summary.fileDate),
    latestCompleteFy: Number.isInteger(fy) && fy > 0 ? fy : null,
  };
});

/** The three openFDA enforcement-report datasets, by product type. */
export const FDA_DATASETS = [
  { key: "drug", dataset: "agency_safety_openfda_drug_enforcement" },
  { key: "device", dataset: "agency_safety_openfda_device_enforcement" },
  { key: "food", dataset: "agency_safety_openfda_food_enforcement" },
] as const;
export type FdaKey = (typeof FDA_DATASETS)[number]["key"];

/** First and last report year held across the FDA enforcement datasets, and the latest report date. */
export const readFdaBounds = memoAsync<{ first: number; last: number; latest: string } | null>(
  LONG_TTL_MS,
  async () => {
    const bounds = await Promise.all(
      FDA_DATASETS.map(async ({ dataset }) => {
        const [min, max] = await Promise.all([
          restGet<{ d: unknown }[]>(
            `corpus_records?select=d:filters->>report_date&dataset=eq.${dataset}&order=filters->report_date.asc.nullslast&limit=1`,
          ),
          restGet<{ d: unknown }[]>(
            `corpus_records?select=d:filters->>report_date&dataset=eq.${dataset}&order=filters->report_date.desc.nullslast&limit=1`,
          ),
        ]);
        return { min: isoDate(min.rows[0]?.d), max: isoDate(max.rows[0]?.d) };
      }),
    );
    const mins = bounds.flatMap((b) => (b.min ? [Number(b.min.slice(0, 4))] : []));
    const maxes = bounds.flatMap((b) => (b.max ? [b.max] : []));
    if (!mins.length || !maxes.length) return null;
    const latest = maxes.sort().at(-1)!;
    return { first: Math.min(...mins), last: Number(latest.slice(0, 4)), latest };
  },
);

/** Count of FDA enforcement entries of one product type in one report year, optionally of one classification. */
export function fdaYearCount(
  dataset: string,
  year: number,
  classification?: string,
): Promise<number> {
  const date = jsonPath("filters->>report_date");
  const klass = classification
    ? `&filters=cs.${encodeURIComponent(JSON.stringify({ classification: [classification] }))}`
    : "";
  return countRows(
    `corpus_records?dataset=eq.${dataset}${klass}&${date}=gte.${year}-01-01&${date}=lt.${year + 1}-01-01`,
  );
}

/** OSHA national series (parsed with the validators of the OSHA page) and the file snapshot date. */
export const readOshaSeries = memoAsync<{
  parsed: OshaEnforcement | null;
  snapshot: string | null;
}>(READ_TTL_MS, async () => {
  const [profile, summary] = await Promise.all([
    restGet<{ p: unknown }[]>(
      "corpus_records?select=p:item->profile&dataset=eq.osha_inspections_national&id=eq.osha-national:summary&limit=1",
    ),
    datasetSummary("osha_inspections_national", { snapshot: "->>snapshot" }),
  ]);
  return {
    parsed: parseOshaEnforcement({
      summary: profile.rows[0]?.p,
      year: undefined,
      sir: undefined,
      employers: [],
    }),
    snapshot: isoDate(summary.snapshot),
  };
});
