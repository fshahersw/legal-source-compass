/** Pure helpers for the Source changes view: source families, daily trend totals and repeated-reason folding. */
import type {
  RegulatoryEvent,
  RegulatorySourceFamily,
  RegulatorySourceId,
  RegulatoryTrend,
} from "@/lib/regulatory/types";

export const FAMILY_LABELS: Record<RegulatorySourceFamily, string> = {
  fda: "FDA",
  nhtsa: "NHTSA",
  cpsc: "CPSC",
  federal_register: "Federal Register",
};

export function sourceFamilyOf(id: RegulatorySourceId | string): RegulatorySourceFamily {
  if (id === "federal_register") return "federal_register";
  if (id.startsWith("nhtsa")) return "nhtsa";
  if (id.startsWith("cpsc")) return "cpsc";
  return "fda";
}

export type TrendDay = {
  day: string;
  events: number;
  initial: number;
  changes: number;
  newRecords: number;
};

export type TrendSummary = {
  days: TrendDay[];
  total: number;
  last7: number;
  initial: number;
  changes: number;
  newRecords: number;
  activeDays: number;
  peak: { day: string; events: number } | null;
};

/**
 * Daily totals split into first captures/backfills, changes/corrections and the remainder (newly observed records),
 * with the last-7-day sum and the busiest day. The remainder is never negative.
 */
export function trendSummary(trend: Pick<RegulatoryTrend, "points">): TrendSummary {
  const days: TrendDay[] = trend.points.map((point) => ({
    day: point.day,
    events: point.events,
    initial: point.initialRecords,
    changes: point.changes,
    newRecords: Math.max(0, point.events - point.initialRecords - point.changes),
  }));
  const sum = (key: keyof Omit<TrendDay, "day">, list = days) =>
    list.reduce((total, day) => total + day[key], 0);
  let peak: TrendSummary["peak"] = null;
  for (const day of days)
    if (day.events > 0 && (!peak || day.events > peak.events))
      peak = { day: day.day, events: day.events };
  return {
    days,
    total: sum("events"),
    last7: sum("events", days.slice(-7)),
    initial: sum("initial"),
    changes: sum("changes"),
    newRecords: sum("newRecords"),
    activeDays: days.filter((day) => day.events > 0).length,
    peak,
  };
}

/**
 * The reason text shared by most rows of a page, so it is printed once above the list instead of on every row.
 * Returns null when no reason repeats on at least half of the rows (and at least three).
 */
export function commonReason(events: readonly Pick<RegulatoryEvent, "reason">[]): string | null {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.reason, (counts.get(event.reason) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best && best[1] >= 3 && best[1] * 2 >= events.length ? best[0] : null;
}
