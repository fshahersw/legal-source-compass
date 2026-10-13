import { z } from "zod";
import { REGULATORY_EVENT_TYPES, REGULATORY_SOURCE_IDS, type RegulatoryQuery } from "./types";

export const QUERY_SOURCE_FAMILIES = ["fda", "nhtsa", "cpsc", "federal_register"] as const;
export const QUERY_FIELDS = [
  "q",
  "source",
  "sourceFamily",
  "eventType",
  "from",
  "to",
  "dateBasis",
] as const;
export type QueryField = (typeof QUERY_FIELDS)[number];
export type RegulatoryQueryCapability = {
  available: boolean;
  mode: "model" | "guided";
  message: string;
};
export type RegulatoryQueryInterpretation = {
  status: "ready" | "clarification" | "unavailable" | "invalid_input";
  query?: RegulatoryQuery;
  summary: string;
  question?: string;
  limitations: string[];
  pendingQuestions?: Exclude<QueryQuestion, "none">[];
};

export function validQueryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const regulatoryQueryPlanSchema = z
  .object({
    q: z.string().trim().max(300).optional(),
    source: z.enum(REGULATORY_SOURCE_IDS).optional(),
    sourceFamily: z.enum(QUERY_SOURCE_FAMILIES).optional(),
    eventType: z.enum(REGULATORY_EVENT_TYPES).optional(),
    from: z.string().refine(validQueryDate).optional(),
    to: z.string().refine(validQueryDate).optional(),
    dateBasis: z.enum(["detected", "published"]).optional(),
    entityNamespace: z.string().max(120).optional(),
    entityId: z.string().max(300).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!!value.entityNamespace !== !!value.entityId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An exact namespace and identifier are required together.",
      });
    if (value.from && value.to && value.from > value.to)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "The date range is reversed." });
    if (value.source && value.sourceFamily && sourceFamilyOf(value.source) !== value.sourceFamily)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The feed is outside the selected source family.",
      });
  });

function sourceFamilyOf(source: string): string {
  if (source.startsWith("fda_") || source.startsWith("openfda_")) return "fda";
  if (source.startsWith("nhtsa_")) return "nhtsa";
  if (source.startsWith("cpsc_")) return "cpsc";
  return "federal_register";
}

export const regulatoryQueryInputSchema = z
  .object({
    turns: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(2_000),
          })
          .strict(),
      )
      .min(1)
      .max(9),
    currentQuery: regulatoryQueryPlanSchema,
    pendingQuestions: z
      .array(z.enum(["source", "date_basis", "date_range", "search_term", "unsupported_analysis"]))
      .max(5)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.turns.at(-1)?.role !== "user")
      context.addIssue({ code: z.ZodIssueCode.custom, message: "A user question is required." });
    if (value.turns.reduce((sum, turn) => sum + turn.content.length, 0) > 16_000)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "The conversation is too long." });
  });
export type RegulatoryQueryInput = z.infer<typeof regulatoryQueryInputSchema>;

/** Omitted optional properties stay omitted with exactOptionalPropertyTypes. */
function cleanQuery(value: RegulatoryQueryInput["currentQuery"]): RegulatoryQuery {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as RegulatoryQuery;
}

export const QUERY_QUESTIONS = [
  "none",
  "source",
  "date_basis",
  "date_range",
  "search_term",
  "unsupported_analysis",
] as const;
export type QueryQuestion = (typeof QUERY_QUESTIONS)[number];
export const queryModelSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            field: z.enum(QUERY_FIELDS),
            value: z.string().max(300).nullable(),
            quote: z.string().min(1).max(2_000),
            turnIndex: z.number().int().min(0).max(8),
          })
          .strict(),
      )
      .max(12),
    question: z.enum(QUERY_QUESTIONS),
  })
  .strict();

export const sourceLabels: Record<(typeof REGULATORY_SOURCE_IDS)[number], string> = {
  federal_register: "Federal Register",
  fda_recall_notices: "FDA recall announcements",
  fda_warning_letters: "FDA warning letters",
  openfda_enforcement_drug: "openFDA drug enforcement records",
  openfda_enforcement_device: "openFDA device enforcement records",
  openfda_enforcement_food: "openFDA food enforcement records",
  cpsc_recalls: "CPSC recalls",
  nhtsa_recalls: "NHTSA recalls",
  nhtsa_investigations: "NHTSA investigations",
  nhtsa_communications: "NHTSA manufacturer communications",
};

export const SOURCE_PHRASES: Record<(typeof REGULATORY_SOURCE_IDS)[number], RegExp> = {
  federal_register: /\bfederal register\b/i,
  fda_recall_notices:
    /\bFDA\b[\s\S]{0,45}\b(?:recall (?:notices|announcements)|recalls)\b|\bFDA recall\b/i,
  fda_warning_letters: /\b(?:FDA\s+)?warning letters?\b/i,
  openfda_enforcement_drug:
    /\b(?:openFDA|enforcement)\b[\s\S]{0,35}\bdrugs?\b|\bdrugs?\b[\s\S]{0,35}\b(?:openFDA|enforcement)\b/i,
  openfda_enforcement_device:
    /\b(?:openFDA|enforcement)\b[\s\S]{0,35}\bdevices?\b|\bdevices?\b[\s\S]{0,35}\b(?:openFDA|enforcement)\b/i,
  openfda_enforcement_food:
    /\b(?:openFDA|enforcement)\b[\s\S]{0,35}\bfood\b|\bfood\b[\s\S]{0,35}\b(?:openFDA|enforcement)\b/i,
  cpsc_recalls: /\bCPSC\b|\bconsumer product recalls?\b/i,
  nhtsa_recalls: /\bNHTSA\b[\s\S]{0,30}\brecalls?\b|\bvehicle recalls?\b/i,
  nhtsa_investigations: /\bNHTSA\b[\s\S]{0,30}\binvestigations?\b|\bvehicle investigations?\b/i,
  nhtsa_communications:
    /\bNHTSA\b[\s\S]{0,30}\bcommunications?\b|\bmanufacturer communications?\b|\btechnical service bulletins?\b/i,
};

const familyPhrases: Record<(typeof QUERY_SOURCE_FAMILIES)[number], RegExp> = {
  fda: /\b(?:FDA|openFDA|food and drug administration)\b/i,
  nhtsa: /\b(?:NHTSA|national highway traffic safety administration)\b/i,
  cpsc: /\b(?:CPSC|consumer product safety commission)\b/i,
  federal_register: /\bfederal register\b/i,
};
const eventPhrases: Record<(typeof REGULATORY_EVENT_TYPES)[number], RegExp> = {
  initial_record: /\b(?:initial|baseline|first collection)\b/i,
  backfill: /\b(?:backfill|historical imports?)\b/i,
  new_record: /\b(?:new records?|newly detected|new developments?)\b/i,
  record_changed: /\b(?:changed|changes|revised|revisions|updated|updates)\b/i,
  correction: /\bcorrections?\b/i,
};
const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function explicitDatesInQuery(text: string): string[] {
  const values = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => ({
    value: match[0],
    index: match.index,
  }));
  const month = `(${months.join("|")})`;
  for (const match of text.matchAll(
    new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})\\b`, "gi"),
  ))
    values.push({
      value: `${match[3]}-${String(months.indexOf(match[1]!.toLowerCase()) + 1).padStart(2, "0")}-${match[2]!.padStart(2, "0")}`,
      index: match.index,
    });
  return [...new Set(values.sort((a, b) => a.index - b.index).map((item) => item.value))];
}

export function datesInQuery(text: string): string[] {
  return explicitDatesInQuery(text).filter(validQueryDate);
}

function ambiguousOrInvalidDate(text: string): boolean {
  const named = [
    ...text.matchAll(
      new RegExp(
        `\\b(${months.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?(?:\\s+(\\d{4}))?\\b`,
        "gi",
      ),
    ),
  ];
  return (
    explicitDatesInQuery(text).some((value) => !validQueryDate(value)) ||
    named.some((match) => !match[3]) ||
    [...text.matchAll(/\b\d{4}-\d{1,2}-\d{1,2}\b/g)].some((match) => !validQueryDate(match[0])) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(text) ||
    new RegExp(`\\b(?:${months.join("|")})\\s+\\d{4}\\b`, "i").test(text) ||
    /\b(?:last|this|next) (?:year|quarter)|\bthis month|\b(?:past|last)\s+\d+\s+(?:weeks?|months?|years?|quarters?)\b/i.test(
      text,
    )
  );
}

/** A relative operational window is resolved in UTC and shown explicitly before it is applied. */
export function relativeQueryWindow(text: string, now: Date): { from: string; to: string } | null {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let from: Date;
  let to = today;
  const days = text.match(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/i);
  if (days && Number(days[1]) >= 1 && Number(days[1]) <= 366) {
    from = new Date(today.getTime() - (Number(days[1]) - 1) * 86_400_000);
  } else if (/\b(?:past|last) week\b/i.test(text)) {
    from = new Date(today.getTime() - 6 * 86_400_000);
  } else if (/\blast month\b/i.test(text)) {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  } else if (/\btoday\b/i.test(text)) {
    from = today;
  } else if (/\byesterday\b/i.test(text)) {
    from = new Date(today.getTime() - 86_400_000);
    to = from;
  } else return null;
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const QUESTIONS: Record<Exclude<QueryQuestion, "none">, string> = {
  source:
    "Which source family should I use: FDA, NHTSA, CPSC, or Federal Register? You can also name a particular feed or say all sources.",
  date_basis:
    "Should the dates refer to publication by the source or detection by this monitor? Incident dates are not a supported filter.",
  date_range:
    "What exact date range should I use? Give ISO dates (YYYY-MM-DD), named dates with a year, or a window such as the past 30 days.",
  search_term:
    "What exact product name, native identifier, or phrase should I look for? Put the phrase in quotation marks, or say all records.",
  unsupported_analysis:
    "Which source records and period should we examine first? This search can locate evidence and revisions; causation, incidence, independent corroboration, and statistical anomaly detection require additional review.",
};

function limitationsForQuery(query: RegulatoryQuery): string[] {
  const limits = [
    "Search covers collected source records; source availability and completeness are shown in Coverage.",
    "Date filters use publication or monitor detection, not when an injury or incident occurred.",
  ];
  if (query.source?.startsWith("openfda_enforcement"))
    limits.push(
      "openFDA enforcement is research metadata; it does not establish current recall lifecycle status.",
    );
  if (query.sourceFamily)
    limits.push(
      "Source family selects these collection feeds; it does not include every document issued by that agency elsewhere.",
    );
  return limits;
}

export function describeQuery(query: RegulatoryQuery): string {
  const parts = [
    query.source
      ? sourceLabels[query.source]
      : query.sourceFamily
        ? `${query.sourceFamily === "federal_register" ? "Federal Register" : query.sourceFamily.toUpperCase()} source family`
        : "All collected sources",
  ];
  if (query.q) parts.push(`text contains “${query.q}”`);
  if (query.eventType) parts.push(query.eventType.replaceAll("_", " "));
  if (query.from || query.to)
    parts.push(
      `${query.dateBasis === "published" ? "publication dates" : query.dateBasis === "detected" ? "detection dates" : "dates (basis awaiting clarification)"} ${query.from ?? "any start"} through ${query.to ?? "any end"} (UTC)`,
    );
  else parts.push(`${query.dateBasis === "published" ? "publication" : "detection"} date basis`);
  if (query.entityNamespace && query.entityId)
    parts.push(`exact entity ${query.entityNamespace}: ${query.entityId}`);
  return parts.join(" · ");
}

function response(
  query: RegulatoryQuery,
  question: QueryQuestion,
  extra: string[] = [],
  pending: Exclude<QueryQuestion, "none">[] = [],
): RegulatoryQueryInterpretation {
  const questions = [...new Set([...pending, ...(question === "none" ? [] : [question])])];
  const nextQuestion = questions[0];
  return {
    status: nextQuestion ? "clarification" : "ready",
    query: { ...query, offset: 0 },
    summary: describeQuery(query),
    ...(nextQuestion ? { question: QUESTIONS[nextQuestion] } : {}),
    limitations: [...limitationsForQuery(query), ...extra],
    pendingQuestions: questions,
  };
}

const CLEAR_FIELDS: Record<QueryField, RegExp> = {
  q: /\b(?:(?:clear|remove|reset)(?: the)? (?:search|text)(?: filters?)?|(?:all|any) records|(?:without|no)(?: the)? (?:search|text)(?: filters?)?)\b/i,
  source:
    /\b(?:(?:clear|remove|reset)(?: the)? source(?:s| family)?(?: filters?)?|(?:all|any) sources?|(?:without|no)(?: the)? source(?: family)? filters?)\b/i,
  sourceFamily:
    /\b(?:(?:clear|remove|reset)(?: the)? source(?:s| family)?(?: filters?)?|(?:all|any) sources?|(?:without|no)(?: the)? source(?: family)? filters?)\b/i,
  eventType:
    /\b(?:(?:clear|remove|reset)(?: the)? (?:events?|event type|change type)(?: filters?)?|(?:all|any) (?:events?|changes)|(?:without|no)(?: the)? (?:event|change)(?: type)? filters?)\b/i,
  from: /\b(?:(?:clear|remove|reset)(?: the)? (?:dates?|date range|start date|from date)(?: filters?)?|(?:all|any) dates?|(?:without|no)(?: the)? date(?: range)? filters?)\b/i,
  to: /\b(?:(?:clear|remove|reset)(?: the)? (?:dates?|date range|end date|to date)(?: filters?)?|(?:all|any) dates?|(?:without|no)(?: the)? date(?: range)? filters?)\b/i,
  dateBasis: /\b(?:clear|remove|reset)(?: the)? date basis\b/i,
};
const DATE_BASIS = {
  published: /\b(?:publication|published|publisher|posted|posting)\b/i,
  detected: /\b(?:detection|detected|collected|capture|captured|monitor)\b/i,
};
const NEGATIVE_SELECTION = /\b(?:no|not|exclude|excluding|except|without|never|don't|do not)\b/i;

// A supported clear is local to its field. Other exclusions in the same turn still need clarification.
function hasUnsupportedNegation(text: string): boolean {
  let remaining = text;
  for (const pattern of Object.values(CLEAR_FIELDS)) {
    remaining = remaining.replace(new RegExp(pattern.source, "gi"), "");
  }
  return NEGATIVE_SELECTION.test(remaining);
}

function negatedQuote(content: string, quote: string): boolean {
  const index = content.indexOf(quote);
  const prefix =
    content
      .slice(Math.max(0, index - 60), index)
      .split(/[.!?;\n]|\bbut\b/i)
      .at(-1) ?? "";
  return NEGATIVE_SELECTION.test(quote) || NEGATIVE_SELECTION.test(prefix);
}

/** Model values must match an allowed operation and be supported by exact user words. */
export function validateQueryModel(
  raw: unknown,
  input: RegulatoryQueryInput,
  now: Date,
): RegulatoryQueryInterpretation {
  const model = queryModelSchema.parse(raw);
  const latestText = input.turns.at(-1)!.content;
  if (ambiguousOrInvalidDate(input.turns.at(-1)!.content))
    return response(cleanQuery(input.currentQuery), "date_range", [], input.pendingQuestions);
  const plan: RegulatoryQuery = cleanQuery(input.currentQuery);
  const pending = new Set(input.pendingQuestions ?? []);
  const requestedFamilies = QUERY_SOURCE_FAMILIES.filter((id) =>
    familyPhrases[id].test(latestText),
  );
  const requestedFeeds = REGULATORY_SOURCE_IDS.filter(
    (id) => SOURCE_PHRASES[id].test(latestText) || latestText.includes(id),
  );
  const ambiguousSource =
    !CLEAR_FIELDS.source.test(latestText) &&
    (requestedFamilies.length > 1 || requestedFeeds.length > 1);
  const assigned = new Set<string>();
  for (const candidate of model.candidates) {
    const turn = input.turns[candidate.turnIndex];
    if (
      !turn ||
      turn.role !== "user" ||
      candidate.turnIndex !== input.turns.length - 1 ||
      !turn.content.includes(candidate.quote)
    )
      throw new Error("Query evidence is not current user text");
    if (assigned.has(candidate.field)) throw new Error("Ambiguous query field");
    assigned.add(candidate.field);
    if (candidate.value === null) {
      if (
        !CLEAR_FIELDS[candidate.field].test(candidate.quote) ||
        hasUnsupportedNegation(turn.content)
      )
        throw new Error("Unsupported clearing operation");
      delete plan[candidate.field];
      continue;
    }
    const value = candidate.value;
    const quote = candidate.quote;
    if (negatedQuote(turn.content, quote))
      throw new Error("Negated selection requires clarification");
    let supported = false;
    if (candidate.field === "q")
      supported =
        quote.toLocaleLowerCase("en-US").includes(value.toLocaleLowerCase("en-US")) &&
        value.trim().length > 0;
    if (candidate.field === "source")
      supported =
        REGULATORY_SOURCE_IDS.includes(value as never) &&
        (SOURCE_PHRASES[value as keyof typeof SOURCE_PHRASES].test(quote) || quote.includes(value));
    if (candidate.field === "sourceFamily")
      supported =
        QUERY_SOURCE_FAMILIES.includes(value as never) &&
        familyPhrases[value as keyof typeof familyPhrases].test(quote);
    if (candidate.field === "eventType")
      supported =
        REGULATORY_EVENT_TYPES.includes(value as never) &&
        eventPhrases[value as keyof typeof eventPhrases].test(quote);
    if (candidate.field === "dateBasis")
      supported = (value === "detected" || value === "published") && DATE_BASIS[value].test(quote);
    if (candidate.field === "from" || candidate.field === "to") {
      const relative = relativeQueryWindow(quote, now);
      supported =
        validQueryDate(value) &&
        (datesInQuery(quote).includes(value) || relative?.[candidate.field] === value);
    }
    if (!supported) throw new Error("Unsupported query value");
    Object.assign(plan, { [candidate.field]: value });
  }
  if (hasUnsupportedNegation(latestText))
    return response(
      cleanQuery(input.currentQuery),
      "search_term",
      ["Exclusion and negated filters need clarification; no inclusion filter was inferred."],
      input.pendingQuestions,
    );
  if (assigned.has("sourceFamily") && !assigned.has("source")) delete plan.source;
  if (assigned.has("source") && !assigned.has("sourceFamily")) delete plan.sourceFamily;
  if (assigned.has("source") || assigned.has("sourceFamily")) pending.delete("source");
  if (ambiguousSource) {
    delete plan.source;
    delete plan.sourceFamily;
    pending.add("source");
  }
  if (assigned.has("q") || assigned.has("eventType")) pending.delete("search_term");
  if (assigned.has("from") || assigned.has("to")) pending.delete("date_range");
  if (assigned.has("dateBasis")) pending.delete("date_basis");
  if (assigned.size && model.question !== "unsupported_analysis")
    pending.delete("unsupported_analysis");
  const changedDates =
    (plan.from !== input.currentQuery.from || plan.to !== input.currentQuery.to) &&
    !!(plan.from || plan.to);
  if (changedDates && !assigned.has("dateBasis")) delete plan.dateBasis;
  const validated = cleanQuery(regulatoryQueryPlanSchema.parse(plan));
  const question =
    (validated.from || validated.to) && !validated.dateBasis ? "date_basis" : model.question;
  return response(validated, question, [], [...pending]);
}

/** Explicit language fallback. It never silently claims to understand an unsupported operation. */
export function interpretGuidedQuery(
  input: RegulatoryQueryInput,
  now: Date,
): RegulatoryQueryInterpretation {
  const text = input.turns.at(-1)!.content;
  const plan: RegulatoryQuery = cleanQuery(input.currentQuery);
  const pending = new Set(input.pendingQuestions ?? []);
  let recognized = false;
  let question: QueryQuestion = "none";
  const ask = (value: Exclude<QueryQuestion, "none">) => {
    pending.add(value);
    question = value;
  };
  if (hasUnsupportedNegation(text))
    return response(
      cleanQuery(input.currentQuery),
      "search_term",
      ["Exclusion and negated filters need clarification; no inclusion filter was inferred."],
      [...pending],
    );
  if (ambiguousOrInvalidDate(text))
    return response(cleanQuery(input.currentQuery), "date_range", [], [...pending]);
  if (CLEAR_FIELDS.source.test(text)) {
    pending.delete("source");
    delete plan.source;
    delete plan.sourceFamily;
    recognized = true;
  } else {
    const sources = REGULATORY_SOURCE_IDS.filter(
      (id) => SOURCE_PHRASES[id].test(text) || text.includes(id),
    );
    const families = QUERY_SOURCE_FAMILIES.filter((id) => familyPhrases[id].test(text));
    if (sources.length === 1 && families.length <= 1) {
      pending.delete("source");
      plan.source = sources[0]!;
      delete plan.sourceFamily;
      recognized = true;
    } else if (sources.length === 0 && families.length === 1) {
      pending.delete("source");
      plan.sourceFamily = families[0]!;
      delete plan.source;
      recognized = true;
    } else if (sources.length > 1 || families.length > 1) ask("source");
  }
  const quoted = [...text.matchAll(/["“]([^"”\n]{1,300})["”]/g)]
    .map((match) => match[1]!.trim())
    .filter(Boolean);
  if (quoted.length === 1) {
    pending.delete("search_term");
    plan.q = quoted[0]!;
    recognized = true;
  } else if (quoted.length > 1) ask("search_term");
  else if (CLEAR_FIELDS.q.test(text)) {
    pending.delete("search_term");
    delete plan.q;
    recognized = true;
  } else {
    const term = text.match(
      /\b(?:about|containing|contains|involving|search for)\s+([\p{L}\p{N}][\p{L}\p{N}\s,'/-]{0,120}?)(?=\s+(?:from|since|between|during|in the|over the|for the|published|detected|last|past)\b|[.!?]|$)/iu,
    );
    if (term?.[1]?.trim()) {
      pending.delete("search_term");
      plan.q = term[1].trim();
      recognized = true;
    }
  }
  if (CLEAR_FIELDS.from.test(text) || CLEAR_FIELDS.to.test(text)) {
    pending.delete("date_range");
    if (CLEAR_FIELDS.from.test(text)) delete plan.from;
    if (CLEAR_FIELDS.to.test(text)) delete plan.to;
    recognized = true;
  } else {
    const range = relativeQueryWindow(text, now);
    const dates = datesInQuery(text);
    if (range) {
      pending.delete("date_range");
      Object.assign(plan, range);
      recognized = true;
    } else if (dates.length === 2) {
      pending.delete("date_range");
      plan.from = dates[0]!;
      plan.to = dates[1]!;
      recognized = true;
    } else if (dates.length === 1) {
      pending.delete("date_range");
      if (/\b(?:since|from|after|starting)\b/i.test(text)) plan.from = dates[0]!;
      else if (/\b(?:until|through|before|ending)\b/i.test(text)) plan.to = dates[0]!;
      else {
        plan.from = dates[0]!;
        plan.to = dates[0]!;
      }
      recognized = true;
    } else if (
      /\b\d{1,2}[/]\d{1,2}(?:[/]\d{2,4})?\b|\b(?:recent|recently|last year|this year|this month)\b/i.test(
        text,
      )
    )
      ask("date_range");
  }
  const bases = (["detected", "published"] as const).filter((basis) =>
    DATE_BASIS[basis].test(text),
  );
  if (bases.length === 1) {
    pending.delete("date_basis");
    plan.dateBasis = bases[0]!;
    recognized = true;
  } else if (bases.length > 1) ask("date_basis");
  else if (
    (plan.from !== input.currentQuery.from || plan.to !== input.currentQuery.to) &&
    (plan.from || plan.to)
  ) {
    delete plan.dateBasis;
    ask("date_basis");
  } else if ((plan.from || plan.to) && !plan.dateBasis) ask("date_basis");
  const events = REGULATORY_EVENT_TYPES.filter((type) => eventPhrases[type].test(text));
  if (CLEAR_FIELDS.eventType.test(text)) {
    pending.delete("search_term");
    delete plan.eventType;
    recognized = true;
  } else if (events.length === 1) {
    pending.delete("search_term");
    plan.eventType = events[0]!;
    recognized = true;
  } else if (events.length > 1) ask("search_term");
  if (
    /\b(?:causation|caused|incidence|risk rate|liability|case value|win probability|independent corroboration|statistical significance|p-value)\b/i.test(
      text,
    )
  )
    ask("unsupported_analysis");
  else if (recognized) pending.delete("unsupported_analysis");
  const parsed = regulatoryQueryPlanSchema.safeParse(plan);
  if (!parsed.success)
    return response(cleanQuery(input.currentQuery), "date_range", [], [...pending]);
  if (!recognized && question === "none") question = "search_term";
  return response(
    cleanQuery(parsed.data),
    pending.size ? "none" : question,
    [
      "Guided interpretation recognizes explicit sources, quoted phrases, dates and change types. Review the proposed filters before applying them.",
    ],
    [...pending],
  );
}
