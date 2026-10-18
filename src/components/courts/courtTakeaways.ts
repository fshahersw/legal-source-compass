/** Key takeaways for /courts/analytics, computed from the selected fiscal year of the published tables. */
import {
  changePct,
  int,
  medianOf,
  pct,
  plural,
  signedPct,
  times,
  usableTakeaways,
  type Takeaway,
} from "@/components/analysis/analysisFormat";

export type CourtTakeawayInput = {
  /** "FY2025". */
  yearLabel: string;
  /** "FY2024"; null for the first fiscal year in the series. */
  priorLabel: string | null;
  plFilings: number | null;
  plFilingsPrior: number | null;
  plSharePct: number | null;
  /** Every fiscal year's PL share, so the selected year can be read against the series median. */
  plShareSeries: readonly (number | null)[];
  top5SharePct: number | null;
  hhi: number | null;
  medianMonthsNational: number | null;
  medianMonthsDistrict: number | null;
  /** True when one MDL docket dominates the pooled national figure (the page's own dominance note). */
  nationalSkewed: boolean;
  flagCount: number;
  flaggedDistricts: number;
};

export function courtTakeaways(i: CourtTakeawayInput): Takeaway[] {
  const delta = changePct(i.plFilings, i.plFilingsPrior);
  const shareMedian = medianOf(i.plShareSeries);
  const skew = i.nationalSkewed ? times(i.medianMonthsNational, i.medianMonthsDistrict) : null;
  return usableTakeaways([
    i.plFilings != null && delta != null && i.priorLabel
      ? {
          id: "pl-filings",
          figure: signedPct(delta),
          text: `product liability filings in ${i.yearLabel} (${int(i.plFilings)}) against ${int(i.plFilingsPrior)} in ${i.priorLabel}; swings usually follow MDL dockets.`,
          anchor: "court-nos",
          anchorLabel: "See filings",
        }
      : null,
    i.plSharePct != null
      ? {
          id: "pl-share",
          figure: pct(i.plSharePct),
          text: `of ${i.yearLabel} district civil filings were product liability${shareMedian != null ? `; the median year in this series is ${pct(shareMedian)}` : ""}.`,
          anchor: "court-pl-share",
          anchorLabel: "See the trend",
        }
      : null,
    i.top5SharePct != null
      ? {
          id: "top5",
          figure: pct(i.top5SharePct),
          text: `of ${i.yearLabel} product liability filings are in the five busiest districts${i.hhi != null ? ` (HHI ${int(i.hhi)})` : ""}.`,
          anchor: "court-top5",
          anchorLabel: "See concentration",
        }
      : null,
    i.medianMonthsDistrict != null && i.medianMonthsNational != null
      ? {
          id: "months",
          figure: `${i.medianMonthsNational.toFixed(1)} mo`,
          text: `pooled national median from filing to disposition, against ${i.medianMonthsDistrict.toFixed(1)} mo for the median district${skew ? ` (${skew}): one MDL docket skews the pooled figure` : ""}.`,
          anchor: "court-disposition",
          anchorLabel: "See the trend",
        }
      : null,
    {
      id: "flags",
      figure: int(i.flagCount),
      text: `${i.flagCount === 1 ? "flag" : "flags"} across ${plural(i.flaggedDistricts, "district")} under the published rules in ${i.yearLabel}; each is a lead to review, not a finding.`,
      anchor: "court-flags",
      anchorLabel: "See flags",
    },
  ]);
}
