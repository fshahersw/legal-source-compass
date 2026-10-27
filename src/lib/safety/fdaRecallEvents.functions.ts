/**
 * Server read of FDA recall events (/safety): the three openFDA enforcement datasets as a narrow projection (event id,
 * class, firm, status, initiation and report dates), grouped into FDA events by the pure model. Memoized for 10 minutes;
 * only the aggregates reach the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  buildFdaRecallEvents,
  FDA_ENFORCEMENT_DATASETS,
  type EnforcementRow,
  type FdaCenter,
  type FdaRecallEventsPayload,
} from "./fdaRecallEvents";

const SELECT = [
  "ev:detail->fields->>event_id",
  "cls:item->>classification",
  "firm:item->>firm",
  "fn:item->>firm_norm",
  "st:item->>status",
  "idt:item->dates->>recall_initiation_date",
  "rd:item->dates->>report_date",
].join(",");

const read = memoAsync(READ_TTL_MS, async (): Promise<FdaRecallEventsPayload> => {
  const centers = Object.keys(FDA_ENFORCEMENT_DATASETS) as FdaCenter[];
  const lists = await Promise.all(
    centers.map((c) =>
      readAllRows<EnforcementRow>(
        `corpus_records?select=${SELECT}&dataset=eq.${FDA_ENFORCEMENT_DATASETS[c]}&order=ordinal.asc,id.asc`,
        { max: 120_000, concurrency: 4 },
      ),
    ),
  );
  const byCenter: Partial<Record<FdaCenter, EnforcementRow[]>> = {};
  centers.forEach((c, i) => (byCenter[c] = lists[i]!));
  return buildFdaRecallEvents(byCenter, new Date().toISOString());
});

export const getFdaRecallEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<FdaRecallEventsPayload> =>
    read().catch((e: unknown) => {
      console.error("fda recall events", e);
      throw new Error("FDA recall events could not be read just now.");
    }),
);
