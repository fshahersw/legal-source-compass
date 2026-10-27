/**
 * Pure models for the damages inputs on /law/calculators: occupation wage percentiles (BLS OEWS), the SSA national
 * average wage index, CPI-U by area (BLS) and whether a cited state judgment rate is still in force. Inputs only: nothing
 * here computes an award or projects a value. A value the publisher does not give is null ("Not recorded"), never 0.
 */

// ------------------------------------------------------------------------------------------------ OEWS wages

export const OEWS_FIELDS = [
  "employment",
  "hourly_mean",
  "annual_mean",
  "hourly_median",
  "annual_p10",
  "annual_p25",
  "annual_median",
  "annual_p75",
  "annual_p90",
  "footnotes",
] as const;

export type OewsWage = {
  employment: number | null;
  hourlyMean: number | null;
  annualMean: number | null;
  hourlyMedian: number | null;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  /** BLS special codes seen in this row ("#" = at or above the top code, "*" or "-" = not available). */
  flags: string[];
  footnotes: string[];
};

const money = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/,/g, "").trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** One OEWS occupation cell ([employment, ..., footnotes] in OEWS_FIELDS order) as numbers, or null. */
export function parseOewsCell(raw: unknown): OewsWage | null {
  if (!Array.isArray(raw) || raw.length < 9) return null;
  const flags = [
    ...new Set(
      raw
        .slice(0, 9)
        .filter((v): v is string => typeof v === "string" && /^[#*-]+$/.test(v.trim()))
        .map((v) => v.trim()),
    ),
  ];
  const fn = typeof raw[9] === "string" ? raw[9] : "";
  return {
    employment: money(raw[0]),
    hourlyMean: money(raw[1]),
    annualMean: money(raw[2]),
    hourlyMedian: money(raw[3]),
    p10: money(raw[4]),
    p25: money(raw[5]),
    median: money(raw[6]),
    p75: money(raw[7]),
    p90: money(raw[8]),
    flags,
    footnotes: fn
      .split(/[,\s]+/)
      .map((f) => f.trim())
      .filter((f) => /^\d{1,2}$/.test(f)),
  };
}

export type OewsOccupation = { soc: string; title: string; level: number };

/** The occupation code list (record oews:occupations, codes {SOC6: [title, level]}), detailed occupations last level. */
export function parseOccupationCodes(raw: unknown): OewsOccupation[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .flatMap(([soc, v]) => {
      if (!/^\d{6}$/.test(soc) || !Array.isArray(v) || typeof v[0] !== "string") return [];
      const level = Number(v[1]);
      return [{ soc, title: v[0].slice(0, 160), level: Number.isInteger(level) ? level : 0 }];
    })
    .sort((a, b) => a.soc.localeCompare(b.soc));
}

/** SOC code as BLS writes it ("47-2061"). */
export const socLabel = (soc: string) => (/^\d{6}$/.test(soc) ? `${soc.slice(0, 2)}-${soc.slice(2)}` : soc);

export type OewsArea = { id: string; area: string; type: "N" | "S" | "M"; usps: string | null };

export function parseOewsArea(raw: { id?: unknown; a?: unknown; t?: unknown; u?: unknown }): OewsArea | null {
  const id = typeof raw.id === "string" && /^oews:[NSM]\d{7}$/.test(raw.id) ? raw.id : null;
  const t = raw.t === "N" || raw.t === "S" || raw.t === "M" ? raw.t : null;
  if (!id || !t || typeof raw.a !== "string") return null;
  const usps = typeof raw.u === "string" && /^[A-Z]{2}$/.test(raw.u) ? raw.u : null;
  return { id, area: raw.a.slice(0, 120), type: t, usps };
}

// ------------------------------------------------------------------------------------------------ SSA AWI

export type AwiPoint = {
  year: number;
  value: number;
  citation: string;
  publicationDate: string | null;
  sourceUrl: string | null;
};

/** One econ_ssa_awi record ({awi, source_url}) as a point, or null when the value is not a stated amount. */
export function parseAwi(raw: { awi?: unknown; source_url?: unknown }): AwiPoint | null {
  const a = raw.awi && typeof raw.awi === "object" ? (raw.awi as Record<string, unknown>) : null;
  if (!a) return null;
  const year = typeof a["year"] === "number" && Number.isInteger(a["year"]) ? a["year"] : null;
  const value = money(a["value"]);
  if (year === null || value === null) return null;
  return {
    year,
    value,
    citation: typeof a["citation"] === "string" ? a["citation"] : "Federal Register",
    publicationDate:
      typeof a["publication_date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a["publication_date"])
        ? a["publication_date"]
        : null,
    sourceUrl: typeof raw.source_url === "string" && /^https:\/\//.test(raw.source_url) ? raw.source_url : null,
  };
}

/** Compound yearly growth (%) between two recorded years; null when either is missing or the span is not positive. */
export function compoundGrowth(points: readonly AwiPoint[], from: number, to: number): number | null {
  const a = points.find((p) => p.year === from)?.value;
  const b = points.find((p) => p.year === to)?.value;
  if (a == null || b == null || to <= from || a <= 0) return null;
  return ((b / a) ** (1 / (to - from)) - 1) * 100;
}

// ------------------------------------------------------------------------------------------------ CPI by area

export type CpiArea = {
  seriesId: string;
  area: string;
  level: string;
  basePeriod: string;
  sourceUrl: string | null;
  /** BLS annual averages (period M13), ascending. */
  annual: { year: number; value: number }[];
};

/**
 * One econ_bls_cpi_areas record: kept only for the not seasonally adjusted all-items CPI-U series with monthly or
 * bimonthly data (CUUR...SA0), whose annual averages BLS publishes as period M13.
 */
export function parseCpiArea(raw: { cpi?: unknown; source_url?: unknown }): CpiArea | null {
  const c = raw.cpi && typeof raw.cpi === "object" ? (raw.cpi as Record<string, unknown>) : null;
  if (!c) return null;
  const sid = typeof c["series_id"] === "string" ? c["series_id"] : "";
  if (!/^CUUR[A-Z0-9]{4}SA0$/.test(sid)) return null;
  const obs = Array.isArray(c["obs"]) ? c["obs"] : [];
  const annual = obs
    .flatMap((o) => {
      if (!Array.isArray(o) || o[1] !== "M13") return [];
      const year = Number(o[0]);
      const value = money(o[2]);
      return Number.isInteger(year) && value !== null && value > 0 ? [{ year, value }] : [];
    })
    .sort((a, b) => a.year - b.year);
  if (!annual.length) return null;
  return {
    seriesId: sid,
    area: typeof c["area"] === "string" ? c["area"].slice(0, 120) : sid,
    level: typeof c["level"] === "string" ? c["level"] : "",
    basePeriod: typeof c["base_period"] === "string" ? c["base_period"] : "",
    sourceUrl: typeof raw.source_url === "string" && /^https:\/\//.test(raw.source_url) ? raw.source_url : null,
    annual,
  };
}

/** Percent change of the annual average between two years; null when either year is not recorded. */
export function cpiChange(a: CpiArea, from: number, to: number): number | null {
  const x = a.annual.find((p) => p.year === from)?.value;
  const y = a.annual.find((p) => p.year === to)?.value;
  return x != null && y != null ? (y / x - 1) * 100 : null;
}

/** Annual averages rebased to 100 in `base` (each area keeps its own published index base, so levels never compare). */
export function rebase(a: CpiArea, base: number): { year: number; value: number }[] {
  const b = a.annual.find((p) => p.year === base)?.value;
  if (b == null) return [];
  return a.annual.filter((p) => p.year >= base).map((p) => ({ year: p.year, value: (p.value / b) * 100 }));
}

export const lastYear = (a: CpiArea): number | null => a.annual.at(-1)?.year ?? null;

// ------------------------------------------------------------------------------------------------ state rate periods

export type RateStatus = "in_force" | "ended" | "not_started" | "undated";

/** Whether a stated rate's effective period covers `today` (ISO dates compare as strings). */
export function rateStatus(
  r: { effectiveFrom: string | null; effectiveTo: string | null },
  today: string,
): RateStatus {
  if (!r.effectiveFrom && !r.effectiveTo) return "undated";
  if (r.effectiveTo && today > r.effectiveTo) return "ended";
  if (r.effectiveFrom && today < r.effectiveFrom) return "not_started";
  return "in_force";
}

/** Days from `today` to the end of the stated period (0 = ends today); null when undated or ended. */
export function daysToEnd(r: { effectiveTo: string | null }, today: string): number | null {
  if (!r.effectiveTo || today > r.effectiveTo) return null;
  const ms = Date.parse(`${r.effectiveTo}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

export const isoToday = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

/** States a metro area spans, read from the BLS area name's state suffix ("..., NY-NJ" gives ["NY", "NJ"]). */
export function metroStates(area: string): string[] {
  const m = /,\s*([A-Z]{2}(?:-[A-Z]{2})*)\s*(?:\(.*\))?$/.exec(area);
  return m ? m[1]!.split("-") : [];
}
