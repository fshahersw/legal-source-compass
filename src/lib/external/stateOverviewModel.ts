/**
 * The federal side of a state's overview: its district courts with caseload trend, bench size and pending MDL actions.
 * Sources: fjc_civil_districts (FJC Integrated Database, filings by fiscal year), judge_cross_districts (FJC biographical
 * directory active/senior judges and JPML pending-MDL reports, as compiled for the matter registry). Rows are matched by
 * exact court id; a district with no bench row keeps its caseload and shows the bench as Not recorded.
 */
import { num, obj, str } from "./placeAnalysisParse";

export type FilingsYear = { fy: number; filings: number };
export type PendingMdl = {
  mdl: number;
  title: string;
  type: string | null;
  judge: string | null;
  pending: number;
  courtId: string;
};

/** MDLs pending before a district, from the stored list; an entry without a number, title or count is dropped. */
export function parsePendingMdls(raw: unknown, courtId: string): PendingMdl[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingMdl[] = [];
  for (const e of raw) {
    const r = obj(e);
    const mdl = num(r["mdl"]);
    const pending = nonNegNum(r["pending"]);
    const title = str(r["title"], 220);
    if (mdl == null || !Number.isInteger(mdl) || mdl < 1 || pending == null || !title) continue;
    out.push({
      mdl,
      title,
      type: str(r["type"], 80) || null,
      judge: str(r["judge"], 100) || null,
      pending,
      courtId,
    });
  }
  return out.sort((a, b) => b.pending - a.pending || a.mdl - b.mdl);
}
const nonNegNum = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};
export type DistrictRow = {
  courtId: string;
  name: string;
  circuit: string | null;
  /** Complete fiscal years only (a year still in progress is never drawn as a trend point), oldest first. */
  series: FilingsYear[];
  latest: {
    fy: number;
    filings: number;
    terminations: number | null;
    pending: number | null;
    medianDays: number | null;
  } | null;
  bench: {
    active: number | null;
    senior: number | null;
    judgeships: number | null;
    asOf: string | null;
  } | null;
  mdl: { pendingMdls: number | null; pendingActions: number | null } | null;
  /** MDLs pending before this district (JPML pending-MDL reports), largest first. */
  mdls: PendingMdl[];
};

const COURT_ID = /^[a-z]{2,6}$/;
const nonNeg = (v: unknown) => {
  const n = num(typeof v === "string" && v.trim() !== "" ? Number(v) : v);
  return n != null && n >= 0 ? n : null;
};

/** Complete-year filings from a stored series, oldest first, at most the last `max` years. */
export function filingsSeries(raw: unknown, max = 12): FilingsYear[] {
  if (!Array.isArray(raw)) return [];
  const out: FilingsYear[] = [];
  for (const e of raw) {
    const r = obj(e);
    const fy = num(r["fy"]);
    const filings = nonNeg(r["filings"]);
    if (fy == null || !Number.isInteger(fy) || filings == null || r["partial"] === true) continue;
    out.push({ fy, filings });
  }
  return out.sort((a, b) => a.fy - b.fy).slice(-max);
}

export type DistrictBase = { id: string; c: unknown; s: unknown };
export type DistrictBench = {
  id: string;
  a: unknown;
  sn: unknown;
  jg: unknown;
  pm: unknown;
  pa: unknown;
  asof: unknown;
  /** item.district.mdls */
  m?: unknown;
};

export function parseDistrict(
  base: DistrictBase,
  bench: DistrictBench | undefined,
): DistrictRow | null {
  if (!COURT_ID.test(base.id)) return null;
  const cells = obj(base.c);
  const name = str(cells["court"], 160);
  if (!name) return null;
  const series = filingsSeries(base.s);
  const lastFull = series.at(-1);
  const latestRow = Array.isArray(base.s)
    ? base.s.map(obj).find((r) => num(r["fy"]) === lastFull?.fy)
    : undefined;
  return {
    courtId: base.id,
    name,
    circuit: str(cells["circuit"], 60) || null,
    series,
    latest: lastFull
      ? {
          fy: lastFull.fy,
          filings: lastFull.filings,
          terminations: nonNeg(latestRow?.["terminations"]),
          pending: nonNeg(latestRow?.["pending_end"]),
          medianDays: nonNeg(latestRow?.["median_days"]),
        }
      : null,
    bench: bench
      ? {
          active: nonNeg(bench.a),
          senior: nonNeg(bench.sn),
          judgeships: nonNeg(bench.jg),
          asOf: str(bench.asof, 10) || null,
        }
      : null,
    mdl: bench ? { pendingMdls: nonNeg(bench.pm), pendingActions: nonNeg(bench.pa) } : null,
    mdls: parsePendingMdls(bench?.m, base.id),
  };
}

export type StateFederalSummary = {
  districts: number;
  activeJudges: number | null;
  seniorJudges: number | null;
  pendingMdls: number | null;
  pendingActions: number | null;
  asOf: string | null;
  /** Every MDL pending before the state's districts, most pending actions first. */
  mdls: PendingMdl[];
  /** Filings summed over the districts for the latest fiscal year they all report, with the year before for change. */
  filings: { fy: number; value: number; previous: number | null } | null;
};

const sumOrNull = (values: (number | null | undefined)[]) =>
  values.length && values.every((v) => v != null)
    ? values.reduce<number>((a, v) => a + (v as number), 0)
    : null;

/** Totals over a state's districts; a total is null unless every district reports it (never a partial sum shown as a total). */
export function summarizeDistricts(rows: DistrictRow[]): StateFederalSummary {
  const fy =
    rows.length && rows.every((r) => r.latest) ? Math.min(...rows.map((r) => r.latest!.fy)) : null;
  let filings: StateFederalSummary["filings"] = null;
  if (fy != null) {
    const at = (year: number) =>
      sumOrNull(rows.map((r) => r.series.find((p) => p.fy === year)?.filings ?? null));
    const value = at(fy);
    filings = value != null ? { fy, value, previous: at(fy - 1) } : null;
  }
  return {
    districts: rows.length,
    activeJudges: sumOrNull(rows.map((r) => r.bench?.active)),
    seniorJudges: sumOrNull(rows.map((r) => r.bench?.senior)),
    pendingMdls: sumOrNull(rows.map((r) => r.mdl?.pendingMdls)),
    pendingActions: sumOrNull(rows.map((r) => r.mdl?.pendingActions)),
    asOf: rows.find((r) => r.bench?.asOf)?.bench?.asOf ?? null,
    mdls: rows.flatMap((r) => r.mdls).sort((a, b) => b.pending - a.pending || a.mdl - b.mdl),
    filings,
  };
}
