/** Company page addresses: the SEC Central Index Key written as exactly 10 digits. */
export const CIK_ADDRESS = /^\d{10}$/;

/** Longest requested value echoed back on the not-found page. */
const SHOWN_MAX = 40;

export const isCikAddress = (value: string) => CIK_ADDRESS.test(value);

/**
 * The value that failed the CIK check, as the user typed it: taken from the notFound data
 * (`{ cik }`), trimmed and bounded for display. Null when absent or blank.
 */
export function requestedCik(data: unknown): string | null {
  const raw =
    data && typeof data === "object" && "cik" in data && typeof data.cik === "string"
      ? data.cik.trim()
      : "";
  if (!raw) return null;
  return raw.length > SHOWN_MAX ? `${raw.slice(0, SHOWN_MAX)}…` : raw;
}

/**
 * A CIK typed without its leading zeros (1–9 digits, not all zeros) as its 10-digit address.
 * Null for anything else: the not-found page offers this address and nothing more.
 */
export function paddedCik(requested: string | null): string | null {
  if (!requested || !/^\d{1,9}$/.test(requested) || !/[1-9]/.test(requested)) return null;
  return requested.padStart(10, "0");
}
