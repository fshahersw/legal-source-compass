/**
 * Number formatting and small statistics shared by the insight generators.
 * One rounding rule everywhere: counts to whole numbers, percentages and rates to one decimal unless a
 * generator says otherwise, money in words ("$3.9 billion"). Every function returns null (or throws no
 * error) for a missing or non-finite input so a generator can drop the candidate instead of printing a guess.
 */

export const NOT_RECORDED = "Not recorded";

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtDec(n: number, digits = 1): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(n: number, digits = 1): string {
  return `${fmtDec(n, digits)}%`;
}

/** "+18.2%" / "-18.2%" / "0.0%". */
export function fmtSignedPct(n: number, digits = 1): string {
  const text = fmtDec(Math.abs(n), digits);
  if (Number(text.replace(/,/g, "")) === 0) return `${fmtDec(0, digits)}%`;
  return `${n > 0 ? "+" : "-"}${text}%`;
}

/** "+5,190" / "-3,392" / "0". */
export function fmtSignedInt(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "-"}${Math.abs(r).toLocaleString("en-US")}`;
}

/** "up 18.2%", "down 18.2%" or "unchanged" (a move that rounds to zero). */
export function moved(pct: number, digits = 1): string {
  const text = fmtDec(Math.abs(pct), digits);
  if (Number(text.replace(/,/g, "")) === 0) return "unchanged";
  return `${pct > 0 ? "up" : "down"} ${text}%`;
}

/** Counts in words for sentences: 1,307,769 -> "1.3 million"; 204,977 -> "204,977". */
export function fmtWords(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${trim(n / 1e12)} trillion`;
  if (abs >= 1e9) return `${trim(n / 1e9)} billion`;
  if (abs >= 1e6) return `${trim(n / 1e6)} million`;
  return fmtInt(n);
}

/** Dollars in words: 3_923_550_962.8 -> "$3.9 billion"; 44_497_238.8 -> "$44.5 million"; 12_345 -> "$12,345". */
export function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${trim(abs / 1e12)} trillion`;
  if (abs >= 1e9) return `${sign}$${trim(abs / 1e9)} billion`;
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6)} million`;
  return `${sign}$${fmtInt(abs)}`;
}

function trim(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

/** Percent change from `base` to `current`; null unless both are finite and the base is positive. */
export function pctChange(current: number | null | undefined, base: number | null | undefined) {
  if (!isNum(current) || !isNum(base) || base <= 0) return null;
  return (100 * (current - base)) / base;
}

/** current / base as a plain multiple ("6.1 times"); null unless both are finite and the base is positive. */
export function timesOf(current: number | null | undefined, base: number | null | undefined) {
  if (!isNum(current) || !isNum(base) || base <= 0) return null;
  return current / base;
}

export function fmtTimes(x: number): string {
  return `${x >= 10 ? fmtInt(x) : fmtDec(x, 1)} times`;
}

/** Share of `part` in `whole`, in percent; null unless the whole is positive. */
export function sharePct(part: number | null | undefined, whole: number | null | undefined) {
  if (!isNum(part) || !isNum(whole) || whole <= 0) return null;
  return (100 * part) / whole;
}

export function median(values: readonly (number | null | undefined)[]): number | null {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export function sum(values: readonly (number | null | undefined)[]): number {
  let t = 0;
  for (const v of values) if (isNum(v)) t += v;
  return t;
}

/** Highest first; ties keep the input order so results are stable. */
export function sortDesc<T>(items: readonly T[], value: (t: T) => number | null | undefined): T[] {
  return items
    .map((item, i) => ({ item, i, v: value(item) }))
    .filter((x): x is { item: T; i: number; v: number } => isNum(x.v))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => x.item);
}

export function sortAsc<T>(items: readonly T[], value: (t: T) => number | null | undefined): T[] {
  return items
    .map((item, i) => ({ item, i, v: value(item) }))
    .filter((x): x is { item: T; i: number; v: number } => isNum(x.v))
    .sort((a, b) => a.v - b.v || a.i - b.i)
    .map((x) => x.item);
}

/** "A", "A and B", "A, B and C". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Cut at a word boundary with an ellipsis when longer than `max`. */
export function clip(text: string, max = 72): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:(-]+$/, "")}…`;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Bound a value to 0..100 for `Insight.score`. */
export const score = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Federal FY N ends Sep 30 N: the latest complete FY at an ECHO-style file date. Null when the date is unreadable. */
export function latestCompleteFiscalYear(fileDate: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(fileDate ?? "");
  if (!m) return null;
  return Number(m[2]) >= 10 ? Number(m[1]) : Number(m[1]) - 1;
}

/** English ordinal circuit label: 1 -> "1st Circuit", 0 -> "D.C. Circuit". */
export function circuitLabel(n: number | null | undefined): string | null {
  if (!isNum(n) || !Number.isInteger(n) || n < 0 || n > 11) return null;
  if (n === 0) return "D.C. Circuit";
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${suffix} Circuit`;
}
