/**
 * Registered government domains (datasets gov_domains and gov_domains_summary, built by scripts/enrichment/gov_domains).
 * Pure, defensive parsing and matching shared by the server functions, the assistant tool and the views.
 *
 * Two official registries are kept side by side and never merged into one opinion:
 *   cisa  the .gov registry (CISA): every domain registered in the .gov zone, with the type, organization, city and state
 *         the registrant gave;
 *   gsa   the GSA list of government domains that do NOT end in .gov or .mil.
 *
 * Rules: a host matches only a listed entry that equals it or is one of its parent domains, label by label (never a
 * substring, a prefix or a similar name). An entry that lists only pages of a host (`example.com/Government`) matches only
 * those pages. Membership is evidence that a domain is registered or listed as a government domain; absence is not evidence
 * of anything. A state, city or type is shown only as the publisher gave it. Stored JSON is untrusted: malformed values are
 * dropped, never repaired.
 */
import { safeResourceHref } from "@/lib/corpus/resourcePresentation";

export const GOV_DOMAINS_DATASET = "gov_domains";
export const GOV_DOMAINS_SUMMARY_DATASET = "gov_domains_summary";

export type GovRegistry = "cisa" | "gsa";
export const REGISTRY_LABEL: Record<GovRegistry, string> = {
  cisa: "CISA .gov registry",
  gsa: "GSA government URLs list",
};

/** Display order of the government levels (derived from the published type string, never from a name). */
export const GOV_GROUPS = [
  "state",
  "county",
  "city",
  "special_district",
  "school_district",
  "tribal",
  "interstate",
  "regional",
  "federal",
  "quasi",
  "unclear",
] as const;
export type GovGroup = (typeof GOV_GROUPS)[number];
export const GOV_GROUP_LABEL: Record<GovGroup, string> = {
  state: "State government",
  county: "County",
  city: "City or local",
  special_district: "Special district",
  school_district: "School district",
  tribal: "Tribal (native sovereign nation)",
  interstate: "Interstate",
  regional: "Regional",
  federal: "Federal",
  quasi: "Quasigovernmental",
  unclear: "Level unclear",
};
/** Groups whose jurisdiction is the publisher-given state: the registry's state is then where the body governs. */
export const STATE_JURISDICTION_GROUPS: ReadonlySet<GovGroup> = new Set([
  "state",
  "county",
  "city",
  "special_district",
  "school_district",
]);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const text = (v: unknown, max = 400): string | null =>
  typeof v === "string" && v.trim() ? v.slice(0, max) : null;
const strings = (v: unknown, max = 40, len = 120): string[] =>
  Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .slice(0, max)
        .map((s) => s.slice(0, len))
    : [];
const isGroup = (v: unknown): v is GovGroup => GOV_GROUPS.includes(v as GovGroup);
const USPS = /^[A-Z]{2}$/;
const ENTRY = /^[a-z0-9._~-]+(?:\/\S{1,200})?$/;
const registries = (v: unknown): GovRegistry[] =>
  strings(v, 2).filter((r): r is GovRegistry => r === "cisa" || r === "gsa");
const states = (v: unknown): string[] => strings(v, 12, 2).filter((s) => USPS.test(s));

// ------------------------------------------------------------------------------------------------ list rows
/** The compact row the state and county pages list (stored as item.row). */
export type GovRow = {
  id: string;
  domain: string;
  path: string | null;
  group: GovGroup | null;
  /** [registry, type exactly as the registry publishes it] */
  types: { registry: GovRegistry; type: string }[];
  organization: string | null;
  city: string | null;
  states: string[];
  registries: GovRegistry[];
  securityContact: "published" | "not_published" | null;
  link: string | null;
  note: string | null;
  notUsed: boolean;
  conflict: boolean;
};

export function parseGovRow(id: unknown, raw: unknown): GovRow | null {
  const o = obj(raw);
  const rid = text(id, 300);
  const domain = text(o["domain"], 253);
  if (!rid || !domain || !ENTRY.test(rid) || !/^[a-z0-9._-]+$/.test(domain)) return null;
  const regs = registries(o["registries"]);
  if (!regs.length) return null;
  const types: GovRow["types"] = [];
  if (Array.isArray(o["types"]))
    for (const pair of o["types"].slice(0, 6)) {
      if (!Array.isArray(pair)) continue;
      const registry = pair[0];
      const type = text(pair[1], 80);
      if ((registry === "cisa" || registry === "gsa") && type) types.push({ registry, type });
    }
  const contact = o["securityContact"];
  const pathText = text(o["path"], 200);
  return {
    id: rid,
    domain,
    path: pathText,
    group: isGroup(o["group"]) ? o["group"] : null,
    types,
    organization: text(o["organization"], 300),
    city: text(o["city"], 120),
    states: states(o["states"]),
    registries: regs,
    securityContact: contact === "published" || contact === "not_published" ? contact : null,
    link: safeResourceHref(typeof o["link"] === "string" ? o["link"] : null),
    note: text(o["note"], 400),
    notUsed: o["notUsed"] === true,
    conflict: o["conflict"] === true,
  };
}

// ----------------------------------------------------------------------------------------------- full facts
export type GovFacts = {
  id: string;
  host: string;
  path: string | null;
  group: GovGroup | null;
  registries: GovRegistry[];
  lists: string[];
  states: string[];
  organization: string | null;
  city: string | null;
  cisa: {
    type: string | null;
    organization: string | null;
    suborganization: string | null;
    city: string | null;
    state: string | null;
    securityContact: "published" | "not_published" | null;
    inZone: boolean | null;
  } | null;
  gsa: {
    rows: {
      type: string | null;
      agency: string | null;
      maintainingOffice: string | null;
      useCase: string | null;
      federalBranch: string | null;
      stateAsPublished: string | null;
      note: string | null;
      link: string | null;
      dateAdded: string | null;
    }[];
    views: { list: string; level: string | null; location: string | null; status: string | null }[];
  } | null;
  notUsed: { status: string | null; level: string | null; note: string | null } | null;
  conflicts: { field: "state" | "group"; cisa: string | null; gsa: string[] }[];
};

/** Parse item.gov (the full stored record). */
export function parseGovFacts(id: unknown, raw: unknown): GovFacts | null {
  const o = obj(raw);
  const rid = text(id, 300);
  const host = text(o["host"], 253);
  if (!rid || !host || !ENTRY.test(rid) || o["schema"] !== "gov_domain.v1") return null;
  const regs = registries(o["registries"]);
  if (!regs.length) return null;
  const c = o["cisa"] ? obj(o["cisa"]) : null;
  const g = o["gsa"] ? obj(o["gsa"]) : null;
  const contact = (v: unknown) => (v === "published" || v === "not_published" ? v : null);
  const gsaRows = g && Array.isArray(g["rows"]) ? g["rows"].slice(0, 6).map(obj) : [];
  const views: NonNullable<GovFacts["gsa"]>["views"] = [];
  if (g) {
    for (const [list, rows] of Object.entries(obj(g["views"])).slice(0, 8)) {
      if (!Array.isArray(rows)) continue;
      for (const r of rows.slice(0, 3).map(obj))
        views.push({
          list: list.slice(0, 40),
          level: text(r["level_of_government"], 80),
          location: text(r["location_as_published"], 120),
          status: text(r["status"], 60),
        });
    }
  }
  const nu = o["notUsed"] ? obj(o["notUsed"]) : null;
  const conflicts: GovFacts["conflicts"] = [];
  if (Array.isArray(o["conflicts"]))
    for (const x of o["conflicts"].slice(0, 6).map(obj)) {
      const field = x["field"];
      if (field !== "state" && field !== "group") continue;
      conflicts.push({ field, cisa: text(x["cisa"], 40), gsa: strings(x["gsa"], 12, 40) });
    }
  return {
    id: rid,
    host,
    path: text(o["path"], 200),
    group: isGroup(o["group"]) ? o["group"] : null,
    registries: regs,
    lists: strings(o["lists"], 12, 40),
    states: states(o["states"]),
    organization: text(o["organization"], 300),
    city: text(o["city"], 120),
    cisa: c
      ? {
          type: text(c["type"], 80),
          organization: text(c["organization"], 300),
          suborganization: text(c["suborganization"], 300),
          city: text(c["city"], 120),
          state: USPS.test(String(c["state"])) ? String(c["state"]) : null,
          securityContact: contact(c["security_contact"]),
          inZone: typeof c["in_zone"] === "boolean" ? c["in_zone"] : null,
        }
      : null,
    gsa: g
      ? {
          rows: gsaRows.map((r) => ({
            type: text(r["type"], 80),
            agency: text(r["agency"], 300),
            maintainingOffice: text(r["maintaining_office"], 300),
            useCase: text(r["use_case"], 120),
            federalBranch: text(r["federal_branch"], 60),
            stateAsPublished: text(r["state_as_published"], 120),
            note: text(r["note"], 600),
            link: safeResourceHref(typeof r["link"] === "string" ? r["link"] : null),
            dateAdded: text(r["date_added"], 40),
          })),
          views,
        }
      : null,
    notUsed: nu
      ? {
          status: text(nu["status"], 80),
          level: text(nu["level_of_government"], 80),
          note: text(nu["note"], 400),
        }
      : null,
    conflicts,
  };
}

// ------------------------------------------------------------------------------------------- host matching
export type ParsedHost =
  | { ok: true; host: string; path: string | null; ip: boolean }
  | { ok: false; reason: "empty" | "not_http" | "invalid" };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOSTNAME = /^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/;

/**
 * A host or an http(s) address -> lower-cased punycode host plus the page path (lower-cased segments). Other schemes,
 * IPv6 literals, single-label names and anything that is not a plain host name are rejected, not repaired.
 */
export function parseHostInput(input: string): ParsedHost {
  const s = input.trim();
  if (!s) return { ok: false, reason: "empty" };
  if (s.length > 2048) return { ok: false, reason: "invalid" };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme && !/^https?$/i.test(scheme[1]!)) return { ok: false, reason: "not_http" };
  if (!scheme && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return { ok: false, reason: "not_http" };
  let url: URL;
  try {
    url = new URL(scheme ? s : `https://${s}`);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.length > 253) return { ok: false, reason: "invalid" };
  const ip = IPV4.test(host);
  if (!ip && !HOSTNAME.test(host)) return { ok: false, reason: "invalid" };
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg).toLowerCase();
      } catch {
        return seg.toLowerCase();
      }
    });
  return { ok: true, host, path: segments.length ? segments.join("/") : null, ip };
}

/**
 * Entries a host can be listed under, most specific first: the host itself, then each parent domain down to two labels
 * (`www.courts.ca.gov` -> `www.courts.ca.gov`, `courts.ca.gov`, `ca.gov`). An IP address has only itself.
 */
export function candidateEntries(host: string, ip = false): string[] {
  if (ip) return [host];
  const labels = host.split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out;
}

export type GovScope = "exact_host" | "parent_domain" | "path";
export type RegistryHit = { facts: GovFacts; scope: GovScope };

/** Whether the listed path is a leading run of whole segments of the page path. */
function pathCovers(listed: string, page: string | null): boolean {
  if (!page) return false;
  const a = listed.toLowerCase().split("/").filter(Boolean);
  const b = page.split("/").filter(Boolean);
  return a.length > 0 && a.length <= b.length && a.every((seg, i) => seg === b[i]);
}

/**
 * The most specific listing for a parsed host: a listed domain that is the host or a parent of it, else a listed page set
 * on exactly this host whose path covers the page. `pathScoped` names the page-only entries on the host that did not cover
 * the page (so a lookup of the bare host can say the host is listed only for those pages).
 */
export function matchRegistry(
  parsed: Extract<ParsedHost, { ok: true }>,
  byId: ReadonlyMap<string, GovFacts>,
  pathEntries: readonly GovFacts[],
): { hit: RegistryHit | null; pathScoped: GovFacts[] } {
  for (const id of candidateEntries(parsed.host, parsed.ip)) {
    const facts = byId.get(id);
    if (facts && !facts.path)
      return {
        hit: { facts, scope: id === parsed.host ? "exact_host" : "parent_domain" },
        pathScoped: [],
      };
  }
  const onHost = pathEntries.filter((e) => e.host === parsed.host && e.path);
  const covering = onHost
    .filter((e) => pathCovers(e.path!, parsed.path))
    .sort((a, b) => b.path!.length - a.path!.length);
  if (covering[0]) return { hit: { facts: covering[0], scope: "path" }, pathScoped: [] };
  return { hit: null, pathScoped: onHost };
}

export type GovSnapshot = {
  cisaZoneExport: string | null;
  cisaCommit: string | null;
  gsaCommit: string | null;
  gsaCommitDate: string | null;
};

export type GovTier = "cisa_registered" | "gsa_listed";
export type GovLookupResult = {
  input: string;
  host: string | null;
  path: string | null;
  status: "registered" | "path_listed_only" | "not_listed" | "invalid";
  scope: GovScope | null;
  invalidReason: string | null;
  tier: GovTier | null;
  matchedEntry: string | null;
  facts: GovFacts | null;
  /** Entries that list only pages of this host (set when the host itself is not listed). */
  pathScopedEntries: string[];
  tldNote: string | null;
  cautions: string[];
  snapshot: GovSnapshot | null;
};

const INVALID_TEXT: Record<string, string> = {
  empty: "Nothing to look up.",
  not_http: "Only a host name or an http(s) address can be looked up.",
  invalid: "That is not a plain host name.",
};

function tldNote(host: string, registered: boolean, snapshot: GovSnapshot | null): string | null {
  if (host.endsWith(".mil"))
    return ".mil domains are not published in either registry, so this lookup can neither confirm nor rule out a .mil host.";
  if (host.endsWith(".gov") && !registered)
    return `The host ends in .gov, but the CISA .gov registry list${snapshot?.cisaZoneExport ? ` (zone exported ${snapshot.cisaZoneExport.slice(0, 10)})` : ""} does not include its registered domain.`;
  return null;
}

/** Assemble the answer for one input (pure; the caller supplies the registry reads). */
export function buildLookupResult(
  input: string,
  parsed: ParsedHost,
  match: { hit: RegistryHit | null; pathScoped: GovFacts[] },
  snapshot: GovSnapshot | null,
): GovLookupResult {
  if (!parsed.ok)
    return {
      input,
      host: null,
      path: null,
      status: "invalid",
      scope: null,
      invalidReason: INVALID_TEXT[parsed.reason] ?? INVALID_TEXT["invalid"]!,
      tier: null,
      matchedEntry: null,
      facts: null,
      pathScopedEntries: [],
      tldNote: null,
      cautions: [],
      snapshot,
    };
  const base = { input, host: parsed.host, path: parsed.path, invalidReason: null, snapshot };
  const hit = match.hit;
  if (!hit) {
    const scoped = match.pathScoped;
    return {
      ...base,
      status: scoped.length ? "path_listed_only" : "not_listed",
      scope: null,
      tier: null,
      matchedEntry: null,
      facts: null,
      pathScopedEntries: scoped.map((e) => e.id),
      tldNote: tldNote(parsed.host, false, snapshot),
      cautions: scoped.length
        ? ["GSA lists only specific pages of this host, not the host itself."]
        : [],
    };
  }
  const facts = hit.facts;
  const cautions: string[] = [];
  if (facts.notUsed)
    cautions.push(
      `GSA's list of domains out of use also names this entry${facts.notUsed.status ? ` (${facts.notUsed.status})` : ""}.`,
    );
  if (facts.conflicts.length)
    cautions.push("The two registries disagree on this entry; both values are shown.");
  if (hit.scope === "path")
    cautions.push("Only the listed pages of this host are covered, not the whole host.");
  return {
    ...base,
    status: "registered",
    scope: hit.scope,
    tier: facts.registries.includes("cisa") ? "cisa_registered" : "gsa_listed",
    matchedEntry: facts.id,
    facts,
    pathScopedEntries: [],
    tldNote: tldNote(parsed.host, true, snapshot),
    cautions,
  };
}

/** The positive label a registered host earns, or null: a host that is not listed is never labelled as unofficial. */
export function evidenceLabel(
  r: Pick<GovLookupResult, "status" | "tier" | "facts" | "snapshot" | "scope">,
): { label: string; detail: string } | null {
  if (r.status !== "registered" || !r.tier || !r.facts) return null;
  const type = r.facts.cisa?.type ?? r.facts.gsa?.rows.find((x) => x.type)?.type ?? null;
  const org = r.facts.organization;
  const scope =
    r.scope === "path"
      ? " (listed pages only)"
      : r.scope === "parent_domain"
        ? ` (subdomain of ${r.facts.id})`
        : "";
  if (r.tier === "cisa_registered")
    return {
      label: "Registered .gov domain",
      detail: `CISA .gov registry${type ? `: ${type}` : ""}${org ? `, ${org}` : ""}${r.snapshot?.cisaZoneExport ? `; snapshot ${r.snapshot.cisaZoneExport.slice(0, 10)}` : ""}${scope}`,
    };
  return {
    label: "Listed government domain",
    detail: `GSA list of government domains outside .gov and .mil${type ? `: ${type}` : ""}${r.snapshot?.gsaCommitDate ? `; list of ${r.snapshot.gsaCommitDate}` : ""}${scope}`,
  };
}

/**
 * The state a registered host belongs to for deciding whether a resource fits a state page: only when the registry gives
 * exactly one state and the body governs within a state (state, county, city, district); federal, tribal, interstate,
 * regional and quasigovernmental entries have no state attribution, and a disagreement between the registries has none.
 */
export function jurisdictionState(
  r: Pick<GovLookupResult, "status" | "facts" | "scope">,
): string | null {
  const f = r.facts;
  if (r.status !== "registered" || !f || r.scope === "path") return null;
  if (!f.group || !STATE_JURISDICTION_GROUPS.has(f.group)) return null;
  if (f.conflicts.some((c) => c.field === "state")) return null;
  return f.states.length === 1 ? f.states[0]! : null;
}

/** host -> USPS for the lookups that register a host to exactly one state (see `jurisdictionState`). */
export function registryStateByHost(results: readonly GovLookupResult[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of results) {
    const state = jurisdictionState(r);
    if (state && r.host) out.set(r.host, state);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- list views
export type GovGroupBlock = { group: GovGroup | "unassigned"; label: string; rows: GovRow[] };

const rowName = (r: GovRow) => (r.organization ?? r.domain).toLowerCase();

/** Rows grouped by government level in a fixed order, each group sorted by organization then domain. */
export function groupGovRows(rows: readonly GovRow[]): GovGroupBlock[] {
  const out: GovGroupBlock[] = [];
  for (const group of [...GOV_GROUPS, "unassigned" as const]) {
    const inGroup = rows
      .filter((r) => (r.group ?? "unassigned") === group)
      .sort((a, b) => rowName(a).localeCompare(rowName(b)) || a.id.localeCompare(b.id));
    if (inGroup.length)
      out.push({
        group,
        label: group === "unassigned" ? "Level not recorded" : GOV_GROUP_LABEL[group],
        rows: inGroup,
      });
  }
  return out;
}

/** Words typed into the filter must all appear (case-insensitive, whole-string containment) in the row's own fields. */
export function filterGovRows(
  rows: readonly GovRow[],
  query: string,
  group: GovGroup | "unassigned" | "" = "",
): GovRow[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (group && (r.group ?? "unassigned") !== group) return false;
    if (!words.length) return true;
    const hay = [
      r.domain,
      r.path ?? "",
      r.organization ?? "",
      r.city ?? "",
      r.types.map((t) => t.type).join(" "),
      r.note ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function countByGroup(rows: readonly GovRow[]): Map<GovGroup | "unassigned", number> {
  const m = new Map<GovGroup | "unassigned", number>();
  for (const r of rows) m.set(r.group ?? "unassigned", (m.get(r.group ?? "unassigned") ?? 0) + 1);
  return m;
}

/** Published type strings with their counts, most frequent first. */
export function countByType(rows: readonly GovRow[]): { type: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows)
    for (const t of new Set(r.types.map((x) => x.type))) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** One line for a row: the types as published, each with the registry that used it when both registries list the entry. */
export function typeLine(r: GovRow): string {
  if (!r.types.length) return "Type not recorded";
  const both = new Set(r.types.map((t) => t.registry)).size > 1;
  return r.types
    .map((t) => (both ? `${t.type} (${t.registry === "cisa" ? "CISA" : "GSA"})` : t.type))
    .join("; ");
}

// ---------------------------------------------------------------------------------------- county matching
const COUNTY_SUFFIXES = [
  "City and Borough",
  "Census Area",
  "County",
  "Parish",
  "Borough",
  "Municipality",
  "Municipio",
  "city",
];

export type CensusArea = { full: string; base: string; suffix: string | null };

/** "Laramie County, Wyoming" or "Laramie County" -> {full: "Laramie County", base: "Laramie", suffix: "County"}. */
export function parseCensusArea(name: string): CensusArea | null {
  const full = name.replace(/,\s*[^,]+$/, "").trim();
  if (!full) return null;
  for (const suffix of COUNTY_SUFFIXES) {
    if (full.endsWith(` ${suffix}`)) {
      const base = full.slice(0, -suffix.length - 1).trim();
      if (base) return { full, base, suffix };
    }
  }
  return { full, base: full, suffix: null };
}

export type CountyMatchMethod = "organization_name" | "organization_name_form_of" | "gsa_note";
export type CountyMatch = { row: GovRow; method: CountyMatchMethod; detail: string };

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Registered domains that name this county exactly. No registry gives a county field, so the only evidence is the
 * publisher's own organization name (CISA) or note (GSA) equalling the Census name of the area, character for character
 * after case and spacing:
 *   - a county-level entry whose organization is "Laramie County" or "County of Laramie" (the area's own suffix: Parish,
 *     Borough, Municipality…), or
 *   - a GSA county-level entry whose note is "Laramie County, WY" or "County of Laramie, WY", or
 *   - for an independent city that is a county equivalent ("Alexandria city"), a city-level entry whose organization is
 *     "City of Alexandria".
 * Nothing is matched on a part of a name, a similar name or the domain text. `rows` must already be the state's rows.
 */
export function matchCountyRows(
  rows: readonly GovRow[],
  area: CensusArea,
  usps: string,
): CountyMatch[] {
  const out: CountyMatch[] = [];
  const full = norm(area.full);
  const suffix = area.suffix;
  const forms = new Set<string>();
  const wanted: GovGroup = suffix === "city" ? "city" : "county";
  if (suffix === "city") forms.add(norm(`City of ${area.base}`));
  else if (suffix) forms.add(norm(`${suffix} of ${area.base}`));
  for (const row of rows) {
    if (!row.states.includes(usps) || row.group !== wanted) continue;
    const org = row.organization ? norm(row.organization) : null;
    if (org && org === full) {
      out.push({
        row,
        method: "organization_name",
        detail: `organization name is exactly “${row.organization}”`,
      });
      continue;
    }
    if (org && forms.has(org)) {
      out.push({
        row,
        method: "organization_name_form_of",
        detail: `organization name is exactly “${row.organization}”`,
      });
      continue;
    }
    if (row.note && row.registries.includes("gsa") && !row.registries.includes("cisa")) {
      const note = norm(row.note);
      const abbr = usps.toLowerCase();
      if (note === `${full}, ${abbr}` || [...forms].some((f) => note === `${f}, ${abbr}`))
        out.push({ row, method: "gsa_note", detail: `GSA note is exactly “${row.note}”` });
    }
  }
  return out.sort((a, b) => a.row.domain.localeCompare(b.row.domain));
}

// -------------------------------------------------------------------------------------------- summaries
export type GovSummaryAll = {
  total: number;
  registries: { cisa: number; gsa: number; both: number };
  groups: Record<string, number>;
  cisaTypes: Record<string, number>;
  withState: number;
  withoutState: number;
  conflicts: number;
  snapshot: GovSnapshot;
};
export type GovSummaryState = {
  usps: string;
  total: number;
  cisa: number;
  gsa: number;
  groups: Record<string, number>;
  cisaTypes: Record<string, number>;
};

const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(v)).slice(0, 80))
    if (typeof n === "number" && Number.isFinite(n) && n >= 0 && k.length <= 80) out[k] = n;
  return out;
};
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export function parseSummaryAll(raw: unknown): GovSummaryAll | null {
  const o = obj(raw);
  if (o["schema"] !== "gov_domains_summary.v1" || o["scope"] !== "all") return null;
  const reg = obj(o["registries"]);
  const snap = obj(o["snapshot"]);
  const cisa = obj(snap["cisa"]);
  const gsa = obj(snap["gsa"]);
  return {
    total: int(o["total"]),
    registries: { cisa: int(reg["cisa"]), gsa: int(reg["gsa"]), both: int(reg["both"]) },
    groups: counts(o["groups"]),
    cisaTypes: counts(o["cisaTypes"]),
    withState: int(o["withState"]),
    withoutState: int(o["withoutState"]),
    conflicts: int(o["conflicts"]),
    snapshot: {
      cisaZoneExport: text(cisa["zoneExport"], 40),
      cisaCommit: text(cisa["commit"], 40),
      gsaCommit: text(gsa["commit"], 40),
      gsaCommitDate: text(gsa["commitDate"], 20),
    },
  };
}

export function parseSummaryState(raw: unknown): GovSummaryState | null {
  const o = obj(raw);
  const usps = String(o["usps"]);
  if (o["schema"] !== "gov_domains_summary.v1" || o["scope"] !== "state" || !USPS.test(usps))
    return null;
  return {
    usps,
    total: int(o["total"]),
    cisa: int(o["cisa"]),
    gsa: int(o["gsa"]),
    groups: counts(o["groups"]),
    cisaTypes: counts(o["cisaTypes"]),
  };
}
