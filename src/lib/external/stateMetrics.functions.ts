/**
 * State-by-state official metrics (datasets state_metrics_profiles and state_metrics_national), built by
 * scripts/enrichment/state_metrics/build_state_metrics.py from Census, BEA, BLS, CDC, NHTSA and openFDA files.
 * Stored JSON is validated defensively: malformed metrics or values are dropped, never guessed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export const METRIC_FORMATS = ["int", "money_m", "dollars", "pct", "rate"] as const;
export type MetricFormat = (typeof METRIC_FORMATS)[number];
export type MetricDirection = "worse" | "better" | "neutral";
export type YearSeries = Record<string, number>;
export type MetricSource = {
  publisher: string;
  name: string;
  url: string;
  page: string | null;
  retrieved: string | null;
};
export type YearDistribution = { n: number; median: number; p25: number; p75: number };
export type MetricDef = {
  key: string;
  label: string;
  short: string;
  unit: string;
  format: MetricFormat;
  group: string;
  method: string;
  denominator: string | null;
  per: number | null;
  higher: MetricDirection;
  selectable: boolean;
  caveats: string[];
  years: [number, number] | null;
  rankYears: number[];
  latestYear: number | null;
  partialYears: Record<string, string>;
  national: YearSeries;
  nationalBasis: string | null;
  distribution: Record<string, YearDistribution>;
  sources: MetricSource[];
  order: number;
};
export type LatestStat = {
  year: number;
  value: number | null;
  rank: number | null;
  of: number;
  z: number | null;
  change5: number | null;
  outlier: "high" | "low" | null;
};
export type StateProfile = {
  usps: string;
  fips: string;
  name: string;
  series: Record<string, YearSeries>;
  latest: Record<string, LatestStat>;
  notes: Record<string, Record<string, string>>;
  overdose12mo: Record<string, { period: string; value: number }>;
};
export type StateMetricsBundle = {
  generatedAt: string | null;
  rankRule: string | null;
  outlierRule: string | null;
  metrics: MetricDef[];
  states: StateProfile[];
};
export type StateMetricsPanelData = {
  generatedAt: string | null;
  metrics: MetricDef[];
  profile: StateProfile | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const YEAR = /^\d{4}$/;

/** {year: number} with only four-digit year keys and finite values. */
export function parseSeries(raw: unknown): YearSeries {
  const out: YearSeries = {};
  for (const [year, value] of Object.entries(obj(raw))) {
    const n = num(value);
    if (YEAR.test(year) && n != null) out[year] = n;
  }
  return out;
}

function parseSource(raw: unknown): MetricSource | null {
  const s = obj(raw);
  const url = str(s["url"]);
  if (!/^https:\/\//.test(url) || !str(s["name"])) return null;
  const page = str(s["page"]);
  return {
    publisher: str(s["publisher"]),
    name: str(s["name"]),
    url,
    page: /^https:\/\//.test(page) ? page : null,
    retrieved: str(s["retrieved"]) || null,
  };
}

export function parseMetric(raw: unknown): MetricDef | null {
  const m = obj(raw);
  const key = str(m["key"]);
  const format = str(m["format"]) as MetricFormat;
  if (!/^[a-z0-9_]+$/.test(key) || !str(m["label"]) || !METRIC_FORMATS.includes(format))
    return null;
  const higher =
    (["worse", "better", "neutral"] as const).find((h) => h === m["higher"]) ?? "neutral";
  const years = Array.isArray(m["years"]) ? m["years"].map(num) : [];
  const distribution: Record<string, YearDistribution> = {};
  for (const [year, d] of Object.entries(obj(m["distribution"]))) {
    const o = obj(d);
    const [n, median, p25, p75] = [num(o["n"]), num(o["median"]), num(o["p25"]), num(o["p75"])];
    if (YEAR.test(year) && n != null && median != null && p25 != null && p75 != null)
      distribution[year] = { n, median, p25, p75 };
  }
  const partialYears: Record<string, string> = {};
  for (const [year, note] of Object.entries(obj(m["partial_years"])))
    if (YEAR.test(year) && str(note)) partialYears[year] = str(note);
  return {
    key,
    label: str(m["label"]),
    short: str(m["short"]) || str(m["label"]),
    unit: str(m["unit"]),
    format,
    group: str(m["group"]) || "Other",
    method: str(m["method"]),
    denominator: str(m["denominator"]) || null,
    per: num(m["per"]),
    higher,
    selectable: m["selectable"] !== false,
    caveats: Array.isArray(m["caveats"])
      ? m["caveats"].filter((c): c is string => typeof c === "string")
      : [],
    years: years.length === 2 && years[0] != null && years[1] != null ? [years[0], years[1]] : null,
    rankYears: Array.isArray(m["rank_years"])
      ? m["rank_years"].flatMap((y) => (num(y) != null ? [num(y)!] : []))
      : [],
    latestYear: num(m["latest_year"]),
    partialYears,
    national: parseSeries(m["national"]),
    nationalBasis: str(m["national_basis"]) || null,
    distribution,
    sources: Array.isArray(m["sources"])
      ? m["sources"].flatMap((s) => {
          const parsed = parseSource(s);
          return parsed ? [parsed] : [];
        })
      : [],
    order: num(m["order"]) ?? 999,
  };
}

export function parseProfile(raw: unknown): StateProfile | null {
  const p = obj(raw);
  const usps = str(p["usps"]);
  const fips = str(p["fips"]);
  if (!/^[A-Z]{2}$/.test(usps) || !/^\d{2}$/.test(fips) || !str(p["name"])) return null;
  const series: Record<string, YearSeries> = {};
  for (const [key, s] of Object.entries(obj(p["series"]))) {
    const parsed = parseSeries(s);
    if (Object.keys(parsed).length) series[key] = parsed;
  }
  const latest: Record<string, LatestStat> = {};
  for (const [key, l] of Object.entries(obj(p["latest"]))) {
    const o = obj(l);
    const year = num(o["year"]);
    if (year == null) continue;
    const outlier = o["outlier"] === "high" || o["outlier"] === "low" ? o["outlier"] : null;
    latest[key] = {
      year,
      value: num(o["value"]),
      rank: num(o["rank"]),
      of: num(o["of"]) ?? 0,
      z: num(o["z"]),
      change5: num(o["change5"]),
      outlier,
    };
  }
  const notes: Record<string, Record<string, string>> = {};
  for (const [key, n] of Object.entries(obj(p["notes"]))) {
    const entries = Object.entries(obj(n)).filter(([y, t]) => YEAR.test(y) && str(t));
    if (entries.length) notes[key] = Object.fromEntries(entries.map(([y, t]) => [y, str(t)]));
  }
  const overdose12mo: Record<string, { period: string; value: number }> = {};
  for (const [key, v] of Object.entries(obj(p["overdose_12mo"]))) {
    const o = obj(v);
    const value = num(o["value"]);
    if (/^\d{4}-\d{2}$/.test(str(o["period"])) && value != null)
      overdose12mo[key] = { period: str(o["period"]), value };
  }
  return { usps, fips, name: str(p["name"]), series, latest, notes, overdose12mo };
}

type Summary = { generated_at?: string; rank_rule?: string; outlier_rule?: string };
const CACHE_MS = 10 * 60 * 1000;
let nationalCache: {
  at: number;
  value: { metrics: MetricDef[]; summary: Summary };
} | null = null;
let bundleCache: { at: number; value: StateMetricsBundle } | null = null;

async function loadNational() {
  if (nationalCache && Date.now() - nationalCache.at < CACHE_MS) return nationalCache.value;
  const [records, catalog] = await Promise.all([
    restGet<{ metric: unknown }[]>(
      "corpus_records?select=metric:item->metric&dataset=eq.state_metrics_national&order=ordinal.asc&limit=500",
    ),
    restGet<{ metadata: { summary?: Summary } | null }[]>(
      "corpus_datasets?select=metadata&id=eq.state_metrics_national&limit=1",
    ),
  ]);
  const metrics = records.rows
    .flatMap(({ metric }) => {
      const parsed = parseMetric(metric);
      return parsed ? [parsed] : [];
    })
    .sort((a, b) => a.order - b.order);
  const value = { metrics, summary: catalog.rows[0]?.metadata?.summary ?? {} };
  nationalCache = { at: Date.now(), value };
  return value;
}

/** Every state profile plus metric definitions, for the /places/analytics dashboard. */
export const getStateMetrics = createServerFn({ method: "GET" }).handler(
  async (): Promise<StateMetricsBundle> => {
    if (bundleCache && Date.now() - bundleCache.at < CACHE_MS) return bundleCache.value;
    const [national, records] = await Promise.all([
      loadNational(),
      restGet<{ profile: unknown }[]>(
        "corpus_records?select=profile:item->profile&dataset=eq.state_metrics_profiles&order=ordinal.asc&limit=100",
      ),
    ]);
    const selectable = new Set(national.metrics.filter((m) => m.selectable).map((m) => m.key));
    const states = records.rows.flatMap(({ profile }) => {
      const parsed = parseProfile(profile);
      if (!parsed) return [];
      // The dashboard only charts selectable metrics; drop the rest to keep the payload small.
      for (const key of Object.keys(parsed.series))
        if (!selectable.has(key)) delete parsed.series[key];
      return [parsed];
    });
    const value: StateMetricsBundle = {
      generatedAt: national.summary.generated_at ?? null,
      rankRule: national.summary.rank_rule ?? null,
      outlierRule: national.summary.outlier_rule ?? null,
      metrics: national.metrics,
      states,
    };
    bundleCache = { at: Date.now(), value };
    return value;
  },
);

/** One state's profile and the metric definitions it references, for the compact state-page panel. */
export const getStateMetricsPanel = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateMetricsPanelData> => {
    const [national, records] = await Promise.all([
      loadNational(),
      restGet<{ profile: unknown }[]>(
        `corpus_records?select=profile:item->profile&dataset=eq.state_metrics_profiles&id=eq.${data.usps}&limit=1`,
      ),
    ]);
    return {
      generatedAt: national.summary.generated_at ?? null,
      metrics: national.metrics,
      profile: records.rows[0] ? parseProfile(records.rows[0].profile) : null,
    };
  });
