/**
 * Civil clearance ratio: terminations per 100 filings in the same complete fiscal year. A flow comparison only; it is
 * not a measure of backlog change (pending is a stock). Pure and client-safe.
 */
export type ClearanceInput = {
  fy: number;
  filings: number | null;
  terminations: number | null;
  partial: boolean;
};
export type ClearanceRow = ClearanceInput & { rate: number | null };

const valid = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/**
 * Complete fiscal years only, with absent intervening years retained as gaps. A year printed twice is ambiguous and
 * kept as a gap; a year with zero (or no) filings has no ratio (never 0 or infinity).
 */
export function clearanceRows(input: readonly ClearanceInput[]): ClearanceRow[] {
  const complete = input.filter((r) => !r.partial && Number.isInteger(r.fy));
  if (!complete.length) return [];
  const years = complete.map((r) => r.fy);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const rows: ClearanceRow[] = [];
  for (let fy = first; fy <= last; fy++) {
    const matches = complete.filter((r) => r.fy === fy);
    const row = matches.length === 1 ? matches[0] : undefined;
    const filings = valid(row?.filings);
    const terminations = valid(row?.terminations);
    rows.push({
      fy,
      filings,
      terminations,
      partial: false,
      rate:
        filings !== null && filings > 0 && terminations !== null
          ? (terminations / filings) * 100
          : null,
    });
  }
  return rows;
}

export type ClearanceCallout = {
  fy: number;
  rate: number;
  /** Change in percentage points from the previous fiscal year, when that year has a ratio too. */
  changePts: number | null;
  /** Complete years in the window at or above 100%. */
  yearsAtOrAbove: number;
  yearsWithRate: number;
};

/**
 * The headline figure: the latest complete year that has a ratio (a trailing gap is skipped, never filled), its
 * change from the year before it (only when that exact year has a ratio) and how many years cleared at least 100%.
 */
export function clearanceCallout(rows: readonly ClearanceRow[]): ClearanceCallout | null {
  const rated = rows.filter(
    (r): r is ClearanceRow & { rate: number } => r.rate !== null && !r.partial,
  );
  const latest = rated.at(-1);
  if (!latest) return null;
  const prev = rows.find((r) => r.fy === latest.fy - 1);
  return {
    fy: latest.fy,
    rate: latest.rate,
    changePts: prev && prev.rate !== null && !prev.partial ? latest.rate - prev.rate : null,
    yearsAtOrAbove: rated.filter((r) => r.rate >= 100).length,
    yearsWithRate: rated.length,
  };
}
