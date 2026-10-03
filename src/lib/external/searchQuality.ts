import type { SearchRecord } from "./searchIdentity";
import { recordedStateCode } from "@/lib/corpus/courtLocations";

export type SearchMatch = { item: Record<string, unknown>; record: SearchRecord };
export type RankedSearchMatch = SearchMatch & {
  displayTitle: string;
  sourceFileLabel: string | null;
  alsoIndexedAs: { dataset: string; id: string }[];
};

function text(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:\d+|x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]!;
    const number = entity.toLowerCase().startsWith("&#x") ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : entity;
  }).replace(/\s+/g, " ").trim();
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
  return title;
}

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
  mdls: 350, expert_rulings: 300, cl_dockets: 150, mdl_docket_documents: 130,
  court_documents: 100, state_proceedings: 120, cl_master_entries: 80,
  federal_regulations_sections: 20,
};
function words(value: string): string[] { return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }
function score(match: RankedSearchMatch, queryWords: string[]): number {
  const titleWords = words(match.displayTitle);
  const exact = queryWords.filter((word) => titleWords.includes(word)).length;
  const prefix = queryWords.filter((word) => !titleWords.includes(word) && titleWords.some((title) => title.startsWith(word))).length;
  const all = queryWords.length > 0 && exact + prefix === queryWords.length;
  const phrase = queryWords.length > 0 && titleWords.join(" ").includes(queryWords.join(" "));
  return exact * 100 + prefix * 70 + (all ? 200 : 0) + (phrase ? 200 : 0) + (legalPriority[match.record.dataset] ?? 0);
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
export function rankSearchMatches(matches: readonly SearchMatch[], q: string) {
  const queryWords = [...new Set(words(q))];
  const unique = new Map<string, RankedSearchMatch>();
  for (const match of matches) {
    const identity = JSON.stringify([match.record.dataset, match.record.id]);
    if (!unique.has(identity)) unique.set(identity, {
      ...match, displayTitle: searchDisplayTitle(match), sourceFileLabel: sourceFileLabel(match.record.source_url), alsoIndexedAs: [],
    });
  }
  const sorted = [...unique.values()].sort((a, b) => score(b, queryWords) - score(a, queryWords)
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
