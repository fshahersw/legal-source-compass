/**
 * CPSC recalls reporting a death, from agency_safety_cpsc_recalls_api.
 *
 * Three groups, never mixed:
 *  - "product": the dataset's own death_mention tag reads "Product-related" (incl. "outside U.S. only").
 *  - "missed": the tag reads "No" or is blank, but the injury statement or title says someone died (the 2025-07-21
 *    above-ground pools recall, "nine children ... have drowned", is tagged "No").
 *  - "background": the tag reads "Background / other product" (deaths with another product, or not of a person).
 *    Shown separately; never counted as a recall reporting a death.
 *
 * The text test removes negated phrases ("no injuries or deaths have been reported"), hypothetical ones ("in danger of
 * being strangled", "nearly suffocated") and deaths of animals ("one dog reportedly died") before it looks for a death.
 * A text mention, not a verified count of deaths caused by the product. Kept in step with reports_death() in
 * scripts/enrichment/build_safety_insights.py. Pure and tested (cpscDeaths.test.ts).
 */

export const CPSC_API_DATASET = "agency_safety_cpsc_recalls_api";

/** Postgres regex (word boundaries \m \M) for the server's candidate filter; the client decides with reportsDeath. */
export const DEATH_CANDIDATE_PG =
  "\\m(died|drowned|suffocated|strangled|killed|deaths?|fatalit(y|ies)|fatal)\\M";
/** Narrower candidate filter for titles, where "Risk of Death" is common hazard wording. */
export const TITLE_DEATH_CANDIDATE_PG =
  "\\m(died|drowned|suffocated|strangled|killed|deaths|death (was |has been )?reported|death of|fatalit(y|ies)|fatal)\\M";

const WORD = "died|drowned|suffocated|strangled|killed";
const EXPLICIT = new RegExp(`\\b(?:${WORD})\\b`, "i");
/** Reported deaths, not the "risk of serious injury or death" boilerplate in CPSC hazard statements. */
const REPORTED = new RegExp(
  "\\b(?:deaths? (?:have been |were |was )?reported|reports? of (?:\\w+ )?deaths?|\\d+ deaths?" +
    "|(?:one|two|three|four|five|six|seven|eight|nine|ten) deaths?|death of|fatalit(?:y|ies)|fatal (?:incident|injur))",
  "i",
);
const STOP = "(?!\\b(?:but|however|although|though|yet)\\b)";
const SCRUB: readonly RegExp[] = [
  // Negations: "no one has died", "No injuries or deaths have been reported", "not aware of any deaths".
  new RegExp(
    `\\b(?:no one|nobody|none|no|not|nor|never)\\b(?:${STOP}[^.;]){0,80}?\\b(?:${WORD}|deaths?|fatalit(?:y|ies)|fatal)\\b`,
    "gi",
  ),
  // Hypotheticals: "in danger of being strangled", "nearly suffocated", "could have died".
  new RegExp(
    `\\b(?:(?:in )?danger of|(?:at )?risk of|threat of|nearly|almost|near|could|can|may|might|would)\\s+(?:have\\s+)?(?:been\\s+|being\\s+|be\\s+)?(?:${WORD})\\b`,
    "gi",
  ),
  // Deaths of animals: "One dog reportedly died".
  new RegExp(
    `\\b(?:dogs?|cats?|pets?|puppy|puppies|kittens?|animals?|birds?|horses?)\\b[^.;]{0,40}?\\b(?:${WORD})\\b`,
    "gi",
  ),
];

/** The text with negated, hypothetical and animal death phrases removed. */
export function scrubDeathText(text: string): string {
  return SCRUB.reduce((t, re) => t.replace(re, " "), text);
}

/** True when the text says a person died, drowned, suffocated, strangled or was killed, or reports deaths. */
export function reportsDeath(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = scrubDeathText(text);
  return EXPLICIT.test(t) || REPORTED.test(t);
}

/** Back-compatible name: the explicit-death test the page and builder share. */
export const explicitDeath = reportsDeath;

/** The death word or phrase the text uses first (for the table), or null. */
export function deathWord(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = scrubDeathText(text);
  const m = EXPLICIT.exec(t) ?? REPORTED.exec(t);
  return m ? m[0].toLowerCase() : null;
}

export type CpscDeathRow = {
  id: string;
  title: string | null;
  date: string | null;
  tag: string | null;
  injuries: string | null;
  hazard: string | null;
  firm: string | null;
  url: string | null;
};

export type CpscDeathKind = "product" | "missed" | "background";

export const KIND_LABEL: Record<CpscDeathKind, string> = {
  product: "Tagged product-related",
  missed: "Missed by the tag",
  background: "Death with another product (background)",
};

export type CpscDeathRecall = {
  id: string;
  recallNumber: string;
  title: string;
  date: string | null;
  kind: CpscDeathKind;
  word: string | null;
  tag: string;
  hazard: string | null;
  firm: string | null;
  url: string | null;
  excerpt: string;
};

export type CpscDeathYear = {
  year: string;
  product: number;
  missed: number;
  background: number;
  partial: boolean;
};

export type CpscDeathsPayload = {
  recalls: CpscDeathRecall[];
  years: CpscDeathYear[];
  /** Recalls reporting a death: product-related tag plus missed by the tag. Background rows are not included. */
  total: number;
  tagged: number;
  untagged: number;
  background: number;
  latest: string | null;
  datasetTotal: number | null;
  dataThrough: string | null;
  readAt: string;
};

/** Which group a row belongs to, or null when it reports no death. */
export function deathKind(
  row: Pick<CpscDeathRow, "tag" | "injuries" | "title">,
): CpscDeathKind | null {
  const tag = (row.tag ?? "").trim().toLowerCase();
  if (tag.startsWith("product-related")) return "product";
  if (tag.startsWith("background")) return "background";
  if (tag === "" || tag === "no")
    return reportsDeath(row.injuries) || reportsDeath(row.title) ? "missed" : null;
  return null;
}

/** The sentence of the injury statement that holds the death word, cut to 240 characters. */
export function deathExcerpt(text: string): string {
  const sentences = text.split(/(?<=[.!?;])\s+/);
  const hit =
    sentences.find((s) => reportsDeath(s)) ??
    sentences.find((s) => new RegExp(`\\b(?:${WORD})\\b`, "i").test(s)) ??
    text;
  return hit.length > 240 ? `${hit.slice(0, 239).trimEnd()}…` : hit;
}

export function buildCpscDeaths(
  rows: readonly CpscDeathRow[],
  datasetTotal: number | null,
  dataThrough: string | null,
  readAt: string,
): CpscDeathsPayload {
  const recalls: CpscDeathRecall[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const kind = deathKind(r);
    if (!kind) continue;
    recalls.push({
      id: r.id,
      recallNumber: r.id.replace(/^cpsc-api:/, ""),
      title: (r.title ?? "").trim() || r.id,
      date: r.date && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : null,
      kind,
      word: deathWord(r.injuries) ?? deathWord(r.title),
      tag: (r.tag ?? "").trim() || "Not recorded",
      hazard: (r.hazard ?? "").trim() || null,
      firm: (r.firm ?? "").trim() || null,
      url: r.url && /^https:\/\//.test(r.url) ? r.url : null,
      excerpt: r.injuries ? deathExcerpt(r.injuries) : "Not recorded",
    });
  }
  recalls.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
  const reporting = recalls.filter((r) => r.kind !== "background");
  const latest = reporting.find((r) => r.date)?.date ?? null;
  const years = new Map<string, CpscDeathYear>();
  const dated = recalls.filter((r) => r.date);
  const latestAny = dated[0]?.date ?? null;
  const through =
    dataThrough && /^\d{4}-\d{2}-\d{2}/.test(dataThrough) ? dataThrough.slice(0, 10) : latestAny;
  if (dated.length && through && latestAny) {
    const first = Math.max(2000, Number(dated[dated.length - 1]!.date!.slice(0, 4)));
    const last = Math.max(Number(through.slice(0, 4)), Number(latestAny.slice(0, 4)));
    for (let y = first; y <= last; y += 1)
      years.set(String(y), {
        year: String(y),
        product: 0,
        missed: 0,
        background: 0,
        partial: false,
      });
    const lastYear = years.get(String(last));
    if (lastYear && !through.endsWith("-12-31")) lastYear.partial = true;
    for (const r of dated) {
      const y = years.get(r.date!.slice(0, 4));
      if (y) y[r.kind] += 1;
    }
  }
  return {
    recalls,
    years: [...years.values()],
    total: reporting.length,
    tagged: recalls.filter((r) => r.kind === "product").length,
    untagged: recalls.filter((r) => r.kind === "missed").length,
    background: recalls.filter((r) => r.kind === "background").length,
    latest,
    datasetTotal,
    dataThrough: through ?? null,
    readAt,
  };
}
