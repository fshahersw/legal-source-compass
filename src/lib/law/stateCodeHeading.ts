/**
 * Display labels for recorded law hierarchy levels (state codes, constitutions, regulations).
 *
 * Deterministic and literal. A designation (kind word + number) is split out of a heading only when
 * the heading itself begins with it, so "TITLE 1-A. COLLABORATIVE FAMILY LAW" shows as kind "Title",
 * number "1-A", name "COLLABORATIVE FAMILY LAW". Nothing is looked up, invented or re-cased: the name
 * keeps the publisher's own capitalisation, and a level with no number anywhere keeps no number.
 *
 * Cleaning is limited to presentation artefacts of the capture: runs of whitespace (tabs, line
 * breaks, `<br>`) become one space, HTML character references and URL-escaped punctuation are
 * decoded the way a browser shows them, and an index page's file-size note such as "(2432KB)" at
 * the end is dropped.
 */

export type LevelLabel = {
  /** Kind word as a label: the heading's own designation word when it has one, else the recorded level. */
  kind: string;
  /** The designation number as printed, or null when neither the record nor the heading gives one. */
  number: string | null;
  /** "recorded": the record's own number (the heading agrees or has none); "heading": split from the heading. */
  numberSource: "recorded" | "heading" | null;
  /** The heading after its designation, as published; null when the source prints no name. */
  name: string | null;
  /** A status the heading itself prints ("Repealed", "Reserved", …), or null. */
  status: string | null;
  /** Kind and number for display, e.g. "Title 1-A"; just the kind when no number is recorded. */
  designation: string;
};

/** Kind words a publisher prints, mapped to the level they designate. */
const KIND_WORDS: Record<string, string> = {
  title: "title",
  titles: "title",
  tit: "title",
  subtitle: "subtitle",
  chapter: "chapter",
  chapters: "chapter",
  chap: "chapter",
  ch: "chapter",
  subchapter: "subchapter",
  subch: "subchapter",
  article: "article",
  articles: "article",
  art: "article",
  subarticle: "subarticle",
  part: "part",
  parts: "part",
  pt: "part",
  subpart: "subpart",
  division: "division",
  div: "division",
  subdivision: "subdivision",
  code: "code",
  act: "act",
  law: "law",
  appendix: "appendix",
  app: "appendix",
  schedule: "schedule",
  rule: "rule",
  section: "section",
  sections: "section",
  sec: "section",
  "§": "section",
  "§§": "section",
};

/** Levels whose name says nothing about the designation the publisher prints. */
const GENERIC_LEVELS = new Set(["heading", "subheading", "group", "unit", "level"]);

/** Short capitalised words that read like a designation letter but are ordinary words. */
const STOPWORDS = new Set([
  "AN",
  "AND",
  "ANY",
  "ALL",
  "AS",
  "AT",
  "BE",
  "BY",
  "FOR",
  "IN",
  "IS",
  "IT",
  "NO",
  "NOT",
  "OF",
  "ON",
  "OR",
  "THE",
  "TO",
]);

const STATUS_WORDS = "repealed|reserved|expired|transferred|renumbered|omitted|superseded";
const LEADING_STATUS = new RegExp(String.raw`^[[(]?\s*(${STATUS_WORDS})\b`, "i");
const TRAILING_STATUS = new RegExp(String.raw`[[(]\s*(${STATUS_WORDS})\b[^\])]*[\])]\s*\.?$`, "i");
/** What may follow a leading status word for it to be a status rather than the start of a name. */
const STATUS_FOLLOW = new RegExp(
  String.raw`^(?:$|[\])]|[.:;,—–-]|by\b|to\b|as\b|in\b|effective\b|eff\.|\d|[[(]\s*(?:${STATUS_WORDS})\b)`,
  "i",
);

/** One number token: digits with up to three letters, a Roman numeral, or capitals with optional digits. */
const TOKEN = String.raw`(?:\d+[A-Za-z]{0,3}|[IVXLCDM]+|[A-Z]{1,3}\d{0,3})`;
const NUMBER = String.raw`${TOKEN}(?:[.\-–:/]${TOKEN})*`;
const DESIGNATION = new RegExp(
  String.raw`^(?:(?<word>[A-Za-z]{2,12}\.?)\s+|(?<sym>§§?)\s*)(?:\[(?<bnum>${NUMBER})\]|(?<num>${NUMBER}))(?=$|[^A-Za-z0-9])(?<tail>.*)$`,
  "s",
);
/** A designation number that is only letters (not a Roman numeral) must be closed by punctuation. */
const LETTERS_ONLY = /^[A-Z]{1,3}$/;
const ROMAN = /^[IVXLCDM]+$/;
const CLOSED = /^(?:$|[.:,;)\]]|\s+[—–-]\s)/;
const CHAIN = new RegExp(String.raw`^\s*[,;]\s*(?<rest>.*)$`, "s");
/** A bare leading number ("VIII. Provisional and Final Remedies"), used only when nothing is recorded. */
const BARE = /^(?<num>[IVXLCDM]+|\d+[A-Za-z]{0,3}(?:[.\-–][0-9A-Za-z]+)*)\.\s+(?<tail>\S.*)$/s;

/** Windows-1252 code points 128–159 as browsers decode `&#128;`–`&#159;`. */
const CP1252: Record<number, string> = {
  128: "€",
  130: "‚",
  131: "ƒ",
  132: "„",
  133: "…",
  134: "†",
  135: "‡",
  136: "ˆ",
  137: "‰",
  138: "Š",
  139: "‹",
  140: "Œ",
  142: "Ž",
  145: "‘",
  146: "’",
  147: "“",
  148: "”",
  149: "•",
  150: "–",
  151: "—",
  152: "˜",
  153: "™",
  154: "š",
  155: "›",
  156: "œ",
  158: "ž",
  159: "Ÿ",
};

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  sect: "§",
  para: "¶",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  cent: "¢",
  pound: "£",
  copy: "©",
  reg: "®",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  middot: "·",
  eacute: "é",
  aacute: "á",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
};

const URL_ESCAPES: Record<string, string> = {
  "%20": " ",
  "%26": "&",
  "%27": "'",
  "%28": "(",
  "%29": ")",
  "%2C": ",",
  "%3A": ":",
  "%3B": ";",
};

function decodeReference(match: string, body: string): string {
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const code = hex ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
    if (code >= 128 && code <= 159) return CP1252[code] ?? match;
    return String.fromCodePoint(code);
  }
  return NAMED[body.toLowerCase()] ?? match;
}

/**
 * A heading as the reader should see it: character references and URL-escaped punctuation decoded,
 * `<br>` and whitespace runs collapsed to one space, an index file-size note dropped. Empty is null.
 * Letters and their case are never changed.
 */
export function cleanHeading(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,7});/g, decodeReference)
    .replace(
      /%(?:20|26|27|28|29|2C|3A|3B)/gi,
      (escape) => URL_ESCAPES[escape.toUpperCase()] ?? escape,
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\(\d+(?:\.\d+)?\s?[KM]B\)$/, "")
    .trim();
  return text || null;
}

function kindOf(word: string): string | null {
  return KIND_WORDS[word.replace(/\.$/, "").toLowerCase()] ?? null;
}

/** Label case for a level or kind name ("subchapter" → "Subchapter"). */
export function kindLabel(level: string): string {
  const words = level.replace(/_/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : words;
}

export type Designation = { kind: string; number: string; tail: string };

/**
 * The designations a heading begins with, in order ("CHAPTER 11, ARTICLE 12C. …" gives two).
 * `strict` (the default) rejects a letters-only number such as "AD" in "TITLE AD VALOREM TAX" unless
 * punctuation closes it; a caller that already holds the recorded number may relax that and then
 * accept only a designation whose number equals the record's.
 */
export function parseDesignations(heading: string, strict = true): Designation[] {
  const chain: Designation[] = [];
  let rest = heading;
  for (;;) {
    const match = DESIGNATION.exec(rest);
    const groups = match?.groups ?? {};
    const word = groups["word"] ?? groups["sym"];
    const bracketed = groups["bnum"];
    const num = bracketed ?? groups["num"];
    const kind = word ? kindOf(word) : null;
    if (!match || !word || !num || !kind || STOPWORDS.has(num)) break;
    const tail = groups["tail"] ?? "";
    if (strict && !bracketed && LETTERS_ONLY.test(num) && !ROMAN.test(num) && !CLOSED.test(tail))
      break;
    chain.push({ kind, number: bracketed ? `[${num}]` : num, tail });
    const next = CHAIN.exec(tail);
    const after = next?.groups?.["rest"] ?? "";
    if (!next || !DESIGNATION.test(after)) break;
    rest = after;
  }
  return chain;
}

function nameFrom(tail: string): string | null {
  const name = tail.replace(/^[\s.:;,—–-]+/, "").trim();
  return name || null;
}

/** The kind word a recorded number carries itself ("Chapter 12", "App.A", "PARTS I, II"), if any. */
function recordedKind(recorded: string): { kind: string; rest: string } | null {
  const lead = /^([A-Za-z]{2,12})(?:\.\s*|\s+)(.+)$/.exec(recorded.trim());
  const kind = lead ? kindOf(lead[1]!) : null;
  return lead && kind ? { kind, rest: lead[2]! } : null;
}

/** Compare two printed numbers ignoring case, brackets, a trailing period, a leading kind word and leading zeros. */
export function sameNumber(recorded: string, printed: string): boolean {
  const norm = (value: string) => {
    let text = value
      .trim()
      .replace(/\.$/, "")
      .replace(/^\[(.*)\]$/, "$1");
    const lead = recordedKind(text);
    if (lead) text = lead.rest;
    return text
      .toUpperCase()
      .replace(/–/g, "-")
      .split(/([.\-:/])/)
      .map((part) => (/^\d+$/.test(part) ? String(Number(part)) : part))
      .join("");
  };
  return norm(recorded) === norm(printed);
}

/**
 * A recorded "number" that is an internal identifier rather than a printed designation: a lower-case
 * code such as "gab" or "sc01" (not a Roman numeral), or a path slug such as "titles-1-chapters-2".
 */
export function isInternalNumber(value: string): boolean {
  if (/^[ivxlcdm]+$/.test(value)) return false;
  return /^[a-z]{2,}\d*$/.test(value) || /^[a-z]+s-[A-Za-z0-9]+(?:-|$)/.test(value);
}

/** A status the heading itself prints: "Repealed.", "[Reserved]", "Transferred to Chapter 643", "… (Repealed)". */
export function headingStatus(name: string | null | undefined): string | null {
  if (!name) return null;
  const label = (word: string) => word[0]!.toUpperCase() + word.slice(1).toLowerCase();
  const lead = LEADING_STATUS.exec(name);
  if (lead && STATUS_FOLLOW.test(name.slice(lead[0].length).trim())) return label(lead[1]!);
  const trail = TRAILING_STATUS.exec(name);
  return trail ? label(trail[1]!) : null;
}

function designationText(kind: string, number: string | null): string {
  if (!number) return kind;
  return recordedKind(number) && /\s/.test(number) ? number : `${kind} ${number}`;
}

/**
 * The label for one recorded level. `level` is the intake's level name, `number` and `heading` the
 * recorded values. The record's number wins when the heading agrees or prints none; a heading's own
 * designation fills a missing or internal number. When both are real numbers and disagree, the
 * heading is left whole so nothing printed is hidden.
 */
/**
 * A name that ends with a copy of the recorded number after a dash, as California prints its codes ("Business and
 * Professions Code - BPC" for code BPC), without that copy, so the number is shown once. Exact, case-sensitive match
 * only; anything else is returned unchanged.
 */
function withoutTrailingNumber(name: string | null, number: string): string | null {
  if (!name) return name;
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^(.*\\S)\\s+[-\\u2013\\u2014]\\s+${escaped}$`).exec(name);
  return match ? match[1]! : name;
}

export function levelLabel(
  level: string,
  number: string | null | undefined,
  heading: string | null | undefined,
): LevelLabel {
  const recorded = typeof number === "string" && number.trim() ? number.trim() : null;
  const clean = cleanHeading(heading);
  const levelKind = level.replace(/_/g, " ").trim().toLowerCase();
  const generic = GENERIC_LEVELS.has(levelKind);
  const internal = recorded !== null && isInternalNumber(recorded);
  const real = recorded !== null && !internal ? recorded : null;
  let kind = kindLabel(levelKind);
  let shown = real;
  let source: LevelLabel["numberSource"] = shown ? "recorded" : null;
  let name = clean;

  if (clean) {
    if (real) {
      // The record holds the number: accept the heading's designation only when it prints that number.
      const chain = parseDesignations(clean, false);
      const ownKind = recordedKind(real)?.kind;
      const own = chain.find(
        (item) =>
          sameNumber(real, item.number) &&
          (item.kind === levelKind || item.kind === ownKind || generic),
      );
      if (own) {
        kind = kindLabel(own.kind);
        shown = own.number;
        name = nameFrom(own.tail);
      } else if (ownKind) {
        kind = kindLabel(ownKind);
      }
      if (!own) name = withoutTrailingNumber(name, real);
    } else {
      // Nothing usable is recorded: a designation the heading begins with supplies kind and number.
      const chain = parseDesignations(clean);
      const own =
        chain.find((item) => item.kind === levelKind) ??
        (chain.length === 1 ? chain[0] : undefined);
      const bare = !own && chain.length === 0 ? BARE.exec(clean) : null;
      if (own) {
        kind = kindLabel(own.kind);
        shown = own.number;
        source = "heading";
        name = nameFrom(own.tail);
      } else if (bare?.groups?.["num"]) {
        shown = bare.groups["num"];
        source = "heading";
        name = nameFrom(bare.groups["tail"] ?? "");
      }
    }
  } else if (real) {
    const ownKind = recordedKind(real)?.kind;
    if (ownKind) kind = kindLabel(ownKind);
  }
  return {
    kind,
    number: shown,
    numberSource: source,
    name,
    status: headingStatus(name),
    designation: designationText(kind, shown),
  };
}

/**
 * A section heading without a leading copy of the section's own number ("Sec. 1.001. PURPOSE OF
 * CODE." under citation "AG:1.001" reads "PURPOSE OF CODE."). Only an exact repeat of the citation,
 * or of its last ":"- or space-separated part, is removed; any other heading is returned cleaned but whole.
 */
export function sectionHeadingLabel(
  citation: string | null | undefined,
  heading: string | null | undefined,
): string | null {
  const clean = cleanHeading(heading);
  if (!clean || !citation) return clean;
  // A citation that already ends with the whole heading ("§ 1–204.73. Notes redeemable …" over "73. Notes
  // redeemable …") says it once; the heading adds nothing.
  const citeText = cleanHeading(citation) ?? "";
  if (citeText.length > clean.length && citeText.endsWith(clean)) return null;
  const cite = citation.trim().replace(/\.$/, "");
  const tails = new Set([cite]);
  for (const sep of [":", " "]) {
    const at = cite.lastIndexOf(sep);
    if (at >= 0 && at < cite.length - 1) tails.add(cite.slice(at + 1));
  }
  const lead = /^(?:(?:sec(?:tion)?\.?|§§?)\s*)?(?<num>\S+?)\.?(?=\s|$)(?<tail>.*)$/is.exec(clean);
  const num = lead?.groups?.["num"];
  if (!num || ![...tails].some((tail) => sameNumber(tail, num))) return clean;
  return nameFrom(lead.groups?.["tail"] ?? "") ?? clean;
}
