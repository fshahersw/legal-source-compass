/**
 * Emerging-tort radar reads (dataset agency_safety_tort_radar, built by scripts/enrichment/build_emerging_tort_radar.py).
 * The list returns slim rows (components, flags, status) plus the overview; one unit's chart series, terms and
 * evidence come from getRadarCandidate when a row is opened. Rows whose stored total does not reconcile with their
 * components are dropped (radarModel.parseUnit). Read-only; 10-minute cache; failures are not cached.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import { readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  RADAR_DATASET,
  UNIT_ID,
  parseRecords,
  parseUnit,
  toRow,
  type RadarRow,
  type RadarSummary,
  type RadarUnit,
} from "@/components/safety/radar/radarModel";

export type RadarPayload = {
  /** false when the dataset is not in the catalog yet (the page shows its empty state). */
  published: boolean;
  summary: RadarSummary | null;
  rows: RadarRow[];
  /** Stored rows left out because they were malformed or their total did not reconcile. */
  dropped: number;
  readAt: string;
};

const read = memoAsync(READ_TTL_MS, async (): Promise<RadarPayload> => {
  const meta = await restGet<{ ready: boolean | null; imported_records: number | null }[]>(
    `corpus_datasets?select=ready,imported_records&id=eq.${RADAR_DATASET}&limit=1`,
  );
  const ds = meta.rows[0];
  if (!ds || !ds.imported_records) {
    return {
      published: false,
      summary: null,
      rows: [],
      dropped: 0,
      readAt: new Date().toISOString(),
    };
  }
  const raw = await readAllRows<{ id: string; item: unknown }>(
    `corpus_records?select=id,item&dataset=eq.${RADAR_DATASET}&order=ordinal.asc`,
    { max: 5_000 },
  );
  const { units, summary, dropped } = parseRecords(raw.map((r) => r.item));
  return {
    published: true,
    summary,
    rows: units.map(toRow),
    dropped,
    readAt: new Date().toISOString(),
  };
});

export const getEmergingTortRadar = createServerFn({ method: "GET" }).handler(
  async (): Promise<RadarPayload> =>
    read().catch((e: unknown) => {
      console.error("emergingTortRadar", e);
      throw new Error("The radar could not be read just now.");
    }),
);

/** One unit with its chart series, rising terms and evidence; null when absent or when it does not reconcile. */
export const getRadarCandidate = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().regex(UNIT_ID) }).parse(d))
  .handler(async ({ data }): Promise<RadarUnit | null> => {
    const r = await restGet<{ item: unknown }[]>(
      `corpus_records?select=item&dataset=eq.${RADAR_DATASET}&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    ).catch((e: unknown) => {
      console.error("radarCandidate", e);
      throw new Error("This radar entry could not be read just now.");
    });
    const item = r.rows[0]?.item;
    const radar =
      item && typeof item === "object" ? (item as Record<string, unknown>)["radar"] : null;
    return parseUnit(radar);
  });
