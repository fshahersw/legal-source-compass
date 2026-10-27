/**
 * Server reads for the civil-justice legislation watch and congressional attention (model: ./legislationWatch.ts).
 * Full-text reads (search_vector, 'simple' config) filtered by dataset, narrow projections only. Memoized for an hour:
 * bills and hearings refresh at most daily, and a cold full-text read can take seconds.
 *
 * The /law landing reads only what its KPIs show (getLegislationLanding: one state read over every topic, one funding
 * read, one federal read) instead of the full watch's fifteen reads; both apply the same exclusion, stage and
 * de-duplication rules, so the counts agree.
 */
import { createServerFn } from "@tanstack/react-start";
import { mapLimit, readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync } from "@/lib/insights/readers/cache";
import { datasetRefreshDates } from "./dataAsOf.server";
import { easternToday } from "./rulemakingTracker";
import {
  ALL_STATE_TOPICS_QUERY,
  ATTENTION_TOPICS,
  FEDERAL_FUNDING_QUERY,
  STATE_TOPICS,
  attentionMatrix,
  congressOn,
  landingFigures,
  mergeBills,
  toFederalBill,
  toHearing,
  toWatchBill,
  type FederalWatchBill,
  type LegislationDataAsOf,
  type LegislationLanding,
  type LegislationWatch,
  type WatchBill,
} from "./legislationWatch";

const fts = (q: string) => `search_vector=wfts(simple).${encodeURIComponent(q)}`;

async function stateBills(query: string, topic: string, today: string): Promise<WatchBill[]> {
  const rows = await readAllRows<unknown>(
    `corpus_records?select=id,title,source_url,filters,cells:item->cells&dataset=eq.state_bills&${fts(query)}&order=ordinal.asc,id.asc`,
    { max: 5_000 },
  );
  return rows.flatMap((r) => toWatchBill(r, topic, today) ?? []);
}

async function federalBills(congress: number): Promise<FederalWatchBill[]> {
  const rows = await readAllRows<unknown>(
    `corpus_records?select=id,title,source_url,filters,cells:item->cells&dataset=eq.congress_bills` +
      `&filters=cs.${encodeURIComponent(JSON.stringify({ congress: [String(congress)] }))}&${fts(FEDERAL_FUNDING_QUERY)}&order=ordinal.asc,id.asc`,
    { max: 2_000 },
  );
  return rows
    .flatMap((r) => toFederalBill(r) ?? [])
    .sort((a, b) => (b.cosponsors ?? -1) - (a.cosponsors ?? -1) || a.id.localeCompare(b.id));
}

async function dataAsOf(): Promise<LegislationDataAsOf> {
  const d = await datasetRefreshDates([
    "state_bills",
    "congress_bills",
    "govinfo_hearings",
  ] as const);
  return {
    stateBills: d.state_bills,
    congressBills: d.congress_bills,
    hearings: d.govinfo_hearings,
  };
}

const read = memoAsync(60 * 60 * 1000, async (): Promise<LegislationWatch> => {
  const today = easternToday();
  const congress = congressOn(today);
  const stateLists = await mapLimit(STATE_TOPICS, 2, (t) => stateBills(t.query, t.id, today));
  const federal = await federalBills(congress);
  const attention = await mapLimit(ATTENTION_TOPICS, 2, async (t) => {
    const [bills, hearings] = await Promise.all([
      readAllRows<{ congress: string | null; has_law: string | null }>(
        `corpus_records?select=id,congress:filters->congress->>0,has_law:filters->has_law->>0&dataset=eq.congress_bills&${fts(t.query)}&order=ordinal.asc,id.asc`,
        { max: 10_000 },
      ),
      readAllRows<unknown>(
        `corpus_records?select=id,title,source_url,congress:filters->congress->>0,held:item->cells->>held&dataset=eq.govinfo_hearings&${fts(t.query)}&order=ordinal.asc,id.asc`,
        { max: 5_000 },
      ),
    ]);
    return attentionMatrix(
      t,
      bills.map((b) => ({
        congress: Number.isInteger(Number(b.congress)) ? Number(b.congress) : null,
        becameLaw: b.has_law === "yes",
      })),
      hearings.flatMap((h) => toHearing(h) ?? []),
      congress,
    );
  });
  return {
    today,
    congress,
    dataAsOf: await dataAsOf(),
    stateBills: mergeBills(stateLists),
    federal,
    attention,
    readAt: new Date().toISOString(),
  };
});

const readLanding = memoAsync(60 * 60 * 1000, async (): Promise<LegislationLanding> => {
  const today = easternToday();
  const congress = congressOn(today);
  const [any, funding, federal, asOf] = await Promise.all([
    stateBills(ALL_STATE_TOPICS_QUERY, "any", today),
    stateBills(STATE_TOPICS.find((t) => t.id === "funding")!.query, "funding", today),
    federalBills(congress),
    dataAsOf(),
  ]);
  return {
    today,
    congress,
    dataAsOf: asOf,
    ...landingFigures(mergeBills([any, funding]), federal),
    readAt: new Date().toISOString(),
  };
});

export const getLegislationWatch = createServerFn({ method: "GET" }).handler(
  async (): Promise<LegislationWatch> =>
    read().catch((e: unknown) => {
      console.error("legislation watch", e);
      throw new Error("The legislation watch could not be read just now.");
    }),
);

export const getLegislationLanding = createServerFn({ method: "GET" }).handler(
  async (): Promise<LegislationLanding> =>
    readLanding().catch((e: unknown) => {
      console.error("legislation landing", e);
      throw new Error("The legislation figures could not be read just now.");
    }),
);
