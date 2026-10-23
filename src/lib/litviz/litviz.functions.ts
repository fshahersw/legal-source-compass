/**
 * litviz/1 server functions (read only) for the litigation visualizations:
 *  - getMdlLanes: every MDL of a scope as a compact positional lane (litviz_mdl_lanes_v1, else computed live; the
 *    client expands it with fromWire);
 *  - getMdlLane: one MDL's label fields, coverage notes and every series row (litviz_mdl_series_v1, else live);
 *  - getProductSignals: the product signal timeline rows (worker SAFETY's product_signals_v1 when applied, plus the
 *    litviz litigation rows);
 *  - getCitationMap / getCitationGrid / getFilingCitations: through the citation adapters (litviz/1 today);
 *  - getCourtLevel: one level of the court hierarchy (litviz_court_children_v1, else the insights RPCs).
 * Corpus credentials stay on the server; every input is validated here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CitationGrid, CitationMap, FilingCitations } from "./citations";
import type { CourtLevel } from "./courtTree";
import { byDecade, toWire, type LanesWire } from "./lanes";
import {
  readCitationGrid,
  readCitationMap,
  readCourtLevel,
  readFilingCitations,
  readLanes,
  readMdlDetail,
  readProductSignals,
  type Available,
} from "./litviz.server";
import { toSignalWire, type MdlDetail, type ProductSignalsWire } from "./signals";

const mdlId = z.string().regex(/^[1-9][0-9]{0,5}$/);

const fail = (what: string) => (e: unknown) => {
  console.error(`litviz ${what}`, e);
  throw new Error(`The ${what} could not be read just now.`);
};

export type LanesResponse = LanesWire & {
  /** Historical scope only: lanes per decade (0 = not recorded) and the decade served. */
  decades: [number, number][] | null;
  decade: number | null;
};

export const getMdlLanes = createServerFn({ method: "GET" })
  .inputValidator((d: { scope?: "reported" | "historical"; decade?: number | null }) =>
    z
      .object({
        scope: z.enum(["reported", "historical"]).default("reported"),
        decade: z.number().int().min(0).max(2100).multipleOf(10).nullable().default(null),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<LanesResponse> => {
    const p = await readLanes(data.scope).catch(fail("MDL lanes"));
    if (data.scope === "reported") return { ...toWire(p), decades: null, decade: null };
    const d = byDecade(p, data.decade);
    return { ...toWire(d.payload), decades: d.decades, decade: d.decade };
  });

export const getMdlLane = createServerFn({ method: "GET" })
  .inputValidator((d: { mdl: string }) => z.object({ mdl: mdlId }).parse(d))
  .handler(({ data }): Promise<MdlDetail | null> =>
    readMdlDetail(data.mdl).catch(fail("MDL lane")),
  );

export const getProductSignals = createServerFn({ method: "GET" })
  .inputValidator((d: { mdl: string }) => z.object({ mdl: mdlId }).parse(d))
  .handler(({ data }): Promise<ProductSignalsWire | null> =>
    readProductSignals(data.mdl)
      .then((p) => (p ? toSignalWire(p) : null))
      .catch(fail("product signal timeline")),
  );

export const getCitationMap = createServerFn({ method: "GET" })
  .inputValidator((d: { mdl: string; limit?: number }) =>
    z.object({ mdl: mdlId, limit: z.number().int().min(5).max(60).default(30) }).parse(d),
  )
  .handler(({ data }): Promise<Available<CitationMap>> =>
    readCitationMap(`${data.mdl}|${data.limit}`).catch(fail("citation map")),
  );

export const getCitationGrid = createServerFn({ method: "GET" })
  .inputValidator((d: { mdls?: string[] | null; limit?: number }) =>
    z
      .object({
        mdls: z.array(mdlId).min(1).max(12).nullable().default(null),
        limit: z.number().int().min(5).max(60).default(30),
      })
      .parse(d ?? {}),
  )
  .handler(({ data }): Promise<Available<CitationGrid>> => {
    const list = data.mdls ? [...new Set(data.mdls)].join(",") : "";
    return readCitationGrid(`${list}|${data.limit}`).catch(fail("citation grid"));
  });

export const getFilingCitations = createServerFn({ method: "GET" })
  .inputValidator((d: { document: string }) =>
    z.object({ document: z.string().regex(/^d_[0-9a-f]{24}$/) }).parse(d),
  )
  .handler(({ data }): Promise<Available<FilingCitations>> =>
    readFilingCitations(data.document).catch(fail("filing's citations")),
  );

export const courtLevelInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("root"), id: z.null().default(null) }),
  z.object({ type: z.literal("states"), id: z.null().default(null) }),
  z.object({
    type: z.enum(["court", "circuit", "judges"]),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  }),
  z.object({ type: z.literal("state"), id: z.string().regex(/^[A-Z]{2}$/) }),
]);

export const getCourtLevel = createServerFn({ method: "GET" })
  .inputValidator((d: { type: string; id?: string | null }) => courtLevelInput.parse(d))
  .handler(({ data }): Promise<CourtLevel & { basis: "precomputed" | "live" }> =>
    readCourtLevel(data.type, data.id).catch(fail("court hierarchy")),
  );
