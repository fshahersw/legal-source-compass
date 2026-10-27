/**
 * Federal enforcement tied to one district court: SEC enforcement releases whose recorded court is this district
 * (sec_enforcement_actions, court id from an exact court-name map) and Justice Department press releases that name
 * this court (doj_press_releases_YYYY filters.court). Pure. A DOJ release naming a court is not a filed case, and the
 * current calendar year is partial, so it is flagged and never compared as a full year.
 */

export type SecRow = { year: string | null; type: string | null; civilAction: boolean };

export type EnforcementYear = {
  year: string;
  sec: number | null;
  secLitigation: number | null;
  doj: number | null;
  partial: boolean;
};

const YEAR = /^(19|20)\d{2}$/;

/** A sec_enforcement_actions row read as {f: filters}. */
export function parseSecRow(raw: unknown): SecRow | null {
  const f = raw && typeof raw === "object" ? (raw as Record<string, unknown>)["f"] : null;
  if (!f || typeof f !== "object") return null;
  const o = f as Record<string, unknown>;
  const first = (k: string) => {
    const v = o[k];
    const x = Array.isArray(v) ? v[0] : v;
    return typeof x === "string" ? x : null;
  };
  const year = first("year");
  return {
    year: year && YEAR.test(year) ? year : null,
    type: first("type"),
    civilAction: first("has_civil_action") === "yes",
  };
}

/**
 * One row per calendar year from the earliest year either source records to `asOfYear`. A year a source does not
 * cover is null ("Not recorded"); a covered year with no release is 0.
 */
export function enforcementYears(
  sec: readonly SecRow[],
  doj: ReadonlyMap<string, number>,
  asOfYear: number,
  secYears: { first: number; last: number } | null,
): EnforcementYear[] {
  const secBy = new Map<string, { all: number; lit: number }>();
  for (const r of sec) {
    if (!r.year) continue;
    const c = secBy.get(r.year) ?? { all: 0, lit: 0 };
    c.all++;
    if (r.type === "litigation_release") c.lit++;
    secBy.set(r.year, c);
  }
  const years = [
    ...[...secBy.keys()].map(Number),
    ...[...doj.keys()].map(Number),
    ...(secYears ? [secYears.first] : []),
  ].filter((y) => Number.isInteger(y) && y <= asOfYear);
  if (!years.length) return [];
  const first = Math.min(...years);
  const out: EnforcementYear[] = [];
  for (let y = first; y <= asOfYear; y++) {
    const key = String(y);
    const s = secBy.get(key);
    const secCovered = secYears ? y >= secYears.first && y <= secYears.last : !!s;
    out.push({
      year: key,
      sec: secCovered ? (s?.all ?? 0) : null,
      secLitigation: secCovered ? (s?.lit ?? 0) : null,
      doj: doj.has(key) ? doj.get(key)! : null,
      partial: y === asOfYear,
    });
  }
  return out;
}

/** Sum of the last `n` complete years of a column; null when any of them is not recorded. */
export function lastCompleteYears(
  rows: readonly EnforcementYear[],
  key: "sec" | "doj" | "secLitigation",
  n: number,
): { total: number | null; from: string; to: string } | null {
  const complete = rows.filter((r) => !r.partial);
  const pick = complete.slice(-n);
  if (pick.length < n) return null;
  const vals = pick.map((r) => r[key]);
  return {
    total: vals.every((v): v is number => v !== null) ? vals.reduce((a, v) => a + v, 0) : null,
    from: pick[0]!.year,
    to: pick.at(-1)!.year,
  };
}
