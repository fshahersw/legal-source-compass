import type {
  InsightAgency,
  InsightKind,
  InsightSeverity,
  SafetyInsight,
} from "@/lib/external/safetyInsights.functions";

export const KIND_LABEL: Record<InsightKind, string> = {
  firm_cluster: "Recall cluster",
  hazard_surge: "Hazard surge",
  class_i_spike: "Class I spike",
  complaint_accel: "Complaint acceleration",
  recall_surge: "Recall surge",
  open_probe: "Open investigation",
  litigation: "Litigation momentum",
  shortage_wave: "Shortage wave",
  crl_cluster: "Approval setbacks",
  court_signal: "Court caseload signal",
  company_exposure: "Company exposure",
  enforcement_surge: "Enforcement surge",
  rulemaking_shift: "Rulemaking shift",
};

export const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  high: "High",
  elevated: "Elevated",
  watch: "Watch",
};

/** Full agency names as keyed in the visuals registry, so the right mark is shown. */
export const AGENCY_NAME: Record<InsightAgency, string> = {
  FDA: "Food and Drug Administration",
  CPSC: "Consumer Product Safety Commission",
  NHTSA: "National Highway Traffic Safety Administration",
  JPML: "Judicial Panel on Multidistrict Litigation",
  COURTS: "U.S. Courts",
  SEC: "Securities and Exchange Commission",
  EPA: "Environmental Protection Agency",
  FTC: "Federal Trade Commission",
  OSHA: "Occupational Safety and Health Administration",
  CMS: "Centers for Medicare & Medicaid Services",
  DEA: "Drug Enforcement Administration",
  FAA: "Federal Aviation Administration",
  CFPB: "Consumer Financial Protection Bureau",
  PHMSA: "Pipeline and Hazardous Materials Safety Administration",
};

export type InsightFilter = {
  severity: InsightSeverity | "";
  agency: InsightAgency | "";
  kind: InsightKind | "";
  query: string;
  seriousOnly: boolean;
};

export const EMPTY_FILTER: InsightFilter = {
  severity: "",
  agency: "",
  kind: "",
  query: "",
  seriousOnly: false,
};

export function filterInsights(insights: readonly SafetyInsight[], f: InsightFilter) {
  const terms = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return insights.filter((i) => {
    if (f.severity && i.severity !== f.severity) return false;
    if (f.agency && i.agency !== f.agency) return false;
    if (f.kind && i.kind !== f.kind) return false;
    if (f.seriousOnly && !i.serious) return false;
    if (!terms.length) return true;
    const hay = [i.headline, i.summary, i.entity, ...i.tags].join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function countBy<T extends string>(
  insights: readonly SafetyInsight[],
  key: (i: SafetyInsight) => T,
) {
  const out = new Map<T, number>();
  for (const i of insights) out.set(key(i), (out.get(key(i)) ?? 0) + 1);
  return out;
}

const fmt = (v: number) =>
  v >= 100
    ? Math.round(v).toLocaleString("en-US")
    : v.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** One-line comparison, e.g. "31 recall events vs 2.1 expected · 14.8× · 180 days". */
export function metricLine(i: SafetyInsight): string {
  const m = i.metric;
  const parts: string[] = [];
  if (m.recent != null) {
    parts.push(
      m.baseline != null
        ? `${fmt(m.recent)} ${m.unit} vs ${fmt(m.baseline)} ${i.kind === "litigation" ? "a year earlier" : "expected"}`
        : `${fmt(m.recent)} ${m.unit}`,
    );
  } else if (m.unit) parts.push(m.unit);
  if (m.ratio != null && Number.isFinite(m.ratio)) parts.push(`${fmt(m.ratio)}×`);
  if (m.window) parts.push(m.window);
  return parts.join(" · ");
}

/** Internal record page for one piece of evidence; ids are passed as route params, never concatenated into HTML. */
export function evidenceParams(e: { dataset: string; id: string }) {
  return { dataset: e.dataset, id: e.id };
}

/** Hazard themes ordered by how far the latest window runs above baseline. */
export function risingThemes(insights: readonly SafetyInsight[], limit = 6) {
  return insights
    .filter((i) => i.kind === "hazard_surge" && i.metric.ratio != null)
    .sort((a, b) => (b.metric.ratio ?? 0) - (a.metric.ratio ?? 0))
    .slice(0, limit);
}
