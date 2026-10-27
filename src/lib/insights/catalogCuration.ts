/**
 * Reader-side curation of the insights metric registry (pure). Two rules:
 *  - A metric whose last refresh wrote no facts is not offered in pickers or rankings: there is nothing to show, and an
 *    empty metric reads as a broken page. It comes back on its own once a refresh writes facts.
 *  - Metrics that need a reading note the registry does not carry yet get it here (idempotent, so a registry that
 *    later carries the note is left as it is).
 */
import type { MetricDef } from "./contract";

/** DOJ press-release counts change basis at 2013 (verified in insights.facts: 1,149-1,501 a year for 2009-2012, 18,150+ from 2013). */
export const DOJ_SERIES_BREAK_CAVEAT =
  "Series break at 2013: years before 2013 hold about 1,100-1,500 releases a year, later years 18,000 or more. The jump reflects what the justice.gov archive holds, not a change in DOJ activity, so do not compare across 2013.";

const EXTRA_CAVEATS: Record<string, string> = {
  doj_press_releases: DOJ_SERIES_BREAK_CAVEAT,
  doj_state_press_releases: DOJ_SERIES_BREAK_CAVEAT,
};

/** True when the registry records that the last refresh wrote at least one fact. */
export const hasFacts = (m: MetricDef): boolean => m.coverage.facts > 0;

export function withReadingNotes(m: MetricDef): MetricDef {
  const extra = EXTRA_CAVEATS[m.id];
  if (!extra || m.caveats.some((c) => c.startsWith("Series break at 2013"))) return m;
  return { ...m, caveats: [extra, ...m.caveats] };
}

/** The registry rows a reader is offered: metrics with facts, with their reading notes. */
export function curateCatalog(metrics: readonly MetricDef[]): MetricDef[] {
  return metrics.filter(hasFacts).map(withReadingNotes);
}

/** Ids left out because the last refresh wrote no facts (listed in the page's About note). */
export function emptyMetricIds(metrics: readonly MetricDef[]): string[] {
  return metrics.filter((m) => !hasFacts(m)).map((m) => m.id);
}
