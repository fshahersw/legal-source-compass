/**
 * Grounded AI context for the state and county analysis blocks (pure). Only figures the page shows go in; the
 * MDL-inflated fjc_rate (filings coded to the county, incl. MDL) and every association that uses it are left out, and
 * associations are framed as patterns across areas, never causes.
 */
import type { FigureInput } from "@/components/kit/ai/buildSectionContext";
import type { CountyAnalysis } from "@/lib/external/countyAnalysis.functions";
import type { StateAnalysis } from "@/lib/external/stateAnalysis.functions";
import { formatPlaceValue, METRIC_BY_KEY, pText } from "./placeMetrics";

/** Measures never sent to the AI: not a residence measure (fjc_rate) or corpus coverage (resources). */
export const AI_EXCLUDED_KEYS: ReadonlySet<string> = new Set(["fjc_rate", "fjc_5y", "resources"]);

const mentionsExcluded = (text: string) =>
  /fjc_rate\b|all federal filings|filings by residents \(all\)|(?<!core )federal civil filings by residents/i.test(
    text,
  );

export const ECOLOGICAL_NOTE = "pattern across areas, not a cause; says nothing about individuals";

/** Share (0-100) of the county's FY2021-FY2025 filings that carry an MDL number, or null. */
export function mdlShareOfFilings(c: Pick<CountyAnalysis, "legal" | "metrics">): number | null {
  const mdl = c.legal?.window["mdl"];
  const all = c.metrics["fjc_5y"];
  if (mdl == null || all == null || !Number.isFinite(mdl) || !Number.isFinite(all) || all <= 0) return null;
  return (mdl / all) * 100;
}

/** The MDL share above which the county's nature-of-suit mix is dominated by MDL-coded filings. */
export const MDL_DOMINANT_SHARE = 25;

const COUNTY_LEGAL_KEYS = [
  "fjc_core_rate",
  "fjc_core_product_rate",
  "osha_rate",
  "cfpb_rate",
  "cfpb_noncredit_rate",
  "echo_formal_per_1k",
  "fjc_own_district_share",
] as const;

/** County legal block: the county's value, the state's median county, the state and the U.S. for each measure shown. */
export function countyLegalFigures(c: CountyAnalysis): FigureInput[] {
  const out: FigureInput[] = [];
  for (const key of COUNTY_LEGAL_KEYS) {
    if (!(key in c.metrics)) continue;
    const def = METRIC_BY_KEY.get(key);
    if (!def) continue;
    const fmt = (v: number | null | undefined) => formatPlaceValue(v, def.format);
    out.push({ label: `${def.label}: ${c.name}`, value: fmt(c.metrics[key]), unit: def.unit });
    const dist = c.stateDistributions[key];
    if (dist) out.push({ label: `${def.label}: median ${c.usps} county`, value: fmt(dist.median), unit: def.unit });
    if (key in c.stateValues) out.push({ label: `${def.label}: ${c.state}`, value: fmt(c.stateValues[key]), unit: def.unit });
    if (key in c.usValues) out.push({ label: `${def.label}: United States`, value: fmt(c.usValues[key]), unit: def.unit });
  }
  const core5 = c.metrics["fjc_core_5y"];
  if (core5 != null) out.push({ label: "Core federal civil filings, five years", value: core5, unit: "cases", period: "FY2021-FY2025" });
  const share = mdlShareOfFilings(c);
  if (share != null)
    out.push({
      label: "Share of the county-coded filings that carry an MDL number",
      value: `${share.toFixed(1)}%`,
      period: "FY2021-FY2025",
      note: "MDL filings are coded to the court's or defendant's county, not residence",
    });
  if (c.legal?.screened.length)
    out.push({ label: "Federal filing rates", value: null, note: "residence code screened out" });
  return out;
}

type Standout = StateAnalysis["standouts"][number];
type Test = StateAnalysis["tests"][number];

/** State "What stands out": the standout lines (minus any about fjc_rate) and the associations that hold. */
export function stateStandoutFigures(a: StateAnalysis): FigureInput[] {
  const out: FigureInput[] = [
    { label: "Counties analysed", value: a.counties },
    { label: "Federal districts", value: a.districts.length },
    { label: "County associations that hold (of those run)", value: `${a.testsHold} of ${a.testsRun}` },
  ];
  a.standouts
    .filter((s: Standout) => !(s.metric && AI_EXCLUDED_KEYS.has(s.metric)) && !mentionsExcluded(s.text))
    .slice(0, 10)
    .forEach((s: Standout, i: number) =>
      out.push({
        label: `Stand-out ${i + 1} (${s.kind})`,
        value: s.text.slice(0, 48),
        note: s.text.slice(48, 188) || undefined,
      }),
    );
  a.tests
    .filter((t: Test) => t.holds && t.rho != null && !AI_EXCLUDED_KEYS.has(t.x) && !AI_EXCLUDED_KEYS.has(t.y))
    .sort((x: Test, y: Test) => Math.abs(y.rho ?? 0) - Math.abs(x.rho ?? 0))
    .slice(0, 8)
    .forEach((t: Test) =>
      out.push({
        label: `Spearman rho, ${METRIC_BY_KEY.get(t.x)?.short ?? t.x} vs ${METRIC_BY_KEY.get(t.y)?.short ?? t.y}`,
        value: t.rho!,
        decimals: 2,
        note: `n = ${t.n} counties; BH-adjusted p ${pText(t.pBh)}; ${ECOLOGICAL_NOTE}`,
      }),
    );
  return out;
}
