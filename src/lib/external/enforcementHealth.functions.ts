/**
 * DOJ health-care enforcement dashboard: releases per year tagged False Claims Act, Healthcare Fraud, Opioids and
 * Prescription Drugs (indexed `filters.topic` counts per yearly partition), FCA releases by the size of their own
 * headline figure, and the largest health-care resolutions ranked by headline figure (rankLargestResolutions).
 * Read-only; memoized for 10 minutes; failures are not cached.
 */
import { createServerFn } from "@tanstack/react-start";
import { countRows, mapLimit } from "@/lib/analytics/tally.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  parseDojRelease,
  parseHeadline,
  readAll,
  readDojOverview,
  type DojRelease,
} from "./enforcementActions.functions";
import { rankLargestResolutions, type LargestEntry } from "./enforcementLargest";
import {
  coverageBreak,
  fcaYear,
  HEALTH_TOPICS,
  isPartialYear,
  TOPIC_FROM_YEAR,
  type HealthDashboard,
  type TopicYear,
} from "./enforcementHealth";

export type DojHealthPayload = HealthDashboard & {
  top: LargestEntry[];
  topCandidates: number;
  topHeld: number;
  coverage: { year: string; before: number; after: number } | null;
};

const enc = encodeURIComponent;
const cs = (v: Record<string, string[]>) => enc(JSON.stringify(v));

const read = memoAsync(READ_TTL_MS, async (): Promise<DojHealthPayload | null> => {
  const overview = await readDojOverview();
  if (!overview) return null;
  const parts = overview.partitions.filter(
    (p) => /_\d{4}$/.test(p.dataset) && Number(p.year) >= TOPIC_FROM_YEAR,
  );
  if (!parts.length) return null;

  const jobs = parts.flatMap((p) => HEALTH_TOPICS.map((t) => ({ p, t })));
  const counts = await mapLimit(jobs, 6, ({ p, t }) =>
    countRows(`corpus_records?dataset=eq.${p.dataset}&filters=cs.${cs({ topic: [t.topic] })}`),
  );

  const fca = await mapLimit(parts, 4, (p) =>
    readAll<{ title: unknown; d: unknown; hf: unknown }>(
      `corpus_records?select=id,title,d:item->release->>date,hf:item->release->headline_figure&dataset=eq.${p.dataset}&filters=cs.${cs({ topic: ["False Claims Act"] })}&order=ordinal.asc`,
      5000,
    ),
  );
  const asOf =
    fca
      .flat()
      .map((r) => (typeof r.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.d) ? r.d : ""))
      .reduce((a, b) => (b > a ? b : a), "") || null;

  const years: TopicYear[] = parts.map((p, i) => {
    const row = { year: p.year, partial: isPartialYear(p.year, asOf) } as TopicYear;
    HEALTH_TOPICS.forEach((t, j) => {
      row[t.id] = counts[i * HEALTH_TOPICS.length + j] ?? null;
    });
    return row;
  });
  const fcaRows = parts.map((p, i) =>
    fcaYear(
      p.year,
      isPartialYear(p.year, asOf),
      (fca[i] ?? []).map((r) => {
        const title = typeof r.title === "string" ? r.title : "";
        return parseHeadline(r.hf, title)?.valueUsd ?? null;
      }),
    ),
  );

  // Largest health-care resolutions: candidates from the indexed $100M+ buckets of each topic.
  const list = parts.map((p) => p.dataset).join(",");
  const bigJobs = HEALTH_TOPICS.flatMap((t) =>
    (["100m_plus", "1b_plus"] as const).map((amount) => ({ t, amount })),
  );
  const big = await mapLimit(bigJobs, 4, ({ t, amount }) =>
    readAll<{ dataset: unknown; id: unknown; title: unknown; source_url: unknown; r: unknown }>(
      `corpus_records?select=dataset,id,title,source_url,r:item->release&dataset=in.(${list})&filters=cs.${cs({ topic: [t.topic], amount: [amount] })}&order=dataset.asc,ordinal.asc`,
      5000,
    ),
  );
  const releases: DojRelease[] = big.flat().flatMap((r) => {
    const ds = typeof r.dataset === "string" ? r.dataset : "";
    const p = /^doj_press_releases_\d{4}$/.test(ds) ? parseDojRelease(r, ds) : null;
    return p ? [p] : [];
  });
  const ranked = rankLargestResolutions(releases, 1e8);

  return {
    years,
    fcaSizes: fcaRows.map((r) => r.sizes),
    fcaMedian: fcaRows.map((r) => r.median),
    latestComplete: [...years].reverse().find((y) => !y.partial)?.year ?? null,
    asOf,
    top: ranked.entries.slice(0, 25),
    topCandidates: ranked.candidates,
    topHeld: ranked.held.length,
    coverage: coverageBreak(overview.partitions.filter((p) => /_\d{4}$/.test(p.dataset))),
  };
});

export const getDojHealthDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<DojHealthPayload | null> =>
    read().catch((e: unknown) => {
      console.error("doj health dashboard", e);
      throw new Error("DOJ health-care enforcement could not be read just now.");
    }),
);
