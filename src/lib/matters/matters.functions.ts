import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizeMdlNumber, type JpmlReport } from "./overview";
import { caseIdPlan } from "./registry";
import {
  loadAppearances,
  loadCounsel,
  loadEntries,
  loadEntryText,
  loadFjcCases,
  loadHub,
  loadLegacyDocuments,
  loadMatterCases,
  loadRegistryDocketDetail,
  loadRegistryDocuments,
  overviewFor,
} from "./source.server";

/* The global account middleware (CORPUS_REQUIRE_AUTH) already guards every server function. */

const mdlInput = z.string().regex(/^(?:mdl[:-])?0*[1-9]\d{0,5}$/i);
const mdlOf = (id: string) => normalizeMdlNumber(id) as string;

export const getMatterOverview = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: mdlInput }).parse(d))
  .handler(async ({ data }) => overviewFor(mdlOf(data.id)));

export const getMatterCases = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: mdlInput }).parse(d))
  .handler(async ({ data }) => {
    const overview = await overviewFor(mdlOf(data.id));
    return overview ? loadMatterCases(overview) : null;
  });

export const getMatterFjcCases = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: mdlInput,
        offset: z.number().int().min(0).max(100000).default(0),
        court: z
          .string()
          .regex(/^[a-z0-9]{2,12}$/)
          .nullable()
          .default(null),
      })
      .parse(d),
  )
  .handler(async ({ data }) => loadFjcCases(mdlOf(data.id), data.offset, data.court));

export const getMatterEntries = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: mdlInput,
        source: z.enum(["auto", "activity", "cl_entries"]).default("auto"),
        type: z
          .string()
          .regex(/^[a-z0-9_]{1,60}$/)
          .nullable()
          .default(null),
        q: z.string().max(120).default(""),
        offset: z.number().int().min(0).max(100000).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const overview = await overviewFor(mdlOf(data.id));
    return overview
      ? loadEntries(overview, {
          source: data.source,
          type: data.type,
          q: data.q,
          offset: data.offset,
        })
      : null;
  });

export const getMatterEntryText = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: z
          .string()
          .min(1)
          .max(80)
          .regex(/^[A-Za-z0-9_-]+$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => loadEntryText(data.id));

export const getMatterDocuments = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: mdlInput }).parse(d))
  .handler(async ({ data }) => {
    const overview = await overviewFor(mdlOf(data.id));
    if (!overview) return null;
    const [registry, legacy] = await Promise.all([
      loadRegistryDocuments(caseIdPlan(overview.registry, overview.overview.keys.all)),
      loadLegacyDocuments(overview.overview.mdl).catch(() => ({ rows: [], published: false })),
    ]);
    const reports: JpmlReport[] = overview.overview.reports;
    return { registry, legacy, reports };
  });

/** PDF registry totals only (one cheap call) for the overview tiles. */
export const getMatterDocumentsSummary = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: mdlInput }).parse(d))
  .handler(async ({ data }) => {
    const overview = await overviewFor(mdlOf(data.id));
    return overview
      ? loadRegistryDocuments(caseIdPlan(overview.registry, overview.overview.keys.all), true)
      : null;
  });

/** The evidence behind one matter-registry docket, for the detail drawer. */
export const getMatterRegistryDocket = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: mdlInput, rowId: z.string().min(8).max(200) }).parse(d))
  .handler(async ({ data }) => loadRegistryDocketDetail(mdlOf(data.id), data.rowId));

export const getMatterParties = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: mdlInput,
        kind: z.enum(["firm", "attorney", "party"]).default("firm"),
        q: z.string().max(120).default(""),
        offset: z.number().int().min(0).max(100000).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const mdl = mdlOf(data.id);
    const [counsel, appearances] = await Promise.all([
      loadCounsel(mdl, data.kind, data.q, data.offset),
      loadAppearances(mdl),
    ]);
    return { counsel, appearances };
  });

export const getMatterHub = createServerFn({ method: "GET" }).handler(async () => loadHub());
