/**
 * Pure model of the same-court comparison on /judges/analytics: the court median of each docket-flow measure and the
 * BenchMatrix groups. Every row has lead "none" (context, never a ranking), columns stay in surname order, and a median
 * needs at least MEDIAN_MIN_N recorded values or it is not recorded.
 *
 * Only the court's own judges are columns and enter the median; judges the report marks as sitting by designation
 * (VJ, CIR, CIT, FCR) are kept apart. Civil cases over three years and the product share are not compared here: the
 * first is driven by MDL member cases that districts report differently, the second sits on bases that cover very
 * different parts of each judge's caseload. Both stay in the data table.
 */
import type { BenchColumn, BenchGroup } from "@/components/charts/editorial";
import type { BenchJudge, CourtBench } from "@/lib/external/judgeCjra.functions";

export const MEDIAN_MIN_N = 3;

/** Median of the recorded values; null below `minN` values. */
export function benchMedian(
  values: readonly (number | null)[],
  minN = MEDIAN_MIN_N,
): number | null {
  const v = values
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    .sort((a, b) => a - b);
  if (v.length < minN) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export type BenchMeasure = {
  key: "motions6m" | "medianDaysCivil";
  label: string;
  note: string;
  format: (v: number) => string;
};

const int = (v: number) => Math.round(v).toLocaleString("en-US");

export function benchMeasures(period: string | null): BenchMeasure[] {
  return [
    {
      key: "motions6m",
      label: "Motions pending > 6 months",
      note: `CJRA report${period ? ` of ${period}` : ""}`,
      format: int,
    },
    {
      key: "medianDaysCivil",
      label: "Median days to termination, civil",
      note: "case-law collection, not complete caseload",
      format: int,
    },
  ];
}

/** The court's own judges (columns, median) and the judges sitting there by designation (listed apart). */
export function splitBench(bench: CourtBench): { own: BenchJudge[]; visiting: BenchJudge[] } {
  return {
    own: bench.judges.filter((j) => j.visiting === null),
    visiting: bench.judges.filter((j) => j.visiting !== null),
  };
}

export type BenchModel = {
  columns: BenchColumn[];
  groups: BenchGroup[];
  medians: Record<BenchMeasure["key"], { value: number | null; n: number }>;
  /** Judges of the court in the comparison. */
  own: number;
  /** Judges sitting by designation, left out of the comparison. */
  visiting: number;
};

/** null when the court has no judge of its own in the report. */
export function benchModel(bench: CourtBench, period: string | null): BenchModel | null {
  const { own, visiting } = splitBench(bench);
  if (!own.length) return null;
  const measures = benchMeasures(period);
  const medians = {} as BenchModel["medians"];
  for (const m of measures) {
    const vals = own.map((j) => j[m.key]);
    medians[m.key] = {
      value: benchMedian(vals),
      n: vals.filter((v) => v !== null).length,
    };
  }
  const columns: BenchColumn[] = [
    { id: "median", label: "Court median", sub: `of ${own.length} judges of the court` },
    ...own.map((j: BenchJudge) => ({ id: j.recordId, label: j.name })),
  ];
  const row = (m: BenchMeasure) => ({
    label: m.label,
    note: `${m.note} · median of ${medians[m.key].n} with a value (shown from ${MEDIAN_MIN_N})`,
    values: [medians[m.key].value, ...own.map((j) => j[m.key])],
    format: m.format,
    lead: "none" as const,
  });
  return {
    columns,
    medians,
    own: own.length,
    visiting: visiting.length,
    groups: [
      { label: "Docket flow (CJRA)", rows: [row(measures[0]!)] },
      { label: "Case-law collection", rows: [row(measures[1]!)] },
    ],
  };
}
