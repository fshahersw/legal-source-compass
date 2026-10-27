/**
 * The "largest resolutions" ranking for DOJ press releases. Pure (no I/O), shared by the $1B+ list and the health-care
 * dashboard's top resolutions.
 *
 * Rules, in order:
 *  1. Rank by the release's own headline figure (the title's figure, or the first resolution sentence's), never by the
 *     largest figure the text mentions (`max_resolution_amount_usd`), which often belongs to another matter.
 *  2. Leave out releases that are not resolutions: speeches, remarks and testimony; appointments, ceremonies and
 *     outreach; annual or fiscal-year statistics; victim-distribution announcements; and court filings or rulings about
 *     a law (a motion, a complaint, a statute struck down).
 *  3. Plausibility guard: a figure read from the text is held back when the title states a dollar amount that is less
 *     than a tenth of it, or when the title describes no resolution at all (no pay, settle, plead, sentence, forfeit…).
 *  4. Collapse releases that state the same figure (within 1%) about one matter (same release date or a shared distinctive name
 *     in the titles), and forfeiture or money judgments repeated across co-defendants' releases (figures within 15% and a
 *     shared distinctive name), so one resolution is listed once.
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
  | "title_contradicts"
  | "title_no_resolution";

export const HELD_LABEL: Record<HeldReason, string> = {
  speech: "Speech, remarks or testimony",
  personnel: "Appointment, ceremony or outreach",
  statistics: "Annual or fiscal-year totals",
  distribution: "Distribution to victims, not a new resolution",
  filing: "A filing or ruling, not a resolution",
  charge: "Charges or an arrest, not a resolution",
  title_contradicts: "The title states a much smaller amount",
  title_no_resolution: "The title describes no resolution",
};

export type LargestEntry = {
  release: DojRelease;
  /** The headline figure the entry is ranked by (USD). */
  valueUsd: number;
  /** Other releases stating the same resolution, collapsed into this entry (newest first). */
  related: DojRelease[];
};

export type HeldRelease = { release: DojRelease; reason: HeldReason; detail: string | null };

export type LargestResult = {
  entries: LargestEntry[];
  held: HeldRelease[];
  /** Releases whose headline figure reached the threshold before the rules above. */
  candidates: number;
};

const SPEECH =
  /\b(remarks|speech(?:es)?|delivers?|testif(?:y|ies|ied)|testimony|keynote|op-ed|prepared statement|statement (?:of|by|on)|applauds?)\b|^statement\b/i;
const PERSONNEL =
  /\b(appoint(?:ed|s|ment)?|sworn in|new leadership|commemorat\w*|recogni[sz]es|honou?rs|awards? ceremony|annual awards|attorney general'?s? awards?|retires|welcomes|departure|hosts?|annual meeting|launch(?:es|ed)?)\b|\breceiv\w*\b.*\b(?:award|honou?r|of the year)\b/i;
const STATISTICS =
  /\b(fiscal year|FY ?\d{2,4}|accomplishments|year in review|annual report|most successful years?|surpass\w*|since (?:19|20)\d\d)\b|\b(?:u\.?s\.? attorney['’]?s? office|usao)\b.*\b(?:collects?|recovers?)\b/i;
const DISTRIBUTION = /\bdistribut(?:ion|ions|es|ed|ing)\b/i;
const FILING =
  /\b(motion for|files? (?:a |an )?(?:motion|brief|complaint|lawsuit|suit|statement of interest|amicus)|filed (?:a |an )?(?:motion|brief|complaint|lawsuit|statement of interest)|strikes? down|challenge to)\b/i;
const CHARGE = /\b(indicted|indictment|faces charges|charged with|arrested|extradited)\b/i;
const OUTCOME = /\b(plead\w*|guilty|sentenc\w*|agree\w*|pay|pays|settle\w*|convicted|ordered)\b/i;
const NON_RESOLUTION_TOPICS = new Set([
  "Office and Personnel Updates",
  "Community Outreach",
  "Speeches",
]);
const RESOLUTION_WORD =
  /\b(pay|pays|paid|paying|settle\w*|agree\w*|resol\w*|plead\w*|guilty|sentenc\w*|forfeit\w*|penalt\w*|fine|fines|fined|restitution|judgment|verdict|ordered|consent decree|recover\w*|convicted)\b/i;
/**
 * A figure read from the text must be the kind of outcome the title describes: a settlement figure needs a settlement
 * in the title, a forfeiture a sentence, plea or order, and so on. Keywords not listed fall back to any resolution word.
 */
const KEYWORD_TITLE: Record<string, RegExp> = {
  settlement: /\b(settle\w*|agree\w*|resol\w*|pay|pays|paid|consent decree)\b/i,
  forfeiture: /\b(forfeit\w*|sentenc\w*|plead\w*|guilty|convicted|ordered)\b/i,
  judgment: /\b(judgment|verdict|ordered|jury|awarded)\b/i,
  "penalty or fine":
    /\b(pay|pays|paid|penalt\w*|fine|fines|fined|plead\w*|guilty|sentenc\w*|agree\w*|settle\w*|resol\w*)\b/i,
  restitution: /\b(restitution|sentenc\w*|ordered|plead\w*|guilty|pay|pays)\b/i,
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

/** Why a release is not ranked as a resolution, or null when it is. */
export function heldReason(r: DojRelease): { reason: HeldReason; detail: string | null } | null {
  const t = r.title;
  if (SPEECH.test(t) || r.topics.includes("Speeches")) return { reason: "speech", detail: null };
  if (PERSONNEL.test(t) || r.topics.some((x) => NON_RESOLUTION_TOPICS.has(x)))
    return { reason: "personnel", detail: null };
  if (STATISTICS.test(t)) return { reason: "statistics", detail: null };
  if (DISTRIBUTION.test(t)) return { reason: "distribution", detail: null };
  if (FILING.test(t)) return { reason: "filing", detail: null };
  if (CHARGE.test(t) && !OUTCOME.test(t)) return { reason: "charge", detail: null };
  const h = r.headline;
  if (h && h.source !== "title") {
    const stated = titleAmounts(t);
    const top = stated.length ? Math.max(...stated) : null;
    if (top !== null && top > 0 && h.valueUsd > top * 10)
      return {
        reason: "title_contradicts",
        detail: `The title states ${fmt(top)}; the figure read from the text is ${fmt(h.valueUsd)}.`,
      };
    if (top === null) {
      const fits = (h.keyword && KEYWORD_TITLE[h.keyword]) || RESOLUTION_WORD;
      if (!fits.test(t))
        return {
          reason: "title_no_resolution",
          detail: `The ${h.keyword ?? "resolution"} figure ${fmt(h.valueUsd)} comes from the text; the title describes no such outcome.`,
        };
    }
  }
  return null;
}

// Words too common in release titles to identify a matter.
const STOP = new Set(
  (
    "about above according acting additional after against agree agrees agreed agreement agreements allegations alleged " +
    "america american announce announces announced another assistant attorney attorneys backed billion business charged " +
    "charges civil claims company companies compensate controller corporation court criminal defendants department " +
    "director district division during eastern employees enters executive false federal former fraud fraudulent general " +
    "global government group guilty health healthcare historic including international investigation investment justice " +
    "largest manhattan million misrepresentations months mortgage national northern office officer operations pleads " +
    "prison record related residential resolve resolves resolution roles scheme securities sentenced settlement " +
    "southern states their total trustee united victims western years million billion pharmaceutical pharmaceuticals " +
    "holdings financial services agrees cartel reach reaches"
  ).split(" "),
);

/** Distinctive capitalised words (5+ letters) of a title, lower-cased: the names that identify a matter. */
export function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const m of title.matchAll(/\b([A-Z][A-Za-z’'-]{4,})\b/g)) {
    const w = m[1]!.toLowerCase().replace(/[’'].*$/, "");
    if (w.length >= 5 && !STOP.has(w)) out.add(w);
  }
  return out;
}

const shares = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));
const within = (a: number, b: number, rel: number) =>
  Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));
const MONEY_JUDGMENT = /forfeit|judgment/i;

type Group = { members: DojRelease[]; value: number; tokens: Set<string>; dates: Set<string> };

function newer(a: DojRelease, b: DojRelease) {
  return (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id);
}

/**
 * Rank releases by their own headline figure (at least `minUsd`), leaving out non-resolutions and implausible figures
 * and collapsing repeats of one resolution. Releases repeated across partitions (same id or same URL) count once.
 */
export function rankLargestResolutions(
  releases: readonly DojRelease[],
  minUsd = 1e9,
): LargestResult {
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
  const kept: DojRelease[] = [];
  for (const r of candidates) {
    const why = heldReason(r);
    if (why) held.push({ release: r, ...why });
    else kept.push(r);
  }
  kept.sort((a, b) => b.headline!.valueUsd - a.headline!.valueUsd || newer(a, b));

  // 1) same figure about one matter
  const groups: Group[] = [];
  for (const r of kept) {
    const v = r.headline!.valueUsd;
    const tokens = titleTokens(r.title);
    const d = r.date;
    const g = groups.find(
      (x) =>
        within(x.value, v, 0.01) && ((d !== null && x.dates.has(d)) || shares(x.tokens, tokens)),
    );
    if (g) {
      g.members.push(r);
      for (const t of tokens) g.tokens.add(t);
      if (d) g.dates.add(d);
    } else groups.push({ members: [r], value: v, tokens, dates: new Set(d ? [d] : []) });
  }

  // 2) one forfeiture or money judgment repeated across co-defendants' releases
  const merged: Group[] = [];
  for (const g of groups) {
    const lead = g.members[0]!;
    const isJudgment = MONEY_JUDGMENT.test(lead.headline!.keyword ?? "");
    const into = isJudgment
      ? merged.find(
          (m) =>
            MONEY_JUDGMENT.test(m.members[0]!.headline!.keyword ?? "") &&
            within(m.value, g.value, 0.15) &&
            shares(m.tokens, g.tokens),
        )
      : undefined;
    if (into) {
      into.members.push(...g.members);
      for (const t of g.tokens) into.tokens.add(t);
    } else merged.push({ ...g, members: [...g.members], tokens: new Set(g.tokens) });
  }

  const entries = merged.map((g): LargestEntry => {
    // the entry shows its largest figure; the newest release stating it leads
    const top = Math.max(...g.members.map((m) => m.headline!.valueUsd));
    const atTop = g.members.filter((m) => m.headline!.valueUsd === top).sort(newer);
    const release = atTop[0]!;
    return {
      release,
      valueUsd: top,
      related: g.members.filter((m) => m !== release).sort(newer),
    };
  });
  entries.sort((a, b) => b.valueUsd - a.valueUsd || newer(a.release, b.release));
  held.sort((a, b) => b.release.headline!.valueUsd - a.release.headline!.valueUsd);
  return { entries, held, candidates: candidates.length };
}
