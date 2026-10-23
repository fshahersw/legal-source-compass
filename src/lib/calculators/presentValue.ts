/**
 * Present value of a future stream of annual amounts, discounted at a published Treasury constant-maturity yield. Pure.
 *
 * Inputs: the annual amount in today's dollars, the number of years, an optional constant annual growth rate (the
 * user's assumption, shown as such), payment timing (end or start of each year), the Treasury maturity and the date (or
 * month) whose published yield is the discount rate, and how that yield is turned into an annual rate:
 *   - "annual": the published yield is used as an annual rate, r = y;
 *   - "semiannual": H.15 and FRED quote these yields "on an investment basis" (bond-equivalent; Treasury notes and bonds
 *     pay semiannual coupons and the official curve is a par yield curve), converted to an annual effective rate
 *     r = (1 + y/2)² − 1.
 * The calculator does not choose between the two; the result states which was used.
 * Payment k (k = 0 … n−1) is amount × (1 + g)^k and is discounted by (1 + r)^t with t = k + 1 (end of year) or t = k
 * (start of year). No other adjustment (taxes, mortality, personal consumption) is made.
 */
import type { MethodStep, SourceObservation } from "./types";

export type Timing = "end" | "start";
export type RateBasis = "annual" | "semiannual";

export type PvInput = {
  amount: number;
  years: number;
  growthPercent: number;
  timing: Timing;
  basis: RateBasis;
};

export type PvRow = { t: number; payment: number; factor: number; pv: number };

export type PvResult = {
  inputs: PvInput;
  rate: SourceObservation;
  yieldPercent: number;
  annualRate: number;
  rows: PvRow[];
  nominalTotal: number;
  presentValue: number;
  method: MethodStep[];
};

export function pvInputProblem(i: PvInput): string | null {
  if (!Number.isFinite(i.amount) || i.amount <= 0) return "Enter an annual amount greater than zero.";
  if (i.amount > 1e12) return "The amount is larger than this calculator handles.";
  if (!Number.isInteger(i.years) || i.years < 1 || i.years > 80) return "Enter a whole number of years from 1 to 80.";
  if (!Number.isFinite(i.growthPercent) || i.growthPercent < -50 || i.growthPercent > 50)
    return "Enter a growth rate between −50% and 50% (0 for none).";
  return null;
}

export const annualRateOf = (yieldPercent: number, basis: RateBasis) =>
  basis === "annual" ? yieldPercent / 100 : (1 + yieldPercent / 200) ** 2 - 1;

export function computePv(i: PvInput, rate: SourceObservation): PvResult {
  const problem = pvInputProblem(i);
  if (problem) throw new Error(problem);
  const y = Number(rate.value);
  if (!Number.isFinite(y)) throw new Error("The published yield is not a usable number.");
  const r = annualRateOf(y, i.basis);
  const g = i.growthPercent / 100;
  const rows: PvRow[] = [];
  for (let k = 0; k < i.years; k++) {
    const t = i.timing === "end" ? k + 1 : k;
    const payment = i.amount * (1 + g) ** k;
    const factor = 1 / (1 + r) ** t;
    rows.push({ t, payment, factor, pv: payment * factor });
  }
  return {
    inputs: { ...i },
    rate,
    yieldPercent: y,
    annualRate: r,
    rows,
    nominalTotal: rows.reduce((a, x) => a + x.payment, 0),
    presentValue: rows.reduce((a, x) => a + x.pv, 0),
    method: [
      {
        label: "Discount rate",
        detail: `${rate.label} (FRED ${rate.seriesId}) on ${rate.date}: ${rate.value}%. ${
          i.basis === "annual"
            ? "Used as an annual rate."
            : `Treated as a bond-equivalent (semiannual) yield and converted to an annual effective rate: (1 + ${y}/200)² − 1 = ${(r * 100).toFixed(4)}%.`
        }`,
      },
      {
        label: "Payments",
        detail: `${i.years} annual payments starting at ${i.amount.toFixed(2)}${i.growthPercent ? `, growing ${i.growthPercent}% a year (your assumption)` : ", level"}, paid at the ${i.timing === "end" ? "end" : "start"} of each year.`,
      },
      {
        label: "Present value",
        detail: `Each payment divided by (1 + r)^t, with t = ${i.timing === "end" ? "1 for the first payment" : "0 for the first payment"}; the sum is the present value. Rounded to cents for display only.`,
      },
    ],
  };
}
