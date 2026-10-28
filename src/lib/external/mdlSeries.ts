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


/** Rows whose latest pending count is recorded: rankings and sizes only ever use these. */
export function hasPending<T extends { pending: number | null }>(r: T): r is T & { pending: number } {
  return r.pending != null;
}
