/**
 * CPSC recalls whose injury statement explicitly says someone died, drowned, suffocated, strangled or was killed.
 * CPSC's own death_mention tag in agency_safety_cpsc_recalls_api misses some of these (the 2025-07-21 above-ground pools
 * recall, "nine children ... have drowned", is tagged "No"), so the page flags them from the text itself. A text
 * mention, not a verified count of deaths caused by the product. Pure and tested (cpscDeaths.test.ts).
 */

export const CPSC_API_DATASET = "agency_safety_cpsc_recalls_api";

/** Postgres regex for the server filter (word boundaries \m \M); the client re-checks with EXPLICIT_DEATH. */
export const EXPLICIT_DEATH_PG = "\\m(died|drowned|suffocated|strangled|killed)\\M";

export const EXPLICIT_DEATH = /\b(?:died|drowned|suffocated|strangled|killed)\b/i;
const NEGATED =
  /\b(?:no one|nobody|no (?:children|child|consumers?|people|persons?|users?|infants?|deaths?))\b[^.;]{0,40}?\b(?:died|drowned|suffocated|strangled|killed)\b|\bnot (?:been )?(?:died|drowned|suffocated|strangled|killed)\b/gi;

/** True when the text says someone died, drowned, suffocated, strangled or was killed (negated phrases removed). */
export function explicitDeath(text: string | null | undefined): boolean {
  if (!text) return false;
  return EXPLICIT_DEATH.test(text.replace(NEGATED, " "));
}

/** The death word the text uses first (for the table), or null. */
export function deathWord(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = EXPLICIT_DEATH.exec(text.replace(NEGATED, " "));
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

export type CpscDeathRecall = {
  id: string;
  recallNumber: string;
  title: string;
  date: string | null;
  word: string;
  tag: string;
  untagged: boolean;
  hazard: string | null;
  firm: string | null;
  url: string | null;
  excerpt: string;
};

export type CpscDeathsPayload = {
  recalls: CpscDeathRecall[];
  years: { year: string; recalls: number; untagged: number; partial: boolean }[];
  total: number;
  untagged: number;
  latest: string | null;
  datasetTotal: number | null;
  dataThrough: string | null;
  readAt: string;
};

/** The sentence of the injury statement that holds the death word, cut to 240 characters. */
export function deathExcerpt(text: string): string {
  const sentences = text.split(/(?<=[.!?;])\s+/);
  const hit = sentences.find((s) => explicitDeath(s)) ?? text;
  return hit.length > 240 ? `${hit.slice(0, 239).trimEnd()}…` : hit;
}

export function buildCpscDeaths(
  rows: readonly CpscDeathRow[],
  datasetTotal: number | null,
  dataThrough: string | null,
  readAt: string,
): CpscDeathsPayload {
  const recalls: CpscDeathRecall[] = [];
  for (const r of rows) {
    if (!explicitDeath(r.injuries)) continue;
    const tag = (r.tag ?? "").trim() || "Not recorded";
    recalls.push({
      id: r.id,
      recallNumber: r.id.replace(/^cpsc-api:/, ""),
      title: (r.title ?? "").trim() || r.id,
      date: r.date && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : null,
      word: deathWord(r.injuries) ?? "died",
      tag,
      untagged: tag === "No" || tag === "Not recorded",
      hazard: (r.hazard ?? "").trim() || null,
      firm: (r.firm ?? "").trim() || null,
      url: r.url && /^https:\/\//.test(r.url) ? r.url : null,
      excerpt: deathExcerpt(r.injuries ?? ""),
    });
  }
  recalls.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
  const latest = recalls.find((r) => r.date)?.date ?? null;
  const years = new Map<string, { year: string; recalls: number; untagged: number; partial: boolean }>();
  const dated = recalls.filter((r) => r.date);
  const through = dataThrough && /^\d{4}-\d{2}-\d{2}/.test(dataThrough) ? dataThrough.slice(0, 10) : latest;
  if (dated.length && through) {
    const first = Math.max(2000, Number(dated[dated.length - 1]!.date!.slice(0, 4)));
    const last = Math.max(Number(through.slice(0, 4)), Number(latest!.slice(0, 4)));
    for (let y = first; y <= last; y += 1)
      years.set(String(y), { year: String(y), recalls: 0, untagged: 0, partial: false });
    const lastYear = years.get(String(last));
    if (lastYear && !through.endsWith("-12-31")) lastYear.partial = true;
    for (const r of dated) {
      const y = years.get(r.date!.slice(0, 4));
      if (!y) continue;
      y.recalls += 1;
      if (r.untagged) y.untagged += 1;
    }
  }
  return {
    recalls,
    years: [...years.values()],
    total: recalls.length,
    untagged: recalls.filter((r) => r.untagged).length,
    latest,
    datasetTotal,
    dataThrough: through ?? null,
    readAt,
  };
}
