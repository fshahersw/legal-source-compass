/**
 * Shapes shared by the calculators. Every result carries its inputs, the source observations it used (series, date,
 * value as published, vintage, URL) and the method in words, so a reader can recompute it by hand. Pure types.
 */

/** One published value a calculation used. `value` is the text as published (e.g. "4.45"). */
export type SourceObservation = {
  seriesId: string;
  /** Plain label of the series, e.g. "1-year Treasury constant maturity, weekly average". */
  label: string;
  date: string;
  value: string;
  units: string;
  /** First day ALFRED shows this value (see econ_fred_observations). */
  vintage: string;
  /** The first value published for the date, when a later revision changed it. */
  firstValue?: string | null;
  firstVintage?: string;
  url: string;
};

/** Observations of one series as the server function returns them (stored tuples decoded). */
export type SeriesObservations = {
  seriesId: string;
  label: string;
  units: string;
  frequency: string;
  url: string;
  obs: {
    date: string;
    value: string | null;
    vintage: string;
    firstValue?: string | null;
    firstVintage?: string;
  }[];
};

/** A value the calculation could not use, with the reason shown in place of a number. */
export type NotRecorded = { notRecorded: string };

export type CalcError = { error: string };

export type MethodStep = { label: string; detail: string };
