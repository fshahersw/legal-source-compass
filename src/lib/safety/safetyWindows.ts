/**
 * Shapes of the safety-nhtsa-windows/1 read RPCs (database/contracts/safety-nhtsa-windows-v1.sql) and the pure views the
 * /safety sections draw from them: the vehicle complaint surge radar, a recall's effect on complaints and the OSHA
 * silica tracker. Until the lead applies the contract the RPCs are missing and the server returns null; the sections
 * then show nothing but a "not loaded yet" note. Pure and tested (safetyWindows.test.ts).
 */

export type ComplaintCounts = {
  current: number;
  prior: number;
  injured: number | null;
  deaths: number | null;
  crashes: number;
  fires: number;
};

export type ComplaintWindows = {
  as_of: string | null;
  current_from?: string;
  current_to?: string;
  prior_from?: string;
  prior_to?: string;
  coverage_from: string | null;
  coverage_to: string | null;
  prior_partial?: boolean;
  totals: ComplaintCounts | null;
  manufacturers: (ComplaintCounts & { manufacturer: string })[];
  pairs: (ComplaintCounts & { manufacturer: string; component: string })[];
  unit?: string;
  source?: string;
};

export type RecallQuarter = {
  quarter: string;
  complaints: number;
  vehicle_complaints: number;
  injured: number | null;
  crashes: number;
  fires: number;
  deaths: number | null;
};

export type RecallWindow = {
  from: string;
  to: string;
  complaints: number;
  injured: number | null;
  crashes: number;
  partial: boolean;
};

export type RecallComplaints = {
  campaign: string;
  recall_date: string | null;
  vehicles: { make: string; model: string; from: number; to: number }[];
  unparsed: string[];
  components: string[];
  coverage_from: string | null;
  coverage_to: string | null;
  quarters: RecallQuarter[];
  before: RecallWindow | null;
  after: RecallWindow | null;
};

export type SilicaYear = {
  year: number;
  fabricator_general: number;
  other_general: number;
  construction: number;
  penalties: number | null;
};

export type OshaSilica = {
  from: string | null;
  to: string | null;
  years: SilicaYear[];
  last12: {
    violations: number;
    fabricator_violations: number;
    fabricator_inspections: number;
    penalties: number | null;
    states: number;
  } | null;
  states: { state: string; violations: number; fabricator_violations: number }[];
  establishments: {
    activity_nr: number;
    name: string | null;
    city: string | null;
    state: string | null;
    violations: number;
    penalties: number | null;
    latest: string;
  }[];
};

/** Percent change between two equal windows; null when the prior window is empty (no base to compare). */
export function pctChange(current: number, prior: number): number | null {
  if (!(prior > 0)) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

export type RadarRow = {
  id: string;
  label: string;
  manufacturer: string;
  component: string;
  current: number;
  prior: number;
  change: number | null;
  injured: number | null;
  deaths: number | null;
  fires: number;
  crashes: number;
};

/**
 * Manufacturer × component pairs with at least `min` complaints in the current window, ranked by percent change.
 * Pairs whose prior window is empty have no percent change and sort after the others (by count).
 */
export function radarRows(w: ComplaintWindows | null, min = 100, limit = 15): RadarRow[] {
  if (!w) return [];
  return w.pairs
    .filter((p) => p.current >= min)
    .map((p) => ({
      id: `${p.manufacturer}\u0000${p.component}`,
      label: `${shortMaker(p.manufacturer)} · ${titleCase(p.component)}`,
      manufacturer: p.manufacturer,
      component: p.component,
      current: p.current,
      prior: p.prior,
      change: pctChange(p.current, p.prior),
      injured: p.injured,
      deaths: p.deaths,
      fires: p.fires,
      crashes: p.crashes,
    }))
    .sort(
      (a, b) =>
        (b.change ?? -Infinity) - (a.change ?? -Infinity) ||
        b.current - a.current ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/** The manufacturer as NHTSA records it, without a trailing corporate suffix, for chart labels only. */
export function shortMaker(name: string): string {
  return name
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/,?\s+(Inc\.?|LLC|Corp\.?|Corporation|Company|Co\.|Ltd\.?|North America|USA|America)\b\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[,\s]+$/, "")
    .trim();
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, "and");
}

/** Quarterly rows for the recall effect chart, every quarter of the complaint coverage, with the recall quarter marked. */
export function recallQuarterRows(
  r: RecallComplaints | null,
): { quarter: string; complaints: number; vehicle: number; recall: boolean; partial: boolean }[] {
  if (!r || !r.coverage_from || !r.coverage_to) return [];
  const toQ = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
  const first = toQ(r.coverage_from);
  const last = toQ(r.coverage_to);
  const lastMonth = Number(r.coverage_to.slice(5, 7));
  const quarterEnd = new Date(
    Date.UTC(Number(r.coverage_to.slice(0, 4)), Math.ceil(lastMonth / 3) * 3, 0),
  )
    .toISOString()
    .slice(0, 10);
  const lastComplete = r.coverage_to.slice(0, 10) >= quarterEnd;
  const by = new Map(r.quarters.map((q) => [q.quarter, q]));
  const recallQ = r.recall_date ? toQ(r.recall_date) : null;
  const out: { quarter: string; complaints: number; vehicle: number; recall: boolean; partial: boolean }[] = [];
  let y = Number(first.slice(0, 4));
  let q = Number(first.slice(6));
  for (let guard = 0; guard < 200; guard += 1) {
    const key = `${y}-Q${q}`;
    const row = by.get(key);
    out.push({
      quarter: key,
      complaints: row?.complaints ?? 0,
      vehicle: row?.vehicle_complaints ?? 0,
      recall: key === recallQ,
      partial: key === last && !lastComplete,
    });
    if (key === last) break;
    q += 1;
    if (q === 5) {
      q = 1;
      y += 1;
    }
  }
  return out;
}

/** Years of the silica series with the first and last marked partial (the data start and end mid-year). */
export function silicaYears(s: OshaSilica | null): (SilicaYear & { partial: boolean })[] {
  if (!s || !s.years.length || !s.from || !s.to) return [];
  const firstYear = Number(s.from.slice(0, 4));
  const lastYear = Number(s.to.slice(0, 4));
  return s.years.map((y) => ({
    ...y,
    partial:
      (y.year === firstYear && !s.from!.endsWith("-01-01")) ||
      (y.year === lastYear && !s.to!.endsWith("-12-31")),
  }));
}
