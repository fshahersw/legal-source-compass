/** Pure data for the "registered government domains by state" chart and its table (gov_domains_summary). */
import { stateByUsps } from "@/lib/corpus/geo";
import { PUERTO_RICO } from "@/lib/corpus/stateHub";
import type { GovGroup, GovSummaryState } from "@/lib/external/govDomainsModel";

export const SERIES = [
  { key: "state", label: "State or territory" },
  { key: "county", label: "County" },
  { key: "city", label: "City or local" },
  { key: "special_district", label: "Special district" },
  { key: "federal", label: "Federal" },
  { key: "other", label: "Other" },
] as const;
export type SeriesKey = (typeof SERIES)[number]["key"];

/** Which chart series a published government level counts in; everything not named above is "Other". */
export function seriesOf(group: GovGroup | "unassigned" | string): SeriesKey {
  return group === "state" ||
    group === "county" ||
    group === "city" ||
    group === "special_district" ||
    group === "federal"
    ? group
    : "other";
}

const TERRITORIES: Record<string, string> = {
  AS: "American Samoa",
  GU: "Guam",
  MP: "Northern Mariana Islands",
  VI: "U.S. Virgin Islands",
};

export function placeName(usps: string): string {
  return (
    stateByUsps.get(usps)?.name ??
    (usps === PUERTO_RICO.usps ? PUERTO_RICO.name : (TERRITORIES[usps] ?? usps))
  );
}

export type StateBar = {
  usps: string;
  name: string;
  total: number;
  cisa: number;
  gsa: number;
  /** Domains per series; they sum to `total`. */
  series: Record<SeriesKey, number>;
};

/** One bar per state with at least one record, largest first (ties by name). */
export function stateBars(states: readonly GovSummaryState[]): StateBar[] {
  return states
    .map((s): StateBar => {
      const series: Record<SeriesKey, number> = {
        state: 0,
        county: 0,
        city: 0,
        special_district: 0,
        federal: 0,
        other: 0,
      };
      for (const [group, n] of Object.entries(s.groups)) series[seriesOf(group)] += n;
      return {
        usps: s.usps,
        name: placeName(s.usps),
        total: s.total,
        cisa: s.cisa,
        gsa: s.gsa,
        series,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** The chart rows: the top `n` bars, flattened for the chart library. */
export function chartRows(bars: readonly StateBar[], n: number) {
  return bars.slice(0, n).map((b) => ({ usps: b.usps, name: b.name, total: b.total, ...b.series }));
}

/** Plain-language summary of the chart for assistive technology. */
export function chartSummary(bars: readonly StateBar[], n: number): string {
  const top = bars.slice(0, n);
  if (!top.length) return "No registered government domains to chart.";
  return `Registered government domains by state, ${top.length} largest of ${bars.length}: ${top
    .map((b) => `${b.name} ${b.total.toLocaleString("en-US")}`)
    .join("; ")}.`;
}
