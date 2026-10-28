export type ClearanceInput = { fy: number; filings: number | null; terminations: number | null; partial: boolean };
export type ClearanceRow = ClearanceInput & { rate: number | null };

/** Complete fiscal years only, with absent intervening years retained as gaps. */
export function clearanceRows(input: readonly ClearanceInput[]): ClearanceRow[] {
  const complete = input.filter((r) => !r.partial && Number.isInteger(r.fy));
  if (!complete.length) return [];
  const years = complete.map((r) => r.fy);
  const first = Math.min(...years), last = Math.max(...years);
  const rows: ClearanceRow[] = [];
  for (let fy = first; fy <= last; fy++) {
    const matches = complete.filter((r) => r.fy === fy);
    const row = matches.length === 1 ? matches[0] : undefined;
    const valid = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
    const filings = valid(row?.filings), terminations = valid(row?.terminations);
    rows.push({ fy, filings, terminations, partial: false,
      rate: filings !== null && filings > 0 && terminations !== null ? terminations / filings * 100 : null });
  }
  return rows;
}