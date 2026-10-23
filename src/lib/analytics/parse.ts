/**
 * Validators for the stored JSON the Analytics overview reads. Pure and client-safe so they can be tested without a
 * database. A row or value that does not match the expected shape is dropped, never repaired or guessed; callers get
 * the rows that did parse, and the builders show a missing period as "Not recorded".
 */
import type { BillsCongress } from "./blocks/rulemaking";
import type {
  FiscalYearFlow,
  MdlFiscalYear,
  MdlMonthlyReport,
  NominationCongress,
  SecuritiesYear,
  VacancyMonthInput,
} from "./blocks/courts";
import type { EpaYear, FtcYear, SecYear } from "./blocks/enforcement";
import type { FsisYear } from "./blocks/safety";
import type { SentinelYear } from "./blocks/consumer";

export const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export const nonNegative = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
};
export const integer = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
export const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const year = (v: unknown): number | null => {
  const n = integer(v);
  return n !== null && n >= 1700 && n <= 2200 ? n : null;
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isoDate = (v: unknown): string | null => {
  const s = text(v);
  return s && ISO_DATE.test(s) ? s : null;
};

/** FJC criminal national series: one entry per fiscal year (defendants filed, terminated). */
export function parseCriminalSeries(raw: unknown): FiscalYearFlow[] {
  const seen = new Set<number>();
  const out: FiscalYearFlow[] = [];
  for (const entry of arr(raw)) {
    const r = obj(entry);
    const fy = year(r?.["fy"]);
    if (!r || fy === null || seen.has(fy)) continue;
    seen.add(fy);
    out.push({
      fy,
      partial: r["partial"] === true,
      filed: nonNegative(r["filed"]),
      terminated: nonNegative(r["terminated"]),
    });
  }
  return out.sort((a, b) => a.fy - b.fy);
}

/** JPML fiscal-year series (jpml_statistics_extra overview). */
export function parseMdlYears(raw: unknown): MdlFiscalYear[] {
  const seen = new Set<number>();
  const out: MdlFiscalYear[] = [];
  for (const entry of arr(raw)) {
    const r = obj(entry);
    const fy = year(r?.["fy"]);
    if (!r || fy === null || seen.has(fy)) continue;
    seen.add(fy);
    out.push({ fy, pending: nonNegative(r["pending"]), periodMonths: integer(r["period_months"]) });
  }
  return out.sort((a, b) => a.fy - b.fy);
}

/** JPML monthly pending-MDL reports (mdl_analytics overview portfolio). */
export function parseMdlMonthly(raw: unknown): MdlMonthlyReport[] {
  return arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const date = isoDate(r?.["date"]);
    const pending = nonNegative(r?.["pending"]);
    const mdls = nonNegative(r?.["mdls"]);
    return date && pending !== null && mdls !== null ? [{ date, pending, mdls }] : [];
  });
}

/** Stanford SCAC year records (cells of `year:<YYYY>` rows). */
export function parseSecuritiesYears(rows: readonly unknown[]): SecuritiesYear[] {
  const seen = new Set<number>();
  const out: SecuritiesYear[] = [];
  for (const row of rows) {
    const c = obj(row);
    const y = year(c?.["year"]);
    if (!c || c["kind"] !== "year" || y === null || seen.has(y)) continue;
    seen.add(y);
    out.push({ year: y, filings: nonNegative(c["filings"]), partial: c["partial"] === true });
  }
  return out.sort((a, b) => a.year - b.year);
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Monthly vacancy lists. A month's count is kept only when the report was read in full (`reports.vacancies` is
 * "parsed"); a partly read or unread list is "Not recorded", never a smaller number.
 */
export function parseVacancyMonths(raw: unknown): VacancyMonthInput[] {
  const seen = new Set<string>();
  const out: VacancyMonthInput[] = [];
  for (const entry of arr(raw)) {
    const r = obj(entry);
    const month = text(r?.["month"]);
    if (!r || !month || !MONTH.test(month) || seen.has(month)) continue;
    seen.add(month);
    const parsed = obj(r["reports"])?.["vacancies"] === "parsed";
    out.push({ month, vacanciesListed: parsed ? nonNegative(r["vacancies_listed"]) : null });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** Tally nomination rows (`congress`, `status` from each record's filters) into per-Congress counts. */
export function tallyNominations(rows: readonly unknown[]): NominationCongress[] {
  const by = new Map<number, NominationCongress>();
  for (const row of rows) {
    const r = obj(row);
    const congress = integer(Number(text(r?.["c"])));
    if (!r || congress === null || congress < 1 || congress > 400) continue;
    const entry = by.get(congress) ?? { congress, received: 0, confirmed: 0 };
    entry.received += 1;
    if (text(r["s"]) === "confirmed") entry.confirmed += 1;
    by.set(congress, entry);
  }
  return [...by.values()].sort((a, b) => a.congress - b.congress);
}

/** SEC rows (`y` = year, `t` = release type from each record's filters) into per-year counts. */
export function tallySec(rows: readonly unknown[]): SecYear[] {
  const by = new Map<number, SecYear>();
  for (const row of rows) {
    const r = obj(row);
    const y = year(Number(text(r?.["y"])));
    const type = text(r?.["t"]);
    if (!r || y === null || (type !== "litigation_release" && type !== "administrative_proceeding"))
      continue;
    const entry = by.get(y) ?? { year: y, litigation: 0, administrative: 0 };
    if (type === "litigation_release") entry.litigation += 1;
    else entry.administrative += 1;
    by.set(y, entry);
  }
  return [...by.values()].sort((a, b) => a.year - b.year);
}

/** FTC action rows (`y` = year, `k` = data-file kind); rows with no year are counted apart. */
export function tallyFtc(
  rows: readonly unknown[],
  kinds: readonly string[],
): { years: FtcYear[]; undated: number } {
  const by = new Map<number, FtcYear>();
  let undated = 0;
  for (const row of rows) {
    const r = obj(row);
    const kind = text(r?.["k"]);
    if (!r || !kind || !kinds.includes(kind)) continue;
    const y = year(Number(text(r["y"])));
    if (y === null) {
      undated += 1;
      continue;
    }
    const entry = by.get(y) ?? { year: y, counts: {} };
    entry.counts[kind] = (entry.counts[kind] ?? 0) + 1;
    by.set(y, entry);
  }
  return { years: [...by.values()].sort((a, b) => a.year - b.year), undated };
}

/** Rows carrying a year string (`y`) into per-year counts. */
export function tallyYears(rows: readonly unknown[]): { year: number; count: number }[] {
  const by = new Map<number, number>();
  for (const row of rows) {
    const y = year(Number(text(obj(row)?.["y"])));
    if (y !== null) by.set(y, (by.get(y) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([y, count]) => ({ year: y, count }))
    .sort((a, b) => a.year - b.year);
}

/** EPA ECHO series rows (`cells` of `epa-echo-series:US:<fy>` records); the all-years row has a non-numeric fy. */
export function parseEpaYears(rows: readonly unknown[]): EpaYear[] {
  const seen = new Set<number>();
  const out: EpaYear[] = [];
  for (const row of rows) {
    const c = obj(row);
    const fy = year(c?.["fy"]);
    if (!c || fy === null || seen.has(fy)) continue;
    seen.add(fy);
    out.push({ fy, opened: nonNegative(c["opened"]), judicial: nonNegative(c["judicial"]) });
  }
  return out.sort((a, b) => a.fy - b.fy);
}

/** FSIS recalls by year: `{ "2014": { I: 65, II: 23, III: 8, PHA: 2 }, ... }`. */
export function parseFsisByYear(raw: unknown): FsisYear[] {
  const o = obj(raw);
  if (!o) return [];
  const out: FsisYear[] = [];
  for (const [key, value] of Object.entries(o)) {
    const y = /^\d{4}$/.test(key) ? Number(key) : null;
    const classes = obj(value);
    if (y === null || !classes) continue;
    const n = (k: string) => nonNegative(classes[k]) ?? 0;
    out.push({ year: y, recalls: n("I") + n("II") + n("III"), alerts: n("PHA") });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** Sentinel national rows (`US-<year>`): printed report counts and the data book's URL. */
export function parseSentinelYears(rows: readonly unknown[]): SentinelYear[] {
  const seen = new Set<number>();
  const out: SentinelYear[] = [];
  for (const row of rows) {
    const r = obj(row);
    const id = text(r?.["id"]);
    const m = id ? /^US-(\d{4})$/.exec(id) : null;
    if (!r || !m) continue;
    const y = Number(m[1]);
    if (seen.has(y)) continue;
    seen.add(y);
    const reports = obj(r["reports"]);
    const url = text(r["source_url"]);
    out.push({
      year: y,
      total: nonNegative(reports?.["total"]),
      fraud: nonNegative(reports?.["fraud"]),
      sourceUrl: url && /^https?:\/\//.test(url) ? url : null,
    });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** Federal Register yearly facet: `{ RULE: { "1995": n }, PRORULE: {...} }` into a plain year-to-count record. */
export function parseTypeYears(raw: unknown): Record<string, number> {
  const o = obj(raw);
  const out: Record<string, number> = {};
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) {
    const n = nonNegative(v);
    if (/^\d{4}$/.test(k) && n !== null) out[k] = n;
  }
  return out;
}

/** The measures that go to the President, per Congress, from `per_congress_type` ("118-hr": 10564). */
export function introducedByCongress(raw: unknown): Map<number, number> {
  const o = obj(raw);
  const out = new Map<number, number>();
  if (!o) return out;
  for (const [key, value] of Object.entries(o)) {
    const m = /^(\d{1,3})-(hr|s|hjres|sjres)$/.exec(key);
    const n = nonNegative(value);
    if (!m || n === null) continue;
    const congress = Number(m[1]);
    out.set(congress, (out.get(congress) ?? 0) + n);
  }
  return out;
}

export function billsFromParts(
  introduced: ReadonlyMap<number, number>,
  becameLaw: ReadonlyMap<number, number>,
): BillsCongress[] {
  return [...introduced.keys()]
    .sort((a, b) => a - b)
    .map((congress) => ({
      congress,
      introduced: introduced.get(congress) ?? null,
      becameLaw: becameLaw.has(congress) ? becameLaw.get(congress)! : null,
    }));
}
