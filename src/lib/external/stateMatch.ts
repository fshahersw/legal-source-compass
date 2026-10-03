/**
 * State matching for `corpus_records.state`.
 *
 * The column holds the full state name in some datasets ("Indiana") and the USPS code in others ("IN"), and "US" for
 * country-level rows (a country, not a state). Rewriting ~258k rows was ruled out by the data-quality pass, so every
 * query that selects by state asks for both spellings of the same state. Nothing is fuzzy: only the exact name or
 * exact USPS code of one of the 50 states + DC matches, and "US" never matches a state.
 */
import { stateByName, stateByUsps } from "@/lib/corpus/geo";

const COUNTRY_VALUES = /^(us|usa|u\.s\.|united states)$/i;

/** The exact stored spellings to match for one state, or null when the value is empty or a country, not a state. */
export function stateMatchValues(input: string | null | undefined): string[] | null {
  const s = (input ?? "").trim();
  if (!s || COUNTRY_VALUES.test(s)) return null;
  const byName = stateByName.get(s);
  if (byName) return [byName.name, byName.usps];
  // A two-letter value is a USPS code; longer values are looked up by name only (no fuzzy matching).
  const byCode = s.length === 2 ? stateByUsps.get(s.toUpperCase()) : undefined;
  if (byCode) return [byCode.name, byCode.usps];
  return [s];
}

/** PostgREST value for `state`: `eq.<v>` for one spelling, `in.("A","B")` for several; always URL-encoded. */
export function stateFilterValue(values: readonly string[]): string {
  const clean = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (clean.length === 1) return `eq.${encodeURIComponent(clean[0]!)}`;
  const quoted = clean.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
  return `in.(${encodeURIComponent(quoted)})`;
}

/**
 * `state=...` query value for a state name or code. Returns null when the value is empty or a country, so a caller
 * must treat "no state" explicitly instead of silently dropping the filter and matching every row.
 */
export function stateQueryValue(input: string | null | undefined): string | null {
  const values = stateMatchValues(input);
  return values ? stateFilterValue(values) : null;
}
