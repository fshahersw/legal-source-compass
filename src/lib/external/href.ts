/**
 * Render-time URL safety for links built from stored source URLs.
 *
 * Some stored `source_url` values contain raw spaces (for example in some judge financial-disclosure source links) or other characters a
 * URL may not contain. The stored value is provenance and is never rewritten; the `href` shown to the browser is
 * percent-encoded. Existing `%XX` escapes are kept exactly (so nothing is double-encoded), a `%` that is not part of
 * an escape becomes `%25`, and `#`, `?`, `&`, `=` and `/` keep their meaning.
 */

const NEEDS_ENCODING = /%(?![0-9A-Fa-f]{2})|[^\x21-\x7e]|["<>\\^`{|}]/;
const ENCODE_EACH = /%(?![0-9A-Fa-f]{2})|[^\x21-\x7e]|["<>\\^`{|}]/g;

export function externalHref(url: string): string {
  const value = url.trim();
  if (!NEEDS_ENCODING.test(value)) return value;
  return value.replace(ENCODE_EACH, (ch) => {
    if (ch === "%") return "%25";
    try {
      return encodeURIComponent(ch);
    } catch {
      // A lone surrogate cannot be encoded; leave it for the browser to reject.
      return ch;
    }
  });
}
