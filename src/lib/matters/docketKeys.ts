/**
 * Pure helpers that turn a master docket number into the native case keys other systems use.
 *
 * These keys are DERIVED by exact court + docket-number normalization (never by name or fuzzy match). Callers must
 * label them "derived" in the UI until the matter registry supplies explicit relationships, and must verify that
 * every returned native case id equals one of the derived keys exactly.
 */

export type ParsedDocket = {
  /** Division/office digit(s) before the colon, e.g. "3". */
  office: string;
  /** Four-digit filing year. */
  year: number;
  /** Two-letter case type, lower-case: cv, md, mn, ml, mc... */
  type: string;
  /** Sequence number without leading zeros. */
  number: string;
};

/** "3:25-md-3140" or "3:2025-md-03140" -> parts. JPML started in 1968, so 2-digit years >= 68 are 19xx. */
export function parseDocketNumber(value: string | null | undefined): ParsedDocket | null {
  const m = /^(\d{1,2}):(\d{2}|\d{4})-([a-z]{2})-0*(\d{1,6})$/i.exec((value ?? "").trim());
  if (!m) return null;
  const yearText = m[2]!;
  const year =
    yearText.length === 4
      ? Number(yearText)
      : Number(yearText) >= 68
        ? 1900 + Number(yearText)
        : 2000 + Number(yearText);
  return { office: m[1]!, year, type: m[3]!.toLowerCase(), number: m[4]! };
}

/** DocketBird-style native case id: "flnd-3:2025-md-03140" (court id, office, year, type, 5-digit number). */
export function docketBirdCaseKey(
  clCourtId: string | null | undefined,
  masterDocket: string | null | undefined,
): string | null {
  const court = (clCourtId ?? "").trim().toLowerCase();
  const parsed = parseDocketNumber(masterDocket);
  if (!/^[a-z0-9]{2,12}$/.test(court) || !parsed) return null;
  return `${court}-${parsed.office}:${parsed.year}-${parsed.type}-${parsed.number.padStart(5, "0")}`;
}

/** Court-site style case id used by official court pages: "3:25md3140". */
export function officialCourtCaseKey(masterDocket: string | null | undefined): string | null {
  const parsed = parseDocketNumber(masterDocket);
  if (!parsed) return null;
  return `${parsed.office}:${String(parsed.year).slice(-2)}${parsed.type}${parsed.number}`;
}

export type MatterCaseKeys = {
  docketBird: string | null;
  officialCourt: string | null;
  /** Every derived key, de-duplicated, in a stable order. */
  all: string[];
};

export function matterCaseKeys(
  clCourtId: string | null | undefined,
  masterDocket: string | null | undefined,
): MatterCaseKeys {
  const docketBird = docketBirdCaseKey(clCourtId, masterDocket);
  const officialCourt = officialCourtCaseKey(masterDocket);
  return {
    docketBird,
    officialCourt,
    all: [...new Set([docketBird, officialCourt].filter((k): k is string => !!k))],
  };
}

/** "flnd-3:2025-md-03140-00771" -> { caseKey: "flnd-3:2025-md-03140", sequence: 771 }. */
export function parseDocketBirdDocumentId(
  id: string,
): { caseKey: string; sequence: number } | null {
  const m = /^(.+)-(\d{5})$/.exec(id);
  if (!m) return null;
  return { caseKey: m[1]!, sequence: Number(m[2]) };
}

/** The file name a court-hosted document URL ends with, decoded exactly once; falls back to the raw URL. */
export function courtDocumentFilename(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (!last) return url;
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}

/** A leading yyyy.mm.dd / yyyy-mm-dd in a court file name is the posting date the court printed; otherwise null. */
export function courtFilenameDate(filename: string): string | null {
  const m = /^(\d{4})[.-](\d{2})[.-](\d{2})\b/.exec(filename);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
