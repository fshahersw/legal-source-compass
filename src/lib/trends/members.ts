/**
 * Pure builder for the matter page's member-docket trend: the registry's member actions (dockets that count as an action),
 * by the month the docket was filed. The registry is a partial count and not the size of the MDL, so a month with no
 * registry docket is a gap and not a zero; the month the registry was last published in is partial.
 */
import {
  assembleBlock,
  densifyMonths,
  formatCount,
  periodLabel,
  type TrendBlockData,
} from "@/lib/analytics/trend";
import { monthAxis } from "./mdl";

const ISO = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function buildMemberMonths(input: {
  mdl: number;
  /** `filed` of each member action: an ISO date, or null when the registry records none. */
  dates: readonly (string | null)[];
  /** "YYYY-MM" the registry's dockets were last published in. */
  publishedMonth: string | null;
  sourceUrl: string;
}): TrendBlockData | null {
  const counts = new Map<string, number>();
  let undated = 0;
  for (const d of input.dates) {
    if (!d || !ISO.test(d)) {
      undated += 1;
      continue;
    }
    const m = d.slice(0, 7);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const months = [...counts.keys()].sort();
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const points = densifyMonths(counts, first, last).map((p) => ({
    ...p,
    ...(p.x === input.publishedMonth ? { partial: true } : {}),
  }));
  return assembleBlock({
    id: `matter-member-months-${input.mdl}`,
    xKind: monthAxis(first, last),
    chart: "bar",
    unit: "actions",
    series: [{ id: "actions", label: "Member actions filed", points }],
    source: { label: "Matter registry, dockets of the matter", url: input.sourceUrl },
    asOf: null,
    notes: [
      "Counts the registry's member dockets that count as an action, by the month each was filed. Membership is never inferred from a caption, product, judge or firm, so this is a partial count and not the size of the MDL.",
      "A month with no registry docket is left as a gap: it does not mean none was filed. A transferor docket and its transferee docket can both be listed.",
      ...(input.publishedMonth === last
        ? [
            `${periodLabel(last, "month")}* is the month the registry was last published; it is drawn faded and is not used for the latest value or its change.`,
          ]
        : []),
      ...(undated
        ? [
            `${formatCount(undated)} member ${undated === 1 ? "action has" : "actions have"} no filing date and ${undated === 1 ? "is" : "are"} not plotted.`,
          ]
        : []),
    ],
  });
}
