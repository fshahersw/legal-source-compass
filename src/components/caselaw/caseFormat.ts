/** Display helpers for /cases (pure). */
import type { Citator } from "@/lib/external/caselaw";

export const NOT_RECORDED = "Not recorded";
export const fmtInt = (n: number | null | undefined) =>
  n == null ? NOT_RECORDED : n.toLocaleString("en-US");

const MONTHS = [
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "May",
  "June",
  "July",
  "Aug.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
];
/** 1966-06-13 -> "June 13, 1966" (no time zone arithmetic: the date is a calendar day). */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return NOT_RECORDED;
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return NOT_RECORDED;
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}
export const yearOf = (d: string | null | undefined) => (d ? d.slice(0, 4) : null);

/** "Miranda v. Arizona, 384 U.S. 436 (1966)" style line from what is recorded. */
export function citeLine(name: string, cites: string[], date: string | null): string {
  const y = yearOf(date);
  return [name, cites[0] ?? null].filter(Boolean).join(", ") + (y ? ` (${y})` : "");
}

export type Bar = { key: string; label: string; n: number; pct: number };

/** Court rows (largest first), the first `top` shown and the rest summed into one row. */
/** Court rows (largest first), the first `top` shown and the rest summed into one row; bars are scaled to the
 * largest court shown (the summed row is capped at a full bar). */
export function courtBars(c: Citator, top = 12): Bar[] {
  const shown = c.byCourt.slice(0, top);
  const max = Math.max(1, ...shown.map((r) => r.n));
  const rows = shown.map((r) => ({
    key: r.courtId,
    label: c.courts[r.courtId] ?? r.courtId,
    n: r.n,
    pct: (100 * r.n) / max,
  }));
  const rest = c.byCourt.slice(top).reduce((s, r) => s + r.n, 0);
  if (rest)
    rows.push({
      key: "_rest",
      label: `${c.byCourt.length - top} other courts`,
      n: rest,
      pct: Math.min(100, (100 * rest) / max),
    });
  return rows;
}

export function decadeBars(c: Citator): Bar[] {
  const max = Math.max(1, ...c.byDecade.map((r) => r.n));
  return c.byDecade.map((r) => ({
    key: String(r.decade ?? "undated"),
    label: r.decade == null ? "Undated" : `${r.decade}s`,
    n: r.n,
    pct: (100 * r.n) / max,
  }));
}

export type CitingSort = "rank" | "newest" | "oldest" | "depth";
export function sortCiting<T extends { date: string | null; depth: number | null }>(
  rows: T[],
  sort: CitingSort,
): T[] {
  if (sort === "rank") return rows;
  const out = [...rows];
  if (sort === "depth") out.sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
  else
    out.sort((a, b) => {
      const x = a.date ?? "";
      const y = b.date ?? "";
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return sort === "newest" ? y.localeCompare(x) : x.localeCompare(y);
    });
  return out;
}

/** Two-letter codes the court registry records as a court's state or territory -> name. */
export const STATE_NAME: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  PR: "Puerto Rico",
  GU: "Guam",
  VI: "U.S. Virgin Islands",
  AS: "American Samoa",
  MP: "Northern Mariana Islands",
};
export const stateLabel = (code: string | null | undefined) =>
  code ? (STATE_NAME[code] ?? code) : NOT_RECORDED;
