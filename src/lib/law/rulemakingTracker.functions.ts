/**
 * Server read for the mass-tort rulemaking tracker (model: ./rulemakingTracker.ts). Three narrow reads per agency, all
 * through indexed filters: open Regulations.gov documents (filters @> agency, then the Eastern-time comment end date),
 * the agency's fr_agency_trends row (yearly final and proposed rules) and its Unified Agenda entries. Memoized for ten
 * minutes; a failed read is never cached.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "@/lib/external/rest.server";
import { mapLimit, readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  TRACKED_AGENCIES,
  agendaEdition,
  easternToday,
  frAgencyYears,
  sortDeadlines,
  toAgendaItem,
  toDeadline,
  type AgendaItem,
  type Deadline,
  type RulemakingTracker,
} from "./rulemakingTracker";

/** First year of the yearly rule chart. */
export const FR_FROM_YEAR = 2015;

const cs = (v: Record<string, string[]>) => encodeURIComponent(JSON.stringify(v));

type DocRow = {
  id: string;
  title: string | null;
  source_url: string | null;
  filters: unknown;
  dates_et: unknown;
  comments: unknown;
};

async function openDeadlines(agency: string, today: string): Promise<Deadline[]> {
  const rows = await readAllRows<DocRow>(
    `corpus_records?select=id,title,source_url,filters,dates_et:item->dates_et,comments:item->comments` +
      `&dataset=eq.regulations_gov_documents&filters=cs.${cs({ agency: [agency] })}` +
      `&item->dates_et->>comment_end=gte.${today}&order=ordinal.asc,id.asc`,
    { max: 3_000 },
  );
  return rows.flatMap((r) => {
    const d = toDeadline({ ...r, item: { dates_et: r.dates_et, comments: r.comments } }, today);
    return d ? [d] : [];
  });
}

async function agenda(agency: string, fr: string): Promise<AgendaItem[]> {
  const rows = await readAllRows<{
    id: string;
    title: string | null;
    source_url: string | null;
    cells: unknown;
  }>(
    `corpus_records?select=id,title,source_url,cells:item->cells&dataset=eq.unified_agenda_pipeline` +
      `&filters=cs.${cs({ agency: [fr] })}&order=ordinal.asc,id.asc`,
    { max: 3_000 },
  );
  return rows.flatMap((r) => {
    const a = toAgendaItem(agency, { ...r, item: { cells: r.cells } });
    return a ? [a] : [];
  });
}

const read = memoAsync(READ_TTL_MS, async (): Promise<RulemakingTracker> => {
  const today = easternToday();
  const [deadlines, trends, agendas] = await Promise.all([
    mapLimit(TRACKED_AGENCIES, 3, (a) => openDeadlines(a.code, today)),
    restGet<{ id: string; trends: unknown }[]>(
      `corpus_records?select=id,trends:item->trends&dataset=eq.fr_agency_trends` +
        `&id=in.(${TRACKED_AGENCIES.map((a) => a.fr).join(",")})`,
    ),
    mapLimit(TRACKED_AGENCIES, 3, (a) => agenda(a.code, a.fr)),
  ]);
  const byFr = new Map(trends.rows.map((r) => [r.id, r]));
  const items = agendas.flat();
  return {
    today,
    agencies: TRACKED_AGENCIES,
    deadlines: sortDeadlines(deadlines.flat()),
    fr: TRACKED_AGENCIES.map((a) =>
      frAgencyYears(a.code, { item: { trends: byFr.get(a.fr)?.trends } }, FR_FROM_YEAR),
    ),
    agenda: items,
    agendaEdition: items.map((i) => agendaEdition(i.url)).find((e) => e !== null) ?? null,
    readAt: new Date().toISOString(),
  };
});

export const getRulemakingTracker = createServerFn({ method: "GET" }).handler(
  async (): Promise<RulemakingTracker> =>
    read().catch((e: unknown) => {
      console.error("rulemaking tracker", e);
      throw new Error("The rulemaking tracker could not be read just now.");
    }),
);
