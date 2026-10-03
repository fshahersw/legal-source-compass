/**
 * Pure: docket entries for the matter timeline.
 *
 * Two sources exist and are never merged silently:
 * - "activity": the saved firm-focused docket sample (entry type, date entered, docket text snippet);
 * - "cl_entries": CourtListener's own entry list for the master docket (number, filing date, source-listed
 *   unsealed document count) with no descriptions.
 */

export type EntrySource = "activity" | "cl_entries";

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

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
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

/** Item from CourtListener's master-docket entry metadata (no descriptions, captions or contents). */
export function parseClEntry(item: unknown): DocketEntry | null {
  if (!isObj(item)) return null;
  const cells = isObj(item["cells"]) ? item["cells"] : {};
  const native = str(cells["native_entry_id"]) ?? str(item["id"]);
  if (!native) return null;
  return {
    id: `cl:${native}`,
    source: "cl_entries",
    entryNumber: intOf(cells["entry_number"]),
    date: isoDate(cells["date_filed"]),
    dateBasis: "filed",
    entryType: null,
    description: null,
    documentCount: intOf(cells["source_unsealed_document_count"]),
    sourceUrl: str(cells["source_docket_url"]),
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
  cl_entries: {
    source: "cl_entries",
    title: "CourtListener entry list (numbers and dates only)",
    scope:
      "One row per source-native docket entry on the master docket. No descriptions, captions or document contents are projected, and the document count is only the unsealed documents the source itself lists.",
  },
};

/**
 * Page `pageIndex` (zero-based) counted from the END of an ascending list: the [start, length] window to request,
 * which the caller then reverses so the newest entries come first.
 */
export function pageFromEnd(
  total: number,
  pageIndex: number,
  pageSize: number,
): { start: number; length: number } {
  const end = Math.max(0, total - pageIndex * pageSize);
  const start = Math.max(0, end - pageSize);
  return { start, length: end - start };
}
