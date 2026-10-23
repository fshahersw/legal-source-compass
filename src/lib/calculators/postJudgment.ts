/**
 * Federal post-judgment interest, 28 U.S.C. § 1961. Pure.
 *
 * § 1961(a): interest "shall be calculated from the date of the entry of the judgment, at a rate equal to the weekly
 * average 1-year constant maturity Treasury yield, as published by the Board of Governors of the Federal Reserve System,
 * for the calendar week preceding the date of the judgment." § 1961(b): "Interest shall be computed daily to the date of
 * payment ... and shall be compounded annually." (Text as reproduced by the Administrative Office of the U.S. Courts,
 * https://www.uscourts.gov/28-usc-1961-post-judgment-interest-rates.)
 *
 * Rate week. The Board publishes weekly averages for weeks ending Friday (H.15; FRED series WGS1YR). The district courts'
 * published rate tables on uscourts.gov apply each week's average to judgments entered from the following Monday through
 * Sunday (e.g. week ending 10/09/2026, 4.45%, effective 10/12/2026 to 10/18/2026). `rateWeekFor` implements exactly that:
 * the Friday three days before the Monday of the judgment's Monday-to-Sunday week. A week the data does not hold is
 * "Not recorded" — never the nearest other week.
 *
 * Before December 21, 2000 the statute used the coupon issue yield equivalent of the average accepted auction price for
 * the last auction of 52-week Treasury bills (uscourts.gov, Post Judgment Interest Rate); that rate is not held here, so
 * earlier judgments are refused with that reason.
 *
 * Accrual. Interest accrues for each day from the date of entry up to (not including) the date of payment. Within each
 * judgment year (entry date to its anniversary) interest is simple at rate ÷ day basis per day; at each anniversary the
 * year's interest is added to the balance (annual compounding). The statute does not state a day basis; the calculator
 * offers a 365-day year (default) or the actual days of each judgment year (365 or 366) and shows which was used.
 * Amounts are carried unrounded and rounded to cents only for display.
 */
import { addDays, anniversary, daysBetween, isIsoDate, weekday } from "./dates";
import type { MethodStep, SeriesObservations, SourceObservation } from "./types";

export const PJI_SERIES = "WGS1YR";
export const PJI_REGIME_START = "2000-12-21";
export const PJI_SOURCES = {
  statute:
    "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title28-section1961&num=0&edition=prelim",
  uscourtsText: "https://www.uscourts.gov/28-usc-1961-post-judgment-interest-rates",
  uscourtsRate: "https://www.uscourts.gov/court-programs/fees/post-judgment-interest-rate",
  h15: "https://www.federalreserve.gov/releases/h15/",
  fred: "https://fred.stlouisfed.org/series/WGS1YR",
  inApp: "/law/uscode/28/1961",
} as const;

export type DayBasis = "365" | "actual";

/** The H.15 week (ending Friday) whose average applies to a judgment entered on `judgmentDate`. */
export function rateWeekFor(judgmentDate: string): {
  weekEnding: string;
  weekStart: string;
  effectiveFrom: string;
  effectiveTo: string;
} {
  const back = (weekday(judgmentDate) + 6) % 7; // days since Monday
  const monday = addDays(judgmentDate, -back);
  const weekEnding = addDays(monday, -3);
  return {
    weekEnding,
    weekStart: addDays(weekEnding, -6),
    effectiveFrom: monday,
    effectiveTo: addDays(monday, 6),
  };
}

/** The weekly average for a week ending `weekEnding`, exactly that date, or null. */
export function findRate(series: SeriesObservations, weekEnding: string): SourceObservation | null {
  const o = series.obs.find((x) => x.date === weekEnding);
  if (!o || o.value === null) return null;
  return {
    seriesId: series.seriesId,
    label: series.label,
    date: o.date,
    value: o.value,
    units: series.units,
    vintage: o.vintage,
    ...(o.firstVintage !== undefined
      ? { firstValue: o.firstValue ?? null, firstVintage: o.firstVintage }
      : {}),
    url: series.url,
  };
}

export type PjiPeriod = {
  from: string;
  /** Exclusive: the anniversary or the payment date. */
  to: string;
  days: number;
  basisDays: number;
  opening: number;
  interest: number;
  closing: number;
  /** True when the period ends at an anniversary and its interest is added to the balance. */
  compounded: boolean;
};

export type PjiResult = {
  inputs: { principal: number; judgmentDate: string; paymentDate: string; dayBasis: DayBasis };
  week: ReturnType<typeof rateWeekFor>;
  rate: SourceObservation;
  ratePercent: number;
  periods: PjiPeriod[];
  days: number;
  interest: number;
  total: number;
  /** Interest per day on the principal in the first judgment year (for a per-diem figure). */
  perDiem: number;
  method: MethodStep[];
  notes: string[];
};

export type PjiInput = {
  principal: number;
  judgmentDate: string;
  paymentDate: string;
  dayBasis: DayBasis;
};

/** Validation before any lookup; returns the reason a calculation cannot run, or null. */
export function pjiInputProblem(i: PjiInput): string | null {
  if (!Number.isFinite(i.principal) || i.principal <= 0)
    return "Enter a judgment amount greater than zero.";
  if (i.principal > 1e13) return "The judgment amount is larger than this calculator handles.";
  if (!isIsoDate(i.judgmentDate)) return "Enter the date the judgment was entered.";
  if (!isIsoDate(i.paymentDate)) return "Enter the date of payment.";
  if (i.paymentDate < i.judgmentDate) return "The payment date is before the judgment date.";
  if (i.judgmentDate < PJI_REGIME_START)
    return "Judgments entered before December 21, 2000 used the 52-week Treasury bill auction yield (28 U.S.C. § 1961 as then in force); that rate is not recorded here.";
  if (daysBetween(i.judgmentDate, i.paymentDate) > 366 * 60)
    return "The period is longer than 60 years.";
  return null;
}

/** The District of Utah's rate page: releases count as issued at the close of business on the release date. */
export const UTD_RATE_PAGE = "https://www.utd.uscourts.gov/post-judgement-interest-rates";

export function computePji(
  i: PjiInput,
  rate: SourceObservation,
  previous: SourceObservation | null = null,
): PjiResult {
  const problem = pjiInputProblem(i);
  if (problem) throw new Error(problem);
  const pct = Number(rate.value);
  if (!Number.isFinite(pct) || pct < 0)
    throw new Error("The published rate is not a usable number.");
  const r = pct / 100;
  const periods: PjiPeriod[] = [];
  let balance = i.principal;
  let from = i.judgmentDate;
  for (let n = 1; from < i.paymentDate; n++) {
    const anniv = anniversary(i.judgmentDate, n);
    const to = anniv < i.paymentDate ? anniv : i.paymentDate;
    const yearDays = daysBetween(anniversary(i.judgmentDate, n - 1), anniv);
    const basisDays = i.dayBasis === "365" ? 365 : yearDays;
    const days = daysBetween(from, to);
    const interest = (balance * r * days) / basisDays;
    const compounded = to === anniv;
    periods.push({
      from,
      to,
      days,
      basisDays,
      opening: balance,
      interest,
      closing: compounded ? balance + interest : balance,
      compounded,
    });
    if (compounded) balance += interest;
    from = to;
  }
  const interest = periods.reduce((a, p) => a + p.interest, 0);
  const firstBasis =
    i.dayBasis === "365" ? 365 : daysBetween(i.judgmentDate, anniversary(i.judgmentDate, 1));
  const week = rateWeekFor(i.judgmentDate);
  const notes: string[] = [];
  if (rate.firstVintage !== undefined)
    notes.push(
      `The Federal Reserve revised this week's average after first publication: first published ${rate.firstValue ?? "with no value"} (${rate.firstVintage}), now ${rate.value}. The calculation uses the current value; check which figure the court applied.`,
    );
  if (i.judgmentDate <= rate.vintage)
    notes.push(
      `Courts differ for a judgment entered on or before the day this week's average was released (${rate.vintage}): the District of Utah treats a release as issued at the close of business and applies the previous week's rate${previous ? ` (week ending ${previous.date}: ${previous.value}%)` : ""} (${UTD_RATE_PAGE}); other districts' tables apply this week's rate from Monday. Check your court's practice.`,
    );
  if (i.judgmentDate.slice(5) === "02-29")
    notes.push(
      "Judgment entered on February 29: in years without that date the anniversary is taken as February 28.",
    );
  return {
    inputs: { ...i },
    week,
    rate,
    ratePercent: pct,
    periods,
    days: daysBetween(i.judgmentDate, i.paymentDate),
    interest,
    total: i.principal + interest,
    perDiem: (i.principal * r) / firstBasis,
    method: [
      {
        label: "Rate",
        detail: `Weekly average 1-year constant maturity Treasury yield for the week ending ${week.weekEnding} (Federal Reserve H.15, FRED ${rate.seriesId}): ${rate.value}%. The courts' published tables apply it to judgments entered ${week.effectiveFrom} to ${week.effectiveTo}.`,
      },
      {
        label: "Daily accrual",
        detail: `Interest runs from the date of entry (${i.judgmentDate}) to the day before payment (${i.paymentDate}): ${daysBetween(i.judgmentDate, i.paymentDate)} days, each at ${pct}% ÷ ${i.dayBasis === "365" ? "365" : "the days of that judgment year (365 or 366)"} of the balance.`,
      },
      {
        label: "Annual compounding",
        detail:
          "At each anniversary of the judgment the year's interest is added to the balance; the next year's interest accrues on the new balance (§ 1961(b)).",
      },
      {
        label: "Rounding",
        detail: "Amounts are carried unrounded; figures are rounded to cents for display only.",
      },
    ],
    notes,
  };
}

export const roundCents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
