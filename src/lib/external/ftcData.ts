/**
 * Validators and small pure helpers for the FTC open-data datasets (ftc_dnc_reported_calls, ftc_hsr_early_terminations,
 * ftc_hsr_filings, ftc_publications_index). Client-safe: no I/O. Every function takes rows already read from the corpus and
 * returns only what parses; a value that does not parse is null ("Not recorded"), never repaired, and a row that cannot be
 * identified is dropped.
 */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Only https links on the FTC's own site are kept from stored records. */
export const ftcUrl = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https:\/\/www\.ftc\.gov\//.test(s) ? s : null;
};

export const NOT_RECORDED = "Not recorded";

// ------------------------------------------------------------------------------------------------ Do Not Call

export type SubjectCount = { subject: string; calls: number };

export type DncMonth = {
  month: string;
  /** Every calendar day of the month has a source (the FTC's daily files or the API). */
  complete: boolean;
  /** `records`: every record counted; `count`: the number of records the API lists was counted, nothing else read. */
  method: "records" | "count";
  calls: number | null;
  robocalls: number | null;
  notRobocalls: number | null;
  noFlag: number | null;
  /** robocalls / (robocalls + notRobocalls) * 100, derived by the build. */
  robocallSharePct: number | null;
  firstDay: string | null;
  lastDay: string | null;
  daysCovered: number | null;
  daysInMonth: number | null;
  subjects: SubjectCount[];
  sourceUrl: string | null;
};

export function parseSubjects(raw: unknown): SubjectCount[] {
  const o = obj(raw);
  if (!o) return [];
  return Object.entries(o)
    .flatMap(([subject, calls]) => {
      const n = int(calls);
      return n !== null && n >= 0 && subject.trim() ? [{ subject, calls: n }] : [];
    })
    .sort((a, b) => b.calls - a.calls || a.subject.localeCompare(b.subject));
}

export function parseDncMonths(rows: unknown[]): DncMonth[] {
  const out = new Map<string, DncMonth>();
  for (const raw of rows) {
    const r = obj(raw);
    const id = str(r?.["id"]);
    const month = str(r?.["month"]);
    if (!r || !id || !month || id !== `US-${month}` || !MONTH.test(month) || out.has(month)) continue;
    const metrics = obj(r["m"]);
    const calls = int(metrics?.["calls"]);
    if (calls === null || calls < 0) continue;
    const method = r["method"] === "count" ? "count" : r["method"] === "records" ? "records" : null;
    const complete = bool(r["complete"]);
    if (!method || complete === null) continue;
    const first = str(r["first"]);
    const last = str(r["last"]);
    const share = num(obj(r["a"])?.["robocall_share_pct"]);
    out.set(month, {
      month,
      complete,
      method,
      calls,
      robocalls: int(metrics?.["robocalls"]),
      notRobocalls: int(metrics?.["not_robocalls"]),
      noFlag: int(metrics?.["no_flag"]),
      robocallSharePct: share !== null && share >= 0 && share <= 100 ? share : null,
      firstDay: first && DAY.test(first) ? first : null,
      lastDay: last && DAY.test(last) ? last : null,
      daysCovered: int(r["days"]),
      daysInMonth: int(r["dim"]),
      subjects: parseSubjects(r["subj"]),
      sourceUrl: ftcUrl(r["source_url"]),
    });
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export type OfficialMonth = {
  month: string;
  total: number;
  robocall: number;
  live: number;
  sourceUrl: string | null;
};

/** Months of the FTC dashboard's monthly comparison; kept only when the two call types add up to the printed total. */
export function parseOfficialMonths(rows: unknown[]): OfficialMonth[] {
  const out = new Map<string, OfficialMonth>();
  for (const raw of rows) {
    const r = obj(raw);
    const id = str(r?.["id"]);
    const month = str(r?.["month"]);
    const m = obj(r?.["m"]);
    if (!r || !id || !month || id !== `official-${month}` || !MONTH.test(month) || !m || out.has(month)) continue;
    const total = int(m["calls"]);
    const robocall = int(m["robocalls"]);
    const live = int(m["live_callers"]);
    if (total === null || robocall === null || live === null || robocall + live !== total) continue;
    out.set(month, { month, total, robocall, live, sourceUrl: str(r["source_url"]) });
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export type StateCallsMonth = {
  month: string;
  complete: boolean;
  calls: number;
  robocalls: number | null;
  robocallSharePct: number | null;
  per100k: number | null;
  rankPer100k: number | null;
  rankedOf: number | null;
  population: number | null;
  populationYear: number | null;
  firstDay: string | null;
  lastDay: string | null;
  subjects: SubjectCount[];
  sourceUrl: string | null;
};

export function parseStateCallsMonths(rows: unknown[], usps: string): StateCallsMonth[] {
  const out = new Map<string, StateCallsMonth>();
  for (const raw of rows) {
    const r = obj(raw);
    const id = str(r?.["id"]);
    const m = /^([A-Z]{2})-(\d{4}-\d{2})$/.exec(id ?? "");
    if (!r || !m || m[1] !== usps || !MONTH.test(m[2]!) || out.has(m[2]!)) continue;
    const metrics = obj(r["m"]);
    const a = obj(r["a"]);
    const calls = int(metrics?.["calls"]);
    const complete = bool(r["complete"]);
    if (calls === null || calls < 0 || complete === null) continue;
    const share = num(a?.["robocall_share_pct"]);
    const per100k = num(a?.["per100k"]);
    const rank = int(a?.["rank_per100k"]);
    const first = str(r["first"]);
    const last = str(r["last"]);
    out.set(m[2]!, {
      month: m[2]!,
      complete,
      calls,
      robocalls: int(metrics?.["robocalls"]),
      robocallSharePct: share !== null && share >= 0 && share <= 100 ? share : null,
      per100k: per100k !== null && per100k >= 0 ? per100k : null,
      rankPer100k: rank !== null && rank >= 1 ? rank : null,
      rankedOf: int(a?.["ranked_of"]),
      population: int(metrics?.["population"]),
      populationYear: int(metrics?.["population_year"]),
      firstDay: first && DAY.test(first) ? first : null,
      lastDay: last && DAY.test(last) ? last : null,
      subjects: parseSubjects(r["subj"]),
      sourceUrl: ftcUrl(r["source_url"]),
    });
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** The FTC's own catch-all buckets; left out when a "top subject" is named. */
export const CATCH_ALL_SUBJECTS = ["Other", "No Subject Provided"] as const;

export type SubjectShare = { subject: string; calls: number; sharePct: number };

/**
 * Subjects summed over the given months, each with its share of all calls counted in those months (catch-all buckets
 * included in the base and listed on their own line, not ranked among the named subjects).
 */
export function subjectShares(months: readonly { subjects: SubjectCount[] }[]): {
  total: number;
  named: SubjectShare[];
  catchAll: SubjectShare[];
} {
  const sums = new Map<string, number>();
  for (const m of months) for (const s of m.subjects) sums.set(s.subject, (sums.get(s.subject) ?? 0) + s.calls);
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  const rows = [...sums.entries()]
    .map(([subject, calls]) => ({
      subject,
      calls,
      sharePct: total ? Math.round((calls / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.subject.localeCompare(b.subject));
  const isCatchAll = (s: string) => (CATCH_ALL_SUBJECTS as readonly string[]).includes(s);
  return {
    total,
    named: rows.filter((r) => !isCatchAll(r.subject)),
    catchAll: rows.filter((r) => isCatchAll(r.subject)),
  };
}

// ------------------------------------------------------------------------------------------------ HSR

export type HsrYearCount = { year: number; count: number };

export type HsrSeries = {
  calendar: HsrYearCount[];
  /** Notices by federal fiscal year (October to September), labelled by the year it ends. */
  fiscal: HsrYearCount[];
  undated: number;
  notices: number;
  firstDate: string | null;
  lastDate: string | null;
};

function yearCounts(raw: unknown): HsrYearCount[] {
  const o = obj(raw);
  if (!o) return [];
  return Object.entries(o)
    .flatMap(([y, n]) => {
      const year = /^\d{4}$/.test(y) ? Number(y) : null;
      const count = int(n);
      return year !== null && count !== null && count >= 0 ? [{ year, count }] : [];
    })
    .sort((a, b) => a.year - b.year);
}

/** The `series-by-year` row of ftc_hsr_early_terminations. */
export function parseHsrSeries(row: unknown): HsrSeries | null {
  const r = obj(row);
  const s = obj(r?.["s"]);
  if (!r || !s) return null;
  const calendar = yearCounts(s["calendar_year"]);
  if (!calendar.length) return null;
  const cells = obj(r["cells"]);
  const period = str(cells?.["period"]);
  const m = period ? /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(period) : null;
  return {
    calendar,
    fiscal: yearCounts(s["fiscal_year"]),
    undated: int(s["undated"]) ?? 0,
    notices: int(s["notices"]) ?? calendar.reduce((a, c) => a + c.count, 0),
    firstDate: m?.[1] ?? null,
    lastDate: m?.[2] ?? null,
  };
}

export type HsrFiscalYear = {
  fy: number;
  partial: boolean;
  transactions: number | null;
  filings: number | null;
  secondRequests: number | null;
  etRequested: number | null;
  etGranted: number | null;
  etNotGranted: number | null;
};

export function parseHsrFiscalYears(rows: unknown[]): HsrFiscalYear[] {
  const out = new Map<number, HsrFiscalYear>();
  for (const raw of rows) {
    const r = obj(raw);
    const id = str(r?.["id"]);
    const m = /^fy-(\d{4})$/.exec(id ?? "");
    const metrics = obj(r?.["m"]);
    if (!r || !m || !metrics) continue;
    const fy = Number(m[1]);
    if (out.has(fy)) continue;
    out.set(fy, {
      fy,
      partial: r["partial"] === true,
      transactions: int(metrics["transactions_reported"]),
      filings: int(metrics["filings_received"]),
      secondRequests: int(metrics["second_requests_total"]),
      etRequested: int(metrics["et_requested"]),
      etGranted: int(metrics["et_granted"]),
      etNotGranted: int(metrics["et_not_granted"]),
    });
  }
  return [...out.values()].sort((a, b) => a.fy - b.fy);
}

// ------------------------------------------------------------------------------------------------ Data Spotlight

export type SpotlightPost = {
  id: string;
  title: string;
  /** The date as the FTC page shows it ("April 27, 2026"). */
  published: string | null;
  publishedIso: string | null;
  summary: string | null;
  url: string | null;
  fileUrl: string | null;
};

export function parseSpotlight(rows: unknown[]): SpotlightPost[] {
  const out: SpotlightPost[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const r = obj(raw);
    const id = str(r?.["id"]);
    const title = str(r?.["title"]);
    if (!r || !id || !title || seen.has(id)) continue;
    seen.add(id);
    const iso = str(r["iso"]);
    const file = obj(arr(r["files"])[0]);
    out.push({
      id,
      title,
      published: str(r["published"]),
      publishedIso: iso && DAY.test(iso) ? iso : null,
      summary: str(r["summary"]),
      url: ftcUrl(r["url"]),
      fileUrl: ftcUrl(file?.["url"]),
    });
  }
  return out.sort((a, b) => (b.publishedIso ?? "").localeCompare(a.publishedIso ?? ""));
}

// ------------------------------------------------------------------------------------------------ labels

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "September 2026" for "2026-09"; the input itself when it is not a month key. */
export function monthName(key: string): string {
  const m = MONTH.exec(key);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : key;
}

/** "September 16, 2026" for an ISO day; the input itself when it is not one. */
export function dayName(iso: string): string {
  if (!DAY.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

/** "September 16 to October 20, 2026" (or "... December 30, 2025 to January 3, 2026" across years). */
export function dayRange(first: string, last: string): string {
  if (first === last) return dayName(first);
  const a = dayName(first);
  const b = dayName(last);
  if (first.slice(0, 4) === last.slice(0, 4)) return `${a.replace(/, \d{4}$/, "")} to ${b}`;
  return `${a} to ${b}`;
}
