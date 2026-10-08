/**
 * Period and age terms in a tolling or repose note, and whether the cited section's current text prints them.
 *
 * A note is the builder's paraphrase of a statute ("may sue within one year after the disability is removed,
 * but never more than eight years after the act"); the terms are the numbers that make it a rule: durations
 * ("1 year", "8 years") and ages of majority ("age 18"). The check asks only whether each term, in digits or in
 * words, appears with its unit in the current section text. It is a consistency check on the note's numbers,
 * not a reading of the statute: a term that is present proves the number is still printed there, a term that
 * is not present means a person must compare the note with the section before relying on it.
 */

export type CrossReferenceTermCheck = "all_present" | "not_all_present" | "none_to_check";

const SMALL = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
const TENS: Record<number, string> = { 20: "twenty", 30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety" };

/** The words for a number as statutes print them ("twenty-one", "one hundred eighty"); null above 999. */
export function numberWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  if (n <= 20) return SMALL[n]!;
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10) * 10]!;
    const ones = n % 10;
    return ones ? `${tens}-${SMALL[ones]}` : tens;
  }
  const hundreds = `${SMALL[Math.floor(n / 100)]} hundred`;
  const rest = n % 100;
  return rest ? `${hundreds} ${numberWords(rest)}` : hundreds;
}

const WORD_TO_NUMBER = new Map<string, number>();
for (let n = 0; n <= 999; n++) {
  const w = numberWords(n);
  if (w) WORD_TO_NUMBER.set(w, n);
}

const NUMBER_WORD = "(?:one hundred (?:and )?)?(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one hundred(?: and)?(?: [a-z-]+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
const UNIT = "(years?|months?|weeks?|days?)";

/** "one year", "two (2) years", "18 months", "one-year", "ninety days" → "1 year", "2 year", "18 month", "1 year", "90 day". */
const DURATION = new RegExp(`\\b(\\d{1,3}|${NUMBER_WORD})\\b\\s*(?:\\(\\d{1,3}\\)\\s*)?[- ]?\\s*${UNIT}\\b(?!\\s+(?:of\\s+age|old)\\b)`, "gi");
/** "under 18", "age of 21", "attains 18", "18 years of age", "eighteenth birthday" → "age 18". */
const AGE_BEFORE = /\b(?:under(?: the age of)?|age of|ages?|attains?(?: the age of)?|attained(?: the age of)?|reach(?:es|ed)?(?: the age of)?|turns?|younger than|less than)\s+(\d{2}|eighteen|nineteen|twenty|twenty[- ]one)\b(?!\s*(?:years?|months?|days?)\b(?!\s+of\s+age))(?!\s*(?:[A-Z][A-Za-z]*\.|§|U\.S\.C|-\d))/gi;
const AGE_AFTER = /\b(\d{2}|eighteen|nineteen|twenty|twenty[- ]one)\s+years\s+(?:of\s+age|old)\b/gi;
const ORDINAL_BIRTHDAY = /\b(eighteenth|nineteenth|twentieth|twenty[- ]first)\s+birthday\b/gi;
const ORDINAL_AGE: Record<string, number> = { eighteenth: 18, nineteenth: 19, twentieth: 20, "twenty-first": 21, "twenty first": 21 };

function toNumber(token: string): number | null {
  const t = token.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^\d+$/.test(t)) return Number(t);
  return WORD_TO_NUMBER.get(t) ?? WORD_TO_NUMBER.get(t.replace(/ /g, "-")) ?? WORD_TO_NUMBER.get(t.replace(/-/g, " ")) ?? null;
}

/** The distinct period and age terms stated in a note, in canonical form ("1 year", "90 day", "age 18"). */
export function extractPeriodTerms(note: string): string[] {
  const out = new Set<string>();
  const text = note.replace(/\s+/g, " ");
  for (const m of text.matchAll(DURATION)) {
    const n = toNumber(m[1]!);
    if (n === null || n === 0) continue;
    out.add(`${n} ${m[2]!.toLowerCase().replace(/s$/, "")}`);
  }
  for (const re of [AGE_BEFORE, AGE_AFTER]) {
    for (const m of text.matchAll(re)) {
      const n = toNumber(m[1]!);
      if (n !== null && n >= 14 && n <= 21) out.add(`age ${n}`);
    }
  }
  for (const m of text.matchAll(ORDINAL_BIRTHDAY)) {
    const n = ORDINAL_AGE[m[1]!.toLowerCase().replace(/\s+/g, "-")] ?? ORDINAL_AGE[m[1]!.toLowerCase()];
    if (n) out.add(`age ${n}`);
  }
  return [...out];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every printed form of a number: digits, words, and the "two (2)" statute form. */
function numberForms(n: number): string[] {
  const forms = [String(n)];
  const w = numberWords(n);
  if (w) {
    forms.push(w, w.replace(/-/g, " "), w.replace(/ /g, "-"));
    forms.push(`${w} \\(${n}\\)`, `${w.replace(/-/g, " ")} \\(${n}\\)`);
  }
  return [...new Set(forms)].map((f) => (f.includes("\\(") ? f : escape(f)));
}

function normaliseBody(body: string): string {
  return body
    .normalize("NFKC")
    .replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Whether the section text prints the term: a duration needs the number (digits or words) followed by its
 * unit; an age needs the number in digits or words, not as part of a section number ("18-1-102", "§ 18.5").
 */
export function termPresent(body: string, term: string): boolean {
  const text = normaliseBody(body);
  const age = /^age (\d+)$/.exec(term);
  if (age) {
    const n = Number(age[1]);
    const forms = numberForms(n).filter((f) => !f.includes("\\("));
    return new RegExp(`(?<![\\d§.-])\\b(?:${forms.join("|")})\\b(?![-.]\\d)`, "i").test(text);
  }
  const dur = /^(\d+) (year|month|week|day)$/.exec(term);
  if (!dur) return false;
  const n = Number(dur[1]);
  const unit = dur[2]!;
  const forms = numberForms(n);
  return new RegExp(`(?<![\\d.-])\\b(?:${forms.join("|")})\\s*-?\\s*${unit}s?\\b`, "i").test(text);
}
