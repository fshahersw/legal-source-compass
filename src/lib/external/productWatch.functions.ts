/**
 * Product watch reads (public.safety_watch_v1, database/contracts/safety-watch-v1.sql): every product's last 12
 * complete months of reports against the 12 before, scored server-side (watchModel) so the browser receives the counts,
 * the ranked lists with their monthly tails and the map points, not the full 1.5 MB table. One product's watch card
 * (for its profile page) comes from the same cached read. Read-only; cached for 10 minutes; a missing function ("not
 * published") is not cached.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rpcPostOptional } from "./rest.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  buildWatch,
  cardFor,
  parseWatchPayload,
  type WatchCard,
  type WatchPayload,
  type WatchView,
} from "@/components/safety/watch/watchModel";

export type WatchResponse = { published: boolean; view: WatchView | null; readAt: string };

class NotPublished extends Error {}

const read = memoAsync(
  READ_TTL_MS,
  async (): Promise<{ payload: WatchPayload; view: WatchView; readAt: string }> => {
    const raw = await rpcPostOptional<unknown>("safety_watch_v1", { p_min: 30 });
    if (raw === null) throw new NotPublished();
    const payload = parseWatchPayload(raw);
    return { payload, view: buildWatch(payload), readAt: new Date().toISOString() };
  },
);

export const getProductWatch = createServerFn({ method: "GET" }).handler(
  async (): Promise<WatchResponse> => {
    try {
      const { view, readAt } = await read();
      return { published: true, view, readAt };
    } catch (error) {
      if (error instanceof NotPublished)
        return { published: false, view: null, readAt: new Date().toISOString() };
      throw error;
    }
  },
);

const ID = /^[a-z][a-z0-9_]{1,20}:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** One product's watch card, or null when the product is not on the watch (fewer than 30 reports in both windows). */
export const getProductWatchCard = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({ id: z.string().regex(ID) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }): Promise<WatchCard | null> => {
    try {
      const { payload } = await read();
      return cardFor(payload, data.id);
    } catch (error) {
      if (error instanceof NotPublished) return null;
      throw error;
    }
  });
