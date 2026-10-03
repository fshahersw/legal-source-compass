/**
 * Display-time text clean-up for corpus strings.
 *
 * Some imported XML/HTML (eCFR hierarchy titles and text, a few corpus_context blocks) still carries character
 * references such as `&amp;` or `&#x2014;`, and ~114k titles carry irregular whitespace. The stored values are never
 * rewritten; they are decoded and normalised when shown. One pass only: `&amp;lt;` becomes `&lt;`, not `<`, and an
 * entity this does not know is left exactly as stored.
 */

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const ENTITY = /&(?:([a-z]{2,8})|#(\d{1,7})|#x([\da-f]{1,6}));/gi;

function codePointOk(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff);
}

/** Decode the XML predefined entities, `&nbsp;` and numeric character references. Unknown entities are kept. */
export function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(ENTITY, (entity, name?: string, dec?: string, hex?: string) => {
    if (name) return NAMED[name.toLowerCase()] ?? entity;
    const n = dec !== undefined ? parseInt(dec, 10) : parseInt(hex ?? "", 16);
    return codePointOk(n) ? String.fromCodePoint(n) : entity;
  });
}

/** Decoded, whitespace-collapsed and trimmed: the form a title or one-line value is shown in. */
export function cleanText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}
