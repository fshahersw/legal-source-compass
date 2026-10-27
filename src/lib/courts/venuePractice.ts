/**
 * MDL venue practice matrix from local-rule insights (dataset court_rule_insights, scope federal_local). Pure.
 * `applies_to` is free text, so a value is compared across districts only when it falls into one of a few narrow,
 * normalised measures (general civil motion practice); rules for criminal, habeas, Social Security, bankruptcy,
 * magistrate-judge objections, summary-judgment statements and similar special cases never fill a cell. When more
 * than one distinct value fits a cell, the cell reads "several" (null) and every candidate stays in the data table
 * with its quote, page and link. Values were read from the rule text and kept only with a word-for-word quote.
 */

export type RuleInsight = {
  id: string;
  courtId: string;
  doc: string;
  docTitle: string | null;
  category: string;
  appliesTo: string;
  number: number | null;
  unit: string | null;
  quote: string;
  page: number | null;
  docUrl: string | null;
  sourceUrl: string | null;
};

export type PracticeMeasure = "opposition_days" | "reply_days" | "brief_pages" | "reply_pages";

export const PRACTICE_MEASURE: Record<PracticeMeasure, { label: string; unit: string }> = {
  opposition_days: { label: "Opposition to a motion", unit: "days" },
  reply_days: { label: "Reply in support of a motion", unit: "days" },
  brief_pages: { label: "Opening or opposition brief", unit: "pages" },
  reply_pages: { label: "Reply brief", unit: "pages" },
};
export const PRACTICE_MEASURES = Object.keys(PRACTICE_MEASURE) as PracticeMeasure[];

/** Special proceedings and documents whose limits are not the general motion rule. */
const SPECIAL =
  /\b(criminal|habeas|capital|social security|ssa|bankrupt|magistrate|special master|summary judgment|56\.1|statement|reconsideration|electronic|adjourn|mediation|discovery|appeal|appellate|pro se|prisoner|class|patent|claim construction|sentenc|petition|emergenc|expedit|temporary restraining|injunction|cross-motion|summary accompanying|table of)/i;
const NON_CIVIL_DOC = /-(criminal|appellate|bankruptcy|admiralty|patent)$/;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const https = (v: unknown) => {
  const s = str(v, 600);
  return s && /^https:\/\/[^\s]+$/.test(s) ? s : null;
};
const num = (v: unknown): number | null => {
  const n =
    typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A row read as {id, court, ri, source_url}. */
export function parseRuleInsight(raw: unknown): RuleInsight | null {
  const r = obj(raw);
  const ri = obj(r?.["ri"]);
  const id = str(r?.["id"], 120);
  const courtId = str(r?.["court"], 20);
  if (!r || !ri || !id || !courtId || !/^[a-z0-9]{2,16}$/.test(courtId)) return null;
  const doc = str(ri["doc"], 80);
  const category = str(ri["category"], 60);
  const appliesTo = str(ri["applies_to"], 300);
  const quote = str(ri["quote"], 1200);
  if (!doc || !category || !appliesTo || !quote) return null;
  const page = num(ri["page"]);
  return {
    id,
    courtId,
    doc,
    docTitle: str(ri["doc_title"], 200),
    category,
    appliesTo,
    number: num(ri["number"]),
    unit: str(ri["unit"], 20),
    quote,
    page: page !== null && Number.isInteger(page) ? page : null,
    docUrl: https(ri["doc_url"]),
    sourceUrl: https(r["source_url"]),
  };
}

/** Which normalised measure a rule fills, or null. */
export function measureOf(r: RuleInsight): PracticeMeasure | null {
  if (NON_CIVIL_DOC.test(r.doc) || SPECIAL.test(r.appliesTo) || r.number === null) return null;
  const a = r.appliesTo.toLowerCase();
  const motion = /\bmotions?\b/.test(a);
  const reply = /\breply\b/.test(a);
  if (r.category === "response_deadline" && r.unit === "days" && motion && !reply)
    if (/\b(oppos\w*|respon\w*|answering)\b/.test(a)) return "opposition_days";
  if (r.category === "reply_deadline" && r.unit === "days" && motion && reply) return "reply_days";
  if (r.category === "page_limit" && r.unit === "pages" && /\b(brief|memorand\w*)\b/.test(a)) {
    if (reply) return "reply_pages";
    if (/\b(opening|initial|support\w*|oppos\w*|any party|motions?)\b/.test(a))
      return "brief_pages";
  }
  return null;
}

export type PracticeCell = {
  value: number | null;
  /** Rules that fit the cell (one value when they agree; "several" when they differ). */
  rules: RuleInsight[];
  several: boolean;
};

export type PracticeMatrix = {
  courts: string[];
  cells: Record<string, Record<PracticeMeasure, PracticeCell>>;
  /** Every rule that fills some cell, for the data table. */
  matched: (RuleInsight & { measure: PracticeMeasure })[];
};

export function practiceMatrix(
  rules: readonly RuleInsight[],
  courts: readonly string[],
): PracticeMatrix {
  const want = new Set(courts);
  const cells: PracticeMatrix["cells"] = {};
  for (const c of courts) {
    cells[c] = {} as Record<PracticeMeasure, PracticeCell>;
    for (const m of PRACTICE_MEASURES) cells[c]![m] = { value: null, rules: [], several: false };
  }
  const matched: PracticeMatrix["matched"] = [];
  for (const r of rules) {
    if (!want.has(r.courtId)) continue;
    const m = measureOf(r);
    if (!m) continue;
    cells[r.courtId]![m].rules.push(r);
    matched.push({ ...r, measure: m });
  }
  for (const c of courts)
    for (const m of PRACTICE_MEASURES) {
      const cell = cells[c]![m];
      const distinct = [...new Set(cell.rules.map((r) => r.number))];
      cell.several = distinct.length > 1;
      cell.value = distinct.length === 1 ? distinct[0]! : null;
    }
  matched.sort(
    (a, b) =>
      courts.indexOf(a.courtId) - courts.indexOf(b.courtId) ||
      PRACTICE_MEASURES.indexOf(a.measure) - PRACTICE_MEASURES.indexOf(b.measure) ||
      a.id.localeCompare(b.id),
  );
  return { courts: [...courts], cells, matched };
}
