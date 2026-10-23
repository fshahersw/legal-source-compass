/**
 * Inflation adjustment between two months with a published price index (default CPI-U, all items, U.S. city average,
 * not seasonally adjusted: FRED CPIAUCNS, BLS series CUUR0000SA0). Pure.
 *
 * Method: amount × (index in the target month ÷ index in the base month), the ratio the BLS CPI Inflation Calculator
 * uses (https://www.bls.gov/data/inflation_calculator.htm). Both index values are shown as published; a month without a
 * published value (BLS did not publish October 2025, a lapse in appropriations) is "Not recorded" — no neighbouring
 * month or interpolation is substituted.
 */
import { isMonthKey, monthLabel, monthStart } from "./dates";
import type { MethodStep, SeriesObservations, SourceObservation } from "./types";

/** Index series offered (all monthly, BLS via FRED). */
export const INFLATION_SERIES: readonly { id: string; label: string; bls: string; note: string }[] =
  [
    {
      id: "CPIAUCNS",
      label: "CPI-U, all items, U.S. city average (not seasonally adjusted)",
      bls: "CUUR0000SA0",
      note: "The index BLS's own inflation calculator uses; BLS does not revise it after publication except to correct errors.",
    },
    {
      id: "CPIMEDNS",
      label: "CPI-U, medical care (not seasonally adjusted)",
      bls: "CUUR0000SAM",
      note: "Medical care component of the CPI-U.",
    },
    {
      id: "CUUR0000SAM2",
      label: "CPI-U, medical care services (not seasonally adjusted)",
      bls: "CUUR0000SAM2",
      note: "Medical care services component of the CPI-U.",
    },
    {
      id: "CWUR0000SA0",
      label: "CPI-W, all items (not seasonally adjusted)",
      bls: "CWUR0000SA0",
      note: "CPI for urban wage earners and clerical workers.",
    },
    {
      id: "CPIAUCSL",
      label: "CPI-U, all items (seasonally adjusted)",
      bls: "CUSR0000SA0",
      note: "Seasonally adjusted values are revised each February for the previous five years; BLS recommends unadjusted data for escalation.",
    },
  ];

export type InflationInput = {
  amount: number;
  fromMonth: string;
  toMonth: string;
  seriesId: string;
};

export type InflationResult =
  | {
      ok: true;
      inputs: InflationInput;
      from: SourceObservation;
      to: SourceObservation;
      factor: number;
      adjusted: number;
      changePercent: number;
      method: MethodStep[];
      notes: string[];
    }
  | { ok: false; inputs: InflationInput; reason: string; missing: string[] };

export function inflationInputProblem(i: InflationInput): string | null {
  if (!Number.isFinite(i.amount) || i.amount <= 0) return "Enter an amount greater than zero.";
  if (i.amount > 1e13) return "The amount is larger than this calculator handles.";
  if (!isMonthKey(i.fromMonth) || !isMonthKey(i.toMonth)) return "Choose both months.";
  if (!INFLATION_SERIES.some((s) => s.id === i.seriesId)) return "Choose an index.";
  return null;
}

export function observationFor(
  series: SeriesObservations,
  month: string,
): SourceObservation | null {
  const o = series.obs.find((x) => x.date === monthStart(month));
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

export function computeInflation(
  i: InflationInput,
  fromSeries: SeriesObservations,
  toSeries: SeriesObservations,
): InflationResult {
  const problem = inflationInputProblem(i);
  if (problem) return { ok: false, inputs: i, reason: problem, missing: [] };
  const from = observationFor(fromSeries, i.fromMonth);
  const to = observationFor(toSeries, i.toMonth);
  const missing = [...(from ? [] : [i.fromMonth]), ...(to ? [] : [i.toMonth])];
  if (!from || !to)
    return {
      ok: false,
      inputs: i,
      missing,
      reason: `Not recorded: no published ${fromSeries.seriesId} value for ${missing.map(monthLabel).join(" or ")}. No other month is substituted.`,
    };
  const factor = Number(to.value) / Number(from.value);
  const notes: string[] = [];
  for (const o of [from, to])
    if (o.firstVintage !== undefined)
      notes.push(
        `${monthLabel(o.date.slice(0, 7))}: revised after first publication (first ${o.firstValue ?? "no value"} on ${o.firstVintage}, now ${o.value}). The current value is used.`,
      );
  return {
    ok: true,
    inputs: i,
    from,
    to,
    factor,
    adjusted: i.amount * factor,
    changePercent: (factor - 1) * 100,
    method: [
      { label: "Index", detail: `${from.label} (FRED ${from.seriesId}), ${from.units}.` },
      {
        label: "Ratio",
        detail: `${monthLabel(i.toMonth)} value ${to.value} ÷ ${monthLabel(i.fromMonth)} value ${from.value} = ${factor.toFixed(6)}.`,
      },
      { label: "Adjusted amount", detail: `Amount × ratio; rounded to cents for display only.` },
    ],
    notes,
  };
}
