/**
 * OSHA enforcement analytics: national inspection and penalty series (osha_inspections_national), the latest
 * complete fiscal year's distribution and cited standards, state inspection rates, published Severe Injury Report
 * aggregates (osha_severe_injuries) and the highest-penalty establishments (osha_employers).
 * Built by scripts/enrichment/osha from the DOL OSHA inspection and violation files. Stored JSON is validated
 * here; malformed rows are dropped, never repaired. Violation counts are records; penalties are computed sums of
 * recorded amounts, not OSHA's official totals.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);

export type OshaYear = {
  fy: number;
  inspections: number;
  programmed: number | null;
  unprogrammed: number | null;
  fatCat: number | null;
  accident: number | null;
  statePlan: number | null;
  currentPenalty: number | null;
  yoyInspectionsPct: number | null;
  yoyPenaltyPct: number | null;
  medianDaysToClose: number | null;
  /** true for a fiscal year still in progress (later than the latest complete year). */
  partial: boolean;
};

export type OshaLatestYear = {
  fy: number;
  inspections: number;
  programmed: number | null;
  unprogrammed: number | null;
  fatCat: number | null;
  accident: number | null;
  federal: number | null;
  statePlan: number | null;
  violationRecords: number | null;
  violationItems: number | null;
  serious: number | null;
  willful: number | null;
  repeat: number | null;
  currentPenalty: number | null;
  penalizedInspections: number | null;
  medianCurrentPenalty: number | null;
  p90CurrentPenalty: number | null;
  p99CurrentPenalty: number | null;
  top1pctSharePct: number | null;
  medianDaysToClose: number | null;
  p90DaysToClose: number | null;
  yoyInspectionsPct: number | null;
  yoyPenaltyPct: number | null;
  distribution: { bucket: string; inspections: number }[];
  topSections: { section: string; records: number }[];
  topSectors: { sector: string; title: string; inspections: number }[];
};

export type OshaStateRate = { code: string; inspections: number; per100k: number };

export type OshaSirYear = {
  year: number;
  reports: number;
  hospitalized: number | null;
  amputations: number | null;
  partial: boolean;
};

export type OshaEmployer = {
  recordId: string;
  rank: number;
  name: string;
  inspections: number | null;
  serious: number | null;
  willful: number | null;
  repeat: number | null;
  currentPenalty: number | null;
  states: string | null;
};

export type OshaEnforcement = {
  /** Latest complete fiscal year (the year the state rates are computed for). */
  latestFy: number;
  series: OshaYear[];
  latest: OshaLatestYear | null;
  stateRates: OshaStateRate[];
  rateDenominator: { source: string; year: number | null; measure: string | null } | null;
  tenFy: {
    from: number;
    to: number;
    inspections: number;
    currentPenalty: number | null;
    statePlanSharePct: number | null;
  } | null;
  sir: { series: OshaSirYear[]; note: string | null } | null;
  employers: OshaEmployer[];
};

const BUCKETS = [
  "0",
  "1-999",
  "1000-4999",
  "5000-9999",
  "10000-49999",
  "50000-99999",
  "100000-499999",
  "500000+",
];

function parseSeries(raw: unknown, latestFy: number): OshaYear[] {
  const out: OshaYear[] = [];
  for (const entry of arr(raw)) {
    const r = obj(entry);
    const fy = num(r?.["fy"]);
    const inspections = num(r?.["inspections"]);
    if (!r || fy == null || inspections == null) continue;
    out.push({
      fy,
      inspections,
      programmed: num(r["programmed"]),
      unprogrammed: num(r["unprogrammed"]),
      fatCat: num(r["fat_cat"]),
      accident: num(r["accident"]),
      statePlan: num(r["state_plan"]),
      currentPenalty: num(r["current_penalty"]),
      yoyInspectionsPct: num(r["yoy_inspections_pct"]),
      yoyPenaltyPct: num(r["yoy_current_penalty_pct"]),
      medianDaysToClose: num(r["median_days_to_close"]),
      partial: fy > latestFy,
    });
  }
  return out.sort((a, b) => a.fy - b.fy);
}

function parseLatest(raw: unknown): OshaLatestYear | null {
  const y = obj(raw);
  const fy = num(y?.["fy"]);
  const inspections = num(y?.["inspections"]);
  if (!y || fy == null || inspections == null) return null;
  const violations = obj(y["violations"]);
  const distribution = obj(y["penalty_distribution"]);
  return {
    fy,
    inspections,
    programmed: num(y["programmed"]),
    unprogrammed: num(y["unprogrammed"]),
    fatCat: num(y["fat_cat"]),
    accident: num(y["accident"]),
    federal: num(y["federal"]),
    statePlan: num(y["state_plan"]),
    violationRecords: num(y["violation_records"]),
    violationItems: num(y["violation_items"]),
    serious: num(violations?.["serious"]),
    willful: num(violations?.["willful"]),
    repeat: num(violations?.["repeat"]),
    currentPenalty: num(y["current_penalty"]),
    penalizedInspections: num(y["penalized_inspections"]),
    medianCurrentPenalty: num(y["median_current_penalty"]),
    p90CurrentPenalty: num(y["p90_current_penalty"]),
    p99CurrentPenalty: num(y["p99_current_penalty"]),
    top1pctSharePct: num(y["top1pct_share_current_penalty"]),
    medianDaysToClose: num(y["median_days_to_close"]),
    p90DaysToClose: num(y["p90_days_to_close"]),
    yoyInspectionsPct: num(y["yoy_inspections_pct"]),
    yoyPenaltyPct: num(y["yoy_current_penalty_pct"]),
    distribution: distribution
      ? BUCKETS.flatMap((bucket) => {
          const n = num(distribution[bucket]);
          return n == null ? [] : [{ bucket, inspections: n }];
        })
      : [],
    topSections: arr(y["top_sections"]).flatMap((s) => {
      const r = obj(s);
      const section = strOrNull(r?.["section"]);
      const records = num(r?.["records"]);
      return section && records != null ? [{ section, records }] : [];
    }),
    topSectors: arr(y["top_naics"]).flatMap((s) => {
      const r = obj(s);
      const sector = strOrNull(r?.["sector"]);
      const title = strOrNull(r?.["title"]);
      const n = num(r?.["inspections"]);
      return sector && title && n != null ? [{ sector, title, inspections: n }] : [];
    }),
  };
}

function parseSir(raw: unknown): OshaEnforcement["sir"] {
  const profile = obj(raw);
  if (!profile) return null;
  const note = strOrNull(profile["series_note"]);
  const rows = arr(profile["series"]).flatMap((s) => {
    const r = obj(s);
    const year = num(r?.["year"]);
    const reports = num(r?.["reports"]);
    return r && year != null && reports != null
      ? [
          {
            year,
            reports,
            hospitalized: num(r["hospitalized"]),
            amputations: num(r["amputations"]),
            partial: false,
          },
        ]
      : [];
  });
  if (!rows.length) return null;
  rows.sort((a, b) => a.year - b.year);
  const last = rows[rows.length - 1]!;
  // OSHA's footnote marks the newest year as partial ("as of November 2025"); flag it only when the note says so.
  if (note && /partial/i.test(note)) last.partial = true;
  return { series: rows, note };
}

export function parseOshaEnforcement(input: {
  summary: unknown;
  year: unknown;
  sir: unknown;
  employers: { id?: unknown; cells?: unknown }[];
}): OshaEnforcement | null {
  const summary = obj(input.summary);
  const latestFy = num(summary?.["rate_fy"]);
  if (!summary || latestFy == null) return null;
  const series = parseSeries(summary["series"], latestFy);
  if (!series.length) return null;
  const stateRates = arr(summary["state_rates_latest_fy"])
    .flatMap((s) => {
      const r = obj(s);
      const code = strOrNull(r?.["code"]);
      const inspections = num(r?.["inspections"]);
      const per100k = num(r?.["per_100k_covered_jobs"]);
      return code && inspections != null && per100k != null ? [{ code, inspections, per100k }] : [];
    })
    .sort((a, b) => b.per100k - a.per100k);
  const denominator = obj(summary["rate_denominator"]);
  const ten = obj(summary["ten_fy"]);
  const range = arr(ten?.["fy_range"]);
  const from = num(range[0]);
  const to = num(range[1]);
  const tenInspections = num(ten?.["inspections"]);
  const tenStatePlan = num(ten?.["state_plan"]);
  const employers = input.employers.flatMap((row) => {
    const id = strOrNull(row.id);
    const c = obj(row.cells);
    const rank = num(c?.["rank"]);
    const name = strOrNull(c?.["name"]);
    if (!id || !c || rank == null || !name) return [];
    return [
      {
        recordId: id,
        rank,
        name,
        inspections: num(c["inspections"]),
        serious: num(c["serious"]),
        willful: num(c["willful"]),
        repeat: num(c["repeat"]),
        currentPenalty: num(c["current_penalty"]),
        states: strOrNull(c["states"]),
      },
    ];
  });
  employers.sort((a, b) => a.rank - b.rank);
  const source = strOrNull(denominator?.["source"]);
  return {
    latestFy,
    series,
    latest: parseLatest(input.year),
    stateRates,
    rateDenominator: source
      ? {
          source,
          year: num(denominator?.["year"]),
          measure: strOrNull(denominator?.["measure"]),
        }
      : null,
    tenFy:
      from != null && to != null && tenInspections != null
        ? {
            from,
            to,
            inspections: tenInspections,
            currentPenalty: num(ten?.["current_penalty"]),
            statePlanSharePct:
              tenStatePlan != null && tenInspections > 0
                ? (tenStatePlan / tenInspections) * 100
                : null,
          }
        : null,
    sir: parseSir(input.sir),
    employers,
  };
}

const TTL = 10 * 60 * 1000;
let cache: { at: number; value: OshaEnforcement } | null = null;

export const getOshaEnforcement = createServerFn({ method: "GET" }).handler(
  async (): Promise<OshaEnforcement | null> => {
    if (cache && Date.now() - cache.at < TTL) return cache.value;
    const [summary, sir, employers] = await Promise.all([
      restGet<{ p: unknown }[]>(
        "corpus_records?select=p:item->profile&dataset=eq.osha_inspections_national&id=eq.osha-national:summary&limit=1",
      ),
      restGet<{ p: unknown }[]>(
        "corpus_records?select=p:item->profile&dataset=eq.osha_severe_injuries&id=eq.osha-sir:summary&limit=1",
      ),
      restGet<{ id: unknown; cells: unknown }[]>(
        "corpus_records?select=id,cells:item->cells&dataset=eq.osha_employers&order=ordinal.asc&limit=25",
      ),
    ]);
    const profile = obj(summary.rows[0]?.p);
    const latestFy = num(profile?.["rate_fy"]);
    // The latest complete year's detail lives on its own record, so it is read once the summary names the year.
    const year =
      latestFy != null
        ? await restGet<{ y: unknown }[]>(
            `corpus_records?select=y:item->year&dataset=eq.osha_inspections_national&id=eq.${encodeURIComponent(`osha-national:FY${latestFy}`)}&limit=1`,
          )
        : { rows: [] as { y: unknown }[] };
    const value = parseOshaEnforcement({
      summary: profile,
      year: year.rows[0]?.y,
      sir: sir.rows[0]?.p,
      employers: employers.rows,
    });
    if (value) cache = { at: Date.now(), value };
    return value;
  },
);
