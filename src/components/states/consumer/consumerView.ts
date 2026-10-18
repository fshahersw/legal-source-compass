/**
 * Pure display helpers for the state page's consumer-protection panel. Every function works only from rows the
 * server function loaded; an unknown value comes back as "Not recorded" (or null), never a guess.
 */
import {
  NOT_RECORDED,
  signedPct,
  usableTakeaways,
  usdCompact,
  type Takeaway,
} from "@/components/analysis/analysisFormat";
import type {
  ConsumerYear,
  DncYear,
  Edition,
  NationalYear,
  Printed,
  RefundYear,
  StateConsumerData,
} from "@/lib/external/stateConsumer.functions";

export { NOT_RECORDED };

/** The credit the FTC asks for, with the terms' own limit: public domain, no endorsement. */
export const FTC_CREDIT =
  "Source: United States Federal Trade Commission, www.ftc.gov. Public domain (FTC Website Policy); no FTC endorsement is implied.";

/** The FTC ranks the 50 states; DC and Puerto Rico are listed but not ranked. */
export const RANKED_STATES = 50;

export const shown = (p: Printed | null | undefined): string => p?.text ?? NOT_RECORDED;

/** "rank 17 of 50", "unranked by the FTC" (DC, PR) or "Not recorded"; lower case so it reads mid-sentence. */
export function rankText(p: Printed | null | undefined): string {
  if (!p) return NOT_RECORDED;
  if (p.value == null) return p.text === "Unranked" ? "unranked by the FTC" : NOT_RECORDED;
  return `rank ${p.text} of ${RANKED_STATES}`;
}

/** "up 2 places", "down 3 places", "no change in rank"; null when either edition has no rank. */
export function rankMove(change: number | null | undefined): string | null {
  if (change == null || !Number.isFinite(change)) return null;
  if (change === 0) return "no change in rank";
  const places = Math.abs(change);
  return `${change > 0 ? "up" : "down"} ${places} ${places === 1 ? "place" : "places"}`;
}

export const sentence = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The Census estimate behind an edition's per-100K figures, as the FTC states it. */
export function populationBasis(year: { populationYear: number | null }): string {
  return year.populationYear != null
    ? `the FTC's ${year.populationYear} Census estimate`
    : "the FTC's Census estimate (year Not recorded)";
}

export function editionName(
  editions: Record<number, Edition>,
  year: number,
  fallback: string,
): string {
  return editions[year]?.name ?? `${fallback} ${year}`;
}

export type TrendPoint = {
  year: number;
  value: number | null;
  /** The figure as printed, for tooltips. */
  text: string | null;
  populationYear: number | null;
};

/** One point per loaded edition, in year order; a missing figure is a null point, never interpolated. */
export function trendPoints(
  years: readonly ConsumerYear[],
  pick: (y: ConsumerYear) => Printed | null,
): TrendPoint[] {
  return years.map((y) => {
    const p = pick(y);
    return {
      year: y.year,
      value: p?.value ?? null,
      text: p?.text ?? null,
      populationYear: y.populationYear,
    };
  });
}

/** Editions that carry an FTC category-definition notice (2020, 2023 and 2024 in the loaded record). */
export function definitionYears(national: readonly NationalYear[]): number[] {
  return national.filter((n) => n.notices.length > 0).map((n) => n.year);
}

/** Notices for the editions in [from, to], each once, in edition order. */
export function noticesBetween(
  national: readonly NationalYear[],
  from: number,
  to: number,
): { year: number; notice: string }[] {
  const seen = new Set<string>();
  const out: { year: number; notice: string }[] = [];
  for (const n of national) {
    if (n.year < from || n.year > to) continue;
    for (const notice of n.notices) {
      if (seen.has(notice)) continue;
      seen.add(notice);
      out.push({ year: n.year, notice });
    }
  }
  return out;
}

/** The national median loss per year, for the comparison line beside the state's median. */
export function nationalMedianPoints(
  years: readonly ConsumerYear[],
  national: readonly NationalYear[],
): (number | null)[] {
  const byYear = new Map(national.map((n) => [n.year, n]));
  return years.map((y) => byYear.get(y.year)?.medianLoss?.value ?? null);
}

export function nationalFor(
  national: readonly NationalYear[],
  year: number,
): NationalYear | undefined {
  return national.find((n) => n.year === year);
}

/** "up 2 places against the 2023 edition", or null when the record has no comparison. */
export function rankChangeText(y: ConsumerYear, previousYear: number): string | null {
  const move = rankMove(y.change.rankChange);
  return move ? `${move} against the ${previousYear} edition` : null;
}

export type CategoryBar = { rank: number; label: string; sharePct: number; width: number };

/** Bars scaled to the largest share shown, so the longest bar is the largest category and no share is cut. */
export function categoryBars(
  items: readonly { rank?: number; label: string; sharePct: number }[],
): CategoryBar[] {
  const max = Math.max(1, ...items.map((i) => i.sharePct));
  return items.map((i, idx) => ({
    rank: i.rank ?? idx + 1,
    label: i.label,
    sharePct: i.sharePct,
    width: Math.max(2, (i.sharePct / max) * 100),
  }));
}

export function refundBars(
  refunds: readonly RefundYear[],
): (RefundYear & { width: number | null })[] {
  const max = Math.max(0, ...refunds.map((r) => r.mailed?.value ?? 0));
  return refunds.map((r) => ({
    ...r,
    width: r.mailed?.value != null && max > 0 ? Math.max(2, (r.mailed.value / max) * 100) : null,
  }));
}

/** A rank as the FTC printed it ("22 of 50"); Not recorded where the source leaves it blank (DC, PR). */
export function rankCellText(p: Printed | null | undefined): string {
  return p && p.value != null ? `${p.text} of ${RANKED_STATES}` : NOT_RECORDED;
}

export const latest = <T>(items: readonly T[]): T | null => items.at(-1) ?? null;

/** Change vs the prior fiscal year, printed with a real minus sign; null (not applicable) for the first year loaded. */
export function dncChange(d: DncYear, previous: DncYear | undefined): string | null {
  if (!previous) return null;
  return d.complaintsYoyPct == null ? NOT_RECORDED : signedPct(d.complaintsYoyPct);
}

/** Key takeaways computed only from the rows that loaded; fewer than two usable ones show none. */
export function consumerTakeaways(d: StateConsumerData): Takeaway[] {
  const y = latest(d.years);
  const first = d.years[0];
  const nat = y ? nationalFor(d.national, y.year) : undefined;
  const dnc = latest(d.dnc);
  const ref = latest(d.refunds);
  return usableTakeaways([
    y?.per100k
      ? {
          id: "per100k",
          figure: y.per100k.text,
          text: `fraud and other reports per 100,000 residents in ${y.year} (${rankText(y.rank)}; denominator ${populationBasis(y)}).`,
          anchor: "consumer-trend",
          anchorLabel: "See the trend",
        }
      : null,
    y?.totalLoss?.value != null
      ? {
          id: "loss",
          figure: usdCompact(y.totalLoss.value),
          text: `reported fraud loss in ${y.year} (reports with a loss of $1 to $999,999)${
            y.medianLoss
              ? `; median loss ${y.medianLoss.text}${nat?.medianLoss ? ` against ${nat.medianLoss.text} for the United States` : ""}`
              : ""
          }.`,
          anchor: "consumer-trend",
          anchorLabel: "See the trend",
        }
      : null,
    first && y && first.year !== y.year && first.per100k && y.per100k
      ? {
          id: "span",
          figure: `${first.per100k.text} → ${y.per100k.text}`,
          text: `reports per 100,000, ${first.year} edition to ${y.year} edition; Census denominators and FTC category definitions differ between editions.`,
          anchor: "consumer-trend",
          anchorLabel: "See the trend",
        }
      : null,
    dnc?.complaintsPer100k
      ? {
          id: "dnc",
          figure: dnc.complaintsPer100k.text,
          text: `Do Not Call complaints per 100,000 residents in FY${dnc.fy} (${dnc.complaintsRank?.value != null ? rankText(dnc.complaintsRank) : `rank ${NOT_RECORDED}`}).`,
          anchor: "consumer-dnc",
          anchorLabel: "See Do Not Call",
        }
      : null,
    ref?.mailed
      ? {
          id: "refunds",
          figure: ref.mailed.text,
          text: `mailed to consumers in the state in ${ref.year}${
            ref.yoyPct != null ? ` (${signedPct(ref.yoyPct)} against ${ref.year - 1})` : ""
          }; a mailing total, not a count of consumers or of amounts cashed.`,
          anchor: "consumer-refunds",
          anchorLabel: "See refunds",
        }
      : null,
  ]);
}
