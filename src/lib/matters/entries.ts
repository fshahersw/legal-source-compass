/**
 * Pure: docket entries for the matter timeline.
 *
 * The saved firm-focused docket sample (entry type, date entered, docket text snippet). The registry timeline
 * (`timeline.ts`) is the reader for matters whose entries are in the matter registry.
 */

import { isObj, str } from "./values";

export type EntrySource = "activity";

export type DocketEntry = {
  id: string;
  source: EntrySource;
  entryNumber: number | null;
  /** yyyy-mm-dd or null when the source records none. */
  date: string | null;
  /** What the date means in this source. */
  dateBasis: "entered" | "filed";
  entryType: string | null;
  /** Docket-text snippet exactly as projected (may end with an ellipsis); null when the source has none. */
  description: string | null;
  /** Documents the source says are attached/unsealed; null when it says nothing. */
  documentCount: number | null;
  sourceUrl: string | null;
};

const isoDate = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const intOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  const s = str(v);
  return s && /^\d{1,7}$/.test(s) ? Number(s) : null;
};

function firstHttps(links: unknown, test: (url: string) => boolean): string | null {
  if (!Array.isArray(links)) return null;
  for (const l of links) {
    const url = isObj(l) ? str(l["url"]) : null;
    if (url && /^https:\/\//i.test(url) && test(url)) return url;
  }
  return null;
}

/** Item from the saved docket-sample activity dataset. */
export function parseActivityEntry(item: unknown): DocketEntry | null {
  if (!isObj(item)) return null;
  const cells = isObj(item["cells"]) ? item["cells"] : {};
  const id = str(item["id"]);
  if (!id) return null;
  const badges = Array.isArray(item["badges"])
    ? item["badges"].filter((b): b is string => typeof b === "string")
    : [];
  const docBadge = badges.map((b) => /^(\d+) verified document/i.exec(b)).find(Boolean);
  return {
    id: `activity:${id}`,
    source: "activity",
    entryNumber: intOf(cells["entry_number"]),
    date: isoDate(cells["published_at"]),
    dateBasis: "entered",
    entryType: str(cells["entry_type"]),
    description: str(item["subtitle"]),
    documentCount: docBadge ? Number(docBadge[1]) : null,
    sourceUrl: firstHttps(item["links"], (u) => u.includes("courtlistener.com/docket/")),
  };
}

/** "pretrial_order" -> "Pretrial order". */
export function entryTypeLabel(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

export type EntryGroup<T extends { date: string | null } = DocketEntry> = {
  key: string;
  label: string;
  entries: T[];
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Group entries by calendar month in the order given; undated entries form one trailing group. */
export function groupEntriesByMonth<T extends { date: string | null }>(
  entries: T[],
): EntryGroup<T>[] {
  const groups: EntryGroup<T>[] = [];
  const index = new Map<string, EntryGroup<T>>();
  for (const e of entries) {
    const key = e.date ? e.date.slice(0, 7) : "undated";
    let g = index.get(key);
    if (!g) {
      const label = e.date
        ? `${MONTHS[Number(e.date.slice(5, 7)) - 1] ?? e.date.slice(5, 7)} ${e.date.slice(0, 4)}`
        : "Date not recorded";
      g = { key, label, entries: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.entries.push(e);
  }
  const undated = groups.findIndex((g) => g.key === "undated");
  if (undated >= 0 && undated !== groups.length - 1) groups.push(...groups.splice(undated, 1));
  return groups;
}

export type EntrySourceNote = {
  source: EntrySource;
  title: string;
  /** One honest sentence about what this list is and is not. */
  scope: string;
};

export const ENTRY_SOURCE_NOTES: Record<EntrySource, EntrySourceNote> = {
  activity: {
    source: "activity",
    title: "Docket text from the saved docket sample",
    scope:
      "Entries from the firm-focused docket sample, with the court's docket text snippet. Dates are the date entered, parsed from the docket text. Coverage ends when the sample was built and can lag the live docket.",
  },
};
