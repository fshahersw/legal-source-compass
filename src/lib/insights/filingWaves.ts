/**
 * Gross new-filing waves of product-liability MDLs, aligned on each MDL's first sizeable fiscal year (pure, tested).
 *
 * Source: corpus dataset fjc_civil_mdls (FJC Integrated Database, civil cases carrying an MDL docket number, by fiscal
 * year of filing). These are cases that carry the MDL number in the IDB: a historical association, not current MDL
 * membership, and gross arrivals, not the JPML's net pending count.
 *
 * Rules:
 *  - Year 0 is the first fiscal year with at least START_MIN filings, so one stray early case does not set the start.
 *  - The IDB is the whole federal civil caseload, so a fiscal year with no case carrying the number is a true 0
 *    between year 0 and the last fiscal year the file covers.
 *  - The fiscal year the file only partly covers (FY2026 runs Oct 2025 - Sep 2026; the file ends earlier) is flagged
 *    partial: drawn dashed, never used as a peak, never in the cohort median.
 *  - "Product-liability MDL": at least PRODUCT_SHARE_MIN of its cases carry a product-liability nature of suit
 *    (the FJC NOS group used by the state analysis: 195, 245, 315, 345, 355, 365, 367, 368, 385).
 */

export const PRODUCT_NOS: readonly number[] = [195, 245, 315, 345, 355, 365, 367, 368, 385];
export const START_MIN = 10;
export const PRODUCT_SHARE_MIN = 0.5;
/** MDLs in the cohort median: product-liability MDLs with at least this many cases in all. */
export const COHORT_MIN_CASES = 500;
/** Years after year 0 shown on the axis. */
export const MAX_OFFSET = 12;

export const FJC_MDL_SOURCE = {
  label: "Federal Judicial Center, Integrated Database (civil), cases carrying an MDL docket number",
  url: "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
} as const;

export type MdlFyRow = {
  mdl: number;
  title: string | null;
  cases: number;
  lastFiled: string | null;
  byFy: { fy: number; cases: number }[];
  /** Share (0-1) of the MDL's cases with a product-liability NOS; null when the NOS mix is not recorded. */
  productShare: number | null;
};

export type WavePoint = { offset: number; fy: number; cases: number; partial: boolean };
export type Wave = {
  mdl: number;
  title: string | null;
  cases: number;
  startFy: number;
  points: WavePoint[];
  /** Highest complete fiscal year (never the partial one). */
  peak: { fy: number; cases: number } | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0
    ? v
    : typeof v === "string" && /^\d{1,9}$/.test(v)
      ? Number(v)
      : null;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** One fjc_civil_mdls record ({id, c: cells, fy: profile.by_fy, nos: profile.nos}) as a typed row, or null. */
export function parseMdlFyRow(raw: unknown, title: string | null = null): MdlFyRow | null {
  const r = obj(raw);
  if (!r) return null;
  const m = /^mdl:(\d{1,5})$/.exec(typeof r["id"] === "string" ? r["id"] : "");
  if (!m) return null;
  const cells = obj(r["c"]) ?? {};
  const byFy = (Array.isArray(r["fy"]) ? r["fy"] : [])
    .flatMap((x) => {
      const o = obj(x);
      const fy = int(o?.["fy"]);
      const cases = int(o?.["cases"]);
      return fy !== null && fy >= 1988 && fy <= 2100 && cases !== null ? [{ fy, cases }] : [];
    })
    .sort((a, b) => a.fy - b.fy);
  const nos = Array.isArray(r["nos"]) ? r["nos"] : [];
  let all = 0;
  let product = 0;
  for (const x of nos) {
    const o = obj(x);
    const code = int(o?.["nos"]);
    const n = int(o?.["cases"]);
    if (n === null) continue;
    all += n;
    if (code !== null && PRODUCT_NOS.includes(code)) product += n;
  }
  const lastFiled = typeof cells["last_filed"] === "string" && ISO.test(cells["last_filed"]) ? cells["last_filed"] : null;
  return {
    mdl: Number(m[1]),
    title,
    cases: int(cells["cases"]) ?? byFy.reduce((s, y) => s + y.cases, 0),
    lastFiled,
    byFy,
    productShare: all > 0 ? product / all : null,
  };
}

/** Federal fiscal year (1 Oct - 30 Sep, labelled by its end) of an ISO date. */
export function fiscalYearOf(iso: string): number | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  return Number(m[2]) >= 10 ? y + 1 : y;
}

/** The fiscal year the file only partly covers, or null when the file ends on 30 September. */
export function partialFiscalYear(dataThrough: string | null): number | null {
  if (!dataThrough) return null;
  const fy = fiscalYearOf(dataThrough);
  if (fy === null) return null;
  return dataThrough < `${fy}-09-30` ? fy : null;
}

/** Latest last_filed across rows: the date the file runs to. */
export function dataThroughOf(rows: readonly MdlFyRow[]): string | null {
  let out: string | null = null;
  for (const r of rows) if (r.lastFiled && (!out || r.lastFiled > out)) out = r.lastFiled;
  return out;
}

export const isProductMdl = (r: MdlFyRow): boolean =>
  r.productShare !== null && r.productShare >= PRODUCT_SHARE_MIN;

/** First fiscal year with at least START_MIN filings, or null. */
export function startFiscalYear(r: Pick<MdlFyRow, "byFy">): number | null {
  return r.byFy.find((y) => y.cases >= START_MIN)?.fy ?? null;
}

/**
 * One MDL's filings by years since year 0, through the last fiscal year the file covers (`lastFy`), at most
 * MAX_OFFSET years. null when it never reaches START_MIN filings in a year.
 */
export function alignWave(r: MdlFyRow, lastFy: number, partialFy: number | null): Wave | null {
  const startFy = startFiscalYear(r);
  if (startFy === null || startFy > lastFy) return null;
  const by = new Map(r.byFy.map((y) => [y.fy, y.cases]));
  const points: WavePoint[] = [];
  for (let fy = startFy; fy <= lastFy && fy - startFy <= MAX_OFFSET; fy++)
    points.push({ offset: fy - startFy, fy, cases: by.get(fy) ?? 0, partial: fy === partialFy });
  let peak: Wave["peak"] = null;
  for (const p of points)
    if (!p.partial && (!peak || p.cases > peak.cases)) peak = { fy: p.fy, cases: p.cases };
  return { mdl: r.mdl, title: r.title, cases: r.cases, startFy, points, peak };
}

const medianOf = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Median filings at each year since year 0, over complete fiscal years only, with the number of MDLs behind it. */
export function cohortMedian(waves: readonly Wave[]): { offset: number; median: number | null; n: number }[] {
  const out: { offset: number; median: number | null; n: number }[] = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset++) {
    const vals = waves.flatMap((w) => {
      const p = w.points[offset];
      return p && !p.partial ? [p.cases] : [];
    });
    out.push({ offset, median: medianOf(vals), n: vals.length });
  }
  while (out.length && out[out.length - 1]!.n === 0) out.pop();
  return out;
}

/** Filings as a percent of the MDL's own complete-year peak (null without a peak). */
export function indexToPeak(w: Wave): (number | null)[] {
  const peak = w.peak?.cases ?? 0;
  return w.points.map((p) => (peak > 0 ? (p.cases / peak) * 100 : null));
}

export type FilingWaves = {
  dataThrough: string | null;
  partialFy: number | null;
  lastFy: number | null;
  /** fjc_civil_mdls records read, and how many are product-liability MDLs. */
  mdlsRead: number;
  productMdls: number;
  /** Product-liability MDLs with at least COHORT_MIN_CASES cases, aligned. */
  waves: Wave[];
};

/** All rows in, the aligned product-liability cohort out. */
export function buildFilingWaves(rows: readonly MdlFyRow[]): FilingWaves {
  const dataThrough = dataThroughOf(rows);
  const partialFy = partialFiscalYear(dataThrough);
  const lastFy = dataThrough ? fiscalYearOf(dataThrough) : null;
  const product = rows.filter(isProductMdl);
  const waves =
    lastFy === null
      ? []
      : product
          .filter((r) => r.cases >= COHORT_MIN_CASES)
          .flatMap((r) => {
            const w = alignWave(r, lastFy, partialFy);
            return w ? [w] : [];
          })
          .sort((a, b) => b.startFy - a.startFy || b.cases - a.cases || a.mdl - b.mdl);
  return { dataThrough, partialFy, lastFy, mdlsRead: rows.length, productMdls: product.length, waves };
}

/** Default selection: the most recent starts (newest year 0 first, larger first), up to `n`. */
export function defaultSelection(waves: readonly Wave[], n = 5): number[] {
  return waves.slice(0, n).map((w) => w.mdl);
}

/** Year-1 growth: filings in year 1 against year 0 (complete years only), as a ratio; null when not computable. */
export function yearOneRatio(w: Wave): number | null {
  const y0 = w.points[0];
  const y1 = w.points[1];
  if (!y0 || !y1 || y0.partial || y1.partial || y0.cases === 0) return null;
  return y1.cases / y0.cases;
}
