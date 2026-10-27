/** Pure helpers for the connected corpus: section grouping, item normalisation and link resolution. */
import { cleanText } from "./entities";
import { externalHref } from "./href";
import { isProvisionDataset } from "./lawTree";
import { RECORD_ID_MAX_LENGTH, RECORD_TOKEN_MAX_ENCODED_LENGTH } from "./recordIdentity";

/** An exact collection identity selects a permanent detail page. IDs are never inferred from names. */
export function recordDestination(dataset: string, id: string) {
  if (dataset === "court_spine") return { kind: "court" as const, id };
  if (dataset === "judges") return { kind: "judge" as const, id };
  if (dataset === "mdls") return { kind: "mdl" as const, id: id.replace(/^mdl:/, "") };
  // A matter-registry record is the same MDL matter: open the matter page, not the generic record view.
  if (dataset === "sw_matters_v1" && /^sw-matter:\d{1,6}$/.test(id))
    return { kind: "mdl" as const, id: id.slice("sw-matter:".length) };
  if (isProvisionDataset(dataset)) return { kind: "provision" as const, dataset, id };
  return { kind: "record" as const, dataset, id };
}

export type SectionId = "courts" | "judges" | "matters" | "law" | "safety" | "sources" | "other";

export const SECTIONS: { id: SectionId; label: string; blurb: string }[] = [
  {
    id: "courts",
    label: "Courts",
    blurb: "Court registry, seals, statistics, rules, forms and court documents.",
  },
  {
    id: "judges",
    label: "Judges",
    blurb: "Judge directory, enrichment, disclosures, entities and biographies.",
  },
  {
    id: "matters",
    label: "Matters",
    blurb: "MDLs, dockets, cases, counsel, settlements, verdicts and expert-admissibility entries.",
  },
  {
    id: "law",
    label: "Law",
    blurb:
      "Statutes, regulations, Federal Register, public laws, limitation periods and citations.",
  },
  {
    id: "safety",
    label: "Safety",
    blurb: "FDA, openFDA and CPSC recall and enforcement records.",
  },
  {
    id: "sources",
    label: "Sources",
    blurb: "Source directories, saved pages, URL directory and coverage labels.",
  },
  { id: "other", label: "Other", blurb: "Datasets not yet assigned to a section." },
];

const EXPLICIT: Record<string, SectionId> = {
  cl_courthouses: "courts",
  cl_people: "judges",
  cl_docket_metadata: "matters",
  sw_matters_v1: "matters",
  sw_docket_documents_v1: "matters",
  sw_matter_dockets_v1: "matters",
  sw_matter_dockets_v1_superseded: "matters",
  sw_docket_entries_v1: "matters",
  sw_matter_parties_v1: "matters",
  sw_matter_regulatory_links_v1: "matters",
  sw_matter_regulatory_links_v1_staged: "matters",
  statutory_limitations_review: "law",
  ecfr_hierarchy: "law",
  ecfr_section_text: "law",
  ecfr_sections_full: "law",
  ecfr_section_versions: "law",
  ecfr_parallel_authorities: "law",
  ecfr_subject_index: "law",
  ecfr_agencies: "law",
  ecfr_authority_notes: "law",
  mass_tort_authority_evidence: "law",
  jpml_html_reference: "law",
  court_spine: "courts",
  court_reference: "courts",
  court_statistics: "courts",
  court_documents: "courts",
  court_forms_expansion_20260912: "courts",
  uscourts_pages: "courts",
  county_litigation: "courts",
  counties: "courts",
  trellis_browser_counties: "courts",
  trellis_receipts: "courts",
  judges: "judges",
  judge_entities: "judges",
  judge_portraits: "judges",
  judge_vendor: "judges",
  mdls: "matters",
  mdl_appearances: "matters",
  mdl_crosswalk: "matters",
  mdl_counsel: "matters",
  mdl_case_inventory: "matters",
  mdl_docket_documents: "matters",
  mdl_docket_activity: "matters",
  settlements: "matters",
  settlement_claims_official: "matters",
  ftc_enforcement_actions: "law",
  ftc_cases: "law",
  ftc_hsr_early_terminations: "law",
  ftc_hsr_filings: "law",
  sec_broker_dealers: "law",
  sec_investment_advisers: "law",
  sec_adviser_statistics: "law",
  frb_enforcement_actions: "law",
  sec_enforcement_actions: "law",
  sam_exclusions: "law",
  congress_bills: "law",
  congress_members: "law",
  congress_committees: "law",
  gov_domains: "sources",
  gov_domains_summary: "sources",
  crs_reports: "law",
  state_bills: "law",
  oig_leie_exclusions: "law",
  oversight_reports: "law",
  oversight_trends: "law",
  doj_oig_reports: "law",
  osc_public_files: "law",
  osc_publications: "law",
  doj_cep_resolutions: "law",
  doj_document_index: "law",
  fsis_recalls: "safety",
  fsis_enforcement_quarterly: "safety",
  ussc_sentencing_districts: "courts",
  eousa_caseload_annual: "courts",
  verdict_reports: "matters",
  expert_rulings: "matters",
  state_proceedings: "matters",
  counsel_directory: "matters",
  seeger: "matters",
  state_codes: "law",
  indiana_code: "law",
  sd_statutes: "law",
  provider_laws: "law",
  public_laws: "law",
  us_code_titles: "law",
  us_code_sections: "law",
  us_code_release_points: "law",
  us_code_amendment_links: "law",
  public_laws_enacted: "law",
  limitation_periods: "law",
  citation_reference: "law",
  citation_index: "law",
  federal_regulations_sections: "law",
  federal_regulations_parts: "law",
  federal_regulations_documents: "law",
  federal_register_history: "law",
  fr_agency_profiles: "law",
  fr_agency_trends: "law",
  unified_agenda_pipeline: "law",
  agency_budget_trends: "law",
  agency_spending_by_state: "law",
  federal: "law",
  agency_science_documents: "safety",
  sources: "sources",
  saved_pages: "sources",
  source_documents: "sources",
  docsupload_coverage: "sources",
  coverage_labels: "sources",
  coverage_topics: "sources",
  large_text_assets: "sources",
  focused: "sources",
};

export function sectionOf(datasetId: string): SectionId {
  if (EXPLICIT[datasetId]) return EXPLICIT[datasetId];
  if (datasetId.startsWith("agency_safety_")) return "safety";
  if (datasetId.startsWith("regulatory_")) return "law";
  if (datasetId.startsWith("doj_press_releases")) return "law";
  if (datasetId.startsWith("judge")) return "judges";
  if (datasetId.startsWith("mdl")) return "matters";
  if (datasetId.startsWith("court")) return "courts";
  if (datasetId.startsWith("uscourts_tables_")) return "courts";
  return "other";
}

/**
 * Retired catalog ids whose rows moved, with their record ids unchanged, into a successor collection.
 * Their /data and /records URLs redirect to the successor so every former URL keeps working.
 * sw_matter_regulatory_links_v1_staged: its 38 links were moved into sw_matter_regulatory_links_v1 on 2026-10-03
 * (contract sw-matter-regulatory-links-flip-staged-r6-20261003-v1.sql); the empty catalog row is retired by
 * database/contracts/release-dataset-regulatory-links-staged-empty-v1.sql.
 */
const RETIRED_DATASETS: Readonly<Record<string, string>> = {
  sw_matter_regulatory_links_v1_staged: "sw_matter_regulatory_links_v1",
};

/** The collection a retired dataset id now lives in, or null when the id is not retired. */
export function datasetSuccessor(id: string): string | null {
  return Object.prototype.hasOwnProperty.call(RETIRED_DATASETS, id) ? RETIRED_DATASETS[id]! : null;
}

/** Human label: use the stored label unless it is just the raw id. */
export function datasetLabel(id: string, label: string | null | undefined) {
  if (label && label !== id) return label;
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type Link = { url: string; label: string };
export type NormItem = {
  id: string;
  title: string;
  subtitle: string | null;
  cells: Record<string, string>;
  links: Link[];
  badges: string[];
  photo: string | null;
  sourceUrl: string | null;
};

function scalar(v: unknown): string | null {
  if (v == null || v === "") return null;
  // Entities are decoded and whitespace collapsed at display time; the stored value is never rewritten.
  if (typeof v === "string") return cleanText(v) || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number"))
    return v.length ? v.join("; ") : null;
  return null;
}

const SKIP = new Set([
  "id",
  "title",
  "name",
  "subtitle",
  "links",
  "badges",
  "cells",
  "photo_url",
  "source_url",
  "search_vector",
  "text",
  "snippet",
]);

/** Producer bookkeeping fields that are not meaningful to a reader when a dataset publishes no listing columns. */
const INTERNAL_KEYS = new Set([
  "dataset",
  "group",
  "firm_id",
  "firm_norm",
  "native_id",
  "sort_date",
]);

/** Normalise any corpus listing item (they vary by dataset) without inventing values. */
export function normalizeItem(
  raw: Record<string, unknown> & {
    id?: unknown;
    title?: unknown;
    name?: unknown;
    subtitle?: unknown;
    cells?: unknown;
    links?: unknown;
    badges?: unknown;
    photo_url?: unknown;
    source_url?: unknown;
  },
): NormItem {
  const id = String(raw.id ?? "");
  const title = scalar(raw.title) ?? scalar(raw.name) ?? id;
  const cells: Record<string, string> = {};
  if (raw.cells && typeof raw.cells === "object") {
    for (const [k, v] of Object.entries(raw.cells as Record<string, unknown>)) {
      const s = scalar(v);
      if (s != null) cells[k] = s;
    }
  } else {
    const dated = !!raw["dates"] && typeof raw["dates"] === "object";
    for (const [k, v] of Object.entries(raw)) {
      if (SKIP.has(k) || INTERNAL_KEYS.has(k) || (dated && k === "published_at")) continue;
      const s = scalar(v);
      if (s != null && s.length <= 200) cells[k] = s;
    }
    if (dated)
      for (const [k, v] of Object.entries(raw["dates"] as Record<string, unknown>)) {
        const s = scalar(v);
        if (s != null && s.length <= 200) cells[k] = s;
      }
  }
  const links = Array.isArray(raw.links)
    ? (raw.links as unknown[])
        .filter((l): l is Link => !!l && typeof (l as Link).url === "string")
        .map((l) => ({ url: l.url, label: l.label ?? l.url }))
    : [];
  const badges = Array.isArray(raw.badges)
    ? (raw.badges as unknown[]).filter((b): b is string => typeof b === "string")
    : [];
  return {
    id,
    title,
    subtitle: scalar(raw.subtitle),
    cells,
    links,
    badges,
    photo: typeof raw.photo_url === "string" && raw.photo_url ? raw.photo_url : null,
    sourceUrl: typeof raw.source_url === "string" && raw.source_url ? raw.source_url : null,
  };
}

/**
 * Ids of listing rows that look identical to another row on the same page (same title, subtitle, cells and badges).
 * They are distinct native records (for example one attorney's separate appearances) and are never merged; the
 * listing shows their record ids so they can be told apart.
 */
export function duplicateLookingIds(items: readonly NormItem[]): Set<string> {
  const byLook = new Map<string, string[]>();
  for (const i of items) {
    const look = JSON.stringify([i.title, i.subtitle, Object.entries(i.cells).sort(), i.badges]);
    byLook.set(look, [...(byLook.get(look) ?? []), i.id]);
  }
  const out = new Set<string>();
  for (const ids of byLook.values()) if (ids.length > 1) for (const id of ids) out.add(id);
  return out;
}

/** A short, recognisable form of a native record id for display ("004171ce…", "firm:3f24b0b7635a81a8"). */
export function shortRecordId(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return `${id.slice(0, 8)}…`;
  return id.length > 28 ? `${id.slice(0, 26)}…` : id;
}

export type ResolvedLink =
  | { kind: "external"; href: string }
  | { kind: "file"; href: string }
  | { kind: "dataset"; dataset: string; q: string; filters: Record<string, string> }
  | { kind: "search"; q: string }
  | { kind: "entity"; type: "mdl" | "court" | "judge"; id: string }
  | { kind: "record"; dataset: string; id: string }
  | {
      kind: "app";
      /** The matched route pattern from the route tree, e.g. "/companies/$cik". */
      to: string;
      params: Record<string, string>;
      search: Record<string, string> | null;
      hash: string | null;
    }
  | { kind: "unmapped"; raw: string };

/**
 * Page routes of this app, derived from the router's own route tree (`router.routesById[*].fullPath`, or the
 * `fullPaths` of src/routeTree.gen.ts), never from a hand-kept list. Server endpoints under /api are dropped: they
 * serve data, and stored corpus files also live under /api/... routes. Index routes ("/companies/") are normalised
 * to their path ("/companies").
 */
export function pageRoutePatterns(fullPaths: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of fullPaths) {
    if (typeof raw !== "string" || !raw.startsWith("/")) continue;
    const path = raw === "/" ? raw : raw.replace(/\/+$/, "");
    if (!path || path === "/api" || path.startsWith("/api/")) continue;
    out.add(path);
  }
  return [...out].sort();
}

/**
 * A named path param ("$cik"). Only named params are matched: the route tree has no splat ("$") or optional
 * ("{-$x}") segments, and groups.test.ts fails if one is added, so the matcher is extended before stored paths
 * under such a route could silently read as unmapped.
 */
const isParamPart = (part: string) => /^\$[A-Za-z_]\w*$/.test(part);

const rootsCache = new WeakMap<readonly string[], Set<string>>();

/** The first path segments that belong to app pages ("courts", "records", ...); a stored path there is never a file. */
function pageRouteRoots(routes: readonly string[]): Set<string> {
  const cached = rootsCache.get(routes);
  if (cached) return cached;
  const roots = new Set<string>();
  for (const r of routes) {
    const first = r.split("/")[1];
    if (first && !isParamPart(first)) roots.add(first);
  }
  rootsCache.set(routes, roots);
  return roots;
}

/** Exact match of decoded path segments against route patterns; static segments win over params, leftmost first. */
function matchPageRoute(
  segments: readonly string[],
  routes: readonly string[],
): { to: string; params: Record<string, string> } | null {
  let best: { to: string; params: Record<string, string>; score: string } | null = null;
  for (const pattern of routes) {
    const parts = pattern === "/" ? [] : pattern.slice(1).split("/");
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let score = "";
    let ok = true;
    for (let i = 0; i < parts.length && ok; i++) {
      const part = parts[i]!;
      if (isParamPart(part)) {
        params[part.slice(1)] = segments[i]!;
        score += "0";
      } else if (part === segments[i]) score += "1";
      else ok = false;
    }
    if (ok && (!best || score > best.score)) best = { to: pattern, params, score };
  }
  return best ? { to: best.to, params: best.params } : null;
}

/**
 * Classify a stored root-relative path ("/companies/0000001800", "/supplement-files/...") against the app's page
 * routes. An exact route match is an in-app link; a path under a page-route root that matches no route is
 * unmapped (it would not open anything); everything else is a stored file served by /api/files.
 *
 * Record paths are "/records/<dataset>/<native id>": everything after the dataset is the id, so a native id that
 * contains "/" (for example "openfda:device/enforcement:Z-1770-2026") still opens its record.
 */
export function resolveRootPath(url: string, routes: readonly string[]): ResolvedLink {
  const parts = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
  const pathname = parts?.[1] ?? "";
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return { kind: "unmapped", raw: url };
  const trimmed = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  let rawSegments = trimmed === "/" ? [] : trimmed.slice(1).split("/");
  const roots = pageRouteRoots(routes);
  if (!roots.has(rawSegments[0] ?? "")) {
    if (rawSegments.length === 0 && routes.includes("/")) return appLink("/", {}, parts);
    return { kind: "file", href: fileUrl(url) };
  }
  if (
    rawSegments[0] === "records" &&
    rawSegments.length > 3 &&
    routes.includes("/records/$dataset/$id")
  )
    rawSegments = [rawSegments[0], rawSegments[1]!, rawSegments.slice(2).join("/")];
  const segments: string[] = [];
  for (const [i, seg] of rawSegments.entries()) {
    // Only a record id may carry "/" (joined above); every segment is decoded exactly once.
    const decoded = decodeNativeId(seg, RECORD_ID_MAX_LENGTH, RECORD_TOKEN_MAX_ENCODED_LENGTH);
    if (decoded === null || (decoded.includes("/") && !(rawSegments[0] === "records" && i === 2)))
      return { kind: "unmapped", raw: url };
    segments.push(decoded);
  }
  const match = matchPageRoute(segments, routes);
  if (!match) return { kind: "unmapped", raw: url };
  if (match.to === "/records/$dataset/$id") {
    const dataset = match.params["dataset"] ?? "";
    if (!/^[a-z0-9_]{1,80}$/.test(dataset)) return { kind: "unmapped", raw: url };
    // Stored record ids are raw, so a "?", "#" or trailing "/" may belong to the id itself. Opening the id without
    // it would show a different record than the one stored, so such a path stays unmapped.
    if (parts?.[2] || parts?.[3] || trimmed !== pathname) return { kind: "unmapped", raw: url };
    return { kind: "record", dataset, id: match.params["id"] ?? "" };
  }
  return appLink(match.to, match.params, parts);
}

function appLink(
  to: string,
  params: Record<string, string>,
  parts: RegExpExecArray | null,
): ResolvedLink {
  const query = parts?.[2] ? Object.fromEntries(new URLSearchParams(parts[2].slice(1))) : null;
  const hash = parts?.[3] ? parts[3].slice(1) : null;
  return {
    kind: "app",
    to,
    params,
    search: query && Object.keys(query).length ? query : null,
    hash: hash || null,
  };
}

/**
 * Map a corpus link to where it lives in this app. `aliases` maps alias -> dataset id; `routes` are the app's page
 * routes (`pageRoutePatterns` of the router's route tree), which decide whether a stored "/..." path is an in-app
 * page or a stored file.
 */
export function resolveLink(
  url: string,
  aliases: Record<string, string>,
  routes: readonly string[],
): ResolvedLink {
  // The stored URL may contain raw spaces; only the href is encoded, the stored value stays as provenance.
  if (/^https?:\/\//i.test(url)) return { kind: "external", href: externalHref(url) };
  if (url.startsWith("/")) return resolveRootPath(url, routes);
  if (url.startsWith("#")) {
    // Full native record identities: encodeURIComponent(id), decoded exactly once.
    // Slashes may be part of an encoded publisher path, never extra token segments.
    if (url.startsWith("#record/")) {
      const record = /^#record\/([a-z0-9_]{1,80})\/([^/?#]+)$/.exec(url);
      const id = record
        ? decodeNativeId(record[2]!, RECORD_ID_MAX_LENGTH, RECORD_TOKEN_MAX_ENCODED_LENGTH)
        : null;
      return record && id
        ? { kind: "record", dataset: record[1]!, id }
        : { kind: "unmapped", raw: url };
    }
    const ent = /^#(mdl|court|judge)\/([^?#]{1,120})$/.exec(url);
    const entityId = ent ? decodeNativeId(ent[2]!, 120) : null;
    if (ent && entityId)
      return {
        kind: "entity",
        type: ent[1] as "mdl" | "court" | "judge",
        id: entityId,
      };
    const [name = "", qs = ""] = url.slice(1).split("?");
    const params = Object.fromEntries(new URLSearchParams(qs));
    const q = params["q"] ?? "";
    delete params["q"];
    if (name === "documents" || name === "search") return { kind: "search", q };
    const key = name.replace(/-/g, "_");
    const ds = aliases[name] ?? aliases[key];
    if (ds) return { kind: "dataset", dataset: ds, q, filters: params };
  }
  return { kind: "unmapped", raw: url };
}

/**
 * What an openFDA MAUDE name query stored on a company_adverse_manufacturers record is known to have found, when
 * that is recorded as nothing usable. Such a query is the search that was run, not a source:
 * - "no_matches": the link's own label records that this query returned no results (openFDA answers it with 404
 *   "No matches found!"), e.g. "openFDA query (no matches)". Per query, so it applies on matched records too.
 * - "no_exact_match": the record's fact "Matched MAUDE spellings" = "None": no query found a manufacturer name
 *   matching the company exactly (each found nothing or only other spellings; 43 of the 49 stored queries on
 *   such records answered 404, checked 2026-10-18).
 * null otherwise: the link stays an ordinary source link. Nothing is inferred from the query text.
 */
export function searchLinkOutcome(
  dataset: string,
  raw: Record<string, unknown>,
  link: { url: string; label: string },
): "no_matches" | "no_exact_match" | null {
  if (dataset !== "company_adverse_manufacturers" || !/^https:\/\/api\.fda\.gov\//i.test(link.url))
    return null;
  if (/\(no matches\)\s*$/i.test(link.label)) return "no_matches";
  const facts = raw["facts"];
  return Array.isArray(facts) &&
    facts.some((f) => Array.isArray(f) && f[0] === "Matched MAUDE spellings" && f[1] === "None")
    ? "no_exact_match"
    : null;
}

/** Invalid escapes and URL/traversal syntax remain inert; native punctuation is preserved. */
function decodeNativeId(encoded: string, max: number, encodedMax = max * 12): string | null {
  if (encoded.length > encodedMax) return null;
  try {
    const id = decodeURIComponent(encoded);
    if (
      !id ||
      id.length > max ||
      id !== id.trim() ||
      /[?#\\]/.test(id) ||
      Array.from(id).some(
        (c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
      )
    )
      return null;
    if (id.split("/").some((part) => part === "." || part === "..")) return null;
    return id;
  } catch {
    return null;
  }
}

export function fileUrl(route: string) {
  return `/api/files?route=${encodeURIComponent(route)}`;
}
