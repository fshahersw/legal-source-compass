/**
 * How many Regulations.gov dockets have a public comment count read (filters.comments is "not_recorded" until it is),
 * so the "most-commented dockets" list can say how small a share it ranks. Two indexed counts; memoized for an hour.
 */
import { createServerFn } from "@tanstack/react-start";
import { countRows } from "@/lib/analytics/tally.server";
import { memoAsync } from "@/lib/insights/readers/cache";

export type DocketCommentCoverage = { dockets: number; counted: number };

const read = memoAsync(60 * 60 * 1000, async (): Promise<DocketCommentCoverage> => {
  const base = "corpus_records?dataset=eq.regulations_gov_dockets";
  const [dockets, notRecorded] = await Promise.all([
    countRows(base),
    countRows(
      `${base}&filters=cs.${encodeURIComponent(JSON.stringify({ comments: ["not_recorded"] }))}`,
    ),
  ]);
  return { dockets, counted: Math.max(0, dockets - notRecorded) };
});

export const getDocketCommentCoverage = createServerFn({ method: "GET" }).handler(
  async (): Promise<DocketCommentCoverage | null> =>
    read().catch((e: unknown) => {
      console.error("docket comment coverage", e);
      return null;
    }),
);
