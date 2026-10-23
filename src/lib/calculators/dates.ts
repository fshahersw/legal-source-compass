/**
 * Calendar arithmetic for the calculators: ISO dates (YYYY-MM-DD) as UTC calendar days, never local time, so a result
 * does not depend on the reader's time zone. Pure.
 */

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

export const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * DAY_MS);
/** Whole days from `a` to `b` (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (iso: string) => new Date(toUtc(iso)).getUTCDay();
export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayName = (iso: string) => WEEKDAYS[weekday(iso)]!;

/**
 * The same month and day `years` later. A February 29 start falls on February 28 in a year without that day (the
 * calculators state this wherever it applies).
 */
export function anniversary(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return fromUtc(Date.UTC(y, m - 1, Math.min(d, last)));
}

/** "2026-10" for a month key; the FRED date of a monthly value is the first of the month. */
export const isMonthKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const monthStart = (month: string) => `${month}-01`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
export function dateLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}
