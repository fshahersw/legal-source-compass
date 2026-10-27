/**
 * Products and recalls under one CFR section (model: ./sectionCrosswalk.ts). Exact-key reads only: the device
 * classification dataset by filters @> {regulation_number}, NHTSA recalls by item.recall.fmvss (15k rows, a narrow
 * projection). Returns null for a section no crosswalk applies to.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "@/lib/external/rest.server";
import { countRows, readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync } from "@/lib/insights/readers/cache";
import { datasetRefreshDates } from "./dataAsOf.server";
import { easternToday } from "./rulemakingTracker";
import {
  crosswalkFor,
  toDeviceType,
  toVehicleRecall,
  type FmvssCoverage,
  type SectionCrosswalk,
} from "./sectionCrosswalk";

const DEVICE_PREFIX = "agency_safety_openfda_device_classification_";

/** The newest device classification snapshot the catalog lists (ids carry the export date). */
const deviceDataset = memoAsync(60 * 60 * 1000, async (): Promise<string | null> => {
  const r = await restGet<{ id: string }[]>(
    `corpus_datasets?select=id&id=like.${DEVICE_PREFIX}*&order=id.desc&limit=1`,
  );
  return r.rows[0]?.id ?? null;
});

const RECALLS = "agency_safety_nhtsa_recalls";

/**
 * Dataset-wide FMVSS coverage of the recall records (two exact counts and the earliest report date), so the page can
 * say the per-standard count is a lower bound. Shared by every 49 CFR 571 section; memoized for an hour.
 */
const recallCoverage = memoAsync(60 * 60 * 1000, async (): Promise<FmvssCoverage> => {
  const base = `corpus_records?dataset=eq.${RECALLS}`;
  const [total, untagged, first] = await Promise.all([
    countRows(base),
    countRows(`${base}&or=(item->recall->>fmvss.is.null,item->recall->>fmvss.eq.%22%22)`),
    restGet<{ d: string | null }[]>(
      `corpus_records?select=d:item->recall->>report_date&dataset=eq.${RECALLS}` +
        `&item->recall->>report_date=not.is.null&order=item->recall->>report_date.asc&limit=1`,
    ),
  ]);
  const d = first.rows[0]?.d;
  return {
    total,
    untagged,
    firstYear: typeof d === "string" && /^\d{4}/.test(d) ? d.slice(0, 4) : null,
  };
});

const cache = new Map<string, { at: number; v: SectionCrosswalk | null }>();
const TTL = 30 * 60 * 1000;

async function read(title: string, section: string): Promise<SectionCrosswalk | null> {
  const x = crosswalkFor(title, section);
  if (!x) return null;
  if (x.kind === "device") {
    const dataset = await deviceDataset();
    if (!dataset) return null;
    const rows = await readAllRows<{ id: string; source_url: string | null; filters: unknown }>(
      `corpus_records?select=id,source_url,filters&dataset=eq.${dataset}` +
        `&filters=cs.${encodeURIComponent(JSON.stringify({ regulation_number: x.regulation }))}&order=ordinal.asc,id.asc`,
      { max: 2_000 },
    );
    const f = (rows[0]?.filters ?? {}) as Record<string, unknown>;
    return {
      kind: "device",
      key: x.regulation,
      dataset,
      sourceUrl: rows[0]?.source_url ?? null,
      exportDate: typeof f["source_export_date"] === "string" ? f["source_export_date"] : null,
      devices: rows.flatMap((r) => toDeviceType(r) ?? []),
    };
  }
  const rows = await readAllRows<Record<string, unknown>>(
    `corpus_records?select=id,title,source_url,report_date:item->recall->>report_date,` +
      `units:item->recall->>potentially_affected,manufacturer:item->recall->>manufacturer` +
      `&dataset=eq.agency_safety_nhtsa_recalls&item->recall->>fmvss=eq.${encodeURIComponent(x.fmvss)}` +
      `&order=ordinal.asc,id.asc`,
    { max: 5_000 },
  );
  const [refreshed, coverage] = await Promise.all([
    datasetRefreshDates([RECALLS] as const),
    recallCoverage().catch((e: unknown) => {
      console.error("recall fmvss coverage", e);
      return null;
    }),
  ]);
  return {
    kind: "vehicle",
    key: x.fmvss,
    recalls: rows.flatMap((r) => toVehicleRecall(r) ?? []),
    today: easternToday(),
    dataAsOf: refreshed[RECALLS],
    coverage,
  };
}

export const getSectionCrosswalk = createServerFn({ method: "GET" })
  .inputValidator((d: { title: string; section: string }) =>
    z
      .object({
        title: z.string().regex(/^\d{1,2}$/),
        section: z.string().regex(/^[0-9A-Za-z.-]{1,24}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<SectionCrosswalk | null> => {
    const key = `${data.title}:${data.section}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.v;
    try {
      const v = await read(data.title, data.section);
      cache.set(key, { at: Date.now(), v });
      if (cache.size > 500) cache.delete(cache.keys().next().value as string);
      return v;
    } catch (e) {
      console.error("section crosswalk", e);
      throw new Error("Products and recalls for this section could not be read just now.");
    }
  });
