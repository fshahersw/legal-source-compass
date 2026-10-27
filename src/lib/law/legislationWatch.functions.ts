/**
 * Server read for the civil-justice legislation watch and congressional attention (model: ./legislationWatch.ts).
 * Full-text reads (search_vector, 'simple' config) filtered by dataset, one per topic, narrow projections only.
 * Memoized for an hour: bills and hearings refresh at most daily, and a cold full-text read can take seconds.
 */
import { createServerFn } from "@tanstack/react-start";
import { mapLimit, readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync } from "@/lib/insights/readers/cache";
import { easternToday } from "./rulemakingTracker";
import {
  ATTENTION_TOPICS,
  FEDERAL_FUNDING_QUERY,
  STATE_TOPICS,
  attentionMatrix,
  congressOn,
  mergeBills,
  toFederalBill,
  toHearing,
  toWatchBill,
  type LegislationWatch,
} from "./legislationWatch";

const fts = (q: string) => `search_vector=wfts(simple).${encodeURIComponent(q)}`;

const read = memoAsync(60 * 60 * 1000, async (): Promise<LegislationWatch> => {
  const today = easternToday();
  const congress = congressOn(today);
  const stateLists = await mapLimit(STATE_TOPICS, 2, async (t) => {
    const rows = await readAllRows<unknown>(
      `corpus_records?select=id,title,source_url,filters,cells:item->cells&dataset=eq.state_bills&${fts(t.query)}&order=ordinal.asc,id.asc`,
      { max: 5_000 },
    );
    return rows.flatMap((r) => toWatchBill(r, t.id, today) ?? []);
  });
  const federalRows = await readAllRows<unknown>(
    `corpus_records?select=id,title,source_url,filters,cells:item->cells&dataset=eq.congress_bills` +
      `&filters=cs.${encodeURIComponent(JSON.stringify({ congress: [String(congress)] }))}&${fts(FEDERAL_FUNDING_QUERY)}&order=ordinal.asc,id.asc`,
    { max: 2_000 },
  );
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
    stateBills: mergeBills(stateLists),
    federal: federalRows
      .flatMap((r) => toFederalBill(r) ?? [])
      .sort((a, b) => (b.cosponsors ?? -1) - (a.cosponsors ?? -1) || a.id.localeCompare(b.id)),
    attention,
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
