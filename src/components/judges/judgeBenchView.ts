/**
 * Pure model of the same-court comparison on /judges/analytics: the court median of each docket-flow measure and the
 * BenchMatrix groups. Every row has lead "none" (context, never a ranking), columns stay in surname order, and a median
 * needs at least MEDIAN_MIN_N recorded values or it is not recorded.
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
  key: "motions6m" | "civil3y" | "medianDaysCivil" | "productShare";
  label: string;
  note: string;
  format: (v: number) => string;
};

const int = (v: number) => Math.round(v).toLocaleString("en-US");

export function benchMeasures(period: string | null): BenchMeasure[] {
  const cjra = `CJRA report${period ? ` of ${period}` : ""}`;
  return [
    { key: "motions6m", label: "Motions pending > 6 months", note: cjra, format: int },
    {
      key: "civil3y",
      label: "Civil cases pending > 3 years",
      note: `${cjra}; includes MDL member cases, reported differently by district`,
      format: int,
    },
    {
      key: "medianDaysCivil",
      label: "Median days to termination, civil",
      note: "CourtListener collection, not complete caseload",
      format: int,
    },
    {
      key: "productShare",
      label: "Product liability share of dockets",
      note: "% of dockets with a recorded nature of suit, CourtListener collection",
      format: (v) => `${v.toFixed(1)}%`,
    },
  ];
}

export type BenchModel = {
  columns: BenchColumn[];
  groups: BenchGroup[];
  medians: Record<BenchMeasure["key"], { value: number | null; n: number }>;
};

export function benchModel(bench: CourtBench, period: string | null): BenchModel {
  const measures = benchMeasures(period);
  const medians = {} as BenchModel["medians"];
  for (const m of measures) {
    const vals = bench.judges.map((j) => j[m.key]);
    medians[m.key] = {
      value: benchMedian(vals),
      n: vals.filter((v) => v !== null).length,
    };
  }
  const columns: BenchColumn[] = [
    { id: "median", label: "Court median", sub: `of ${bench.judges.length} judges listed` },
    ...bench.judges.map((j: BenchJudge) => ({ id: j.recordId, label: j.name })),
  ];
  const row = (m: BenchMeasure) => ({
    label: m.label,
    note: `${m.note} · median of ${medians[m.key].n} with a value (shown from ${MEDIAN_MIN_N})`,
    values: [medians[m.key].value, ...bench.judges.map((j) => j[m.key])],
    format: m.format,
    lead: "none" as const,
  });
  return {
    columns,
    medians,
    groups: [
      { label: "Docket flow (CJRA)", rows: measures.slice(0, 2).map(row) },
      { label: "Collection", rows: measures.slice(2).map(row) },
    ],
  };
}
