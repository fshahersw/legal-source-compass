/** Automated safety intelligence: deterministic flags computed by scripts/enrichment/build_safety_insights.py. */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

export const INSIGHT_KINDS = [
  "firm_cluster",
  "hazard_surge",
  "class_i_spike",
  "complaint_accel",
  "recall_surge",
  "open_probe",
  "litigation",
  "shortage_wave",
  "crl_cluster",
  "court_signal",
  "company_exposure",
  "enforcement_surge",
  "rulemaking_shift",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];
export type InsightSeverity = "high" | "elevated" | "watch";
export const INSIGHT_AGENCIES = [
  "FDA",
  "CPSC",
  "NHTSA",
  "JPML",
  "COURTS",
  "SEC",
  "EPA",
  "FTC",
  "OSHA",
  "CMS",
  "DEA",
  "FAA",
  "CFPB",
  "PHMSA",
] as const;
export type InsightAgency = (typeof INSIGHT_AGENCIES)[number];

export type InsightEvidence = {
  dataset: string;
  id: string;
  title: string;
  date: string | null;
  note: string | null;
};
export type SafetyInsight = {
  id: string;
  rank: number;
  kind: InsightKind;
  agency: InsightAgency;
  entity: string;
  headline: string;
  summary: string;
  score: number;
  severity: InsightSeverity;
  serious: boolean;
  metric: {
    recent: number | null;
    baseline: number | null;
    ratio: number | null;
    window: string;
    unit: string;
  };
  series: { period: string; count: number }[];
  evidence: InsightEvidence[];
  method: string;
  asOf: string;
  tags: string[];
};
export type SafetyIntelligence = {
  generatedAt: string | null;
  insights: SafetyInsight[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const SEVERITIES: readonly InsightSeverity[] = ["high", "elevated", "watch"];
const AGENCIES: readonly InsightAgency[] = INSIGHT_AGENCIES;

/** Validate one stored insight; anything malformed is dropped rather than shown with guessed fields. */
export function parseInsight(raw: unknown): SafetyInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = str(r["kind"]) as InsightKind;
  const severity = str(r["severity"]) as InsightSeverity;
  const agency = str(r["agency"]) as InsightAgency;
  const score = num(r["score"]);
  if (!INSIGHT_KINDS.includes(kind) || !SEVERITIES.includes(severity) || !AGENCIES.includes(agency))
    return null;
  if (score == null || !str(r["id"]) || !str(r["headline"])) return null;
  const metric = (r["metric"] && typeof r["metric"] === "object" ? r["metric"] : {}) as Record<
    string,
    unknown
  >;
  const series = Array.isArray(r["series"]) ? r["series"] : [];
  const evidence = Array.isArray(r["evidence"]) ? r["evidence"] : [];
  return {
    id: str(r["id"]),
    rank: num(r["rank"]) ?? 0,
    kind,
    agency,
    entity: str(r["entity"]),
    headline: str(r["headline"]),
    summary: str(r["summary"]),
    score,
    severity,
    serious: r["serious"] === true,
    metric: {
      recent: num(metric["recent"]),
      baseline: num(metric["baseline"]),
      ratio: num(metric["ratio"]),
      window: str(metric["window"]),
      unit: str(metric["unit"]),
    },
    series: series.flatMap((p) => {
      const point = p as Record<string, unknown>;
      const count = num(point["count"]);
      return str(point["period"]) && count != null ? [{ period: str(point["period"]), count }] : [];
    }),
    evidence: evidence.flatMap((e) => {
      const item = e as Record<string, unknown>;
      return str(item["dataset"]) && str(item["id"])
        ? [
            {
              dataset: str(item["dataset"]),
              id: str(item["id"]),
              title: str(item["title"]) || str(item["id"]),
              date: str(item["date"]) || null,
              note: str(item["note"]) || null,
            },
          ]
        : [];
    }),
    method: str(r["method"]),
    asOf: str(r["as_of"]),
    tags: Array.isArray(r["tags"])
      ? r["tags"].filter((t): t is string => typeof t === "string" && !!t)
      : [],
  };
}

let cache: { at: number; value: SafetyIntelligence } | null = null;

export const getSafetyIntelligence = createServerFn({ method: "GET" }).handler(
  async (): Promise<SafetyIntelligence> => {
    if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.value;
    const [records, catalog] = await Promise.all([
      restGet<{ item: { insight?: unknown } }[]>(
        "corpus_records?select=item&dataset=eq.agency_safety_insights&order=ordinal.asc&limit=1000",
      ),
      restGet<{ metadata: { summary?: { generated_at?: string } } | null }[]>(
        "corpus_datasets?select=metadata&id=eq.agency_safety_insights&limit=1",
      ),
    ]);
    const insights = records.rows.flatMap(({ item }) => {
      const parsed = parseInsight(item?.insight);
      return parsed ? [parsed] : [];
    });
    const value = {
      generatedAt: catalog.rows[0]?.metadata?.summary?.generated_at ?? null,
      insights,
    };
    cache = { at: Date.now(), value };
    return value;
  },
);
