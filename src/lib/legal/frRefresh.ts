/**
 * Incremental Federal Register refresh for the legal atlas: pure helpers shared by
 * scripts/legal/acquire-federal-register.mjs, prepare-fr-staging.mjs and
 * refresh-federal-register.mjs. No I/O here.
 *
 * Every legal_atlas fr_document must carry the same native field set, so a refresh
 * produces the payload shape of the 2026-10-02 load and never the reduced
 * "dates" shape of the quality reference fetch (scripts/fetch-register-gap.mjs).
 */
import { ID_PATTERNS } from "./identity.ts";

export const FEDERAL_REGISTER_ORIGIN = "https://www.federalregister.gov";
export const FEDERAL_REGISTER_SCHEMA_VERSION = "federal-register-api-v1/round3";
/** The API fields requested for every legal atlas document (order is the request order). */
export const FEDERAL_REGISTER_FIELDS = [
  "document_number", "title", "type", "publication_date", "agencies", "cfr_references", "regulation_id_numbers",
  "docket_ids", "dockets", "effective_on", "html_url", "pdf_url", "raw_text_url", "full_text_xml_url", "action",
  "comments_close_on", "regulations_dot_gov_info", "regulation_id_number_info", "json_url", "citation",
] as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addDays(day: string, n: number): string {
  if (!isIsoDay(day)) throw new Error(`Invalid ISO day: ${day}`);
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export type Period = { start: string; end: string };
/** Calendar-month periods that exactly tile [from, through], both inclusive. */
export function monthlyPeriods(from: string, through: string): Period[] {
  if (!isIsoDay(from) || !isIsoDay(through)) throw new Error("Use ISO dates (YYYY-MM-DD)");
  if (from > through) throw new Error("The refresh window is empty");
  const out: Period[] = [];
  let start = from;
  while (start <= through) {
    const year = Number(start.slice(0, 4)); const month = Number(start.slice(5, 7));
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const end = monthEnd < through ? monthEnd : through;
    out.push({ start, end });
    start = addDays(end, 1);
  }
  return out;
}

export type AcquiredPeriod = { start_date: string; end_date: string; expected: number; actual: number; status: string };
/**
 * The acquired periods must tile the window with no gap or overlap, each marked
 * acquired with the publisher's count equal to the rows kept. Returns the problems found.
 */
export function windowProblems(periods: readonly AcquiredPeriod[], from: string, through: string): string[] {
  const inWindow = periods.filter((p) => p.end_date >= from && p.start_date <= through)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const problems: string[] = [];
  let cursor = from;
  for (const p of inWindow) {
    if (p.start_date < from || p.end_date > through) problems.push(`Period ${p.start_date}..${p.end_date} extends outside the window`);
    if (p.start_date !== cursor) problems.push(`Gap or overlap at ${cursor} (next period starts ${p.start_date})`);
    if (p.status !== "acquired") problems.push(`Period ${p.start_date} is ${p.status}`);
    if (p.expected !== p.actual) problems.push(`Period ${p.start_date}: publisher count ${p.expected} but ${p.actual} rows kept`);
    cursor = p.end_date >= cursor ? addDays(p.end_date, 1) : cursor;
  }
  if (cursor <= through) problems.push(`Window not acquired from ${cursor} through ${through}`);
  return problems;
}

/** Official documents.json search URL for one period, with the fixed legal atlas field set. */
export function documentsUrl(period: Period): string {
  const url = new URL(`${FEDERAL_REGISTER_ORIGIN}/api/v1/documents.json`);
  url.searchParams.set("conditions[publication_date][gte]", period.start);
  url.searchParams.set("conditions[publication_date][lte]", period.end);
  url.searchParams.set("per_page", "1000");
  for (const field of FEDERAL_REGISTER_FIELDS) url.searchParams.append("fields[]", field);
  return url.href;
}

/** A RIN in the publisher's canonical form (e.g. 0910-AI60). Other strings are never linked or rewritten. */
export function isCanonicalRin(value: unknown): value is string {
  return typeof value === "string" && new RegExp(ID_PATTERNS["rule_proceeding"]!).test(value);
}

/**
 * A post-2009 correction notice: the publisher numbers it C1-, C2-... and gives it its parent's type
 * (e.g. C1-2026-20360, "Proposed Rule", correcting 2026-20360). Like a pre-2009 "Correction", it
 * corrects a document; it does not itself propose or finalize the rule. (R1-/R2- republications do.)
 */
export function isCorrectionNumber(documentNumber: unknown): boolean {
  return typeof documentNumber === "string" && /^C[0-9]+-/.test(documentNumber);
}

/** Missing round-3 fields on a native Federal Register document (empty when the field set is complete). */
export function missingFields(data: Record<string, unknown>): string[] {
  return FEDERAL_REGISTER_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(data, field));
}

export type HeldDocument = { id: string; source_url: string };
/** Held publications are matched by the exact publisher URL; a reused document number with another URL is new. */
export function heldUrlSet(held: readonly HeldDocument[]): Set<string> {
  return new Set(held.map((h) => h.source_url));
}
