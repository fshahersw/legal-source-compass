/**
 * Server functions for the MDL command page (/matters/$id). getMdlCommand returns mode "registry" when the matter
 * overview resolves (mdls directory or Seeger Weiss registry) and "recorded" otherwise, so an MDL that only the lens
 * records hold (JPML series, hearings, court page, terminated history...) still gets a page instead of "not found".
 *
 * The section loaders (regulatory links, defendants, typed events, SEC registrants, order PDFs) are separate server
 * functions so each section loads on its own. Every read is cached for 10 minutes on the server (command.server.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadMdlLens, type MdlLens } from "@/lib/external/mdlLens.functions";
import { readMdlSeries } from "@/components/mdl/jpml-series/jpmlSeries.server";
import { summarizeDates } from "./docketDates";
import { joinCourtPageOrders, type CourtPageMatch } from "./orders";
import { overviewFor } from "./source.server";
import {
  loadDefendantRoster,
  loadDocketDates,
  loadKeyOrders,
  loadOrderDocuments,
  loadRegulatoryLinks,
  loadSecDefendants,
  loadTypedEvents,
} from "./command.server";
import { whatChanged, type JpmlPoint } from "./whatChanged";
import type {
  DefendantRosterPayload,
  DocketDatesPayload,
  KeyOrdersPayload,
  MatterOverviewPayload,
  MdlCommandPayload,
  OrderDocumentsPayload,
  RegulatoryLinksPayload,
  SecDefendantsPayload,
  TypedEventsPayload,
} from "./types";

const mdlInput = z.object({ id: z.string().regex(/^[1-9][0-9]{0,4}$/) });
const parseMdl = (d: unknown) => mdlInput.parse(d);

const todayIso = () => new Date().toISOString().slice(0, 10);

/** True when any lens record holds this MDL number (the "recorded" mode needs something to show). */
export function lensHasRecords(lens: MdlLens | null): boolean {
  if (!lens) return false;
  return !!(
    lens.mdl ||
    lens.recordedTitle ||
    lens.courtPage ||
    lens.hearings.length ||
    lens.panelOrders.length ||
    lens.terminated.length ||
    lens.companies.length ||
    lens.fdaReports.length ||
    lens.signal
  );
}

/** Assemble the command payload from what was read; pure apart from the inputs (tested in command.functions.test.ts). */
export function assembleCommand(parts: {
  mdl: string;
  asOf: string;
  overview: MatterOverviewPayload | null;
  lens: MdlLens | null;
  orders: KeyOrdersPayload | null;
  dates: DocketDatesPayload | null;
  jpml: { points: JpmlPoint[]; sourceUrl: string | null } | null;
  errors: string[];
}): MdlCommandPayload {
  const { mdl, asOf, overview, lens, orders, dates } = parts;
  const courtOrders = lens?.courtPage?.latestOrders ?? [];
  const courtPageOrders: CourtPageMatch[] = orders
    ? joinCourtPageOrders(
        orders.ledger,
        courtOrders.map((o) => ({ title: o.title, url: o.url, date: o.date, vacated: o.vacated })),
      )
    : [];
  const collectedThrough = orders?.coverage.collectedThrough ?? dates?.collectedThrough ?? null;
  const jpmlPoints = parts.jpml?.points ?? lens?.mdl?.series ?? [];
  return {
    mdl,
    mode: overview ? "registry" : "recorded",
    found: !!overview || lensHasRecords(lens) || jpmlPoints.length > 0,
    overview,
    lens,
    orders,
    dates,
    datesSummary: dates ? summarizeDates(dates.rows, asOf, collectedThrough) : null,
    courtPageOrders,
    whatChanged: whatChanged({
      asOf,
      collectedThrough,
      jpml: jpmlPoints,
      entries: orders?.entries ?? [],
      dates: dates?.rows ?? [],
      courtPage: courtPageOrders,
    }),
    jpmlPoints,
    jpmlSourceUrl: parts.jpml?.sourceUrl ?? lens?.series.sourceUrl ?? null,
    asOf,
    errors: parts.errors,
  };
}

/** Read one section; a failure is logged, recorded by name and returns null so the rest of the page still loads. */
async function section<T>(
  name: string,
  errors: string[],
  read: () => Promise<T>,
): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    console.error(`mdl command: ${name}`, e);
    errors.push(name);
    return null;
  }
}

export const getMdlCommand = createServerFn({ method: "GET" })
  .inputValidator(parseMdl)
  .handler(async ({ data }): Promise<MdlCommandPayload> => {
    const mdl = data.id;
    const errors: string[] = [];
    const [overview, lens, orders, dates, series] = await Promise.all([
      section("overview", errors, () => overviewFor(mdl)),
      section("lens", errors, () => loadMdlLens(Number(mdl))),
      section("orders", errors, () => loadKeyOrders(mdl)),
      section("dates", errors, () => loadDocketDates(mdl)),
      section("jpml", errors, () => readMdlSeries(Number(mdl))),
    ]);
    return assembleCommand({
      mdl,
      asOf: todayIso(),
      overview,
      lens,
      orders,
      dates,
      jpml: series
        ? {
            points: series.points.map((p) => ({
              date: p.date,
              pending: p.pending,
              total: p.total,
            })),
            sourceUrl: series.sourceUrl,
          }
        : null,
      errors,
    });
  });

export const getMdlRegulatoryLinks = createServerFn({ method: "GET" })
  .inputValidator(parseMdl)
  .handler(async ({ data }): Promise<RegulatoryLinksPayload> => loadRegulatoryLinks(data.id));

export const getMdlDefendants = createServerFn({ method: "GET" })
  .inputValidator(parseMdl)
  .handler(async ({ data }): Promise<DefendantRosterPayload> => loadDefendantRoster(data.id));

export const getMdlTypedEvents = createServerFn({ method: "GET" })
  .inputValidator(parseMdl)
  .handler(async ({ data }): Promise<TypedEventsPayload> => loadTypedEvents(data.id));

export const getMdlSecDefendants = createServerFn({ method: "GET" })
  .inputValidator(parseMdl)
  .handler(async ({ data }): Promise<SecDefendantsPayload> => loadSecDefendants(data.id));

/** Documents-layer files for the classified order entries of one MDL (exact docket + entry join). */
export const getMdlOrderDocuments = createServerFn({ method: "GET" })
  .inputValidator(parseMdl)
  .handler(async ({ data }): Promise<OrderDocumentsPayload> => {
    const orders = await loadKeyOrders(data.id);
    return loadOrderDocuments(data.id, orders.entries);
  });
