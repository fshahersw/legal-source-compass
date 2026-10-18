/** Key takeaways for /places/analytics: what the selected metric and year show, from the ranked states. */
import {
  listAnd,
  plural,
  times,
  usableTakeaways,
  type Takeaway,
} from "@/components/analysis/analysisFormat";
import type { MetricFormat } from "@/lib/external/stateMetrics.functions";
import {
  changeUnitFor,
  formatChange,
  formatValue,
  median,
  OUTLIER_Z,
  type RankedValue,
} from "./stateMetricsMath";

export type StateTakeawayInput = {
  /** "Overdose / 100k". */
  short: string;
  year: number;
  format: MetricFormat;
  ranked: readonly RankedValue[];
  /** Jurisdictions the source could have reported (51: 50 states and DC). */
  jurisdictions: number;
  /** A year the source marks partial: ranks and changes are not used. */
  partial: boolean;
};

const isTotalFormat = (f: MetricFormat) => f === "int" || f === "money_m";

export function stateMetricTakeaways(i: StateTakeawayInput): Takeaway[] {
  const { ranked, format, year } = i;
  if (!ranked.length) return [];
  const high = ranked[0]!;
  const low = ranked[ranked.length - 1]!;
  const mid = median(ranked.map((r) => r.value));
  const fmt = (v: number) => formatValue(v, format);
  const total = isTotalFormat(format);
  const ofMedian = mid != null ? times(high.value, mid) : null;
  const range = low.value > 0 && ranked.length > 1 ? times(high.value, low.value) : null;
  const withChange = ranked.filter((r) => r.change5 != null);
  const rising = withChange.filter((r) => (r.change5 ?? 0) > 0);
  const bigUp = [...withChange].sort((a, b) => (b.change5 ?? 0) - (a.change5 ?? 0))[0];
  const bigDown = [...withChange].sort((a, b) => (a.change5 ?? 0) - (b.change5 ?? 0))[0];
  const unit = changeUnitFor(format);
  const outliers = ranked.filter((r) => r.outlier);
  const out: (Takeaway | null)[] = [
    ofMedian
      ? {
          id: "highest",
          figure: `${ofMedian} median`,
          text: `${high.name} is highest on ${i.short} in ${year} (${fmt(high.value)}) against a state median of ${mid != null ? fmt(mid) : ""}${total ? "; a total, so it mostly tracks population" : ""}.`,
          anchor: "state-ranking",
          anchorLabel: "See the ranking",
        }
      : null,
    range
      ? {
          id: "range",
          figure: range,
          text: `separates the highest (${high.name}, ${fmt(high.value)}) from the lowest (${low.name}, ${fmt(low.value)}) of ${plural(ranked.length, "reporting jurisdiction")}${ranked.length < i.jurisdictions ? ` of ${i.jurisdictions}` : ""}.`,
          anchor: "state-map",
          anchorLabel: "See the map",
        }
      : null,
    !i.partial && withChange.length >= 10 && bigUp && bigDown
      ? {
          id: "five-year",
          figure: `${rising.length} of ${withChange.length}`,
          text: `jurisdictions are above their ${year - 5} level; largest rise ${bigUp.name} ${formatChange(bigUp.change5, unit)}, largest fall ${bigDown.name} ${formatChange(bigDown.change5, unit)}.`,
          anchor: "state-ranking",
          anchorLabel: "See 5-yr Δ",
        }
      : null,
    !i.partial
      ? {
          id: "outliers",
          figure: String(outliers.length),
          text: outliers.length
            ? `${outliers.length === 1 ? "jurisdiction lies" : "jurisdictions lie"} beyond |z| > ${OUTLIER_Z}: ${listAnd(outliers.map((o) => o.usps))}. A flag marks an unusual value, not an error.`
            : `jurisdictions lie beyond |z| > ${OUTLIER_Z}; values are spread without a flagged outlier.`,
          anchor: "state-ranking",
          anchorLabel: "See flags",
        }
      : null,
  ];
  return usableTakeaways(out);
}
