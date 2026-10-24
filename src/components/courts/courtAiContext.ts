/**
 * The AI context of the product-liability filings chart on /courts/analytics: the yearly totals the chart draws, the
 * selected year's change on the year before and the share of "other personal injury" filings, as the card prints them.
 * Pure and tested (courtAiContext.test.ts).
 */
import { buildSectionContext } from "@/components/kit/ai/buildSectionContext";
import type { SectionContext } from "@/lib/assistant/sectionContext";

export function filingsContext(input: {
  /** Fiscal years in chart order. */
  years: readonly number[];
  /** Total filings per year, aligned with `years`; null where a group is not recorded. */
  totals: readonly (number | null)[];
  /** Index of the selected year in `years`. */
  selected: number;
  /** Percent change of the selected year on the year before, when both are recorded. */
  changePercent: number | null;
  /** Share (percent) of the selected year's filings in the largest nature-of-suit group. */
  otherShare: number | null;
  source: string;
}): SectionContext {
  const { years, totals, selected } = input;
  const fy = (i: number) => `FY${years[i]}`;
  const sel = years[selected] === undefined ? null : fy(selected);
  const prior = selected > 0 && years[selected - 1] !== undefined ? fy(selected - 1) : null;
  return buildSectionContext({
    title: "Product liability filings by fiscal year",
    scope: "U.S. district courts",
    period: years.length ? `FY${years[0]}–FY${years[years.length - 1]}` : null,
    source: input.source,
    figures: [
      ...years.map((_, i) => ({
        label: "Product liability filings",
        value: totals[i] ?? null,
        unit: "cases",
        period: fy(i),
      })),
      ...(input.changePercent !== null && sel && prior
        ? [
            {
              label: `Change in filings, ${sel} on ${prior}`,
              value: `${input.changePercent > 0 ? "+" : input.changePercent < 0 ? "-" : ""}${Math.abs(input.changePercent).toFixed(1)}%`,
            },
          ]
        : []),
      ...(input.otherShare !== null && sel
        ? [
            {
              label: "Other personal injury incl. pharmaceutical (365, 367), share of filings",
              value: `${input.otherShare.toFixed(1)}%`,
              period: sel,
            },
          ]
        : []),
    ],
  });
}
