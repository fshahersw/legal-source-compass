/** Read-only server read for the Time Limits legislative change watch (state_bills phrase search). */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "@/lib/external/rest.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import { WATCH_DATASET, parseWatchRow, watchPath, type WatchBill } from "./legislativeWatch";

export type WatchPayload = {
  bills: WatchBill[];
  /** Rows returned by the search; above `limit` the list would be cut, which the page then says. */
  returned: number;
  limit: number;
  dropped: number;
  /** Open States bulk dump date recorded on the dataset. */
  dumpDate: string | null;
  readAt: string;
};

const LIMIT = 500;

const read = memoAsync(READ_TTL_MS, async (): Promise<WatchPayload> => {
  const [rows, meta] = await Promise.all([
    restGet<unknown[]>(watchPath(LIMIT)),
    restGet<{ dump: unknown }[]>(
      `corpus_datasets?select=dump:metadata->summary->dump->last_modified&id=eq.${WATCH_DATASET}&limit=1`,
    ).catch(() => ({ rows: [] as { dump: unknown }[], total: null })),
  ]);
  const bills = rows.rows.map(parseWatchRow).filter((b): b is WatchBill => !!b);
  const dump = meta.rows[0]?.dump;
  const parsed = typeof dump === "string" ? new Date(dump) : null;
  return {
    bills,
    returned: rows.rows.length,
    limit: LIMIT,
    dropped: rows.rows.length - bills.length,
    // "Thu, 01 Oct 2026 01:54:34 GMT" -> "2026-10-01"
    dumpDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null,
    readAt: new Date().toISOString(),
  };
});

export const getLimitationsLegislativeWatch = createServerFn({ method: "GET" }).handler(
  async (): Promise<WatchPayload> =>
    read().catch((e: unknown) => {
      console.error("limitations legislative watch", e);
      throw new Error("State bills could not be read just now.");
    }),
);
