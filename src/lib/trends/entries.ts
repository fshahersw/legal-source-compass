/**
 * Pure builder for the matter page's docket-entry trend: master-docket entries the matter registry captured, by the
 * month they were filed. The registry may hold fewer entries than the provider reports, so completeness decides how a
 * month with no captured entry is drawn: a counted zero when the capture is complete, a gap when it is not.
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

export type EntryCoverage = {
  /** Entries the registry holds for this docket. */
  captured: number | null;
  /** Entries the provider reports for it, when it says. */
  providerTotal: number | null;
};

export type CaptureState = "complete" | "partial" | "unknown";

export function captureState(c: EntryCoverage): CaptureState {
  if (c.providerTotal === null || c.captured === null) return "unknown";
  return c.captured >= c.providerTotal ? "complete" : "partial";
}

export function buildDocketEntriesMonthly(input: {
  mdl: number;
  /** `date_filed` of each captured entry: an ISO date, or null when the entry has none. */
  dates: readonly (string | null)[];
  coverage: EntryCoverage;
  /** "YYYY-MM" the registry's entries were last published in; entries of that month may be incomplete. */
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
  const state = captureState(input.coverage);
  const filled = new Map<string, number | null>(counts);
  const base = densifyMonths(filled, first, last);
  // A complete capture lists every entry, so a month with none is a real zero; otherwise it stays a gap.
  const points = base.map((p) => {
    const value = p.value === null && state === "complete" ? 0 : p.value;
    return { ...p, value, ...(input.publishedMonth === p.x ? { partial: true } : {}) };
  });
  const { captured, providerTotal } = input.coverage;
  const coverageNote =
    state === "complete"
      ? `The registry holds all ${formatCount(providerTotal)} entries the provider reported at its last check, so a month with no entry is drawn as zero.`
      : state === "partial"
        ? `The registry holds ${formatCount(captured)} of the ${formatCount(providerTotal)} entries the provider reports, so each bar is a lower bound and a month with no captured entry is left as a gap, not zero.`
        : `The provider's total is not recorded, so the capture may be incomplete: each bar is a lower bound and a month with no captured entry is left as a gap, not zero.`;
  const lastPartial = input.publishedMonth === last;
  return assembleBlock({
    id: `matter-docket-entries-${input.mdl}`,
    xKind: monthAxis(first, last),
    chart: "bar",
    unit: "entries",
    series: [{ id: "entries", label: "Entries captured", points }],
    source: { label: "Matter registry, docket entries of the master docket", url: input.sourceUrl },
    asOf: null,
    notes: [
      "Counts master-docket entries by the month their filing date falls in, as the provider lists them. Entries on member dockets are not counted.",
      coverageNote,
      ...(lastPartial
        ? [
            `${periodLabel(last, "month")}* is the month the registry was last published; it is drawn faded and is not used for the latest value or its change.`,
          ]
        : []),
      ...(undated
        ? [
            `${formatCount(undated)} captured ${undated === 1 ? "entry has" : "entries have"} no filing date and ${undated === 1 ? "is" : "are"} not plotted.`,
          ]
        : []),
    ],
  });
}
