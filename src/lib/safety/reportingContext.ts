/**
 * Litigation-stimulated reporting: adverse-event reports for a product in the 12 months before and after its MDL was
 * centralized (the JPML transfer date), and the share of reports a lawyer submitted. FAERS counts reports, not cases:
 * reports rise when litigation publicises a product, and defense experts raise exactly that, so the page shows the
 * transfer date and the reporter mix next to the trend. Pure and tested (reportingContext.test.ts).
 *
 * Rules: a window that runs past the series' last month or before its first month is partial and never compared (no
 * percent change); the lawyer share comes from fda_faers_product_series, whose openFDA search can differ from the
 * product page's own search, so it is labelled with that search.
 */

export type MonthlySeries = { coverage_from: string; coverage_to: string; vals: readonly number[] };

export type MdlTransfer = {
  mdl: number;
  title: string | null;
  transferred: string | null;
  pending: number | null;
  total: number | null;
  sourceUrl: string | null;
};

export type LawyerYear = { year: number; reports: number; lawyer: number | null; partial: boolean };

export type LawyerSeries = {
  mdl: number;
  product: string | null;
  search: string | null;
  sourceUrl: string | null;
  years: LawyerYear[];
};

export type TransferWindow = {
  mdl: number;
  title: string | null;
  transferMonth: string | null;
  before: number | null;
  after: number | null;
  beforePartial: boolean;
  afterPartial: boolean;
  /** Percent change, only when both windows are complete. */
  change: number | null;
};

const MONTH = /^\d{4}-\d{2}$/;
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
export const monthOf = (idx: number) =>
  `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;

/**
 * Sum of `n` months starting at `start` (inclusive). Months outside the series window are not recorded: the sum
 * covers only the months inside it and `partial` says so; null when no month of the window is inside.
 */
export function windowSum(
  s: MonthlySeries,
  start: string,
  n: number,
): { value: number | null; partial: boolean } {
  if (!MONTH.test(s.coverage_from) || !MONTH.test(start)) return { value: null, partial: true };
  const base = monthIndex(s.coverage_from);
  const last = Math.min(
    base + s.vals.length - 1,
    MONTH.test(s.coverage_to) ? monthIndex(s.coverage_to) : Infinity,
  );
  const from = monthIndex(start);
  let sum = 0;
  let inside = 0;
  for (let i = from; i < from + n; i += 1) {
    if (i < base || i > last) continue;
    sum += s.vals[i - base] ?? 0;
    inside += 1;
  }
  return { value: inside ? sum : null, partial: inside < n };
}

/** Before = the 12 months before the transfer month; after = the transfer month and the 11 after it. */
export function transferWindow(s: MonthlySeries, t: MdlTransfer): TransferWindow {
  const transferMonth =
    t.transferred && /^\d{4}-\d{2}/.test(t.transferred) ? t.transferred.slice(0, 7) : null;
  if (!transferMonth)
    return {
      mdl: t.mdl,
      title: t.title,
      transferMonth: null,
      before: null,
      after: null,
      beforePartial: true,
      afterPartial: true,
      change: null,
    };
  const idx = monthIndex(transferMonth);
  const before = windowSum(s, monthOf(idx - 12), 12);
  const after = windowSum(s, transferMonth, 12);
  const change =
    !before.partial && !after.partial && before.value && after.value !== null
      ? Math.round(((after.value - before.value) / before.value) * 1000) / 10
      : null;
  return {
    mdl: t.mdl,
    title: t.title,
    transferMonth,
    before: before.value,
    after: after.value,
    beforePartial: before.partial,
    afterPartial: after.partial,
    change,
  };
}

/** Monthly points from `monthsBefore` before the earliest transfer month to the end of the series. */
export function monthlyPoints(
  s: MonthlySeries,
  fromMonth: string | null,
): { month: string; reports: number; partial: boolean }[] {
  if (!MONTH.test(s.coverage_from)) return [];
  const base = monthIndex(s.coverage_from);
  const start = fromMonth && MONTH.test(fromMonth) ? Math.max(base, monthIndex(fromMonth)) : base;
  const out: { month: string; reports: number; partial: boolean }[] = [];
  for (let i = start; i < base + s.vals.length; i += 1)
    out.push({ month: monthOf(i), reports: s.vals[i - base] ?? 0, partial: false });
  return out;
}

/** Lawyer-reported share by year (null when the year's lawyer count is not recorded or it has no reports). */
export function lawyerShares(l: LawyerSeries | null): {
  year: string;
  share: number | null;
  lawyer: number | null;
  reports: number;
  partial: boolean;
}[] {
  if (!l) return [];
  return l.years
    .filter((y) => Number.isFinite(y.year))
    .map((y) => ({
      year: String(y.year),
      reports: y.reports,
      lawyer: y.lawyer,
      share:
        y.lawyer === null || !(y.reports > 0)
          ? null
          : Math.round((y.lawyer / y.reports) * 1000) / 10,
      partial: y.partial,
    }));
}

/** Parse fda_faers_product_series item.series rows; unknown values stay null. */
export function parseLawyerYears(raw: unknown): LawyerYear[] {
  if (!Array.isArray(raw)) return [];
  const out: LawyerYear[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const year = Number(o["year"]);
    const reports = Number(o["reports"]);
    if (!Number.isInteger(year) || !Number.isFinite(reports)) continue;
    const lawyer =
      typeof o["lawyer"] === "number" && Number.isFinite(o["lawyer"])
        ? (o["lawyer"] as number)
        : null;
    out.push({ year, reports, lawyer, partial: o["partial"] === true });
  }
  return out.sort((a, b) => a.year - b.year);
}
