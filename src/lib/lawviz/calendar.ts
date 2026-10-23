/**
 * Enforcement calendar model (pure, isomorphic). Parses `lawviz_calendar_v1` (database/contracts/lawviz-v1.sql) and
 * builds the day grid of one year per series. Coverage rule: inside a series' window (its first to last dated record)
 * a day without a record is 0; outside it the day is not recorded (null), never 0.
 */

export const AGENCIES = [
  { id: "all", label: "All agencies" },
  { id: "cpsc", label: "CPSC" },
  { id: "fda", label: "FDA" },
  { id: "sec", label: "SEC" },
  { id: "ftc", label: "FTC" },
  { id: "doj", label: "Justice Department" },
] as const;
export type AgencyId = (typeof AGENCIES)[number]["id"];
export const isAgency = (v: unknown): v is AgencyId =>
  typeof v === "string" && AGENCIES.some((a) => a.id === v);

export type Series = {
  id: string;
  label: string;
  unit: string;
  first: string | null;
  last: string | null;
  total: number;
  undated: number;
  sourceLabel: string;
  sourceUrl: string | null;
  datasets: string[];
};
export type CalendarData =
  | {
      status: "ok";
      agency: AgencyId;
      year: number;
      series: Series[];
      /** series -> "YYYY-MM-DD" -> count (only days with records) */
      days: Record<string, Record<string, number>>;
      /** series -> "YYYY-MM" -> count */
      months: Record<string, Record<string, number>>;
      builtAt: string | null;
      dropped: number;
    }
  | { status: "unavailable" | "empty" | "invalid"; builtAt: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const SERIES_ID = /^[a-z][a-z0-9_]{1,31}$/;
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 300) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const nat = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const httpsUrl = (v: unknown) => {
  const s = str(v, 400);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
};

export function parseCalendar(raw: unknown, builtAt: string | null = null): CalendarData {
  const r = obj(raw);
  if (!r) return { status: "unavailable", builtAt };
  if (r["status"] === "empty" || r["status"] === "invalid") return { status: r["status"], builtAt };
  if (r["status"] !== "ok" || !isAgency(r["agency"]) || typeof r["year"] !== "number")
    return { status: "unavailable", builtAt };
  let dropped = 0;
  const series: Series[] = [];
  for (const x of Array.isArray(r["series"]) ? (r["series"] as unknown[]) : []) {
    const a = Array.isArray(x) ? (x as unknown[]) : [];
    const id = typeof a[0] === "string" && SERIES_ID.test(a[0]) ? a[0] : null;
    const label = str(a[1], 200);
    if (!id || !label) {
      dropped++;
      continue;
    }
    const first = typeof a[3] === "string" && ISO.test(a[3]) ? a[3] : null;
    const last = typeof a[4] === "string" && ISO.test(a[4]) ? a[4] : null;
    series.push({
      id,
      label,
      unit: str(a[2], 40) ?? "records",
      first: first && last && first <= last ? first : null,
      last: first && last && first <= last ? last : null,
      total: nat(a[5]) ?? 0,
      undated: nat(a[6]) ?? 0,
      sourceLabel: str(a[7], 120) ?? "Source",
      sourceUrl: httpsUrl(a[8]),
      datasets: Array.isArray(a[9])
        ? (a[9] as unknown[]).filter(
            (d): d is string => typeof d === "string" && /^[a-z0-9_]{2,80}$/.test(d),
          )
        : [],
    });
  }
  const ids = new Set(series.map((s) => s.id));
  const days: Record<string, Record<string, number>> = {};
  for (const x of Array.isArray(r["days"]) ? (r["days"] as unknown[]) : []) {
    const a = Array.isArray(x) ? (x as unknown[]) : [];
    const n = nat(a[2]);
    if (
      typeof a[0] !== "string" ||
      !ids.has(a[0]) ||
      typeof a[1] !== "string" ||
      !ISO.test(a[1]) ||
      !n
    ) {
      dropped++;
      continue;
    }
    (days[a[0]] ??= {})[a[1]] = n;
  }
  const months: Record<string, Record<string, number>> = {};
  for (const x of Array.isArray(r["months"]) ? (r["months"] as unknown[]) : []) {
    const a = Array.isArray(x) ? (x as unknown[]) : [];
    const n = nat(a[2]);
    if (
      typeof a[0] !== "string" ||
      !ids.has(a[0]) ||
      typeof a[1] !== "string" ||
      !MONTH.test(a[1]) ||
      !n
    ) {
      dropped++;
      continue;
    }
    (months[a[0]] ??= {})[a[1]] = n;
  }
  return {
    status: "ok",
    agency: r["agency"],
    year: r["year"],
    series,
    days,
    months,
    builtAt,
    dropped,
  };
}

// ------------------------------------------------------------------------------------------------ day grid
export type DayCell = {
  date: string;
  /** Monday = 0 … Sunday = 6 */
  weekday: number;
  week: number;
  /** null = outside the series' coverage (not recorded) */
  value: number | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Every day of `year` in week columns (weeks start on Monday; week 0 holds January 1). */
export function yearGrid(
  year: number,
  series: Series,
  days: Record<string, number> | undefined,
): DayCell[] {
  const out: DayCell[] = [];
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const offset = (jan1.getUTCDay() + 6) % 7;
  for (let d = new Date(jan1); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = isoDay(d);
    const dayOfYear = Math.round((d.getTime() - jan1.getTime()) / 86_400_000);
    const covered =
      series.first !== null && series.last !== null && date >= series.first && date <= series.last;
    out.push({
      date,
      weekday: (d.getUTCDay() + 6) % 7,
      week: Math.floor((dayOfYear + offset) / 7),
      value: covered ? (days?.[date] ?? 0) : null,
    });
  }
  return out;
}

/**
 * Up to five classes for the non-zero days of a year, from the values' quintiles (integer breaks, duplicates merged).
 * Returns the upper bound of each class; class i holds values in (bounds[i-1], bounds[i]].
 */
export function countBreaks(values: readonly number[], classes = 5): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (let i = 1; i <= classes; i++) {
    const q = v[Math.min(v.length - 1, Math.ceil((i / classes) * v.length) - 1)]!;
    if (!out.length || q > out[out.length - 1]!) out.push(q);
  }
  return out;
}

export function classOf(value: number, breaks: readonly number[]): number {
  for (let i = 0; i < breaks.length; i++) if (value <= breaks[i]!) return i;
  return breaks.length - 1;
}

export function breakLabels(breaks: readonly number[]): string[] {
  return breaks.map((b, i) => {
    const lo = i === 0 ? 1 : breaks[i - 1]! + 1;
    return lo === b
      ? b.toLocaleString("en-US")
      : `${lo.toLocaleString("en-US")}–${b.toLocaleString("en-US")}`;
  });
}

/** Monthly totals of one series as calendarMatrix points: months in coverage are 0 when empty, others absent. */
export function monthPoints(
  series: Series,
  months: Record<string, number> | undefined,
): { key: string; value: number | null; partial: boolean }[] {
  if (!series.first || !series.last) return [];
  const out: { key: string; value: number | null; partial: boolean }[] = [];
  let y = Number(series.first.slice(0, 4));
  let m = Number(series.first.slice(5, 7));
  const endKey = series.last.slice(0, 7);
  for (let guard = 0; guard < 2400; guard++) {
    const key = `${y}-${pad(m)}`;
    const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const partial =
      (key === series.first.slice(0, 7) && !series.first.endsWith("-01")) ||
      (key === endKey && Number(series.last.slice(8, 10)) < lastOfMonth);
    out.push({ key, value: months?.[key] ?? 0, partial });
    if (key === endKey) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Years a view can show: from the earliest coverage start to the latest coverage end of its series. */
export function yearsOf(series: readonly Series[]): number[] {
  const firsts = series.map((s) => s.first).filter((x): x is string => !!x);
  const lasts = series.map((s) => s.last).filter((x): x is string => !!x);
  if (!firsts.length || !lasts.length) return [];
  const a = Number(firsts.sort()[0]!.slice(0, 4));
  const b = Number(lasts.sort().at(-1)!.slice(0, 4));
  const out: number[] = [];
  for (let y = b; y >= a; y--) out.push(y);
  return out;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function longDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
