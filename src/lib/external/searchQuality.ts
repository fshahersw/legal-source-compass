import type { SearchRecord } from "./searchIdentity";
import { recordedStateCode } from "@/lib/corpus/courtLocations";
import { cleanText } from "./entities";

export type SearchMatch = { item: Record<string, unknown>; record: SearchRecord };
export type RankedSearchMatch = SearchMatch & {
  displayTitle: string;
  sourceFileLabel: string | null;
  alsoIndexedAs: { dataset: string; id: string }[];
};

function text(value: unknown): string {
  return typeof value === "string" ? cleanText(value) : "";
}

/** Use heading/citation fields as labeled, rather than mistaking a CFR title number for a heading. */
export function searchDisplayTitle({ record, item }: SearchMatch): string {
  const heading = text(item["heading"]);
  const citation = text(item["citation"]);
  if (record.dataset.startsWith("federal_regulations_") && heading)
    return citation ? `${citation} — ${heading}` : heading;
  const title = text(record.title) || text(item["name"]) || text(item["title"]) || record.id;
  if (record.dataset === "mdls" && (typeof item["mdl_number"] === "number" || typeof item["mdl_number"] === "string"))
    return `MDL ${String(item["mdl_number"])} — ${title}`;
  // The matter registry's MDL record carries its number in the cells; its title is the caption only.
  if (record.dataset === "sw_matters_v1") {
    const cells = item["cells"] && typeof item["cells"] === "object" ? (item["cells"] as Record<string, unknown>) : {};
    const mdl = cells["mdl_number"];
    if (typeof mdl === "number" || typeof mdl === "string") return `MDL ${String(mdl)} — ${title}`;
  }
  return title;
}

/**
 * Search intent for a person. A query that STARTS with an honorific ("Judge Rodgers", "Hon. Casey Rodgers") and has a
 * short name after it is a search for a person. Titles never contain the honorific, so the AND query would exclude
 * the person: the database is asked for the query without it and ranking uses the intent instead. A bare honorific,
 * a long phrase ("Justice for victims act") or a question-like sentence is left exactly as typed.
 */
export type SearchIntent = { honorific: boolean; query: string };
const HONORIFIC_LEAD = /^(?:judge|justice|hon\.?|honorable|magistrate)\s+/i;
const NAME_BREAKERS = new Set(["for", "of", "the", "and", "or", "in", "re", "v", "vs", "to", "on"]);
export function searchIntent(q: string): SearchIntent {
  const trimmed = q.trim();
  // "Magistrate Judge Cannon": every leading honorific is dropped.
  let rest = trimmed;
  let lead = HONORIFIC_LEAD.exec(rest);
  if (!lead) return { honorific: false, query: trimmed };
  while (lead) {
    rest = rest.slice(lead[0].length).trim();
    lead = HONORIFIC_LEAD.exec(rest);
  }
  const restWords = rest.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'.-]*/gu) ?? [];
  if (!restWords.length || restWords.length > 4 || NAME_BREAKERS.has(restWords[0]!) || /["()]/.test(rest))
    return { honorific: false, query: trimmed };
  return { honorific: true, query: rest };
}

/** Datasets whose records are people; with an honorific in the query these rank above same-surname matches elsewhere. */
export const PERSON_DATASETS: ReadonlySet<string> = new Set(["judges", "people", "cl_people", "judge_entities", "judge_enrichment"]);
export type SearchContext = {
  /** CourtListener person ids of judges who preside over an MDL (mdls.filters.cl_person_id). */
  mdlJudgePersonIds?: ReadonlySet<string> | undefined;
  /** Judge-entity ids of those judges (mdls.filters.entity_id); the judge directory records carry this native id. */
  mdlJudgeEntityIds?: ReadonlySet<string> | undefined;
};

/** Retain meaningful path/query values. Fragments and query ordering do not identify another source. */
export function canonicalSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

export function sourceFileLabel(value: string | null): string | null {
  const canonical = canonicalSourceUrl(value);
  if (!canonical) return null;
  const file = new URL(canonical).pathname.split("/").pop();
  if (!file || !/\.(pdf|html?|xml|txt)$/i.test(file)) return null;
  try { return decodeURIComponent(file); } catch { return file; }
}

/** Prefix retrieval is restricted to plain words, preserving quoted/boolean query semantics. */
export function searchQueryFilters(q: string): Record<string, boolean> {
  return /^[\p{L}\p{N}]+(?:\s+[\p{L}\p{N}]+){0,7}$/u.test(q.trim()) && !/\b(?:OR|AND|NOT)\b/i.test(q)
    ? { __prefix: true } : {};
}

/** Only explicitly recorded native court IDs are eligible for a directory lookup. */
export function searchCourtId({ item, record }: SearchMatch): string | null {
  if (record.dataset === "court_spine") return record.id;
  for (const field of ["cl_court_id", "court_id", "court"]) {
    const id = item[field];
    if (typeof id === "string" && /^[a-z][a-z0-9]{0,19}$/.test(id)) return id;
  }
  return null;
}

export function searchState(match: SearchMatch, courtLocations: ReadonlyMap<string, string>) {
  const court = searchCourtId(match);
  const location = court ? courtLocations.get(court) : undefined;
  const recorded = recordedStateCode(match.record.state ?? "");
  return { state: location ?? recorded, stateBasis: location ? "exact_court_location" as const : recorded ? "recorded_state" as const : null };
}

const legalPriority: Record<string, number> = {
  mdls: 350, sw_matters_v1: 200, expert_rulings: 300, cl_dockets: 150, mdl_docket_documents: 130,
  court_documents: 100, state_proceedings: 120, cl_master_entries: 80,
  federal_regulations_sections: 20,
};
function words(value: string): string[] { return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }
/** Person-intent boost: +250 for a people dataset, +250 more when that person presides over an MDL (exact CourtListener person id). */
function personBoost(match: RankedSearchMatch, context: SearchContext): number {
  if (!PERSON_DATASETS.has(match.record.dataset)) return 0;
  // Exact native ids only (CourtListener person id, or the judge-entity id the MDL record links); never a name match.
  const id = /^(?:cl:people:)?(\d+)$/.exec(match.record.id)?.[1];
  const entity = typeof match.item["entity_id"] === "string" ? match.item["entity_id"] : undefined;
  const presides = (id && context.mdlJudgePersonIds?.has(id)) || (entity && context.mdlJudgeEntityIds?.has(entity));
  return 250 + (presides ? 250 : 0);
}
function score(match: RankedSearchMatch, queryWords: string[], boost: number): number {
  const titleWords = words(match.displayTitle);
  const exact = queryWords.filter((word) => titleWords.includes(word)).length;
  const prefix = queryWords.filter((word) => !titleWords.includes(word) && titleWords.some((title) => title.startsWith(word))).length;
  const all = queryWords.length > 0 && exact + prefix === queryWords.length;
  const phrase = queryWords.length > 0 && titleWords.join(" ").includes(queryWords.join(" "));
  return exact * 100 + prefix * 70 + (all ? 200 : 0) + (phrase ? 200 : 0) + (legalPriority[match.record.dataset] ?? 0) + boost;
}

// Presentation grouping is limited to source-document rows. Native court/case/judge identities stay separate.
const sourceDocumentDatasets = new Set(["agency_science_documents", "source_documents", "saved_pages", "sources", "url_directory"]);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function sourceGroupKey(match: RankedSearchMatch): string | null {
  if (!sourceDocumentDatasets.has(match.record.dataset)) return null;
  const url = canonicalSourceUrl(match.record.source_url);
  if (!url) return null;
  // Keep every non-identity payload field: dates, qualification, chapters and source provenance are significant.
  const payload = Object.fromEntries(Object.entries(match.item).filter(([key]) => key !== "id").map(([key, value]) => {
    return [key, typeof value === "string" && canonicalSourceUrl(value) === url ? url : value];
  }));
  return canonical([match.record.dataset, url, match.displayTitle, match.record.category, match.record.state, payload]);
}

/** Ranking/grouping changes only result cards; each original (dataset,id) remains a linkable identity. */
export function rankSearchMatches(matches: readonly SearchMatch[], q: string, context: SearchContext = {}) {
  // With a person-intent honorific the title words to match are the name (the honorific is not in any title).
  const intent = searchIntent(q);
  const queryWords = [...new Set(words(intent.honorific ? intent.query : q))];
  const unique = new Map<string, RankedSearchMatch>();
  for (const match of matches) {
    const identity = JSON.stringify([match.record.dataset, match.record.id]);
    if (!unique.has(identity)) unique.set(identity, {
      ...match, displayTitle: searchDisplayTitle(match), sourceFileLabel: sourceFileLabel(match.record.source_url), alsoIndexedAs: [],
    });
  }
  const scoreOf = (m: RankedSearchMatch) => score(m, queryWords, intent.honorific ? personBoost(m, context) : 0);
  const sorted = [...unique.values()].sort((a, b) => scoreOf(b) - scoreOf(a)
    || a.displayTitle.localeCompare(b.displayTitle) || a.record.dataset.localeCompare(b.record.dataset) || a.record.id.localeCompare(b.record.id));
  const groups = new Map<string, RankedSearchMatch>();
  const ranked: RankedSearchMatch[] = [];
  for (const match of sorted) {
    const key = sourceGroupKey(match);
    const previous = key ? groups.get(key) : undefined;
    if (previous) previous.alsoIndexedAs.push({ dataset: match.record.dataset, id: match.record.id });
    else {
      ranked.push(match);
      if (key) groups.set(key, match);
    }
  }
  return { ranked, nativeRecords: unique.size, groupedSourceRecords: unique.size - ranked.length };
}
