/**
 * Primary-source backfill entries for the limitations matrix.
 *
 * An entry is only `verified` when every claim it makes is backed by a literal, whitespace-normalised substring
 * of a captured official response. Anything else must be `flagged` (reason required) or `not_recorded`
 * (no period, reason required). Nothing here guesses.
 */
import { CLAIM_TYPES } from "../types";

export const PERIOD_UNITS = ["years", "months", "days"] as const;
export type PeriodUnit = (typeof PERIOD_UNITS)[number];
export const ENTRY_STATUSES = ["verified", "flagged", "not_recorded"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const ACCRUAL_KINDS = [
  "accrual",
  "discovery",
  "occurrence",
  "death",
  "treatment_end",
  "breach",
  "other",
  "not_recorded",
] as const;

export type CaptureMeta = {
  id: string;
  state: string;
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  hostClass: "official" | "official_designated" | "blocked_secondary" | "unlisted";
  finalHostClass?: "official" | "official_designated" | "blocked_secondary" | "unlisted";
  retrievedAt: string;
  rawSha256: string;
  rawBytes: number;
  textSha256: string;
  textBytes: number;
  intermediary?: boolean;
  extraction?: string;
};

export type MatrixEntryInput = {
  claimType: string;
  variant?: string;
  status: string;
  period: { amount: number; unit: string } | null;
  periodEvidence: string;
  citation: string;
  excerpt: string;
  captureId: string;
  accrual: { kind: string; text: string; evidence: string };
  tolling: { text: string; citation: string; evidence: string }[];
  repose: {
    years: number;
    citation: string;
    trigger: string;
    evidence: string;
    effectiveFrom: string | null;
  }[];
  lastAmended: { text: string; date: string | null; evidence: string };
  effectiveDate: string | null;
  crossChecks: { captureId: string; note: string }[];
  confidence: string;
  confidenceNote: string;
  flags: string[];
  notRecordedReason?: string;
  /** Open issues that cannot be resolved from official text, each with the precise reason. */
  blockers?: { issue: string; why: string }[];
};

const UNITS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const NUMBER_WORDS: Record<string, number> = {
  ...Object.fromEntries(UNITS.map((w, i) => [w, i + 1])),
  ...Object.fromEntries(TEENS.map((w, i) => [w, i + 10])),
  ...Object.fromEntries(TENS.map((w, i) => [w, (i + 2) * 10])),
  ...Object.fromEntries(
    TENS.flatMap((t, ti) => UNITS.map((u, ui) => [`${t}-${u}`, (ti + 2) * 10 + ui + 1] as const)),
  ),
  "one hundred eighty": 180,
};

/** Normalise typography and whitespace so a quoted excerpt compares against extracted page text. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsLiteral(haystack: string, needle: string): boolean {
  const n = normalizeText(needle);
  return n.length >= 8 && normalizeText(haystack).includes(n);
}

/** Every `<number> <unit>` quantity stated in a literal period quotation, e.g. "two (2) years" or "1 year". */
export function parsePeriodQuantities(text: string): { amount: number; unit: PeriodUnit }[] {
  const t = normalizeText(text).toLowerCase();
  const words = Object.keys(NUMBER_WORDS)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace("-", "[- ]"))
    .join("|");
  const re = new RegExp(
    `(?:\\b(${words})\\b|\\b(\\d{1,3})\\b)(?:\\s*\\(\\s*\\d{1,3}\\s*\\))?[\\s-]+(years?|months?|days?)\\b`,
    "g",
  );
  const found: { amount: number; unit: PeriodUnit }[] = [];
  const compound = new RegExp(
    `(?:\\b(${words})\\b|\\b(\\d{1,3})\\b)(?:\\s*\\(\\s*\\d{1,3}\\s*\\))?[\\s-]+years?,?\\s+and\\s+(?:\\b(${words})\\b|\\b(\\d{1,3})\\b)(?:\\s*\\(\\s*\\d{1,3}\\s*\\))?[\\s-]+months?\\b`,
    "g",
  );
  const num = (word: string | undefined, digits: string | undefined) =>
    word ? (NUMBER_WORDS[word.replace(" ", "-")] ?? NUMBER_WORDS[word]) : Number(digits);
  for (const m of t.matchAll(compound)) {
    const years = num(m[1], m[2]);
    const months = num(m[3], m[4]);
    if (years && months) found.push({ amount: years * 12 + months, unit: "months" });
  }
  for (const m of t.matchAll(re)) {
    const amount = m[1]
      ? (NUMBER_WORDS[m[1].replace(" ", "-")] ?? NUMBER_WORDS[m[1]])
      : Number(m[2]);
    if (!amount) continue;
    const unit = m[3]!.startsWith("year") ? "years" : m[3]!.startsWith("month") ? "months" : "days";
    found.push({ amount, unit });
  }
  return found;
}

export type EntryProblem = { level: "error" | "warning"; message: string };

const isoDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export type CaptureLookup = (id: string) => { meta: CaptureMeta; text: string } | undefined;

/** Mechanically verify one entry against its captures. Returns every problem found. */
export function checkEntry(
  jurisdiction: string,
  entry: MatrixEntryInput,
  lookup: CaptureLookup,
): EntryProblem[] {
  const out: EntryProblem[] = [];
  const err = (message: string) => out.push({ level: "error", message });
  const warn = (message: string) => out.push({ level: "warning", message });
  if (!(CLAIM_TYPES as readonly string[]).includes(entry.claimType))
    err(`unknown claim type ${entry.claimType}`);
  if (!(ENTRY_STATUSES as readonly string[]).includes(entry.status)) err("invalid status");
  if (!(CONFIDENCE_LEVELS as readonly string[]).includes(entry.confidence))
    err("invalid confidence");
  if (!entry.confidenceNote?.trim()) err("confidenceNote is required");
  if (entry.variant !== undefined && !/^[a-z0-9_]{1,40}$/.test(entry.variant))
    err("variant must be a short snake_case slug");
  if (!Array.isArray(entry.flags)) err("flags must be an array");
  if (entry.status === "flagged" && !entry.flags?.length)
    err("flagged entries need at least one flag");
  if (entry.status === "not_recorded") {
    if (entry.period !== null) err("not_recorded entries must have period null");
    if (!entry.notRecordedReason?.trim()) err("not_recorded entries need notRecordedReason");
    return out;
  }
  if (!entry.citation?.trim()) err("citation is required");
  if (!entry.period) {
    err("period is required unless status is not_recorded");
  } else {
    if (
      !Number.isInteger(entry.period.amount) ||
      entry.period.amount < 1 ||
      entry.period.amount > 100
    )
      err("period.amount must be a positive integer");
    if (!(PERIOD_UNITS as readonly string[]).includes(entry.period.unit))
      err("period.unit invalid");
  }
  const capture = lookup(entry.captureId);
  if (!capture) {
    err(`primary capture ${entry.captureId} not found`);
    return out;
  }
  const { meta, text } = capture;
  if (meta.state !== jurisdiction)
    err(`capture ${meta.id} belongs to ${meta.state}, not ${jurisdiction}`);
  if (meta.status !== 200) err("capture did not return HTTP 200");
  if (meta.hostClass === "blocked_secondary" || meta.finalHostClass === "blocked_secondary")
    err("capture host is a secondary publisher");
  if (meta.hostClass === "unlisted")
    warn(`capture host is not on the official-host list; manual official-source review required`);
  if (!containsLiteral(text, entry.excerpt))
    err("excerpt is not a literal substring of the capture text");
  if (!containsLiteral(entry.excerpt, entry.periodEvidence))
    err("periodEvidence is not a literal substring of the excerpt");
  if (entry.period) {
    const quantities = parsePeriodQuantities(entry.periodEvidence);
    const wanted = `${entry.period.amount} ${entry.period.unit}`;
    if (!quantities.some((q) => q.amount === entry.period!.amount && q.unit === entry.period!.unit))
      err(
        `periodEvidence states ${quantities.map((q) => `${q.amount} ${q.unit}`).join(", ") || "no parseable period"}; entry says ${wanted}`,
      );
  }
  if (!ACCRUAL_KINDS.includes(entry.accrual?.kind as (typeof ACCRUAL_KINDS)[number]))
    err("invalid accrual.kind");
  else if (entry.accrual.kind === "not_recorded") {
    warn("accrual rule not recorded");
  } else {
    if (!entry.accrual.text?.trim()) err("accrual.text required");
    if (
      !entry.accrual.evidence ||
      ![
        text,
        ...(entry.crossChecks ?? []).flatMap((c) =>
          lookup(c.captureId) ? [lookup(c.captureId)!.text] : [],
        ),
      ].some((t) => containsLiteral(t, entry.accrual.evidence))
    )
      err("accrual.evidence is not a literal substring of the primary or a cross-check capture");
  }
  const evidenceTexts = [
    text,
    ...(entry.crossChecks ?? []).flatMap((c) => {
      const other = lookup(c.captureId);
      return other && other.meta.hostClass !== "blocked_secondary" ? [other.text] : [];
    }),
  ];
  const inEvidence = (needle: string) => evidenceTexts.some((t) => containsLiteral(t, needle));
  for (const [i, t] of (entry.tolling ?? []).entries()) {
    if (!t.evidence || !inEvidence(t.evidence))
      err(
        `tolling[${i}].evidence is not a literal substring of the primary or a cross-check capture`,
      );
  }
  for (const [i, r] of (entry.repose ?? []).entries()) {
    if (!Number.isInteger(r.years) || r.years < 1) err(`repose[${i}].years invalid`);
    if (!r.evidence || !inEvidence(r.evidence))
      err(
        `repose[${i}].evidence is not a literal substring of the primary or a cross-check capture`,
      );
    else if (
      !parsePeriodQuantities(r.evidence).some((q) => q.unit === "years" && q.amount === r.years)
    )
      err(`repose[${i}].evidence does not state ${r.years} years`);
    if (r.effectiveFrom !== null && !isoDate(r.effectiveFrom))
      err(`repose[${i}].effectiveFrom invalid`);
  }
  if (entry.lastAmended?.evidence && !inEvidence(entry.lastAmended.evidence))
    err("lastAmended.evidence is not a literal substring of the primary or a cross-check capture");
  if (
    entry.lastAmended?.date !== null &&
    entry.lastAmended?.date !== undefined &&
    !isoDate(entry.lastAmended.date)
  )
    err("lastAmended.date must be YYYY-MM-DD or null");
  if (
    entry.effectiveDate !== null &&
    entry.effectiveDate !== undefined &&
    !isoDate(entry.effectiveDate)
  )
    err("effectiveDate must be YYYY-MM-DD or null");
  if (!entry.lastAmended?.text?.trim()) warn("lastAmended not recorded");
  for (const [i, c] of (entry.crossChecks ?? []).entries()) {
    const other = lookup(c.captureId);
    if (!other) err(`crossChecks[${i}] capture ${c.captureId} not found`);
    else if (other.meta.hostClass === "blocked_secondary")
      err(`crossChecks[${i}] is a secondary source`);
  }
  if (entry.status === "verified") {
    if (meta.intermediary && entry.confidence === "high" && !(entry.crossChecks ?? []).length)
      err("an intermediary-only extraction without a cross-check cannot be high confidence");
    if (entry.flags?.length) err("verified entries cannot carry flags; use status flagged");
  }
  return out;
}

export type MatrixEntry = MatrixEntryInput & {
  jurisdiction: string;
  variant: string;
  primary: { url: string; retrievedAt: string; rawSha256: string; textSha256: string };
};

export type TimeRuleInput = {
  status: string;
  citation: string;
  excerpt: string;
  evidence: string;
  captureId: string;
  extendsWhenLastDayIsWeekend: boolean | null;
  extendsWhenLastDayIsHoliday: boolean | null;
  confidence: string;
  confidenceNote: string;
  flags: string[];
  notRecordedReason?: string;
};

/** Verify a state's computation-of-time rule (last day on a weekend or legal holiday) against its capture. */
export function checkTimeRule(
  jurisdiction: string,
  rule: TimeRuleInput,
  lookup: CaptureLookup,
): EntryProblem[] {
  const out: EntryProblem[] = [];
  const err = (message: string) => out.push({ level: "error", message });
  if (!(ENTRY_STATUSES as readonly string[]).includes(rule.status)) err("invalid status");
  if (rule.status === "not_recorded") {
    if (!rule.notRecordedReason?.trim()) err("not_recorded needs notRecordedReason");
    return out;
  }
  if (!rule.citation?.trim()) err("citation is required");
  if (
    typeof rule.extendsWhenLastDayIsWeekend !== "boolean" &&
    !(rule.status === "flagged" && rule.extendsWhenLastDayIsWeekend === null)
  )
    err("extendsWhenLastDayIsWeekend must be true or false (null only when flagged)");
  if (rule.status === "flagged" && !rule.flags?.length) err("flagged needs flags");
  const capture = lookup(rule.captureId);
  if (!capture) return [...out, { level: "error", message: `capture ${rule.captureId} not found` }];
  if (capture.meta.state !== jurisdiction) err("capture belongs to another jurisdiction");
  if (capture.meta.hostClass === "blocked_secondary") err("secondary source");
  if (!containsLiteral(capture.text, rule.excerpt))
    err("excerpt is not a literal substring of the capture text");
  if (!containsLiteral(rule.excerpt, rule.evidence))
    err("evidence is not a literal substring of the excerpt");
  return out;
}
