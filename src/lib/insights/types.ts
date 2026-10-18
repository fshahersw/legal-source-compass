/**
 * Shared types for the "insight of the day" feature. Safe to import from client code (types only).
 *
 * An Insight is a deterministic, number-backed summary computed from published corpus rows by a pure
 * generator in `generators/`. Nothing is written by a language model and nothing is estimated: every
 * figure on an Insight is read from, or arithmetically derived from, a stored row, and a candidate whose
 * inputs are missing or malformed is dropped rather than shown with a placeholder.
 */

/** The shape of the claim an insight makes (used for variety in the pool and for labelling). */
export type InsightKind =
  | "mover" //        biggest change between two periods
  | "leader" //       who ranks first
  | "laggard" //      who ranks last
  | "concentration" // top-N share of a total
  | "outlier" //      far from the median
  | "mix_shift" //    change in composition
  | "trend" //        direction over a longer run
  | "coverage"; //    what the published data does and does not cover

export type InsightPoint = {
  label: string;
  /** Already formatted for display ("18.2%", "1,307,769", "$3.9 billion"). */
  value: string;
  note?: string | undefined;
  /** Site-relative path (starts with "/") or https URL. */
  href?: string | undefined;
};

export type InsightSourceLink = { label: string; href: string };

export type Insight = {
  /** Stable across days and unique across sections: `<section>.<slug>`. Rotation orders by this. */
  id: string;
  /** Section id (see `SectionDef.id` in registry.ts). */
  section: string;
  kind: InsightKind;
  headline: string;
  /** 2 to 4 plain-language sentences. */
  summary: string[];
  /** 3 to 5 major points. */
  points: InsightPoint[];
  /** Shown as a small footnote when the data is partial, sampled or provisional. */
  caveat?: string;
  sources: InsightSourceLink[];
  /** Latest period the figures cover, as the source states it ("FY2025", "2025", "2026-10-01"). */
  dataThrough?: string;
  /** Notability, 0 to 100. Orders the "other insights" list and trims an oversized pool; it never picks the day's insight. */
  score: number;
};

/** What the page shows for one section on one UTC day. */
export type SectionInsight = {
  section: string;
  title: string;
  /** Page that holds the section's charts. */
  href: string;
  /** Link text for the page ("Open state charts"). */
  chartsLabel: string;
  pick: Insight | null;
  /** 1-based place of `pick` in the rotation order. 0 when there is no pick. */
  position: number;
  poolSize: number;
  /** Headlines of the other insights in the pool (not a forecast of later days), best first. */
  headlines: string[];
  /** True when at least one data source for the section could not be read; the pool is built from the rest. */
  partial: boolean;
  /** True only in an all-sections response when this section's whole read failed; the card then offers Retry. */
  failed: boolean;
};

export type DailyInsights = {
  /** UTC day, `YYYY-MM-DD`, taken from the server clock when the request ran. */
  dayKey: string;
  sections: SectionInsight[];
};
