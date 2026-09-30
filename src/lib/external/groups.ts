/** Pure helpers for the connected corpus: section grouping, item normalisation and link resolution. */

export type SectionId = "courts" | "judges" | "matters" | "law" | "safety" | "sources" | "other";

export const SECTIONS: { id: SectionId; label: string; blurb: string }[] = [
  { id: "courts", label: "Courts", blurb: "Court registry, seals, statistics, rules, forms and court documents." },
  { id: "judges", label: "Judges", blurb: "Judge directory, enrichment, disclosures, entities and biographies." },
  { id: "matters", label: "Matters", blurb: "MDLs, dockets, cases, counsel, settlements, verdicts and expert rulings." },
  { id: "law", label: "Law", blurb: "Statutes, regulations, Federal Register, public laws, limitation periods and citations." },
  { id: "safety", label: "Safety", blurb: "FDA, openFDA and CPSC recall, enforcement and injury data." },
  { id: "sources", label: "Sources", blurb: "Source directories, saved pages, URL directory and coverage labels." },
  { id: "other", label: "Other", blurb: "Datasets not yet assigned to a section." },
];

const EXPLICIT: Record<string, SectionId> = {
  court_spine: "courts", court_reference: "courts", court_statistics: "courts", court_documents: "courts",
  court_forms_expansion_20260912: "courts", uscourts_pages: "courts", county_litigation: "courts",
  county_enrichment_20260928: "courts", counties: "courts", trellis_browser_counties: "courts", trellis_receipts: "courts",
  judges: "judges", judge_enrichment: "judges", judge_disclosures: "judges", judge_entities: "judges",
  judge_portraits: "judges", judge_vendor: "judges", people: "judges",
  mdls: "matters", mdl_appearances: "matters", mdl_crosswalk: "matters", mdl_counsel: "matters",
  mdl_case_inventory: "matters", mdl_docket_documents: "matters", mdl_docket_activity: "matters",
  settlements: "matters", verdict_reports: "matters", expert_rulings: "matters", state_proceedings: "matters",
  counsel_directory: "matters", seeger: "matters",
  open_us_law: "law", state_codes: "law", indiana_code: "law", sd_statutes: "law", provider_laws: "law",
  public_laws: "law", limitation_periods: "law", citation_reference: "law", citation_index: "law",
  federal_regulations_sections: "law", federal_regulations_parts: "law", federal_regulations_documents: "law",
  federal_register_history: "law", federal: "law",
  cpsc_injury_data: "safety", agency_science_documents: "safety",
  sources: "sources", url_directory: "sources", saved_pages: "sources", source_documents: "sources",
  docsupload_coverage: "sources", coverage_labels: "sources", coverage_topics: "sources", library_assets: "sources",
  large_text_assets: "sources", gap_enrichment_20260927: "sources", focused: "sources", pending_publication: "sources",
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
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) return v.length ? v.join("; ") : null;
  return null;
}

const SKIP = new Set(["id", "title", "name", "subtitle", "links", "badges", "cells", "photo_url", "source_url", "search_vector", "text", "snippet"]);

/** Normalise any corpus listing item (they vary by dataset) without inventing values. */
export function normalizeItem(raw: Record<string, unknown>): NormItem {
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
    ? (raw.links as unknown[]).filter((l): l is Link => !!l && typeof (l as Link).url === "string").map((l) => ({ url: l.url, label: l.label ?? l.url }))
    : [];
  const badges = Array.isArray(raw.badges) ? (raw.badges as unknown[]).filter((b): b is string => typeof b === "string") : [];
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

export type ResolvedLink =
  | { kind: "external"; href: string }
  | { kind: "file"; href: string }
  | { kind: "dataset"; dataset: string; q: string; filters: Record<string, string> }
  | { kind: "search"; q: string }
  | { kind: "unmapped"; raw: string };

/** Map a corpus link to where it lives in this app. `aliases` maps alias -> dataset id. */
export function resolveLink(url: string, aliases: Record<string, string>): ResolvedLink {
  if (/^https?:\/\//i.test(url)) return { kind: "external", href: url };
  if (url.startsWith("/")) return { kind: "file", href: fileUrl(url) };
  if (url.startsWith("#")) {
    const [name, qs = ""] = url.slice(1).split("?");
    const params = Object.fromEntries(new URLSearchParams(qs));
    const q = params.q ?? "";
    delete params.q;
    if (name === "documents" || name === "search") return { kind: "search", q };
    const key = name.replace(/-/g, "_");
    const ds = aliases[name] ?? aliases[key];
    if (ds) return { kind: "dataset", dataset: ds, q, filters: params };
  }
  return { kind: "unmapped", raw: url };
}

export function fileUrl(route: string) {
  return `/api/files?route=${encodeURIComponent(route)}`;
}
