/**
 * Citing filings per year for a USC or CFR section (pure): the citations layer reports [year, filings] pairs only for
 * years with a citing filing; the years between are real zeros (the layer lists every citing filing it holds).
 */
export type CitationYear = { year: string; filings: number };

export function citationYears(byYear: readonly (readonly [number, number])[]): CitationYear[] {
  const ok = byYear.filter(
    ([y, n]) => Number.isInteger(y) && y > 1900 && Number.isFinite(n) && n >= 0,
  );
  if (!ok.length) return [];
  const min = Math.min(...ok.map(([y]) => y));
  const max = Math.max(...ok.map(([y]) => y));
  const map = new Map(ok.map(([y, n]) => [y, n]));
  const out: CitationYear[] = [];
  for (let y = min; y <= max; y++) out.push({ year: String(y), filings: map.get(y) ?? 0 });
  return out;
}

/** Page size and page cap of the full citing-filings list (the cited-by read allows 50 per page). */
export const CITED_BY_PAGE = 50;
export const CITED_BY_MAX_PAGES = 20;

/** Honest description of the citing-filings list: all of them, or the newest `shown` of `total`. */
export function citingListLabel(shown: number, total: number, loading: boolean): string {
  const f = (v: number) => v.toLocaleString("en-US");
  if (shown >= total) return `All ${f(total)} citing filings, newest first.`;
  return `The newest ${f(shown)} of ${f(total)} citing filings${loading ? "; loading the rest" : ""}.`;
}
