/**
 * Pure: dates the court set on the docket, read verbatim from the docket text.
 *
 * Only the printed phrases "due by", "set for", "is set for", "reset for" and "continued to" followed by a M/D/YYYY date
 * are read. The label is the event name printed before the phrase ("Jury Trial", "Close of Expert Discovery").
 * "Vacated" is set only when the text itself says the setting is vacated. Nothing is projected forward: a date is
 * shown "as docketed on <entry date>", and anything the court changed after the collected docket text is not known.
 */

export type DatePhrase = "due by" | "set for" | "is set for" | "reset for" | "continued to";

export type DocketDate = {
  /** yyyy-mm-dd, from the printed M/D/YYYY. */
  date: string;
  /** The date exactly as printed ("2/8/2027"). */
  printed: string;
  phrase: DatePhrase;
  /** The event name printed before the phrase; null when the text names none. */
  label: string | null;
  /** The time printed with the date ("08:00 AM"); null when none. */
  time: string | null;
  /** True only when the text says this setting is vacated. */
  vacated: boolean;
  /** The clause the date was read from, verbatim (at most 200 characters). */
  snippet: string;
};

const DATE_RE =
  /\b(due\s+by|is\s+set\s+for|set\s+for|reset\s+for|continued\s+to)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b(?:,?\s+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:[AaPp]\.?\s?[Mm]\.?)?))?/gi;
const VACATED_AFTER =
  /^[\s,]*(?:(?:is|are|has\s+been|have\s+been|was|were)\s+)?(?:hereby\s+)?VACATED\b/i;
const LEAD_IN =
  /^(?:You\s+are\s+hereby\s+notified\s+that|It\s+is\s+(?:hereby\s+)?ordered\s+that|ORDERED\s+that|Please\s+take\s+notice\s+that|and|or|the|with)\s+/i;
const MAX_LABEL_WORDS = 12;

function realDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Start of the clause a position sits in: after the last ". ", "; ", ": ", ") " or line break before it. */
function clauseStart(text: string, at: number): number {
  const before = text.slice(0, at);
  let start = 0;
  const re = /(?:[.;:]\s+|\)\s+|\n)/g;
  for (let m = re.exec(before); m; m = re.exec(before)) start = m.index + m[0].length;
  return start;
}

function cleanLabel(raw: string): string | null {
  let s = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,;:]+$/, "")
    .trim();
  for (let i = 0; i < 4 && LEAD_IN.test(s); i++) s = s.replace(LEAD_IN, "").trim();
  if (!s) return null;
  const words = s.split(" ");
  return words.length > MAX_LABEL_WORDS ? `… ${words.slice(-MAX_LABEL_WORDS).join(" ")}` : s;
}

/** Every docketed date in one entry's text, in the order printed. */
export function extractDocketDates(text: string | null | undefined): DocketDate[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const out: DocketDate[] = [];
  let prev: { index: number; label: string | null } | null = null;
  for (const m of text.matchAll(DATE_RE)) {
    const index = m.index ?? 0;
    const date = realDate(Number(m[4]), Number(m[2]), Number(m[3]));
    if (!date) continue;
    const phrase = m[1]!.toLowerCase().replace(/\s+/g, " ") as DatePhrase;
    const start = clauseStart(text, index);
    // "Jury Trial set for 8/20/2026, is vacated and continued to 8/24/2026": the second date is the same event.
    const label: string | null =
      prev && prev.index >= start ? prev.label : cleanLabel(text.slice(start, index));
    const end = index + m[0].length;
    const after = text.slice(end, end + 80);
    const sentenceEnd = text.slice(start).search(/\.\s+[A-Z(]/);
    const snippet = (sentenceEnd >= 0 ? text.slice(start, start + sentenceEnd) : text.slice(start))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    out.push({
      date,
      printed: `${m[2]}/${m[3]}/${m[4]}`,
      phrase,
      label,
      time: m[5] ? m[5].replace(/\s+/g, " ").trim() : null,
      vacated: VACATED_AFTER.test(after),
      snippet,
    });
    prev = { index, label };
  }
  return out;
}

/** A docketed date with the entry it was read from. */
export type DatedEntry = DocketDate & {
  entryId: string;
  entryNumber: number | null;
  /** The filing date of the entry that printed the date (the "as docketed on" date). */
  entryDate: string | null;
  sourceUrl: string | null;
};

/** A dated row with the role of the entry it was read from (orders.ts DocketRole; absent = not known). */
export type RoledDate = DatedEntry & { entryRole?: string | null | undefined };

/**
 * Entry roles whose dates the court itself set: orders and clerk settings. A date printed in a party filing (a movant
 * noticing its own hearing, CM/ECF "Responses due by" on a motion) is shown only with its own label, never as the
 * MDL's next date.
 */
export const COURT_SET_ROLES: ReadonlySet<string> = new Set(["order", "clerk_setting"]);

export const isCourtSet = (r: RoledDate): boolean => COURT_SET_ROLES.has(r.entryRole ?? "");

export const PRINTED_IN_FILING = "Printed in a party filing";
export const SET_BY_COURT = "Court order or clerk setting";

export type DocketDatesSummary = {
  /** Dates read from the collected text (every entry role). */
  total: number;
  /** Court-set dates (order or clerk setting), not vacated and on or after `today`. */
  ahead: number;
  /** Dates ahead that only a party filing prints; listed apart, never the next date. */
  aheadInFilings: number;
  /** The soonest court-set date ahead. */
  next: DatedEntry | null;
  /** The latest court-set date. */
  latest: DatedEntry | null;
  vacated: number;
  /** Latest filing date in the collected docket text; later changes are not collected. */
  collectedThrough: string | null;
};

/**
 * Upcoming settings: not vacated, on or after `today` (yyyy-mm-dd), soonest first. By default only dates the court set
 * (order or clerk-setting entries); `courtSetOnly: false` keeps dates printed in party filings too.
 */
export function upcomingDates<T extends RoledDate>(
  rows: readonly T[],
  today: string,
  opts: { courtSetOnly?: boolean } = {},
): T[] {
  const courtSetOnly = opts.courtSetOnly ?? true;
  return rows
    .filter((r) => !r.vacated && r.date >= today && (!courtSetOnly || isCourtSet(r)))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.entryDate ?? "").localeCompare(b.entryDate ?? "") ||
        a.entryId.localeCompare(b.entryId),
    );
}

export function summarizeDates(
  rows: readonly RoledDate[],
  today: string,
  collectedThrough: string | null,
): DocketDatesSummary {
  const ahead = upcomingDates(rows, today);
  const aheadAll = upcomingDates(rows, today, { courtSetOnly: false });
  let latest: DatedEntry | null = null;
  for (const r of rows)
    if (!r.vacated && isCourtSet(r) && (!latest || r.date > latest.date)) latest = r;
  return {
    total: rows.length,
    ahead: ahead.length,
    aheadInFilings: aheadAll.length - ahead.length,
    next: ahead[0] ?? null,
    latest,
    vacated: rows.filter((r) => r.vacated).length,
    collectedThrough,
  };
}

/** "as docketed on 2026-05-21; entries collected through 2026-10-03" */
export function docketedNote(entryDate: string | null, collectedThrough: string | null): string {
  const on = entryDate ? `as docketed on ${entryDate}` : "docketing date not recorded";
  return collectedThrough
    ? `${on}; later changes after ${collectedThrough} are not collected`
    : `${on}; collection date not recorded`;
}
