import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CASE_ROLES, CASE_SORTS, type CaseFilter, type CaseRole } from "./cases";
import { normalizeMdlNumber, type JpmlReport } from "./overview";
import { caseIdPlan } from "./registry";
import {
  loadAppearances,
  loadCounsel,
  loadEntries,
  loadEntryText,
  loadFjcCases,
  loadCaseDocuments,
  loadCasesPage,
  loadCasesScope,
  loadHub,
  loadLegacyDocuments,
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

const caseFilterInput = z.object({
  q: z.string().max(120).default(""),
  court: z
    .string()
    .regex(/^[a-z0-9]{2,12}$/)
    .optional(),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  status: z.string().max(60).optional(),
  evidence: z
    .string()
    .regex(/^[a-z0-9_]{1,60}$/)
    .optional(),
  role: z
    .string()
    .refine((v) => v === "" || (CASE_ROLES as readonly string[]).includes(v))
    .optional(),
  route: z
    .string()
    .regex(/^[a-z0-9_]{1,60}$/)
    .optional(),
  actions: z.enum(["", "action"]).optional(),
});

/** The validated filter as the pure filter type (only the keys that carry a value). */
function toCaseFilter(input: z.infer<typeof caseFilterInput>): CaseFilter {
  const f: CaseFilter = {};
  if (input.q.trim()) f.q = input.q.trim();
  if (input.court) f.court = input.court;
  if (input.year) f.year = input.year;
  if (input.status) f.status = input.status;
  if (input.evidence) f.evidence = input.evidence;
  if (input.role) f.role = input.role as CaseRole;
  if (input.route) f.route = input.route;
  if (input.actions === "action") f.actions = "action";
  return f;
}

/** One page of a matter's member cases; the server filters, sorts, counts and facets the whole list. */
export const getMatterCasesPage = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        id: mdlInput,
        filter: caseFilterInput.default({ q: "" }),
        sort: z.enum(CASE_SORTS as unknown as [string, ...string[]]).default("filed-desc"),
        offset: z.number().int().min(0).max(100000).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const overview = await overviewFor(mdlOf(data.id));
    if (!overview) return null;
    return loadCasesPage(
      overview,
      toCaseFilter(data.filter),
      data.sort as (typeof CASE_SORTS)[number],
      data.offset,
    );
  });

/** What the member-case list is made of (no rows): the overview tiles use this instead of the whole list. */
export const getMatterCasesScope = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: mdlInput }).parse(d))
  .handler(async ({ data }) => {
    const overview = await overviewFor(mdlOf(data.id));
    return overview ? loadCasesScope(overview) : null;
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

/** The verified PDFs filed under one registry docket's own case ids, for the detail drawer. */
export const getMatterCaseDocuments = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: mdlInput, rowId: z.string().min(8).max(200) }).parse(d))
  .handler(async ({ data }) => loadCaseDocuments(mdlOf(data.id), data.rowId));

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
