/**
 * The "largest resolutions" ranking for DOJ press releases. Pure (no I/O), shared by the $1B+ list and the health-care
 * dashboard's top resolutions.
 *
 * Rules, in order:
 *  1. Rank only figures the release's own title states with a resolution verb (headline source "title"), never the
 *     largest figure the text mentions (`max_resolution_amount_usd`), which often belongs to another matter. A figure
 *     read from the text (the first resolution sentence) is not ranked: it is listed separately (`textOnly`) when it
 *     passes every check below, and held back otherwise.
 *  2. Leave out releases that are not resolutions: speeches, statements, remarks and testimony; appointments,
 *     ceremonies and outreach; annual, fiscal-year or multi-year totals; victim distributions; court filings or rulings
 *     about a law; and charges, arrests and takedowns.
 *  3. Checks on a text figure: held when the title states an amount that differs from it by a factor of 2 or more;
 *     when the title or sentence states a statutory maximum ("not more than", "up to", "faces"); when the words before
 *     the figure describe an amount claimed, alleged, held, lost, totalled across matters or the size of a scheme rather
 *     than a resolution; when the title describes no outcome of that figure's kind; and when the sentence names, before
 *     the figure, no one the title names (one exact-word check: the figure is about another party).
 *  4. Collapse releases only on exact keys: the same id or URL; the same normalised title (case and punctuation only)
 *     on the same date or with the same figure; the same figure on the same date from the same DOJ component; or the
 *     same figure on the same date with the same normalised title text up to and including that figure. Title words
 *     are never compared one by one (no name-similarity grouping).
 * Nothing is summed: each entry is one figure as one release states it.
 */
import type { DojRelease } from "./enforcementActions.functions";

export type HeldReason =
  | "speech"
  | "personnel"
  | "statistics"
  | "distribution"
  | "filing"
  | "charge"
  | "maximum"
  | "not_outcome"
  | "title_contradicts"
  | "title_no_resolution"
  | "other_party";

export const HELD_LABEL: Record<HeldReason, string> = {
  speech: "Speech, statement, remarks or testimony",
  personnel: "Appointment, ceremony or outreach",
  statistics: "Annual, fiscal-year or multi-year totals",
  distribution: "Distribution to victims, not a new resolution",
  filing: "A filing or ruling, not a resolution",
  charge: "Charges, an arrest or a takedown, not a resolution",
  maximum: "A statutory maximum, not an outcome",
  not_outcome: "An amount claimed, held, lost or totalled, not a resolution",
  title_contradicts: "The title states a different amount",
  title_no_resolution: "The title describes no resolution of this kind",
  other_party: "The sentence does not name the title's party",
};

export type LargestEntry = {
  release: DojRelease;
  /** The headline figure the entry is ranked by (USD). */
  valueUsd: number;
  /** Other releases stating the same resolution (exact keys only), collapsed into this entry (newest first). */
  related: DojRelease[];
};

export type HeldRelease = { release: DojRelease; reason: HeldReason; detail: string | null };

export type LargestResult = {
  /** Ranked: figures the release title itself states. */
  entries: LargestEntry[];
  /** Not ranked: figures read only from the release text that pass every check (the title states no other amount). */
  textOnly: LargestEntry[];
  held: HeldRelease[];
  /** Releases whose headline figure reached the threshold before the rules above. */
  candidates: number;
};

const SPEECH =
  /\b(remarks|speech(?:es)?|delivers?|testif(?:y|ies|ied)|testimony|keynote|op-ed|prepared statements?|statements? (?:of|by|on|from)|applauds?)\b|^statements?\b/i;
const PERSONNEL =
  /\b(appoint(?:ed|s|ment)?|sworn in|new leadership|commemorat\w*|recogni[sz]es|honou?rs|awards? ceremony|annual awards|attorney general'?s? awards?|retires|welcomes|departure|hosts?|annual meeting|launch(?:es|ed)?)\b|\breceiv\w*\b.*\b(?:award|honou?r|of the year)\b/i;
const MONTH = "(?:january|february|march|april|may|june|july|august|september|october|november|december)";
const STATISTICS = new RegExp(
  [
    String.raw`\b(?:fiscal year|FY ?\d{2,4}|accomplishments|year in review|annual report|most successful years?|surpass\w*)\b`,
    String.raw`\bsince (?:${MONTH} )?(?:19|20)\d\d\b`,
    String.raw`\bin (?:19|20)\d\d\b`,
    String.raw`\bbetween (?:${MONTH} )?(?:19|20)\d\d and (?:${MONTH} )?(?:19|20)\d\d\b`,
    String.raw`\b(?:during|over) (?:a |the )?(?:past )?[\w-]+[- ]year period\b`,
    String.raw`\brecoveries totall?ing\b`,
    String.raw`\brecord[- ]breaking recoveries\b`,
    String.raw`\b(?:judgments and settlements|settlements and judgments)\b`,
    String.raw`\b(?:u\.?s\.? attorney['’]?s? office|usao)\b.*\b(?:collects?|recovers?|secures?)\b`,
  ].join("|"),
  "i",
);
/** Victim payouts from forfeited funds (not "distributing" a drug, which is an offence). */
const DISTRIBUTION =
  /\bdistributions?\b.*\b(?:to|of)\b.*\bvictims?\b|\bvictims?['’]? (?:compensation )?fund\b|\bdistribution of (?:funds|forfeited|assets)\b|\b(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final|initial|additional|total) distributions?\b|\bremission\b|\b(?:compensates?|returns?|returned)\b.*\bto (?:crime )?victims\b/i;
const FILING =
  /\b(motion for|files? (?:a |an )?(?:motion|brief|complaint|lawsuit|suit|statement of interest|amicus|civil (?:action|complaint|forfeiture))|filed (?:a |an )?(?:motion|brief|complaint|lawsuit|statement of interest)|strikes? down|challenge to)\b/i;
/** Always a charge, whatever else the title says. */
const CHARGE_ALWAYS = /\b(takedown|arrested|extradited)\b/i;
/** A charge unless the title also states an outcome. */
const CHARGE = /\b(indicted|indictment|faces charges|charged|charges against)\b/i;
const OUTCOME = /\b(plead\w*|guilty|sentenc\w*|agree\w*|pay|pays|settle\w*|convicted|ordered)\b/i;
const NON_RESOLUTION_TOPICS = new Set(["Office and Personnel Updates", "Community Outreach", "Speeches"]);
/** Statutory-maximum wording in a sentence ("faces ... a fine of not more than $1,000,000,000"). */
const MAXIMUM = /\b(not more than|up to|maximum|faces?|facing|could face)\b/i;
/** The same in a title ("Pay Up to $350M" caps a real settlement, so "up to" alone does not count there). */
const TITLE_MAXIMUM =
  /\b(not more than|maximum (?:fine|penalty|sentence)|faces? (?:up to|a maximum|a fine)|could face)\b/i;
/** Words before a text figure that describe something other than a resolution amount (a claim, a loss, holdings). */
const NOT_OUTCOME =
  /\b(alleged(?:ly)?|claim(?:ed|ing)|purported(?:ly)?|bogus|fake|fictitious|sham|indebted|seek(?:s|ing)?|sought|demand(?:ed|s|ing)?|misappropriated|embezzled|stole|stolen|laundered|losses|lost|under management|in addition to|parallels|builds on)\b/gi;
/** A resolution word before the figure: a not-outcome word only counts when it comes after the last one. */
const BEFORE_OUTCOME =
  /\b(pay|pays|paid|paying|forfeit\w*|ordered|agree\w*|settle\w*|fine|fines|fined|restitution|penalt\w*|judgment)\b/gi;
/** An aggregate across matters running up to the figure ("total fines ... of more than"); "a total of" is one payment. */
const AGGREGATE = /(?:(?<!\ba )\btotal\b|\bcollectively\b|\baggregate\b)[^$]{0,90}$/i;
/** A figure that sizes a scheme rather than resolving it ("a nearly $1 billion health care fraud scheme"). */
const SCHEME_SIZE =
  /^\s*(?!(?:for|to|in|over|under|from|after|as|and|of|by|with)\b)(?:[\w-]+\s+){0,3}(?:fraud|scheme|ponzi)\b/i;
/** A title figure that is a debt being collected, not this release's outcome. */
const TITLE_NOT_OUTCOME = /\befforts to collect\b/i;
const RESOLUTION_WORD =
  /\b(pay|pays|paid|paying|settle\w*|agree\w*|resol\w*|plead\w*|guilty|sentenc\w*|forfeit\w*|penalt\w*|fine|fines|fined|restitution|judgment|verdict|ordered|consent decree|recover\w*|convicted)\b/i;
/**
 * A figure read from the text must be the kind of outcome the title describes: a settlement figure needs a settlement
 * in the title, a forfeiture a sentence, plea or order, a judgment a judgment, verdict, award or order to pay ("jury"
 * alone is a conviction, not a money judgment). Keywords not listed fall back to any resolution word.
 */
const KEYWORD_TITLE: Record<string, RegExp> = {
  settlement: /\b(settle\w*|agree\w*|resol\w*|pay|pays|paid|consent decree)\b/i,
  forfeiture: /\b(forfeit\w*|sentenc\w*|plead\w*|pleas?|admit\w*|guilty|convicted|ordered)\b/i,
  judgment: /\b(judgments?|verdicts?|awarded|awards|ordered to pay)\b/i,
  "penalty or fine":
    /\b(pay|pays|paid|penalt\w*|fine|fines|fined|plead\w*|pleas?|admit\w*|guilty|sentenc\w*|agree\w*|settle\w*|resol\w*)\b/i,
  restitution: /\b(restitution|sentenc\w*|ordered|plead\w*|pleas?|admit\w*|guilty|pay|pays)\b/i,
};

const MULTIPLIER: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  mm: 1e6,
  billion: 1e9,
  b: 1e9,
  bn: 1e9,
  trillion: 1e12,
};

/** Dollar amounts written in a title ("$4 Billion", "$378 Million", "$22,164,212.92"), in USD. */
export function titleAmounts(title: string): number[] {
  const out: number[] = [];
  const re =
    /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(thousand|million|billion|trillion|mm|bn|[kmb])\b)?/gi;
  for (const m of title.matchAll(re)) {
    const n = Number(m[1]!.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const mult = m[2] ? (MULTIPLIER[m[2].toLowerCase()] ?? 1) : 1;
    out.push(n * mult);
  }
  return out;
}

const fmt = (v: number) =>
  v >= 1e9
    ? `$${(v / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 })} billion`
    : v >= 1e6
      ? `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} million`
      : `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// Capitalised title words that name no one: generic nouns, verbs and title-case function words.
const GENERIC = new Set(
  (
    "about above according acting additional after against agree agrees agreed agreement agreements allegations alleged " +
    "america american announce announces announced another area assets assistant attorney attorneys back backed billion " +
    "business cartel charge charged charges civil claims co-founder commander company companies compensate conspiracy " +
    "controller convicted convicts corporation court courts criminal defendant defendants department director district " +
    "division drug drugs during eastern employee employees enters executive false federal filed files following forfeit " +
    "forfeits forfeiture former founder fraud fraudulent from general global government group guilty health healthcare " +
    "high high-ranking historic illegal including international into investigation investment judge jury justice largest " +
    "laundering leader life manhattan medicare member million misrepresentations money months mortgage national northern " +
    "office officer operations operative ordered over pays plead pleads pleaded police prison proceeds ranking record " +
    "related residential resolve resolves resolution role roles scheme schemes securities sentenced sentences settlement " +
    "settles southern state states their that this total trafficking trustee united victims western with years " +
    "pharmaceutical pharmaceuticals holdings financial services reach reaches results resulting role sells selling " +
    "under will plus their them they days weeks the and for its his her was has who are new out off all any but not " +
    "now per via inc llc corp ltd one two three four five six seven eight nine ten eleven twelve dozens hundreds"
  ).split(" "),
);

/** Capitalised words of a title (3+ letters, not generic), lower-cased: the names a sentence must share. */
export function titleNames(title: string): Set<string> {
  const out = new Set<string>();
  for (const m of title.matchAll(/(?<![\w’'-])([A-Z][A-Za-z’'-]{2,})/g)) {
    const w = m[1]!.toLowerCase().replace(/[’'](?:s)?$/, "");
    if (w.length >= 3 && !GENERIC.has(w)) out.add(w);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Why a release is not a resolution by its title, or null. */
function titleReason(r: DojRelease): HeldReason | null {
  const t = r.title;
  if (SPEECH.test(t) || r.topics.includes("Speeches")) return "speech";
  if (PERSONNEL.test(t) || r.topics.some((x) => NON_RESOLUTION_TOPICS.has(x))) return "personnel";
  if (STATISTICS.test(t)) return "statistics";
  if (DISTRIBUTION.test(t)) return "distribution";
  if (FILING.test(t)) return "filing";
  if (CHARGE_ALWAYS.test(t) || (CHARGE.test(t) && !OUTCOME.test(t))) return "charge";
  if (TITLE_MAXIMUM.test(t)) return "maximum";
  if (TITLE_NOT_OUTCOME.test(t)) return "not_outcome";
  return null;
}

/** Why a release is neither ranked nor listed as a text figure, or null when it is kept. */
export function heldReason(r: DojRelease): { reason: HeldReason; detail: string | null } | null {
  const byTitle = titleReason(r);
  if (byTitle) return { reason: byTitle, detail: null };
  const h = r.headline;
  if (!h || h.source === "title") return null;

  const t = r.title;
  const stated = titleAmounts(t).filter((v) => v > 0);
  // the title's amount closest to the text figure; 2x or more apart either way is a contradiction
  const nearest = stated.length
    ? stated.reduce((a, b) =>
        Math.abs(Math.log(b / h.valueUsd)) < Math.abs(Math.log(a / h.valueUsd)) ? b : a,
      )
    : null;
  if (nearest !== null && Math.max(nearest, h.valueUsd) >= 2 * Math.min(nearest, h.valueUsd))
    return {
      reason: "title_contradicts",
      detail: `The title states ${fmt(nearest)}; the figure read from the text is ${fmt(h.valueUsd)}.`,
    };

  const sentence = h.sentence ?? "";
  const at = sentence.indexOf(h.asWritten);
  const before = at >= 0 ? sentence.slice(0, at) : sentence;
  if (MAXIMUM.test(sentence))
    return { reason: "maximum", detail: `The sentence states a maximum: “${sentence.slice(0, 200)}”` };
  const lastAt = (re: RegExp) => Math.max(-1, ...[...before.matchAll(re)].map((m) => m.index ?? -1));
  const after = at >= 0 ? sentence.slice(at + h.asWritten.length) : "";
  if (
    AGGREGATE.test(before) ||
    lastAt(NOT_OUTCOME) > lastAt(BEFORE_OUTCOME) ||
    SCHEME_SIZE.test(after)
  )
    return {
      reason: "not_outcome",
      detail: `The words before ${fmt(h.valueUsd)} do not describe a resolution: “${sentence.slice(0, 200)}”`,
    };
  const fits = (h.keyword && KEYWORD_TITLE[h.keyword]) || RESOLUTION_WORD;
  if (!fits.test(t))
    return {
      reason: "title_no_resolution",
      detail: `The ${h.keyword ?? "resolution"} figure ${fmt(h.valueUsd)} comes from the text; the title describes no such outcome.`,
    };
  // the sentence must name, before the figure, a party the title names (one exact-word check)
  const names = [...titleNames(t)];
  const named = names.some((w) =>
    new RegExp(`(?<![\\w-])${escapeRe(w)}(?![\\w-])`, "i").test(before),
  );
  if (!named)
    return {
      reason: "other_party",
      detail: `The sentence names no one the title names before the figure: “${sentence.slice(0, 200)}”`,
    };
  return null;
}

/** Title with case and punctuation removed (nothing else): an exact key. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$]+/gu, " ")
    .trim();
}

function newer(a: DojRelease, b: DojRelease) {
  return (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id);
}

/**
 * Group releases that state one resolution, on exact keys only (see rule 4). Union-find over the keys, so a chain of
 * exact matches lands in one group.
 */
export function collapseExact(releases: readonly DojRelease[]): LargestEntry[] {
  const parent = releases.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  releases.forEach((r, i) => {
    const v = r.headline!.valueUsd;
    const title = normaliseTitle(r.title);
    const keys = [`v:${v}|t:${title}`];
    if (r.date) {
      keys.push(`d:${r.date}|t:${title}`);
      for (const c of r.components) keys.push(`d:${r.date}|v:${v}|c:${c}`);
      // a title figure: the same title words up to and including the figure, on the same date
      const at = r.headline!.source === "title" ? r.title.indexOf(r.headline!.asWritten) : -1;
      if (at >= 0)
        keys.push(
          `d:${r.date}|v:${v}|p:${normaliseTitle(r.title.slice(0, at + r.headline!.asWritten.length))}`,
        );
    }
    for (const k of keys) {
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, DojRelease[]>();
  releases.forEach((r, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  });
  const entries = [...groups.values()].map((members): LargestEntry => {
    // the entry shows its largest figure; the newest release stating it leads
    const top = Math.max(...members.map((m) => m.headline!.valueUsd));
    const release = members.filter((m) => m.headline!.valueUsd === top).sort(newer)[0]!;
    return { release, valueUsd: top, related: members.filter((m) => m !== release).sort(newer) };
  });
  return entries.sort((a, b) => b.valueUsd - a.valueUsd || newer(a.release, b.release));
}

/**
 * Rank releases whose title states a figure of at least `minUsd`, list text-only figures separately, hold back
 * non-resolutions and implausible figures, and collapse repeats on exact keys. Releases repeated across partitions
 * (same id or same URL) count once.
 */
export function rankLargestResolutions(releases: readonly DojRelease[], minUsd = 1e9): LargestResult {
  const seen = new Set<string>();
  const unique: DojRelease[] = [];
  for (const r of releases) {
    const key = r.url ?? r.id;
    if (seen.has(r.id) || seen.has(key)) continue;
    seen.add(r.id);
    seen.add(key);
    unique.push(r);
  }
  const candidates = unique.filter((r) => r.headline && r.headline.valueUsd >= minUsd);
  const held: HeldRelease[] = [];
  const ranked: DojRelease[] = [];
  const text: DojRelease[] = [];
  for (const r of candidates) {
    const why = heldReason(r);
    if (why) held.push({ release: r, ...why });
    else if (r.headline!.source === "title") ranked.push(r);
    else text.push(r);
  }
  held.sort((a, b) => b.release.headline!.valueUsd - a.release.headline!.valueUsd);
  return {
    entries: collapseExact(ranked),
    textOnly: collapseExact(text),
    held,
    candidates: candidates.length,
  };
}
