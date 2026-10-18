import { STATES } from "@/lib/corpus/geo";
import type { ClaimType, LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { claimMatrix } from "./stateStatutes";

export type PeriodBucket = { period: string; months: number; states: string[] };

/** Months in a recorded period label such as "2 calendar years"; null when the label is not a period. */
export function periodMonths(label: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s+calendar\s+(year|month|day)s?$/i.exec(label.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]!.toLowerCase() === "year" ? n * 12 : m[2]!.toLowerCase() === "month" ? n : n / 30;
}

/**
 * Group jurisdictions by the recorded general period for one claim. Only rows with a recorded citation and
 * a parseable period are counted; nothing is inferred for a state without a recorded rule.
 */
export function nationalSpread(
  snapshot: LimitationsSnapshot,
  claim: ClaimType,
  variantName: (rule: LimitationRule) => string,
) {
  const buckets = new Map<string, PeriodBucket>();
  let recorded = 0;
  for (const s of STATES) {
    const row = claimMatrix(snapshot, s.usps, variantName).find((r) => r.claimType === claim);
    if (!row?.citation) continue;
    const months = periodMonths(row.period);
    if (months == null) continue;
    recorded++;
    const bucket = buckets.get(row.period) ?? { period: row.period, months, states: [] };
    bucket.states.push(s.usps);
    buckets.set(row.period, bucket);
  }
  const list = [...buckets.values()].sort((a, b) => a.months - b.months);
  return {
    buckets: list,
    recorded,
    total: STATES.length,
    max: Math.max(1, ...list.map((b) => b.states.length)),
  };
}
