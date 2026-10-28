/** Validation of the JPML monthly series an MDL record carries. Pure and client-safe. */

/** One monthly JPML report figure. `total` is null when the report row carries no historical total. */
export type MdlPoint = { date: string; pending: number; total: number | null };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The monthly points a record carries, validated: a point needs a calendar date and a finite, non-negative pending
 * count; anything else is dropped (a gap, never a zero). A date printed twice with different counts is ambiguous and
 * both copies are dropped; exact repeats are kept once. Sorted by date.
 */
export function validSeries(raw: unknown): MdlPoint[] {
  if (!Array.isArray(raw)) return [];
  const byDate = new Map<string, MdlPoint | "conflict">();
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const date = typeof o["date"] === "string" && ISO_DAY.test(o["date"]) ? o["date"] : null;
    const pending = num(o["pending"]);
    if (!date || pending == null || pending < 0 || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
      continue;
    const total = num(o["total"]);
    const point: MdlPoint = { date, pending, total: total != null && total >= 0 ? total : null };
    const seen = byDate.get(date);
    if (seen === undefined) byDate.set(date, point);
    else if (seen !== "conflict" && (seen.pending !== point.pending || seen.total !== point.total))
      byDate.set(date, "conflict");
  }
  return [...byDate.values()]
    .filter((p): p is MdlPoint => p !== "conflict")
    .sort((a, b) => a.date.localeCompare(b.date));
}


/** "2026-10" for "2026-10-01". Null for anything that is not an ISO calendar date. */
export function monthKey(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${m[1]}-${m[2]}` : null;
}

/** The month key `months` calendar months before `key` ("2026-10", 12 → "2025-10"). */
export function shiftMonth(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) - months;
  const yy = Math.floor(idx / 12);
  const mm = idx - yy * 12 + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

export type ExactChange =
  | { ok: true; latest: MdlPoint; prior: MdlPoint; change: number }
  | { ok: false; reason: "no-latest" | "no-prior-report" | "two-reports-in-month" };

/**
 * Change in actions pending between the latest report in `series` and the report exactly `months` calendar months
 * earlier. `series` should already be validated (see `validSeries`); the latest point is the last by date.
 */
export function exactChange(series: readonly MdlPoint[], months = 12): ExactChange {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const latestKey = latest ? monthKey(latest.date) : null;
  if (!latest || !latestKey) return { ok: false, reason: "no-latest" };
  if (sorted.filter((p) => monthKey(p.date) === latestKey).length > 1)
    return { ok: false, reason: "two-reports-in-month" };
  const target = shiftMonth(latestKey, months);
  const prior = sorted.filter((p) => monthKey(p.date) === target);
  if (prior.length === 0) return { ok: false, reason: "no-prior-report" };
  if (prior.length > 1) return { ok: false, reason: "two-reports-in-month" };
  return { ok: true, latest, prior: prior[0]!, change: latest.pending - prior[0]!.pending };
}

/**
 * The windowed figures of a record recomputed from its validated series with exact calendar-month matching:
 * change in pending over 1, 3 and 12 reports' months, and over 12 months the growth in total actions (new) and new
 * minus the pending change (resolved). Null wherever the matching month's report is missing.
 */
export function windowFigures(series: readonly MdlPoint[]) {
  const c1 = exactChange(series, 1);
  const c3 = exactChange(series, 3);
  const c12 = exactChange(series, 12);
  const new12m =
    c12.ok && c12.latest.total != null && c12.prior.total != null
      ? c12.latest.total - c12.prior.total
      : null;
  return {
    change1m: c1.ok ? c1.change : null,
    change3m: c3.ok ? c3.change : null,
    change12m: c12.ok ? c12.change : null,
    new12m,
    resolved12m: new12m != null && c12.ok ? new12m - c12.change : null,
  };
}

/** Rows whose latest pending count is recorded: rankings and sizes only ever use these. */
export function hasPending<T extends { pending: number | null }>(r: T): r is T & { pending: number } {
  return r.pending != null;
}
