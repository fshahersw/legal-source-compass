/**
 * Pure: classify one master-docket entry from its own docket text (rule version "orders/2").
 *
 * Accuracy rules (feature brief "mdl-command", owner rules in AGENTS.md):
 *  - Only explicit docket text is read, and the order patterns are anchored at the start of the text. A docket entry
 *    that merely mentions "CMO 12" (a motion, a stipulation, "Set Deadline re ... CMO") is never an issued order.
 *  - "[PROPOSED]", "STIPULATION", "MOTION", "Brief re", "Set Deadline(s)" and "Correction of Docket" entries are never
 *    counted as issued numbered orders.
 *  - A Rule 702 / Daubert ruling is an order entry whose own printed title names Rule 702 or Daubert; its outcome comes
 *    only from the order verb printed at the start ("ORDER DENYING ...", "ORDER GRANTING IN PART AND DENYING IN PART
 *    ..."), otherwise it is null ("Outcome not stated in docket text"). Motions are a separate kind and never a ruling.
 *    A compound order whose first verb rules on other motions states no Rule 702 outcome.
 *  - Subject kinds (leadership, settlement, fact sheets, bellwether, common benefit, special master) are read only in
 *    the order's own head clause: a numbered order's printed subject, or the clause after "ORDER <verb>" (APPOINTING,
 *    REGARDING, GRANTING ...). Prose orders ("ORDER: The PSC is ORDERED to ...") get no subject kind (rule orders/2).
 *  - A withheld entry (the projection published it without its text) is never classified.
 *  - Missing numbers in a CMO/PTO sequence are reported as "Not in collected docket text", never assumed.
 *
 * Everything here is deterministic and tested against docket text seen in the corpus (orders.test.ts).
 */

export const ORDERS_RULE_VERSION = "orders/2" as const;

/** What kind of docket entry the text is. "order" = entered by the court: orders, judgments, verdicts, CTOs. */
export type DocketRole = "order" | "filing" | "clerk_setting" | "withheld" | "unknown";

export type OrderKind =
  | "cmo"
  | "pto"
  | "rule702"
  | "rule702_motion"
  | "pfs"
  | "bellwether"
  | "trial_setting"
  | "leadership"
  | "common_benefit"
  | "special_master"
  | "settlement"
  | "cto"
  | "bankruptcy_stay"
  | "verdict";

export const ORDER_KINDS: readonly OrderKind[] = [
  "cmo",
  "pto",
  "rule702",
  "rule702_motion",
  "pfs",
  "bellwether",
  "trial_setting",
  "leadership",
  "common_benefit",
  "special_master",
  "settlement",
  "cto",
  "bankruptcy_stay",
  "verdict",
];

export const ORDER_KIND_LABEL: Record<OrderKind, string> = {
  cmo: "Case management orders",
  pto: "Pretrial orders",
  rule702: "Rule 702 / Daubert rulings",
  rule702_motion: "Rule 702 / Daubert motions",
  pfs: "Fact sheet orders",
  bellwether: "Bellwether orders",
  trial_setting: "Trial settings",
  leadership: "Leadership orders",
  common_benefit: "Common-benefit orders",
  special_master: "Special-master orders",
  settlement: "Settlement orders",
  cto: "Conditional transfer orders",
  bankruptcy_stay: "Bankruptcy and stay notices",
  verdict: "Jury verdicts and judgments on verdicts",
};

/**
 * granted / denied / granted_in_part: Rule 702 ruling verbs. set / vacated / continued: trial settings.
 * for_plaintiff / for_defendant: a verdict entry that says so. null: not stated in the docket text.
 */
export type OrderOutcome =
  | "granted"
  | "denied"
  | "granted_in_part"
  | "set"
  | "vacated"
  | "continued"
  | "for_plaintiff"
  | "for_defendant"
  | null;

export const OUTCOME_NOT_STATED = "Outcome not stated in docket text";

export type OrderTag = {
  kind: OrderKind;
  /** The order's printed number (CMO/PTO/CTO); null for unnumbered kinds. */
  number: number | null;
  /** Amendment suffix exactly as printed after the number ("A" in 9-A, "F" in 33.F, "b" in 28(b)); null when none. */
  suffix: string | null;
  /** Amendment words printed before the order name ("FIRST AMENDED", "ADDENDUM TO"); null when none. */
  amended: string | null;
  /** The subject as printed (after the number for numbered orders, else the printed title); null when none. */
  subject: string | null;
  outcome: OrderOutcome;
};

export type DocketClassification = {
  rule: typeof ORDERS_RULE_VERSION;
  role: DocketRole;
  /** The printed title: the text before the signature / "by Judge" / "(Entered" part; null when there is no text. */
  title: string | null;
  /** Kinds found, numbered orders first. Empty when nothing explicit was found. */
  tags: OrderTag[];
};

/* ------------------------------------------------------------------ patterns */

const MAX_TITLE = 300;
const MAX_SUBJECT = 200;

/** Where the printed title of a docket entry ends: the signature, the judge, related documents or clerk stamps. */
const TITLE_END =
  /(?:\.\s*|\s+)(?:Signed\s+by\b|\(?by\s+(?:(?:Senior|Chief|District|Magistrate|U\.S\.|United\s+States)\s+)*(?:Judge|Magistrate|Special\s+Master|Honorable)\b|(?:Approved\s+)?Judge\s+[A-Z][^.]{0,80}?\s+on\s+\d)|\s*\(Related\s+Doc|\.?\s+See\s+Order\b|\s*\((?:Filed\s+on|Entered:)|\s+Associated\s+Cases:|\.\s*\((?:[A-Za-z0-9]{1,6}(?:,\s*[A-Za-z ]{1,20})?)\)/i;

/** Words that may precede a numbered order's name. */
const AMEND_WORD =
  /(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|AMENDED|REVISED|SUPPLEMENTAL|CORRECTED)/;

/**
 * An issued numbered order: optional "MDL ORDER -", "MDL", amendment words or "ADDENDUM TO", then the order name and its
 * number at the very start of the text. Groups: 1 prefix, 2 order name, 3 number, 4 letter suffix, 5 bracket suffix.
 */
const NUMBERED = new RegExp(
  String.raw`^[\s*]*((?:(?:MDL\s+ORDER\s*[-–—:]?\s*)|(?:MDL\s+)|(?:${AMEND_WORD.source}\s+)|(?:ADDENDUM\s+TO\s+))*)` +
    String.raw`(CASE\s+MANAGEMENT\s+ORDER|PRE-?\s?TRIAL\s+ORDER|CMO|PTO)\s*(?:NO\.?|NUMBER|#)?\s*(\d{1,4})` +
    String.raw`(?:[.-]?([A-Z])(?![A-Za-z])|\s?\(([a-z0-9]{1,2})\))?`,
  "i",
);

/** Text that is a court entry: an order, opinion, judgment, CTO or a numbered order. */
const ORDER_START =
  /^[\s*]*(?:(?:MDL|MINUTE|OMNIBUS|STIPULATED|AGREED|SCHEDULING|PROTECTIVE|INITIAL|PRETRIAL|PRE-TRIAL)\s+)?(?:(?:MEMORANDUM\s+(?:OPINION\s+)?(?:AND\s+|&\s+)?)?(?:OPINION\s+(?:AND\s+|&\s+)?)?ORDER\b|(?:MEMORANDUM\s+)?OPINION\b|(?:CLERK'?S\s+)?JUDGMENT\b|CONDITIONAL\s+TRANSFER\s+ORDER\b|JURY\s+VERDICT\b)/i;

/** A signature line anywhere marks an entry the court entered (stipulated orders and the like). */
const SIGNED =
  /\bSigned\s+by\s+(?:the\s+)?(?:(?:Senior|Chief|District|Magistrate|U\.S\.|Honorable)\s+)*(?:Judge|Special\s+Master)\b/i;

/** Clerk notices, minute entries and deadline settings. */
const CLERK_START =
  /^[\s*]*(?:MINUTE\s+ENTRY|MINUTES?\s+(?:of\s+)?(?:proceedings|entry)|CLERK'?S\s+NOTICE|ELECTRONIC\s+NOTICE|NOTICE\s+(?:OF\s+)?(?:HEARING|RESCHEDULING|SETTING)|(?:Set|Reset)(?:\/Reset)?\s+(?:Deadlines?|Hearings?)|Set\s*\/\s*Reset|Terminate\s+Deadlines?|Docket\s+(?:Text\s+)?Notice|REMARK)\b/i;

const PROPOSED_START = /^[\s*]*(?:\[\s*PROPOSED\s*\]|PROPOSED\b)/i;

/** Order verbs printed straight after the order head word. */
const RULING_VERB =
  /^[\s*]*(?:OMNIBUS\s+)?(?:MEMORANDUM\s+(?:OPINION\s+)?(?:AND\s+|&\s+)?)?(?:OPINION\s+(?:AND\s+|&\s+)?)?ORDER\s+(?:\[non-document\]\s*)?(?:(?:RE|REGARDING|ON)\s*:?\s*)?(GRANTING\s+IN\s+PART\s+AND\s+DENYING\s+IN\s+PART|DENYING\s+IN\s+PART\s+AND\s+GRANTING\s+IN\s+PART|GRANTING|DENYING)\b/i;

const RULE702 = /\b(?:RULE\s+702|DAUBERT)\b/i;
/** Titles about schedules, briefs, sealing or page limits are procedure around a Rule 702 motion, not a ruling on it. */
const RULE702_NOT_A_RULING =
  /\b(?:seal(?:ing|ed)?|redact\w*|stipulat\w*|extension|extend\w*|deadlines?|briefing|schedul\w*|exceed|page\s+limits?|leave\s+to\s+file|withdraw\w*|reply|replies|oppositions?|responses?)\b/i;
/** A motion entry, possibly preceded by the filer's own words ("Defendants' MOTION", "NOTICE OF MOTION AND MOTION"). */
const MOTION_START =
  /^[\s*]*(?:(?:JOINT|OMNIBUS|CORRECTED|AMENDED|RENEWED|DEFENDANTS?['’]?|PLAINTIFFS?['’]?|NOTICE\s+OF\s+MOTION\s+AND)\s+)*MOTION\b/i;
const MOTION_NOT_RULE702 =
  /\b(?:extension|extend\w*|seal(?:ing)?|leave\s+to\s+file|exceed|page\s+limits?|administrative|withdraw\w*|pro\s+hac\s+vice)\b/i;

/** Procedure around a subject (extensions, page limits, sealing) does not make an order a PFS / bellwether / ... order. */
const SUBJECT_EXCLUDED =
  /\b(?:extension\s+of\s+time|motion\s+for\s+(?:an\s+)?extension|to\s+extend|briefing\s+schedule|leave\s+to\s+file|to\s+exceed|page\s+limits?|pro\s+hac\s+vice|(?:to|under)\s+seal|sealing)\b/i;

/**
 * The verb or preposition that opens an unnumbered order's own subject ("ORDER APPOINTING ...", "Order Regarding ...",
 * "ORDER granting ... Motion to Approve ..."). An order whose text goes straight into prose ("ORDER: The PSC is
 * ORDERED to ...", "Order [non-document] - The Court will hold a status conference ...") has no printed subject and is
 * never given a subject kind (rule orders/2).
 */
const SUBJECT_HEAD = new RegExp(
  String.raw`^[\s*]*(?:(?:MDL|MINUTE|OMNIBUS|STIPULATED|AGREED|AMENDED|CORRECTED|SUPPLEMENTAL)\s+)*` +
    String.raw`(?:MEMORANDUM\s+(?:OPINION\s+)?(?:AND\s+|&\s+)?)?(?:OPINION\s+(?:AND\s+|&\s+)?)?ORDER\s*` +
    String.raw`(?:\[non-document\]\s*)?(?:[-–—:]\s*)?` +
    String.raw`(PRELIMINARILY\s+APPROVING|FINALLY\s+APPROVING|APPOINTING|REAPPOINTING|DESIGNATING|ESTABLISHING|CREATING|` +
    String.raw`GOVERNING|CONCERNING|REGARDING|RE|ON|GRANTING|DENYING|APPROVING|ADOPTING|IMPLEMENTING|MODIFYING|AMENDING|` +
    String.raw`SETTING|AUTHORIZING|CONFIRMING|ENTERING|FOR)\b\s*:?\s*`,
  "i",
);

/** Verbs that appoint or organise; an unnumbered leadership order opens with one or its subject says so. */
const APPOINT_VERB =
  /^(?:APPOINTING|REAPPOINTING|DESIGNATING|ESTABLISHING|CREATING|CONFIRMING|APPROVING|GOVERNING)$/i;

/** End of the first clause: a sentence end (not after "No." / "Inc." and the like), a semicolon or a spaced dash. */
const CLAUSE_END =
  /(?<!\b(?:No|Nos|Inc|Co|Corp|Dr|Mr|Ms|Mrs|v|vs|Doc|Dkt|ECF|St|Jr|Ltd|L\.L\.C|U\.S))\.\s+(?=[A-Z(["'])|;\s|\s[-–—]\s|\s\(Related\s+Doc/;
const MAX_CLAUSE = 220;

/** Each subject kind is read only inside the order's own head clause; `not` lists wording that is not that kind. */
const SUBJECT_KINDS: { kind: OrderKind; re: RegExp; not?: RegExp; needs?: RegExp }[] = [
  { kind: "pfs", re: /\bfact\s+sheets?\b|\b[PD]FSs?\b/i },
  { kind: "bellwether", re: /\bbellwether/i },
  {
    kind: "leadership",
    // Bare PSC / PEC acronyms are not read: orders addressed to the committee are not leadership orders.
    re: /\b(?:leadership|co-?\s?leads?|lead\s+counsel|co-?\s?liaisons?|liaison\s+counsel|steering\s+committee|executive\s+committee)\b/i,
    not: /\b(?:withdraw\w*|substitut\w*|pro\s+hac\s+vice|status\s+conference|discovery|depositions?|attend\w*|appear\w*)\b/i,
    // Without an appointing verb the clause itself must say it appoints or organises the leadership.
    needs:
      /\b(?:appoint\w*|reappoint\w*|approv\w*|designat\w*|leadership\s+(?:structure|committee|development|slate|appointments?|applications?)|slate|structure|organi[sz]ation)\b/i,
  },
  { kind: "common_benefit", re: /\bcommon[-\s]benefit\b/i },
  {
    kind: "special_master",
    re: /\bspecial\s+masters?\b/i,
    not: /\b(?:discovery\s+rulings?|objections?|overrul\w*|affirm\w*|report\s+and\s+recommendations?|R\s?&\s?Rs?|referr\w*|refer)\b/i,
  },
  {
    kind: "settlement",
    re: /\bsettlements?\b/i,
    not: /\b(?:settlement\s+(?:status\s+)?conferences?|settlement\s+weeks?|mediat\w*|ADR|status\s+conference|discovery)\b/i,
  },
];

/** The first clause of a subject: a leading parenthesis is read whole, otherwise up to the first clause end. */
export function headClause(subject: string): string | null {
  const s = subject.replace(/^[\s.:;,\-–—]+/, "").trim();
  if (!s) return null;
  if (s.startsWith("(")) {
    const close = s.indexOf(")");
    const inner = (close > 0 ? s.slice(1, close) : s.slice(1)).trim();
    return inner ? inner.slice(0, MAX_CLAUSE) : null;
  }
  const end = CLAUSE_END.exec(s);
  const out = (end ? s.slice(0, end.index) : s).replace(/[\s.,;:]+$/, "").trim();
  return out ? out.slice(0, MAX_CLAUSE) : null;
}

/**
 * The order's own head: for a numbered order, the first clause of its printed subject; otherwise the clause after
 * "ORDER <verb>". Null when the order prints no subject (prose orders, bare "ORDER").
 */
export function orderHead(
  title: string,
  numbered: OrderTag | null,
): { verb: string | null; clause: string } | null {
  if (numbered) {
    const clause = numbered.subject ? headClause(numbered.subject) : null;
    return clause ? { verb: null, clause } : null;
  }
  const m = SUBJECT_HEAD.exec(title);
  if (!m) return null;
  const clause = headClause(title.slice(m[0].length));
  return clause ? { verb: m[1]!.replace(/\s+/g, " ").toUpperCase(), clause } : null;
}

/** A clause that only schedules a hearing, briefing or conference about a subject is not an order on that subject. */
const SCHEDULING_CLAUSE =
  /^(?:(?:a|the)\s+)?(?:hearings?|briefing|responses?|status\s+conferences?|telephon\w*\s+conferences?|oral\s+argument)\b/i;

function subjectKinds(head: { verb: string | null; clause: string }): OrderKind[] {
  if (SUBJECT_EXCLUDED.test(head.clause) || SCHEDULING_CLAUSE.test(head.clause)) return [];
  const out: OrderKind[] = [];
  for (const { kind, re, not, needs } of SUBJECT_KINDS) {
    if (!re.test(head.clause) || not?.test(head.clause)) continue;
    if (needs && !(head.verb && APPOINT_VERB.test(head.verb)) && !needs.test(head.clause)) continue;
    out.push(kind);
  }
  return out;
}

const TRIAL_SETTING =
  /\b((?:jury|bench)\s+(?:trial|selection))\b[^.;]{0,40}?\b(?:(?:is\s+)?(?:re)?set\s+for|continued\s+to|vacated)/i;

const CTO =
  /^[\s*]*CONDITIONAL\s+TRANSFER\s+ORDER\b\s*(?:\(?\s*CTO\s*-?\s*(\d{1,4})\s*\)?|No\.?\s*(\d{1,4})\b|(\d{1,4})\b)?/i;

const VERDICT =
  /^[\s*]*(?:JURY\s+VERDICT\b|(?:CLERK'?S\s+)?JUDGMENT\s+(?:ON|UPON)\s+(?:THE\s+)?(?:JURY\s+)?VERDICT\b)/i;
const VERDICT_SIDE = /\bin\s+favor\s+of\s+(?:the\s+)?(plaintiffs?|defendants?)\b/i;
const PROPOSED_ANYWHERE = /\bpropos/i;

const BANKRUPTCY_SUGGESTION =
  /^[\s*]*(?:NOTICE\s+(?:OF\s+)?)?SUGGESTION\s+OF\s+(?:PENDENCY\s+OF\s+)?BANKRUPTCY\b/i;
const BANKRUPTCY_NOTICE =
  /^[\s*]*NOTICE\s+(?:OF\s+)?(?:FILING\s+(?:OF\s+)?)?BANKRUPTCY\b[^.]{0,120}?\bAUTOMATIC\s+STAY\b/i;
const STAY_NOTICE = /^[\s*]*NOTICE\s+OF\s+(?:THE\s+)?(?:AUTOMATIC\s+)?STAY\b/i;
const BANKRUPTCY_WORDS =
  /\bbankrupt|\bchapter\s+11\b|\bautomatic\s+stay\b|§\s*362\b|\b11\s+U\.S\.C\./i;

/* ------------------------------------------------------------------ helpers */

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** The printed title: everything before the signature, the judge, related documents or clerk stamps. */
export function printedTitle(text: string): string {
  const t = collapse(text);
  const m = TITLE_END.exec(t);
  const head = (m ? t.slice(0, m.index) : t).replace(/[\s.,;:-]+$/, "");
  return head.length > MAX_TITLE ? `${head.slice(0, MAX_TITLE).trimEnd()}…` : head;
}

/** "(Order for Counsel to ...)" -> "Order for Counsel to ..."; leading punctuation dropped; null when empty. */
function cleanSubject(rest: string): string | null {
  let s = rest.replace(/^[\s.:;,\-–—]+/, "").trim();
  const wrapped = /^\((.*)\)\.?$/.exec(s);
  if (wrapped && !wrapped[1]!.includes(")")) s = wrapped[1]!.trim();
  if (!s) return null;
  return s.length > MAX_SUBJECT ? `${s.slice(0, MAX_SUBJECT).trimEnd()}…` : s;
}

function amendWords(prefix: string): string | null {
  const words = collapse(prefix.replace(/\*/g, " "))
    .replace(/\bMDL\s+ORDER\s*[-–—:]?/gi, " ")
    .replace(/\bMDL\b/gi, " ");
  const out = collapse(words);
  return out ? out.toUpperCase() : null;
}

/** The issued numbered order at the start of the text (CMO / PTO), or null. */
export function numberedOrder(text: string): OrderTag | null {
  const m = NUMBERED.exec(collapse(text));
  if (!m) return null;
  const number = Number(m[3]);
  if (!Number.isInteger(number) || number < 1) return null;
  const name = m[2]!.toUpperCase();
  const kind: OrderKind = /^(?:CASE|CMO)/.test(name) ? "cmo" : "pto";
  const title = printedTitle(text);
  const after = title.length >= m[0].length ? title.slice(m[0].length) : "";
  return {
    kind,
    number,
    suffix: m[4] ?? m[5] ?? null,
    amended: amendWords(m[1] ?? ""),
    subject: cleanSubject(after),
    outcome: null,
  };
}

/** A second ruling verb after the first means a compound order; its Rule 702 outcome is then not stated alone. */
const OTHER_RULING_VERB =
  /\b(?:grant(?:s|ed|ing)?|den(?:y|ies|ied|ying)|defer(?:s|red|ring)?|sustain(?:s|ed|ing)?|overrul(?:e|es|ed|ing))\b/i;

function rulingOutcome(title: string): OrderOutcome {
  const m = RULING_VERB.exec(title);
  if (!m) return null;
  // "ORDER granting the parties' preservation motions ..., and granting in part, denying in part ... Rule 702": the
  // first verb rules on other motions, so the Rule 702 outcome is not stated by it.
  const rest = title.slice(m.index + m[0].length);
  if (OTHER_RULING_VERB.test(rest)) return null;
  const at702 = rest.search(RULE702);
  if (at702 > 0 && rest.slice(0, at702).includes(";")) return null;
  const verb = m[1]!.toUpperCase().replace(/\s+/g, " ");
  if (verb.includes("IN PART")) return "granted_in_part";
  return verb === "GRANTING" ? "granted" : "denied";
}

function trialSetting(text: string): OrderTag | null {
  const t = collapse(text);
  const m = TRIAL_SETTING.exec(t);
  if (!m) return null;
  // The clause the setting sits in: from the event name to the end of its sentence.
  const rest = t.slice(m.index);
  const end = rest.search(/\.\s+[A-Z(]/);
  const clause = (end >= 0 ? rest.slice(0, end) : rest).slice(0, 160).trim();
  const continued = /\bcontinued\s+to\b/i.test(clause);
  const vacated = /\bvacated\b/i.test(clause);
  return {
    kind: "trial_setting",
    number: null,
    suffix: null,
    amended: null,
    subject: clause,
    outcome: continued ? "continued" : vacated ? "vacated" : "set",
  };
}

const tag = (kind: OrderKind, subject: string | null, extra: Partial<OrderTag> = {}): OrderTag => ({
  kind,
  number: null,
  suffix: null,
  amended: null,
  subject,
  outcome: null,
  ...extra,
});

/* ------------------------------------------------------------------ classifier */

/**
 * Classify one docket entry's text. `withheld` is the projection's own flag: a withheld entry is never classified.
 * Returns the role, the printed title and every explicit kind found (numbered orders first).
 */
export function classifyDocketText(
  text: string | null | undefined,
  opts: { withheld?: boolean | undefined } = {},
): DocketClassification {
  if (opts.withheld) return { rule: ORDERS_RULE_VERSION, role: "withheld", title: null, tags: [] };
  const raw = typeof text === "string" ? text : "";
  if (!raw.trim()) return { rule: ORDERS_RULE_VERSION, role: "unknown", title: null, tags: [] };
  const title = printedTitle(raw);
  const proposed = PROPOSED_START.test(raw);
  const numbered = proposed ? null : numberedOrder(raw);
  const cto = proposed ? null : CTO.exec(raw);
  const verdict = !proposed && VERDICT.test(raw) && !PROPOSED_ANYWHERE.test(raw);
  const orderStart = !proposed && (numbered !== null || ORDER_START.test(raw));
  const role: DocketRole = proposed
    ? "filing"
    : orderStart || verdict
      ? "order"
      : CLERK_START.test(raw)
        ? "clerk_setting"
        : SIGNED.test(raw)
          ? "order"
          : "filing";

  const tags: OrderTag[] = [];
  if (numbered) tags.push(numbered);
  if (cto) {
    const n = Number(cto[1] ?? cto[2] ?? cto[3] ?? NaN);
    tags.push(
      tag("cto", cleanSubject(title.slice(cto[0].length)), {
        number: Number.isInteger(n) && n > 0 ? n : null,
      }),
    );
  }
  if (verdict) {
    const side = VERDICT_SIDE.exec(raw)?.[1]?.toLowerCase();
    tags.push(
      tag("verdict", title, {
        outcome: side ? (side.startsWith("plaintiff") ? "for_plaintiff" : "for_defendant") : null,
      }),
    );
  }

  // Rule 702 / Daubert: rulings only from order entries that start as orders; motions are counted apart.
  if (orderStart && !numbered && RULE702.test(title) && !RULE702_NOT_A_RULING.test(title))
    tags.push(tag("rule702", title, { outcome: rulingOutcome(title) }));
  if (
    role === "filing" &&
    !proposed &&
    MOTION_START.test(raw) &&
    RULE702.test(collapse(raw).slice(0, 300)) &&
    !MOTION_NOT_RULE702.test(title)
  )
    tags.push(tag("rule702_motion", title));

  // Subject kinds come only from the order's own head clause (numbered subject, or "ORDER <verb> ..."), never from
  // words further on in the text.
  if (orderStart) {
    const head = orderHead(title, numbered);
    if (head)
      for (const kind of subjectKinds(head)) tags.push(tag(kind, numbered?.subject ?? title));
  }

  if (role === "order" || role === "clerk_setting") {
    const setting = trialSetting(raw);
    if (setting) tags.push(setting);
  }

  if (!proposed) {
    const bankruptcy =
      BANKRUPTCY_SUGGESTION.test(raw) ||
      BANKRUPTCY_NOTICE.test(raw) ||
      (STAY_NOTICE.test(raw) && BANKRUPTCY_WORDS.test(raw));
    if (bankruptcy) tags.push(tag("bankruptcy_stay", title));
  }

  return { rule: ORDERS_RULE_VERSION, role, title, tags };
}

/* ------------------------------------------------------------------ server prefilter */

/**
 * PostgreSQL regular expressions (case-insensitive `imatch`) that select a superset of the entries the classifier can
 * tag, so the loader reads candidates instead of every entry. They use no backslashes (PostgREST quoting) and are also
 * valid JavaScript, which orders.test.ts uses to check that every tagged fixture passes the prefilter.
 */
export const ORDER_PREFILTER_PATTERNS: readonly string[] = [
  "^[^A-Za-z0-9]{0,4}(MDL|AMENDED|FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|REVISED|SUPPLEMENTAL|CORRECTED|ADDENDUM|CASE MANAGEMENT ORDER|PRE-?TRIAL ORDER|PRE TRIAL ORDER|CMO|PTO|ORDER|OMNIBUS|OPINION|MEMORANDUM|MINUTE ORDER|STIPULATED|AGREED|SCHEDULING|PROTECTIVE|INITIAL|PRETRIAL|CONDITIONAL TRANSFER|JURY VERDICT|JUDGMENT|CLERK.?S JUDGMENT|SUGGESTION OF)",
  "^[^A-Za-z0-9]{0,4}NOTICE[^.]{0,60}(BANKRUPTCY|STAY)",
  "^[^A-Za-z0-9]{0,4}((JOINT|OMNIBUS|CORRECTED|AMENDED|RENEWED|DEFENDANTS?.?|PLAINTIFFS?.?|NOTICE OF MOTION AND) )*MOTION.{0,255}.{0,45}(RULE 702|DAUBERT)",
  "(JURY|BENCH) (TRIAL|SELECTION)[^.;]{0,60}(SET FOR|CONTINUED TO|VACATED)",
];

/** Dates set on the docket (docketDates.ts); same quoting rules as above. */
export const DATE_PREFILTER_PATTERN =
  "(due by|set for|continued to|reset for) [0-9]{1,2}/[0-9]{1,2}/[0-9]{4}";

/* ------------------------------------------------------------------ ledger */

/** One classified master-docket entry, as the loader returns it. */
export type ClassifiedEntry = {
  id: string;
  entryNumber: number | null;
  /** yyyy-mm-dd filing date of the entry; null when not recorded. */
  date: string | null;
  docketKey: string | null;
  /** CourtListener (or court) page of the entry, https only. */
  sourceUrl: string | null;
  /** RECAP document ids the entry lists (join keys only). */
  documentIds: string[];
  role: DocketRole;
  title: string | null;
  tags: OrderTag[];
};

/** One row of the numbered-order ledger: one entry of one CMO / PTO number (amendments are their own rows). */
export type LedgerRow = {
  kind: "cmo" | "pto";
  number: number;
  suffix: string | null;
  amended: string | null;
  subject: string | null;
  entry: Pick<
    ClassifiedEntry,
    "id" | "entryNumber" | "date" | "sourceUrl" | "docketKey" | "documentIds"
  >;
};

export type LedgerSequence = {
  kind: "cmo" | "pto";
  /** Rows (entries), oldest number first, then by suffix and date. */
  rows: LedgerRow[];
  /** Issued entries (an amendment or a re-entry is its own entry). */
  issuedEntries: number;
  /** Distinct order numbers found. */
  distinctNumbers: number;
  highest: number | null;
  /** Numbers between 1 and the highest found that no collected entry starts with. */
  missing: number[];
  latest: LedgerRow | null;
};

export const NOT_IN_COLLECTED_TEXT = "Not in collected docket text";

const suffixKey = (s: string | null) => (s ?? "").toLowerCase();

/** The CMO and PTO ledgers of one MDL, with the numbers missing from the collected docket text. */
export function orderLedger(
  entries: readonly ClassifiedEntry[],
): Record<"cmo" | "pto", LedgerSequence> {
  const build = (kind: "cmo" | "pto"): LedgerSequence => {
    const rows: LedgerRow[] = [];
    for (const e of entries)
      for (const t of e.tags)
        if (t.kind === kind && t.number !== null)
          rows.push({
            kind,
            number: t.number,
            suffix: t.suffix,
            amended: t.amended,
            subject: t.subject,
            entry: {
              id: e.id,
              entryNumber: e.entryNumber,
              date: e.date,
              sourceUrl: e.sourceUrl,
              docketKey: e.docketKey,
              documentIds: e.documentIds,
            },
          });
    rows.sort(
      (a, b) =>
        a.number - b.number ||
        suffixKey(a.suffix).localeCompare(suffixKey(b.suffix)) ||
        (a.entry.date ?? "").localeCompare(b.entry.date ?? "") ||
        (a.entry.entryNumber ?? 0) - (b.entry.entryNumber ?? 0),
    );
    const numbers = new Set(rows.map((r) => r.number));
    const highest = rows.length ? Math.max(...numbers) : null;
    const missing: number[] = [];
    if (highest !== null) for (let n = 1; n <= highest; n++) if (!numbers.has(n)) missing.push(n);
    let latest: LedgerRow | null = null;
    for (const r of rows)
      if (
        !latest ||
        (r.entry.date ?? "") > (latest.entry.date ?? "") ||
        ((r.entry.date ?? "") === (latest.entry.date ?? "") && r.number > latest.number)
      )
        latest = r;
    return {
      kind,
      rows,
      issuedEntries: new Set(rows.map((r) => r.entry.id)).size,
      distinctNumbers: numbers.size,
      highest,
      missing,
      latest,
    };
  };
  return { cmo: build("cmo"), pto: build("pto") };
}

/** "CMO No. 36", "PTO No. 28(b)", "CMO No. 9-A"; the printed suffix is kept. */
export function orderLabel(kind: "cmo" | "pto", number: number, suffix: string | null): string {
  const base = `${kind.toUpperCase()} No. ${number}`;
  if (!suffix) return base;
  return /^[a-z0-9]{1,2}$/.test(suffix) && suffix === suffix.toLowerCase() && /[a-z]/.test(suffix)
    ? `${base}(${suffix})`
    : `${base}-${suffix}`;
}

/* ------------------------------------------------------------------ court-page join */

/** An order as listed on the transferee court's own MDL page (mdl_intel_court_pages). */
export type CourtPageOrderInput = {
  title: string;
  url: string;
  date: string | null;
  vacated: boolean;
};

export type CourtPageMatch = {
  kind: "cmo" | "pto";
  number: number;
  suffix: string | null;
  title: string;
  url: string;
  date: string | null;
  vacated: boolean;
  /** Docket ledger rows with the same (kind, number, suffix); empty when the docket text has none. */
  docketEntryIds: string[];
};

/**
 * Court-page orders matched to the docket ledger only on exact (kind, number, suffix), read from the court page's own
 * printed title with the same anchored pattern. Court-page rows that are not numbered orders are left out.
 */
export function joinCourtPageOrders(
  ledger: Record<"cmo" | "pto", LedgerSequence>,
  courtOrders: readonly CourtPageOrderInput[],
): CourtPageMatch[] {
  const index = new Map<string, string[]>();
  for (const seq of [ledger.cmo, ledger.pto])
    for (const r of seq.rows) {
      const key = `${r.kind}|${r.number}|${suffixKey(r.suffix)}`;
      index.set(key, [...(index.get(key) ?? []), r.entry.id]);
    }
  const out: CourtPageMatch[] = [];
  for (const o of courtOrders) {
    const n = numberedOrder(o.title);
    if (!n || (n.kind !== "cmo" && n.kind !== "pto") || n.number === null) continue;
    const kind = n.kind;
    out.push({
      kind,
      number: n.number,
      suffix: n.suffix,
      title: o.title,
      url: o.url,
      date: o.date,
      vacated: o.vacated,
      docketEntryIds: index.get(`${kind}|${n.number}|${suffixKey(n.suffix)}`) ?? [],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ counts */

export type KindCount = { kind: OrderKind; entries: number; latest: string | null };

/** Entries per kind (an entry counts once per kind), with the latest entry date; kinds with none are left out. */
export function countKinds(entries: readonly ClassifiedEntry[]): KindCount[] {
  const by = new Map<OrderKind, { ids: Set<string>; latest: string | null }>();
  for (const e of entries)
    for (const t of e.tags) {
      const cur = by.get(t.kind) ?? { ids: new Set<string>(), latest: null };
      cur.ids.add(e.id);
      if (e.date && (!cur.latest || e.date > cur.latest)) cur.latest = e.date;
      by.set(t.kind, cur);
    }
  return ORDER_KINDS.flatMap((kind) => {
    const c = by.get(kind);
    return c ? [{ kind, entries: c.ids.size, latest: c.latest }] : [];
  });
}
