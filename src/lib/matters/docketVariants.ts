/**
 * Which registered PDF case ids belong on a matter's document query.
 *
 * A registered id is included only when it is a formatting variant of a docket id the page already
 * requests, or an `MDL` / `MDL No.` label for this matter's own number. Formatting is hyphens,
 * zero-padding, a two-digit or four-digit year, letter case, a trailing judge suffix (`-njr`,
 * `-DWF-DJF`), and a court prefix when the other id has none. Two different court prefixes are
 * different dockets. Captions, firms, and parties are never compared.
 */

const DOCKET_FORM =
  /^(?:([a-z]{2,12})-)?(\d{1,2}):(\d{2}|\d{4})-?([a-z]{2})-?0*(\d{1,6})(?:-[a-z]{1,5})*$/i;
const MDL_LABEL = /^MDL (\d{1,6})$/;
const MDL_NO_LABEL = /^MDL No\. (\d{1,6})$/;
const PLAIN_CASE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/;

export type DocketFormatting = {
  court: string | null;
  office: string;
  year: number;
  type: string;
  number: string;
};

/** Digits without leading zeros, or null when this is not an MDL number. */
export function matterMdlNumber(value: string | null | undefined): string | null {
  const s = (value ?? "").replace(/^mdl[:-]?/i, "").trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = String(Number(s));
  return n === "0" ? null : n;
}

/** The docket identity used to compare formatting, or null when `id` is not a docket number. */
export function docketFormatting(id: string): DocketFormatting | null {
  const m = DOCKET_FORM.exec(id.trim());
  if (!m) return null;
  const yearText = m[3]!;
  const year =
    yearText.length === 4
      ? Number(yearText)
      : Number(yearText) >= 68
        ? 1900 + Number(yearText)
        : 2000 + Number(yearText);
  if (!Number.isInteger(year) || year < 1968 || year > 2099) return null;
  return {
    court: m[1] ? m[1].toLowerCase() : null,
    office: String(Number(m[2])),
    year,
    type: m[4]!.toLowerCase(),
    number: String(Number(m[5])),
  };
}

export function sameDocketFormatting(a: DocketFormatting, b: DocketFormatting): boolean {
  return (
    a.office === b.office &&
    a.year === b.year &&
    a.type === b.type &&
    a.number === b.number &&
    (a.court === b.court || a.court === null || b.court === null)
  );
}

/** Plain provider case ids, plus the two MDL label spellings the corpus registers. */
export function isDocumentQueryCaseId(id: string): boolean {
  return PLAIN_CASE_ID.test(id) || MDL_LABEL.test(id) || MDL_NO_LABEL.test(id);
}

/**
 * True when `id` may be added to a document query that already requests `asked` for matter `mdl`.
 * `mdl` is the matter number (`"3004"`), or null when the caller is not a matter page.
 */
export function acceptsRegisteredCaseId(
  id: string,
  asked: readonly string[],
  mdl: string | null,
): boolean {
  if (!isDocumentQueryCaseId(id) || asked.includes(id)) return false;
  const matter = matterMdlNumber(mdl);
  if (MDL_LABEL.test(id) || MDL_NO_LABEL.test(id))
    return matter !== null && (id === `MDL ${matter}` || id === `MDL No. ${matter}`);
  const key = docketFormatting(id);
  if (!key) return false;
  return asked.some((candidate) => {
    const other = docketFormatting(candidate);
    return other !== null && sameDocketFormatting(key, other);
  });
}

/** Registered ids, in input order, that this matter's document query should also request. */
export function selectRegisteredCaseIds(
  asked: readonly string[],
  mdl: string | null,
  registered: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of registered) {
    if (seen.has(id) || !acceptsRegisteredCaseId(id, asked, mdl)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
