/**
 * Pure model of the comparison matrix: which cell leads a row, and how a value is written. A row leads only when at
 * least two values are recorded (one value alone is not a comparison); ties all lead; a missing value never leads and
 * is never read as zero. Tested in editorial.test.ts.
 */
export type BenchColumn = {
  id: string;
  label: string;
  /** Second line under the label ("Seventh Circuit"). */
  sub?: string | undefined;
  /** The highlighted column (the entity the page is about). */
  hero?: boolean | undefined;
};

export type BenchRow = {
  label: string;
  /** One line under the row label: unit, table, period. */
  note?: string | undefined;
  /** One value per column; null means not recorded. */
  values: readonly (number | null | undefined)[];
  /** Writes a value (default: grouped digits). */
  format?: ((v: number) => string) | undefined;
  /** Which value leads the row: the highest, the lowest, or none (the row is context, not a ranking). */
  lead?: "highest" | "lowest" | "none" | undefined;
};

export type BenchGroup = { label: string; rows: readonly BenchRow[] };

const rec = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Column indices that lead a row, or none. */
export function leaderIndices(
  values: readonly (number | null | undefined)[],
  lead: "highest" | "lowest" | "none" = "highest",
): number[] {
  if (lead === "none") return [];
  const recorded = values
    .map((v, i) => ({ v, i }))
    .filter((o): o is { v: number; i: number } => rec(o.v));
  if (recorded.length < 2) return [];
  const best =
    lead === "highest"
      ? Math.max(...recorded.map((o) => o.v))
      : Math.min(...recorded.map((o) => o.v));
  return recorded.filter((o) => o.v === best).map((o) => o.i);
}

export const defaultBenchFormat = (v: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: 1 });
