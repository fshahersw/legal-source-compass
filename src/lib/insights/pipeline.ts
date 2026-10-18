/**
 * Pure assembly of a section's daily insight from its source outcomes. No I/O and no clock: the caller passes
 * the UTC day key. Kept apart from the server function so it can be unit tested without a database.
 */
import { finishPool } from "./build";
import { pickDaily } from "./rotation";
import type { Insight, SectionInsight } from "./types";

/** At most this many candidates per section; the most notable are kept. */
export const MAX_POOL = 10;

export type SourceOutcome =
  { id: string; ok: true; insights: Insight[] } | { id: string; ok: false; error: string };

export type SectionMeta = { id: string; title: string; href: string; chartsLabel: string };

export type SectionPool = { pool: Insight[]; partial: boolean };

/**
 * Combine source outcomes into the section's candidate pool. A failed source drops only its own candidates
 * (partial = true). When every source failed the read failed as a whole and this throws, so the page shows an
 * error with Retry instead of a misleading "no insight available".
 */
export function buildPool(sectionId: string, outcomes: readonly SourceOutcome[]): SectionPool {
  const failed = outcomes.filter((o) => !o.ok);
  if (outcomes.length > 0 && failed.length === outcomes.length)
    throw new Error(`Insight data for "${sectionId}" could not be read.`);
  const insights = outcomes.flatMap((o) => (o.ok ? o.insights : []));
  return {
    pool: finishPool(
      insights.filter((i) => i.section === sectionId),
      MAX_POOL,
    ),
    partial: failed.length > 0,
  };
}

/** The section as shown on `dayKey`: today's pick, its place in the rotation and the other headlines. */
export function sectionForDay(
  meta: SectionMeta,
  pool: SectionPool,
  dayKey: string,
): SectionInsight {
  const picked = pickDaily(pool.pool, dayKey, meta.id);
  const others = pool.pool.filter((i) => i.id !== picked?.item.id);
  return {
    section: meta.id,
    title: meta.title,
    href: meta.href,
    chartsLabel: meta.chartsLabel,
    pick: picked?.item ?? null,
    position: picked?.position ?? 0,
    poolSize: picked?.poolSize ?? 0,
    headlines: others.map((i) => i.headline),
    partial: pool.partial,
    failed: false,
  };
}

/** A section whose read failed inside an all-sections request (single-section requests throw instead). */
export function failedSection(meta: SectionMeta): SectionInsight {
  return {
    section: meta.id,
    title: meta.title,
    href: meta.href,
    chartsLabel: meta.chartsLabel,
    pick: null,
    position: 0,
    poolSize: 0,
    headlines: [],
    partial: true,
    failed: true,
  };
}
