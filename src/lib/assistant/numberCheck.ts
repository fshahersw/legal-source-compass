/**
 * The deterministic check on a generated section summary: every number a sentence states must appear in the section
 * context it was written from. A sentence with a number the context does not hold is dropped, and the reader is told
 * "some details omitted". Pure and tested (numberCheck.test.ts); no model is involved.
 *
 * What counts as the same number:
 *  - the same digits after removing thousands commas ("303,716" is 303716; "4.4%" and "4.4 percent" are 4.4; a leading
 *    sign or currency mark is ignored);
 *  - a scaled restatement of a context number when it is correctly rounded to the digits shown ("303.7 thousand" for
 *    303,716; "$3.9 billion" for "$3.94 billion");
 *  - a number written out in full for a context number given with a scale ("3,940,000,000" for "3.94 billion").
 * Anything else, including a sum, a difference or a rounded plain number, is not in the context and fails.
 */

export type NumberMention = { value: number; decimals: number; scale: number };

const SCALE_WORDS: Record<string, number> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};
const SCALE_LETTERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  b: 1e9,
  bn: 1e9,
  tn: 1e12,
};

const NUMBER = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/g;

/** Every number in `text`, in order, with the scale word that follows it ("3.94 billion", "$1.2M"). */
export function numberMentions(text: string): NumberMention[] {
  const out: NumberMention[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const whole = match[1]!.replace(/,/g, "");
    const fraction = match[2] ?? "";
    const value = Number(`${whole}${fraction}`);
    if (!Number.isFinite(value)) continue;
    const tail = text.slice((match.index ?? 0) + match[0].length);
    let scale = 1;
    const word = /^\s+(thousand|million|billion|trillion)\b/i.exec(tail);
    if (word) scale = SCALE_WORDS[word[1]!.toLowerCase()]!;
    else {
      const letter = /^(k|mm|mn|m|bn|tn|b)(?![A-Za-z])/i.exec(tail);
      if (letter) scale = SCALE_LETTERS[letter[1]!.toLowerCase()]!;
    }
    out.push({ value, decimals: fraction ? fraction.length - 1 : 0, scale });
  }
  return out;
}

const same = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** True when `m` is a number the context states, or a correctly rounded restatement of one. */
export function supported(m: NumberMention, context: readonly NumberMention[]): boolean {
  for (const c of context) {
    const full = c.value * c.scale;
    if (m.scale === 1) {
      // the digits as the context prints them, or the number written out in full
      if (same(m.value, c.value) || same(m.value, full)) return true;
    } else if (m.scale === c.scale && same(m.value, c.value)) {
      return true;
    } else {
      const effective = m.value * m.scale;
      if (same(effective, full)) return true;
      // "303.7 thousand" for 303,716: the context number divided by the scale, rounded to the digits shown
      if (Number((full / m.scale).toFixed(m.decimals)) === m.value) return true;
    }
  }
  return false;
}

const ABBREVIATION =
  /\b(?:U\.S|U\.S\.C|C\.F\.R|No|Nos|Inc|Corp|Co|Ltd|vs|v|St|Dr|Mr|Ms|Mrs|Jr|Sr|e\.g|i\.e|etc|Fed|Cir|Dist|Ct)\.$/;

/** Splits prose into sentences without cutting "U.S." or a decimal. */
export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  const boundary = /[.!?]["')\]]*\s+(?=[A-Z0-9"'(])/g;
  for (const match of text.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].trimEnd().length;
    const head = text.slice(start, end);
    if (ABBREVIATION.test(head)) continue;
    parts.push(head.trim());
    start = (match.index ?? 0) + match[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

/** Plain text of a model line: markdown emphasis, code ticks and heading marks removed. */
function plain(line: string): string {
  return line
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BULLET = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+/;
export const THIN_SENTENCE = "Not enough figures here to summarize.";

export type CheckedSummary = {
  /** Sentences that passed the check, grouped as the model wrote them, at most `maxBullets` bullets. */
  bullets: string[];
  /** Sentences left out because they stated a number the context does not hold. */
  omitted: number;
  /** The model said the figures are too thin to summarize. */
  thin: boolean;
};

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Checks a model answer against the context text it was written from. The answer is read as bullets (a line per
 * bullet, or one bullet per sentence when it is plain prose); each sentence is kept only if every number in it is
 * supported. A bullet with no surviving sentence disappears. At most `maxBullets` bullets and about `maxWords` words are
 * kept, in order, so the reader gets the model's first points.
 */
export function checkSummary(
  modelText: string,
  contextText: string,
  options: { maxBullets?: number; maxWords?: number } = {},
): CheckedSummary {
  const maxBullets = options.maxBullets ?? 4;
  const maxWords = options.maxWords ?? 110;
  const text = modelText.trim();
  if (
    text
      .replace(/[^A-Za-z ]/g, "")
      .toLowerCase()
      .startsWith("not enough figures here to summarize")
  )
    return { bullets: [], omitted: 0, thin: true };

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bulleted = lines.some((l) => BULLET.test(l));
  const groups: string[][] = bulleted
    ? lines.filter((l) => BULLET.test(l)).map((l) => splitSentences(plain(l.replace(BULLET, ""))))
    : splitSentences(plain(lines.join(" "))).map((s) => [s]);

  const known = numberMentions(contextText);
  let omitted = 0;
  const bullets: string[] = [];
  let total = 0;
  for (const sentences of groups) {
    if (bullets.length >= maxBullets) break;
    const ok = sentences.filter((s) => {
      const good = numberMentions(s).every((m) => supported(m, known));
      if (!good) omitted += 1;
      return good;
    });
    if (!ok.length) continue;
    const bullet = ok.join(" ");
    // the word budget cuts the tail, never the first point
    if (bullets.length && total + words(bullet) > maxWords) break;
    bullets.push(bullet);
    total += words(bullet);
  }
  return { bullets, omitted, thin: false };
}
