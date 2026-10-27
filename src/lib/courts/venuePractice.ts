/**
 * MDL venue practice matrix from local-rule insights (dataset court_rule_insights, scope federal_local). Pure.
 * `applies_to` is free text, so a value is compared across districts only when it describes the general civil motion
 * rule in a narrow, positive form ("Opposition to a motion", "Reply in support of a motion", "Reply brief"). Clauses
 * that list exceptions ("other than ...", "except ...") are stripped first, so a general rule that names a special
 * proceeding as an exception still counts; a rule about a special proceeding or document (criminal, habeas, summary
 * judgment, sealing, fees, costs, extensions, administrative relief and similar) never fills a cell.
 *
 * A deadline is counted from a start point the quote states (after service, after filing, after a due date, or before
 * the motion day). Values are compared only with values that share that start point. A limit stated as a preference
 * ("prefers", "should") is not a limit and is left out. When a district has no general rule but splits the rule by
 * motion type (dispositive and nondispositive, motions requiring a brief or not), the cell reads "several" and every
 * branch stays in the data table with its quote, page and link.
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
export const DEADLINE_MEASURES = ["opposition_days", "reply_days"] as const;

/** Where a deadline is counted from, as the quoted rule states it. */
export type Anchor = "after_service" | "after_filing" | "after_due" | "before_hearing" | "unstated";
export const ANCHORS: readonly Anchor[] = [
  "after_service",
  "after_filing",
  "after_due",
  "before_hearing",
  "unstated",
];

/** Row note for a deadline measure counted from an anchor. */
export function anchorNote(m: PracticeMeasure, a: Anchor): string {
  const what = m === "reply_days" ? "the opposition" : "the motion";
  switch (a) {
    case "after_service":
      return `days after service of ${what}`;
    case "after_filing":
      return `days after ${what} is filed`;
    case "after_due":
      return `days after ${what} is due`;
    case "before_hearing":
      return "days before the motion day";
    default:
      return "days (start point not stated)";
  }
}

/** Special proceedings: a rule about one of these is never a general motion rule, not even as a branch. */
const PROCEEDING =
  /\b(criminal|habeas|capital|social security|ssa|bankrupt|magistrate|special master|pro se|unrepresented|prisoner|patent|claim construction|sentenc|appeal|appellate|misdemeanor|2254|2255)/i;
/** Special motions and documents whose limits are not the general motion rule. */
const SPECIAL =
  /\b(summary[- ]judgment|56\.1|statements?\b|facts\b|reconsideration|electronic|adjourn|mediation|adr\b|neutral|discovery|class|petition|emergenc|expedit|temporary restraining|injunction|cross-motion|summary accompanying|table of|seal|sealing|registry|extend time|enlarge|shorten time|extension|fees?\b|54\(d\)|costs?\b|administrative|letter|leave\b|supplemental|ex parte|related case|rule 12|12\(b\)|dispositive|nondispositive|non-dispositive|requiring|remand|dismiss|objections?)/i;
const NON_CIVIL_DOC = /-(criminal|appellate|bankruptcy|admiralty|patent|adr)$/;
/** A stated preference is not a limit. */
const PREFERENCE = /\b(prefer\w*|should|encourag\w*)\b/i;
const BINDING = /\b(shall|must|may not|will not|in no event|not to exceed|limited)\b/i;
const NO_REPLY = /\b(?:may|must) not file a reply\b/i;

/** Splits of the general rule by motion type, read from the stripped applies_to (deadlines only). */
const BRANCHES: [RegExp, string][] = [
  [/\bnon-?dispositive motions?\b/, "Nondispositive motions"],
  [/\bdispositive motions?\b/, "Dispositive motions"],
  [/\bnot requiring a (?:supporting )?brief\b/, "Motions not requiring a brief"],
  [/\brequiring a (?:supporting )?brief\b/, "Motions requiring a brief"],
  [/\bmotions? to remand\b.*\bdismiss\b/, "Listed motions (remand, dismiss, summary judgment and others)"],
];

/** applies_to without its exception clauses: "Response to a motion (other than Rule 12 ...)" -> "response to a motion". */
export function stripExceptions(appliesTo: string): string {
  return appliesTo
    .toLowerCase()
    .replace(/\s*\((?:other than|except|excluding)\b[^)]*\)/g, "")
    .replace(/\s+(?:other than|except(?: for)?|excluding)\b.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The start point a quoted deadline states. */
export function anchorOf(quote: string): Anchor {
  const q = quote.replace(/\s+/g, " ").toLowerCase();
  if (/\b(?:prior to|before)\b[^.;]{0,60}\b(?:motion day|hearing|return date)\b/.test(q))
    return "before_hearing";
  if (/\bafter\b[^.;]{0,40}\b(?:was|is) due\b/.test(q)) return "after_due";
  if (
    /\b(?:after|of|from)\s+(?:the\s+)?(?:date\s+of\s+)?service\b|\bafter being served\b|\bafter\b[^.;]{0,30}\bserve[sd]?\b/.test(
      q,
    )
  )
    return "after_service";
  if (/\bafter\s+(?:the\s+)?filing\b|\bafter\b[^.;]{0,40}\b(?:was|is|has been)\s+filed\b/.test(q))
    return "after_filing";
  return "unstated";
}

const OPPOSITION_HEAD = /^(?:(?:memorandum|memoranda|brief|briefs) )?(?:in )?(?:opposition|opposing|response|answering)\b/;
const TO_MOTION = /\b(?:to|opposing) (?:a |an |any |all )?(?:civil )?motions?$/;
const REPLY_HEAD = /^reply\b/;
const IN_SUPPORT_OF_MOTION = /\b(?:in support of|on|to) (?:a |an |any |all )?(?:civil )?motions?$/;
const BRIEF_GENERAL = [
  /^briefs? \((?:opening|initial) or opposition\)$/,
  /^(?:opposition|opening|initial|supporting(?: and response)?) (?:briefs?|memorand\w*)(?: or (?:brief|memorand\w*))?$/,
  /^briefs? generally$/,
  /^motions? with (?:incorporated memorand\w*|points and authorities)(?: and opposing memorand\w*)?$/,
  /^(?:briefs?|memorand\w*) (?:supporting|in support of) or (?:opposing|in opposition to) (?:a |an |any )?motions?$/,
];
const REPLY_PAGES = /^reply (?:briefs?|memorand\w*)(?: or (?:brief|memorand\w*))?$/;

export type RuleClass = {
  measure: PracticeMeasure;
  /** Start point of a deadline; null for a page limit. */
  anchor: Anchor | null;
  /** Null for the general rule; the motion type for one branch of a split rule. */
  branch: string | null;
  /** The rule bars a reply without leave (no number). */
  noReply: boolean;
};

/** What a rule fills, or null when it is not a comparable general civil motion rule. */
export function classifyRule(r: RuleInsight): RuleClass | null {
  const a = stripExceptions(r.appliesTo);
  // a proceeding named only in an exception clause ("other than ... habeas petitions") does not exclude the rule
  if (NON_CIVIL_DOC.test(r.doc) || PROCEEDING.test(a)) return null;
  if (PREFERENCE.test(r.quote) && !BINDING.test(r.quote)) return null;
  const deadline =
    r.category === "response_deadline"
      ? ("opposition_days" as const)
      : r.category === "reply_deadline"
        ? ("reply_days" as const)
        : null;
  if (deadline) {
    const head = deadline === "opposition_days" ? OPPOSITION_HEAD : REPLY_HEAD;
    if (!head.test(a)) return null;
    const noReply = deadline === "reply_days" && r.number === null && NO_REPLY.test(r.quote);
    if (!noReply && (r.number === null || r.unit !== "days")) return null;
    const anchor = noReply ? null : anchorOf(r.quote);
    const branch = BRANCHES.find(([re]) => re.test(a))?.[1] ?? null;
    if (branch) return { measure: deadline, anchor, branch, noReply };
    if (SPECIAL.test(a)) return null;
    const tail = deadline === "opposition_days" ? TO_MOTION : IN_SUPPORT_OF_MOTION;
    return tail.test(a) ? { measure: deadline, anchor, branch: null, noReply } : null;
  }
  if (r.category !== "page_limit" || r.unit !== "pages" || r.number === null || SPECIAL.test(a))
    return null;
  if (REPLY_PAGES.test(a))
    return { measure: "reply_pages", anchor: null, branch: null, noReply: false };
  if (BRIEF_GENERAL.some((re) => re.test(a)))
    return { measure: "brief_pages", anchor: null, branch: null, noReply: false };
  return null;
}

/** The measure a rule fills as the general rule (branches and bars excluded), or null. */
export function measureOf(r: RuleInsight): PracticeMeasure | null {
  const c = classifyRule(r);
  return c && !c.branch && !c.noReply ? c.measure : null;
}

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

export type MatchedRule = RuleInsight & RuleClass & { reading: string };

export type PracticeCell = {
  value: number | null;
  /** Start point of the value (deadlines only). */
  anchor: Anchor | null;
  /** Rules that fit the cell, general and branch. */
  rules: MatchedRule[];
  /** Several general rules disagree, or the district splits the rule by motion type. */
  several: boolean;
  /** No general rule; the district states the rule per motion type (see the branches). */
  split: boolean;
};

export type PracticeMatrix = {
  courts: string[];
  cells: Record<string, Record<PracticeMeasure, PracticeCell>>;
  /** Every rule that fills or splits some cell, for the data table. */
  matched: MatchedRule[];
};

function reading(r: RuleInsight, c: RuleClass): string {
  const base = c.noReply
    ? "No reply without the court's permission"
    : c.anchor
      ? `${r.number} ${anchorNote(c.measure, c.anchor)}`
      : `${r.number} ${r.unit ?? ""}`.trim();
  return c.branch ? `${c.branch}: ${base}` : base;
}

export function practiceMatrix(
  rules: readonly RuleInsight[],
  courts: readonly string[],
): PracticeMatrix {
  const want = new Set(courts);
  const cells: PracticeMatrix["cells"] = {};
  for (const c of courts) {
    cells[c] = {} as Record<PracticeMeasure, PracticeCell>;
    for (const m of PRACTICE_MEASURES)
      cells[c]![m] = { value: null, anchor: null, rules: [], several: false, split: false };
  }
  const matched: MatchedRule[] = [];
  for (const r of rules) {
    if (!want.has(r.courtId)) continue;
    const c = classifyRule(r);
    if (!c) continue;
    const m: MatchedRule = { ...r, ...c, reading: reading(r, c) };
    cells[r.courtId]![c.measure].rules.push(m);
    matched.push(m);
  }
  for (const c of courts)
    for (const k of PRACTICE_MEASURES) {
      const cell = cells[c]![k];
      const general = cell.rules.filter((r) => !r.branch);
      const valued = general.filter((r) => !r.noReply && r.number !== null);
      const distinct = [...new Set(valued.map((r) => `${r.number}|${r.anchor ?? ""}`))];
      cell.split = general.length === 0 && cell.rules.some((r) => r.branch);
      cell.several = distinct.length > 1 || cell.split;
      if (distinct.length === 1 && !cell.split) {
        cell.value = valued[0]!.number;
        cell.anchor = valued[0]!.anchor;
      }
    }
  matched.sort(
    (a, b) =>
      courts.indexOf(a.courtId) - courts.indexOf(b.courtId) ||
      PRACTICE_MEASURES.indexOf(a.measure) - PRACTICE_MEASURES.indexOf(b.measure) ||
      a.id.localeCompare(b.id),
  );
  return { courts: [...courts], cells, matched };
}

/** Matrix rows: deadlines split by start point (only start points some district uses), page limits as they are. */
export function practiceRows(
  m: PracticeMatrix,
): { measure: PracticeMeasure; anchor: Anchor | null; values: (number | null)[] }[] {
  const out: { measure: PracticeMeasure; anchor: Anchor | null; values: (number | null)[] }[] = [];
  for (const k of PRACTICE_MEASURES) {
    const anchors: (Anchor | null)[] = (DEADLINE_MEASURES as readonly string[]).includes(k)
      ? ANCHORS.filter((a) => m.courts.some((c) => m.cells[c]![k].anchor === a))
      : [null];
    if (!anchors.length) anchors.push("after_service");
    for (const a of anchors)
      out.push({
        measure: k,
        anchor: a,
        values: m.courts.map((c) => {
          const cell = m.cells[c]![k];
          return cell.value !== null && cell.anchor === a ? cell.value : null;
        }),
      });
  }
  return out;
}
