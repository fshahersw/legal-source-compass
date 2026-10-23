/** Display helpers for the enforcement_extra panels (pure; unit-tested). */
export const NOT_RECORDED = "Not recorded";

export function fmtInt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? NOT_RECORDED : Math.round(n).toLocaleString("en-US");
}

/** Percentages are stored with one decimal; shown as stored. */
export function fmtPct(n: number | null | undefined, digits = 1): string {
  return n == null || !Number.isFinite(n) ? NOT_RECORDED : `${n.toFixed(digits)}%`;
}

/** Months with one decimal below 10 (time-served cases make small medians), whole months above. */
export function fmtMonths(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NOT_RECORDED;
  return `${n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US")} mo`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** ISO yyyy-mm-dd shown as "17 Oct 2026" without time-zone conversion. */
export function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return NOT_RECORDED;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : NOT_RECORDED;
}

export function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** "TEXAS SOUTHERN" -> "Texas Southern" (EOUSA labels are upper case). */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
