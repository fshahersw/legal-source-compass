/**
 * Validators and tallies for the depth pages (Enforcement trends and Safety trends). Same rule as ./parse: a row or
 * value that does not match the expected shape is dropped, never repaired or guessed.
 */
import type { DojAmountYear, SaferProductsYear, SecAmountYear } from "./blocks/depth";
import { isoDate, nonNegative, obj, text, year } from "./parse";

/** The size bands a press release's stated resolution figure falls in, from the dataset's amount bucket ids. */
const BAND_KEYS = { tenM: "10m_plus", hundredM: "100m_plus", billion: "1b_plus" } as const;

/** DOJ index: releases per year by amount bucket (the overview's `by_year`, parsed). */
export function dojAmountYears(
  byYear: readonly { year: string; count: number; amount: Partial<Record<string, number>> }[],
): DojAmountYear[] {
  const out: DojAmountYear[] = [];
  for (const y of byYear) {
    const yr = year(Number(y.year));
    if (yr === null) continue;
    out.push({
      year: yr,
      total: y.count,
      bands: {
        tenM: y.amount[BAND_KEYS.tenM] ?? 0,
        hundredM: y.amount[BAND_KEYS.hundredM] ?? 0,
        billion: y.amount[BAND_KEYS.billion] ?? 0,
      },
    });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** SEC litigation releases per year and amount bucket (`y` year, `t` type, `a` amount bucket from each record's filters). */
export function tallySecAmounts(rows: readonly unknown[]): SecAmountYear[] {
  const by = new Map<number, SecAmountYear>();
  for (const row of rows) {
    const r = obj(row);
    const yr = year(Number(text(r?.["y"])));
    if (!r || yr === null || text(r["t"]) !== "litigation_release") continue;
    const entry = by.get(yr) ?? { year: yr, bands: { tenM: 0, hundredM: 0, billion: 0 } };
    const a = text(r["a"]);
    if (a === BAND_KEYS.tenM) entry.bands.tenM += 1;
    else if (a === BAND_KEYS.hundredM) entry.bands.hundredM += 1;
    else if (a === BAND_KEYS.billion) entry.bands.billion += 1;
    by.set(yr, entry);
  }
  return [...by.values()].sort((a, b) => a.year - b.year);
}

/** The `count` largest components whose name says "Division", in descending order of releases. */
export function divisionNames(
  components: readonly { name: string; count: number }[],
  count = 4,
): string[] {
  return [...components]
    .filter((c) => /\bDivision\b/.test(c.name))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, count)
    .map((c) => c.name);
}

/** EPA ECHO series rows (`cells`): federal penalty per fiscal year. */
export function parseEpaPenalties(
  rows: readonly unknown[],
): { fy: number; penalty: number | null }[] {
  const seen = new Set<number>();
  const out: { fy: number; penalty: number | null }[] = [];
  for (const row of rows) {
    const c = obj(row);
    const fy = year(c?.["fy"]);
    if (!c || fy === null || seen.has(fy)) continue;
    seen.add(fy);
    out.push({ fy, penalty: nonNegative(c["fed_penalty"]) });
  }
  return out.sort((a, b) => a.fy - b.fy);
}

/** SaferProducts.gov publication-year records (`safer` of `sp-pub-<year>`). */
export function parseSaferProductsYears(rows: readonly unknown[]): SaferProductsYear[] {
  const seen = new Set<number>();
  const out: SaferProductsYear[] = [];
  for (const row of rows) {
    const s = obj(row);
    const yr = year(s?.["year"]);
    const reports = nonNegative(s?.["reports"]);
    if (!s || s["kind"] !== "published" || yr === null || reports === null || seen.has(yr))
      continue;
    seen.add(yr);
    out.push({ year: yr, reports, partial: s["partial"] === true });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** First and last date of a window object `{ first, last }`. */
export function parseWindow(raw: unknown): { first: string | null; last: string | null } {
  const o = obj(raw);
  return { first: isoDate(o?.["first"]), last: isoDate(o?.["last"]) };
}
