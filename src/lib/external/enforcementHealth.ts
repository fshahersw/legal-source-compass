/**
 * Pure model for the DOJ health-care enforcement dashboard (False Claims Act, health-care fraud, opioids, prescription
 * drugs) and the DOJ coverage note. No I/O. Counts are releases per calendar year of the release date, from the yearly
 * partitions doj_press_releases_YYYY; a release can carry several topics, so topic counts are never added together.
 */
import type { DojPartition } from "./enforcementActions.functions";

export const HEALTH_TOPICS = [
  { id: "fca", topic: "False Claims Act", label: "False Claims Act" },
  { id: "hcf", topic: "Healthcare Fraud", label: "Health-care fraud" },
  { id: "opioids", topic: "Opioids", label: "Opioids" },
  { id: "rx", topic: "Prescription Drugs", label: "Prescription drugs" },
] as const;
export type HealthTopicId = (typeof HEALTH_TOPICS)[number]["id"];

/** Topic tags are applied consistently from 2015; earlier partitions carry almost none (FCA 0–9 a year). */
export const TOPIC_FROM_YEAR = 2015;

export const SIZE_BUCKETS = [
  { id: "none", label: "No figure or under $1M" },
  { id: "m1", label: "$1M to under $10M" },
  { id: "m10", label: "$10M to under $100M" },
  { id: "m100", label: "$100M or more" },
] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number]["id"];

/** The headline-figure size bucket of one release (each release falls in exactly one). */
export function sizeBucket(headlineUsd: number | null): SizeBucket {
  if (headlineUsd == null || !Number.isFinite(headlineUsd) || headlineUsd < 1e6) return "none";
  if (headlineUsd < 1e7) return "m1";
  if (headlineUsd < 1e8) return "m10";
  return "m100";
}

export type TopicYear = {
  year: string;
  partial: boolean;
} & Record<HealthTopicId, number | null>;

export type SizeYear = { year: string; partial: boolean } & Record<SizeBucket, number>;

export type HealthDashboard = {
  years: TopicYear[];
  /** FCA releases by headline-figure size, per year (exact partition of the FCA count). */
  fcaSizes: SizeYear[];
  /** Median FCA headline figure among releases stating one of $1M or more, per year. */
  fcaMedian: { year: string; partial: boolean; median: number | null; n: number }[];
  latestComplete: string | null;
  asOf: string | null;
};

/** A year is partial when it is the current calendar year of the data's latest release date (or later). */
export function isPartialYear(year: string, asOf: string | null): boolean {
  if (!asOf) return false;
  return Number(year) >= Number(asOf.slice(0, 4));
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** FCA size buckets and the median headline figure for one year's releases. */
export function fcaYear(
  year: string,
  partial: boolean,
  headlines: readonly (number | null)[],
): { sizes: SizeYear; median: { year: string; partial: boolean; median: number | null; n: number } } {
  const sizes: SizeYear = { year, partial, none: 0, m1: 0, m10: 0, m100: 0 };
  const stated: number[] = [];
  for (const h of headlines) {
    sizes[sizeBucket(h)] += 1;
    if (h != null && h >= 1e6) stated.push(h);
  }
  return { sizes, median: { year, partial, median: median(stated), n: stated.length } };
}

/**
 * Where the yearly partitions change coverage: the first year whose release count is at least five times the year
 * before. DOJ News API holds 1,149–1,501 releases a year for 2009–2012 against 16,800–21,200 from 2013, so a series
 * that crosses that year reads a coverage change as growth.
 */
export function coverageBreak(
  partitions: readonly DojPartition[],
): { year: string; before: number; after: number } | null {
  const sorted = [...partitions].sort((a, b) => a.year.localeCompare(b.year));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.records > 0 && cur.records >= prev.records * 5)
      return { year: cur.year, before: prev.records, after: cur.records };
  }
  return null;
}

/** Change of the latest complete year against the year before, in releases and percent (null when not comparable). */
export function lastChange(
  rows: readonly TopicYear[],
  id: HealthTopicId,
): { year: string; value: number; prior: number | null; delta: number | null; pct: number | null } | null {
  const complete = rows.filter((r) => !r.partial && r[id] != null);
  const last = complete.at(-1);
  if (!last) return null;
  const prev = complete.at(-2);
  const value = last[id]!;
  const prior = prev && Number(prev.year) === Number(last.year) - 1 ? prev[id] : null;
  return {
    year: last.year,
    value,
    prior,
    delta: prior != null ? value - prior : null,
    pct: prior ? ((value - prior) / prior) * 100 : null,
  };
}
