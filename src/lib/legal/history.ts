import { calendarDate } from "./schema.ts";
import type { LEGAL_ENUMS } from "./schema.ts";

export type HistoricalFrequency = {
  n: number; occurred: number; share: number | null;
  date_range: { from: string; to: string } | null;
  excluded_incomplete_followup: number;
  label: string;
};
const validDay = (s: string | null): s is string => s !== null && calendarDate.safeParse(s).success;
const range = (dates: string[]) => dates.length ? { from: [...dates].sort()[0]!, to: [...dates].sort().at(-1)! } : null;
export function daysBetween(from: string, to: string): number | null {
  if (!validDay(from) || !validDay(to) || to < from) return null;
  return (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
}
function anniversary(date: string, years: number) {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const y = year + years;
  const finalDay = Math.min(day, new Date(Date.UTC(y, month, 0)).getUTCDate());
  return `${y}-${String(month).padStart(2, "0")}-${String(finalDay).padStart(2, "0")}`;
}
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const n = sorted.length; return n ? n % 2 ? sorted[Math.floor(n / 2)]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2 : null; }

export type RuleHistory = { id: string; agency: string; proposed: string; finalized: string | null; comment_count: number | null };
/** Exclude the entire immature cohort, including early successes, to avoid survivorship bias. */
export function rulemakingFrequency(rows: readonly RuleHistory[], horizon: 1 | 2 | 5, asOf: string): HistoricalFrequency {
  calendarDate.parse(asOf);
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()].filter((r) => validDay(r.proposed) && r.proposed >= "2000-01-01" && r.proposed <= asOf);
  const mature = unique.filter((r) => anniversary(r.proposed, horizon) <= asOf);
  const occurred = mature.filter((r) => validDay(r.finalized) && r.finalized >= r.proposed && r.finalized <= anniversary(r.proposed, horizon)).length;
  return { n: mature.length, occurred, share: mature.length ? occurred / mature.length : null,
    date_range: range(mature.map((r) => r.proposed)), excluded_incomplete_followup: unique.length - mature.length,
    label: `Historical share finalized within ${horizon} ${horizon === 1 ? "year" : "years"}` };
}
export function observedDurations(rows: readonly { id: string; start: string | null; event: string | null }[], asOf: string) {
  calendarDate.parse(asOf);
  const cohort = [...new Map(rows.map((r) => [r.id, r])).values()].filter((r) => validDay(r.start) && r.start <= asOf);
  const completed = cohort.flatMap((r) => {
    const days = r.event && r.event <= asOf ? daysBetween(r.start!, r.event) : null;
    return days !== null ? [{ days, start: r.start! }] : [];
  });
  return { n: completed.length, cohort_n: cohort.length, event_not_recorded: cohort.length - completed.length,
    median_days: median(completed.map((r) => r.days)), date_range: range(completed.map((r) => r.start)),
    label: "Historical time to recorded event; median among observed events" };
}
export type BillHistory = { id: string; introduced: string; enacted: string | null; congress_ended: string; chamber: string; committees: string[]; cosponsors: number | null; bipartisan: boolean | null };
export function legislativeFrequency(rows: readonly BillHistory[], asOf: string): HistoricalFrequency {
  calendarDate.parse(asOf);
  const cohort = [...new Map(rows.map((r) => [r.id, r])).values()].filter((r) => validDay(r.introduced) && r.introduced >= "2000-01-01" && r.introduced <= asOf);
  const closed = cohort.filter((r) => validDay(r.congress_ended) && r.congress_ended <= asOf);
  const occurred = closed.filter((r) => validDay(r.enacted) && r.enacted >= r.introduced && r.enacted <= asOf).length;
  return { n: closed.length, occurred, share: closed.length ? occurred / closed.length : null, date_range: range(closed.map((r) => r.introduced)), excluded_incomplete_followup: cohort.length - closed.length, label: "Historical enactment share for completed Congresses" };
}
export function admissionFrequency(rows: readonly { ruling_id: string; date: string; outcome: keyof typeof LEGAL_ENUMS.evidence_outcome }[], asOf: string) {
  calendarDate.parse(asOf);
  const unique = [...new Map(rows.map((r) => [r.ruling_id, r])).values()].filter((r) => validDay(r.date) && r.date <= asOf);
  const n = unique.length; const admitted = unique.filter((r) => r.outcome === "admitted").length;
  return { n, admitted, excluded: unique.filter((r) => r.outcome === "excluded").length, partial: unique.filter((r) => r.outcome === "partial").length,
    admission_share: n ? admitted / n : null, date_range: range(unique.map((r) => r.date)), label: "Historical admission share; partial rulings shown separately" };
}
