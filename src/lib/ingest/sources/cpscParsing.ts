/**
 * Port of the CPSC part of scripts/enrichment/enforcement/parsing.py (same patterns, Python semantics via py.ts).
 * Nothing here guesses: a value that does not match a stated pattern comes back as null. Tested value for value against
 * the Python functions (fixtures/golden/cpsc-rules.json, made by scripts/ingest/golden/make_golden.py).
 */
import { cleanText, pyMatch, pyRe, pyRound, pySearch, pySplit, pyStrip, pySub } from "../py.ts";

export const HAZARD_RULES: [string, string, string][] = [
  [
    "fire_burn",
    "Fire, burn and overheating",
    "\\bfire|(?<!chemical )\\bburn|flam(e|mab)|overheat|ignit|scald|smok(e|ing)\\b|\\bmelt",
  ],
  ["shock", "Electric shock and electrocution", "\\bshock|electrocut"],
  ["fall", "Fall", "\\bfall(s|ing)?\\b|\\bfell\\b"],
  [
    "tip_over",
    "Tip-over and instability",
    "tip[- ]?over|\\b(tips|tipping|tipped) over\\b|instab|unstable",
  ],
  ["choking", "Choking", "\\bchok"],
  ["strangulation", "Strangulation and entanglement", "strangul|entangl|drawstring"],
  ["suffocation", "Suffocation, asphyxiation and entrapment", "suffocat|asphyxi|entrap"],
  ["laceration", "Laceration and sharp edges", "lacerat|\\bsharp\\b|\\bcuts?\\b"],
  [
    "ingestion",
    "Ingestion (magnets, batteries, small parts)",
    "ingest|swallow|\\bmagnets?\\b|button[- ]cell|coin[- ]?batter|button batter",
  ],
  [
    "chemical",
    "Lead, phthalates and chemical exposure",
    "\\blead (paint|content|levels?|poisoning)|levels? of lead|excessive lead|contains? lead|lead limit|phthalat|\\btoxic|chemical(?! burns?)|(?<!blood )\\bpoison|carbon monoxide|\\bco poisoning|methylene|benzene|asbestos",
  ],
  ["drowning", "Drowning", "drown"],
  [
    "crash",
    "Crash, collision and loss of control",
    "\\bcrash|collision|loss of (steering )?control|lose control",
  ],
  ["impact", "Impact and struck-by injury", "\\bimpact|struck|projectile|eject"],
];
export const STANDARD_RULE =
  "violat|fails? to (meet|comply)|does not (meet|comply)|do not (meet|comply)|not in compliance|noncomplian|non-complian|mandatory (safety )?standard|federal (safety )?(standard|regulation|requirement)";
export const HAZARD_LABELS: Record<string, string> = Object.fromEntries([
  ...HAZARD_RULES.map(([k, label]) => [k, label]),
  ["other", "Other or unclassified"],
]);
const HAZARD_RX = HAZARD_RULES.map(([k, , p]) => [k, pyRe(p, "i")] as const);
const STANDARD_RX = pyRe(STANDARD_RULE, "i");

export function hazardCategories(text: string | null | undefined): string[] {
  const found = HAZARD_RX.filter(([, rx]) => pySearch(rx, text ?? "")).map(([k]) => k);
  return found.length ? found : ["other"];
}

export function mentionsStandardViolation(text: string | null | undefined): boolean {
  return Boolean(pySearch(STANDARD_RX, text ?? ""));
}

const DEATH = pyRe("\\b(deaths?|died|dies|fatal(ity|ities)?|killed)\\b", "i");
const NEGATED_DEATH = pyRe(
  "\\bno (reported |known )?(deaths?|fatalit(y|ies))\\b" +
    "|\\bno (reports?|incidents?) of (any )?(injur(y|ies)|incidents?)?( or | and |, )?(deaths?|fatalit(y|ies))\\b" +
    "|\\bno (injur(y|ies)|incidents?)(,? (or|and) (incidents?|injur(y|ies)))?,? (or|and) (deaths?|fatalit(y|ies))\\b" +
    "|\\bnot aware of any (injur(y|ies)|incidents?)?( or | and )?(deaths?|fatalit(y|ies))\\b" +
    "|\\bwithout (any )?(injur(y|ies)|deaths?)( or deaths?)?\\b" +
    "|\\bno ([a-z-]+,? (or |and )?){1,6}(deaths?|fatalit(y|ies))\\b",
  "i",
);
const NONE = pyRe("^(none|no)\\b[^.]*\\b(reported|known|injur|incident)", "i");

/** The injury statement mentions a death after explicitly negated phrases are removed (a text mention, not a count). */
export function mentionsDeath(text: string | null | undefined): boolean {
  return Boolean(pySearch(DEATH, pySub(NEGATED_DEATH, " ", text ?? "")));
}

const SENTENCE = pyRe('(?<=[.!?;])\\s+(?=[A-Z0-9\\"“(])');
const NONE_FIRST = pyRe(
  "^\\W*(none\\b|no (reported |known )?(injur|incident|report)|(the firm|[\\w.,&' -]{1,60}) (is|are|was|were|has|have) not (been )?(aware|received)|not aware of)",
  "i",
);
const BACKGROUND = pyRe(
  "\\bCPSC estimates\\b|\\bper year\\b|\\beach year\\b|\\bannually\\b|\\bevery (year|two weeks)\\b|\\bsince (19|20)\\d\\d\\b" +
    "|\\bhazardous magnets\\b|\\bin the past\\b" +
    "|\\bother (firms?|compan(y|ies)|manufacturers?|retailers?|brands?|products?|models?|mini-\\w+|makers?)\\b" +
    "|\\bother (firms|companies|manufacturers)'|\\banother (company|firm|retailer|manufacturer|brand|maker)\\b" +
    "|\\bsold by another\\b|\\bsimilar\\b|\\bnearly identical\\b" +
    "|\\bpossibility\\b|\\bpotential(ly)?\\b|\\b(could|can) (result|cause|lead)\\b|\\brisk of\\b|\\bother recalled\\b" +
    "|\\b(dogs?|cats?|pets?|animals?|birds?|horses?)\\b",
  "i",
);
const FOREIGN = pyRe(
  "\\boutside (of )?the (U\\.\\s?S\\.|United States)|\\b(Canada|(?<!New )Mexico|Europe|Japan|Australia|New Zealand|United Kingdom|U\\.K\\.|England|Scotland|Ireland|Germany|France|Italy|Spain|Sweden|Norway|Denmark|Finland|Netherlands|Belgium|Switzerland|Austria|China|Hong Kong|Taiwan|Korea|India|Israel|Brazil|Chile|Argentina|South Africa|Russia|Manitoba|Ontario|Quebec|British Columbia|Alberta)\\b|\\boverseas\\b|\\babroad\\b",
);
const US_STATES =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|" +
  "Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|" +
  "Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|" +
  "Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|" +
  "West Virginia|Wisconsin|Wyoming|Puerto Rico";
const US = pyRe("\\b(United States|" + US_STATES + ")\\b|(?<!\\w)U\\.\\s?S\\.");
const OUTSIDE_US = pyRe("\\boutside (of )?the (U\\.\\s?S\\.|United States)", "i");

/** Sentences that still contain a death word after explicitly negated phrases are removed. */
export function deathSentences(text: string | null | undefined): string[] {
  const remaining = pySub(NEGATED_DEATH, " ", cleanText(text));
  return pySplit(SENTENCE, remaining).filter((s) => pySearch(DEATH, s));
}

/** 'background' | 'product' | null — see parsing.death_mention_class (a text rule, not a verified count). */
export function deathMentionClass(
  text: string | null | undefined,
): "background" | "product" | null {
  const sentences = deathSentences(text);
  if (!sentences.length) return null;
  if (!sentences.filter((s) => !pySearch(BACKGROUND, s)).length) return "background";
  if (pyMatch(NONE_FIRST, cleanText(text)) && !deathForeignOnly(text)) return "background";
  return "product";
}

/** Every product-class death sentence names a place outside the U.S. and none names the U.S. */
export function deathForeignOnly(text: string | null | undefined): boolean {
  const sentences = deathSentences(text).filter((s) => !pySearch(BACKGROUND, s));
  return (
    sentences.length > 0 &&
    sentences.every(
      (s) => Boolean(pySearch(FOREIGN, s)) && !pySearch(US, pySub(OUTSIDE_US, " ", s)),
    )
  );
}

const INJURY = pyRe(
  "\\binjur(y|ies|ed)\\b|\\bburns?\\b|\\blacerations?\\b|\\bbruis|\\bfractur|\\bconcussion|\\bhospital|\\bemergency (room|department)|\\bmedical (treatment|attention)",
  "i",
);
const NEGATED_INJURY = pyRe(
  "\\bno (reported |known )?(injur(y|ies)|incidents?)( or (injur(y|ies)|incidents?|deaths?))*( (have|has) been| were| was)? reported\\b|\\bno injur(y|ies)\\b|\\bwithout (any )?injur(y|ies)\\b|\\bnot aware of any (injur(y|ies)|incidents?)( or (injur(y|ies)|incidents?))*\\b",
  "i",
);

/** The whole injury statement says none were reported (e.g. 'None reported.'). */
export function reportsNone(text: string | null | undefined): boolean {
  const clean = cleanText(text);
  return (
    Boolean(clean) &&
    Boolean(pyMatch(NONE, clean)) &&
    !mentionsDeath(clean) &&
    !pySearch(INJURY, pySub(NEGATED_INJURY, " ", clean))
  );
}

export function mentionsInjury(text: string | null | undefined): boolean {
  return Boolean(pySearch(INJURY, pySub(NEGATED_INJURY, " ", text ?? "")));
}

const WORD_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const UNITS = pyRe(
  "^(?:about|approximately)?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\\s*(million|thousand)?\\s*(?:units)?\\.?$",
  "i",
);

const ND = /\p{Nd}/u;
/** Unicode decimal digits as ASCII (Python's float() reads any Nd digit); digit runs are encoded as aligned blocks of ten. */
function asciiDigits(s: string): string {
  if (/^\p{ASCII}*$/u.test(s)) return s;
  return Array.from(s, (ch) => {
    if (!ND.test(ch) || /[0-9]/.test(ch)) return ch;
    let cp = ch.codePointAt(0)!;
    let start = cp;
    while (ND.test(String.fromCodePoint(start - 1))) start--;
    cp -= start;
    return String(cp % 10);
  }).join("");
}

/** Strict parse of NumberOfUnits ('About 14,250', '1.2 million', 'Approximately 500 units'); anything else null. */
export function parseUnits(text: unknown): number | null {
  const m = pyMatch(UNITS, cleanText(text));
  if (!m) return null;
  const raw = m[1]!.toLowerCase();
  const scale = (m[2] ?? "").toLowerCase();
  let value = raw in WORD_NUM ? WORD_NUM[raw]! : Number(asciiDigits(raw).replace(/,/g, ""));
  if (scale === "million") value *= 1_000_000;
  else if (scale === "thousand") value *= 1_000;
  else if (raw.includes(".")) return null;
  return pyRound(value);
}

const PAREN = pyRe("\\([^)]*\\)", "g");
const COUNTRY_SPLIT = pyRe(",\\s*|\\s+and\\s+|;\\s*");

/** ManufacturerCountries value -> country names (parenthetical qualifiers dropped; split only into standalone values). */
export function normalizeCountry(
  value: string | null | undefined,
  standalone: Set<string>,
): string[] {
  const text = pyStrip(cleanText(pySub(PAREN, " ", value ?? "")), " ,;.");
  if (!text) return [];
  if (standalone.has(text)) return [text];
  const parts = pySplit(COUNTRY_SPLIT, text)
    .map((p) => cleanText(p))
    .filter(Boolean);
  if (parts.length > 1 && parts.every((p) => standalone.has(p))) return [...new Set(parts)];
  return [text];
}

/** Recall-level units only when every product row with a units string carries the same string and it parses. */
export function recallUnits(products: { NumberOfUnits?: unknown }[]): number | null {
  const texts = new Set(products.map((p) => cleanText(p.NumberOfUnits)).filter(Boolean));
  if (texts.size !== 1) return null;
  return parseUnits([...texts][0]);
}
