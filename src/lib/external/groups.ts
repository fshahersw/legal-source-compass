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
  cl_courts: "courts",
  cl_courthouses: "courts",
  cl_court_appeals_to: "courts",
  cl_people: "judges",
  cl_positions: "judges",
  cl_educations: "judges",
  cl_schools: "judges",
  cl_master_entries: "matters",
  cl_docket_metadata: "matters",
  sw_matters_v1: "matters",
  sw_matter_dockets_v1: "matters",
  sw_matter_dockets_v1_superseded: "matters",
  sw_docket_entries_v1: "matters",
  sw_matter_parties_v1: "matters",
  sw_matter_regulatory_links_v1: "matters",
  sw_matter_regulatory_links_v1_staged: "matters",
  cl_citation_edges: "law",
  cl_reporter_citations: "law",
  statutory_limitations_review: "law",
  regulatory_backfill: "law",
  ecfr_hierarchy: "law",
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
  county_enrichment_20260928: "courts",
  counties: "courts",
  trellis_browser_counties: "courts",
  trellis_receipts: "courts",
  judges: "judges",
  judge_enrichment: "judges",
  judge_entities: "judges",
  judge_portraits: "judges",
  judge_vendor: "judges",
  people: "judges",
  mdls: "matters",
  mdl_appearances: "matters",
  mdl_crosswalk: "matters",
  mdl_counsel: "matters",
  mdl_case_inventory: "matters",
  mdl_docket_documents: "matters",
  mdl_docket_activity: "matters",
  settlements: "matters",
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
  limitation_periods: "law",
  citation_reference: "law",
  citation_index: "law",
  federal_regulations_sections: "law",
  federal_regulations_parts: "law",
  federal_regulations_documents: "law",
  federal_register_history: "law",
  federal: "law",
  agency_science_documents: "safety",
  sources: "sources",
  saved_pages: "sources",
  source_documents: "sources",
  docsupload_coverage: "sources",
  coverage_labels: "sources",
  coverage_topics: "sources",
  large_text_assets: "sources",
  gap_enrichment_20260927: "sources",
  focused: "sources",
  pending_publication: "sources",
};

export function sectionOf(datasetId: string): SectionId {
  if (EXPLICIT[datasetId]) return EXPLICIT[datasetId];
  if (datasetId.startsWith("agency_safety_")) return "safety";
  if (datasetId.startsWith("judge")) return "judges";
  if (datasetId.startsWith("mdl")) return "matters";
  if (datasetId.startsWith("court")) return "courts";
  return "other";
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
    for (const [k, v] of Object.entries(raw)) {
      if (SKIP.has(k)) continue;
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
  | { kind: "unmapped"; raw: string };

/** Map a corpus link to where it lives in this app. `aliases` maps alias -> dataset id. */
export function resolveLink(url: string, aliases: Record<string, string>): ResolvedLink {
  // The stored URL may contain raw spaces; only the href is encoded, the stored value stays as provenance.
  if (/^https?:\/\//i.test(url)) return { kind: "external", href: externalHref(url) };
  if (url.startsWith("/")) return { kind: "file", href: fileUrl(url) };
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
