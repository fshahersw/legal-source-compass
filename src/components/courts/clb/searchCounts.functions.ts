/**
 * Read-only server function for a court page's search-count records (dataset clb_search_counts): the court's record and
 * the national topic series, in one request. Courts outside the dataset's 14 return null without a request.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "@/lib/external/rest.server";
import {
  parseCourtCounts,
  parseTopicSeries,
  SEARCH_COUNT_COURTS,
  type CourtCounts,
  type TopicSeries,
} from "./searchCounts";

export type CourtSearchCounts = { court: CourtCounts; series: TopicSeries[] };

export const getClbSearchCounts = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ court: z.string().regex(/^[a-z0-9]{2,20}$/) }).parse(d))
  .handler(async ({ data }): Promise<CourtSearchCounts | null> => {
    if (!(SEARCH_COUNT_COURTS as readonly string[]).includes(data.court)) return null;
    // two plain filters in parallel (a value with ":" inside an or=() tree would need quoting)
    const [c, t] = await Promise.all([
      restGet<{ id: string; p: unknown }[]>(
        `corpus_records?select=id,p:item->profile&dataset=eq.clb_search_counts&id=eq.court:${data.court}&limit=1`,
      ),
      restGet<{ id: string; p: unknown }[]>(
        `corpus_records?select=id,p:item->profile&dataset=eq.clb_search_counts&id=like.topic:*&limit=40`,
      ),
    ]);
    const court = c.rows.length === 1 ? parseCourtCounts(c.rows[0]!.p, data.court) : null;
    if (!court) return null;
    const series = t.rows.flatMap((x) => {
      const s = parseTopicSeries(x.p);
      return s && x.id === `topic:${s.slug}` ? [s] : [];
    });
    return { court, series };
  });
