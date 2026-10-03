/**
 * Pure: member cases of a matter, with the evidence for each membership and facet counts computed from the rows
 * actually in hand (never from corpus-wide totals).
 *
 * Integrity rules enforced here:
 * - parent_docket_id is not membership; each row carries the evidence that links it to the MDL.
 * - FJC IDB MDL numbers are labelled historical/administrative, never a current member census or master designation.
 * - Captions that name a party are withheld by the source; the docket number is shown instead.
 * - Unknown values stay null and render as "Not recorded".
 */

export type CaseEvidence =
  | "master_docket"
  | "crosswalk_master"
  | "crosswalk_member_edge"
  | "catalog_master_reference"
  | "fjc_idb"
  | "registry";

export const EVIDENCE_LABELS: Record<CaseEvidence, string> = {
  master_docket: "Master docket",
  crosswalk_master: "Crosswalk master",
  crosswalk_member_edge: "Crosswalk member edge",
  catalog_master_reference: "Catalog master reference",
  fjc_idb: "FJC IDB (historical)",
  registry: "Matter registry",
};

export const EVIDENCE_NOTES: Record<CaseEvidence, string> = {
  master_docket:
    "The MDL record's own master docket (court id and docket number match the JPML listing).",
  crosswalk_master: "A saved MDL-to-docket crosswalk names this matter as the MDL master docket.",
  crosswalk_member_edge:
    "A member_of_mdl edge in the saved MDL docket crosswalk resolves this case to the MDL.",
  catalog_master_reference:
    "The saved case catalog points this case at a master docket that the crosswalk resolves to this MDL. Not a transfer order.",
  fjc_idb:
    "The FJC Integrated Database records this MDL number on the docket. A dated administrative association, not a current member census, master designation or transfer ruling.",
  registry: "Explicit relationship from the matter registry.",
};

/** What the sources state about a docket's part in the MDL (closed vocabulary of the matter registry, plus the legacy three). */
export type CaseRole =
  | "master"
  | "member"
  | "jpml_panel"
  | "transferor"
  | "transferee"
  | "associated_unspecified"
  | "unknown";

export const CASE_ROLES: readonly CaseRole[] = [
  "master",
  "jpml_panel",
  "member",
  "transferor",
  "transferee",
  "associated_unspecified",
  "unknown",
];

export const ROLE_LABELS: Record<CaseRole, string> = {
  master: "Master docket",
  jpml_panel: "JPML panel proceeding",
  member: "Member",
  transferor: "Transferor (originating)",
  transferee: "Transferee (receiving)",
  associated_unspecified: "Associated (role not stated)",
  unknown: "Role not stated",
};

/** Routes into the MDL that a source can state; "unknown" is stored as null and shown as "Not recorded". */
export const ROUTE_LABELS: Record<string, string> = {
  transferred: "Transferred (JPML order)",
  pending_in_transferee_court: "Already pending in the transferee court",
  direct_filed: "Direct filed",
  multiple_sources: "Sources differ",
};

export function routeLabel(route: string): string {
  return ROUTE_LABELS[route] ?? route.replace(/_/g, " ");
}

/** Evidence kinds of the matter registry (contract §4). Dataset metadata labels, when loaded, win over these. */
export const BASIS_LABELS: Record<string, string> = {
  docketbird_relationship: "Provider-reported (DocketBird)",
  jpml_schedule_a: "JPML order, Schedule A",
  jpml_cto_schedule: "JPML conditional transfer order schedule",
  docket_transfer_entry: "Docket entry",
  native_crosswalk: "Firm dataset crosswalk",
  fjc_idb_mdl_number: "Historical administrative (FJC IDB)",
  master_party_case_reference: "Master docket party list (case number named)",
  identity_resolution: "Identity (exact court + number)",
  jpml_master_docket_list: "JPML master docket list",
  cl_docket_header: "CourtListener docket header",
  docketbird_search_exact: "Provider search (DocketBird, exact)",
  docketbird_is_mdl_master: "Provider-reported master (DocketBird)",
};

/** One line on what each registry evidence kind asserts (contract §4); shown as a tooltip, never as a claim of its own. */
export const BASIS_NOTES: Record<string, string> = {
  docketbird_relationship:
    "DocketBird's litigation graph reports this docket as consolidated into the MDL master. Provider-reported evidence, route not stated.",
  jpml_schedule_a:
    "Listed on a schedule of a JPML transfer order; the docket is the transferor (originating) case.",
  jpml_cto_schedule:
    "Listed on a schedule of a JPML conditional transfer order; the docket is the transferor case.",
  docket_transfer_entry:
    "A docket entry on the master, JPML or receiving docket names this case number.",
  native_crosswalk:
    "The firm's saved MDL-to-docket crosswalk links this docket to the master. A firm collection, not a census.",
  fjc_idb_mdl_number:
    "The FJC Integrated Database carries this MDL number on the docket. Historical and administrative.",
  master_party_case_reference:
    "A party record on the master docket names exactly this civil action number.",
  identity_resolution:
    "An exact court + docket-number lookup resolved the provider id. Identity only; it never creates membership.",
  jpml_master_docket_list: "The JPML pending-MDL report lists this docket as the MDL's master.",
  cl_docket_header:
    "A CourtListener docket header whose court and number equal the master docket identity.",
  docketbird_search_exact: "An exact DocketBird search in court “jpml” returned this MDL docket.",
  docketbird_is_mdl_master: "DocketBird marks this docket as the MDL master.",
};

/** Labels read from the published dataset's own metadata (value -> label), optional. */
export type RegistryLabels = { basis?: Record<string, string>; role?: Record<string, string> };

/** One registry assertion behind a docket's role in the MDL, as projected for the list (evidence rows load on demand). */
export type RegistryCaseDetail = {
  /** Registry row id, "sw-md:<mdl>:<docket_key>". */
  rowId: string;
  /** Provider-neutral docket key, e.g. "cand:4:2022-md-03047". */
  docketKey: string;
  /** Evidence kinds (the registry's `membership_basis`). */
  basisKinds: string[];
  evidenceCount: number | null;
  /** One row per action is flagged: a transferor and its transferee share an action id. */
  countsAsAction: boolean | null;
  actionId: string | null;
  /** The registry marks a docket asserted for two MDLs by different sources. */
  conflict: boolean;
  /** Exact provider case ids the registry holds for this docket (strings as the provider uses them). */
  nativeCaseIds: string[];
  /** Links as the registry projects them (CourtListener, DocketBird, JPML order). */
  links: { url: string; label: string }[];
};

export type CaseRow = {
  id: string;
  clDocketId: string | null;
  docketNumber: string | null;
  /** Shown only when the source projects a caption; null when withheld or absent. */
  caption: string | null;
  captionWithheld: boolean;
  courtId: string | null;
  dateFiled: string | null;
  dateTerminated: string | null;
  /** As recorded: active, terminated, supporting_master... */
  status: string | null;
  role: CaseRole;
  evidence: CaseEvidence;
  /** Source text for the evidence, when the source gives one. */
  evidenceDetail: string | null;
  /** Route into the MDL (direct filing, JPML transfer, tag-along). Not recorded by the legacy sources. */
  route: string | null;
  defendant: string | null;
  sourceUrl: string | null;
  source: "inventory" | "fjc" | "master" | "registry";
  /** Present only for rows the matter registry projects. */
  registry?: RegistryCaseDetail;
};

/** The evidence kinds of a row: the registry's kinds when it has them, otherwise the single legacy class. */
export function evidenceKindsOf(row: CaseRow): string[] {
  return row.registry && row.registry.basisKinds.length ? row.registry.basisKinds : [row.evidence];
}

export function evidenceKindLabel(kind: string, labels?: RegistryLabels): string {
  return (
    labels?.basis?.[kind] ??
    BASIS_LABELS[kind] ??
    EVIDENCE_LABELS[kind as CaseEvidence] ??
    kind.replace(/_/g, " ")
  );
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const NOT_RECORDED_TEXT = /^(not recorded|—|-|none|n\/a|unknown)$/i;
const cleaned = (v: unknown): string | null => {
  const s = str(v);
  return s && !NOT_RECORDED_TEXT.test(s) ? s : null;
};

function factMap(facts: unknown): Map<string, string> {
  const m = new Map<string, string>();
  if (!Array.isArray(facts)) return m;
  for (const f of facts)
    if (Array.isArray(f) && f.length >= 2 && typeof f[0] === "string")
      m.set(f[0], f[1] == null ? "" : String(f[1]));
  return m;
}

function clDocketUrl(id: string | null): string | null {
  return id && /^[1-9]\d*$/.test(id) ? `https://www.courtlistener.com/docket/${id}/` : null;
}

const BASIS_TO_EVIDENCE: Record<string, CaseEvidence> = {
  master_docket_of_mdl: "crosswalk_master",
  member_of_mdl: "crosswalk_member_edge",
  catalog_mdl_master_docket_id: "catalog_master_reference",
};

/** Convert a saved-docket-sample row (listing item + its detail facts) into a CaseRow. Unknown basis => dropped (null). */
export function parseInventoryCase(item: unknown, facts: unknown): CaseRow | null {
  if (!isObj(item)) return null;
  const cells = isObj(item["cells"]) ? item["cells"] : {};
  const f = factMap(facts);
  const basis = f.get("MDL membership basis") ?? "";
  const evidence = BASIS_TO_EVIDENCE[basis];
  if (!evidence) return null;
  const idText = str(item["id"]);
  const clId =
    str(f.get("CourtListener docket id")) ??
    (idText?.startsWith("cl_docket:") ? idText.slice(10) : null);
  const captionFact = f.get("Caption") ?? "";
  const withheld =
    /^withheld\b/i.test(captionFact) ||
    /caption withheld/i.test(JSON.stringify(item["badges"] ?? []));
  const docket = cleaned(cells["docket"]) ?? cleaned(f.get("Docket number (AWS release)"));
  const title = str(item["title"]);
  // A title equal to "<docket> (<court>)" is the projected placeholder, not a caption.
  const placeholder = !!title && /^\S+ \([a-z0-9]+\)$/i.test(title);
  const role: CaseRole = evidence === "crosswalk_master" ? "master" : "member";
  return {
    id: `inventory:${idText ?? clId ?? docket ?? "row"}`,
    clDocketId: clId,
    docketNumber: docket,
    caption: !withheld && title && !placeholder ? title : null,
    captionWithheld: withheld,
    courtId: cleaned(cells["court"]),
    dateFiled: cleaned(cells["filed"]),
    dateTerminated: cleaned(f.get("Date terminated (AWS release)")),
    status: cleaned(cells["status"]),
    role,
    evidence,
    evidenceDetail: cleaned(f.get("MDL membership evidence")),
    route: null,
    defendant: cleaned(f.get("Defendant as recorded")),
    sourceUrl: clDocketUrl(clId),
    source: "inventory",
  };
}

/** Convert a CourtListener docket-metadata listing item selected by an FJC MDL number into a CaseRow. */
export function parseFjcCase(item: unknown): CaseRow | null {
  if (!isObj(item)) return null;
  const cells = isObj(item["cells"]) ? item["cells"] : {};
  const nativeId = str(cells["native_id"]);
  const docket = cleaned(cells["docket_number"]);
  if (!nativeId && !docket) return null;
  return {
    id: `fjc:${nativeId ?? docket}`,
    clDocketId: nativeId,
    docketNumber: docket,
    caption: null,
    captionWithheld: true,
    courtId: cleaned(cells["court_id"]),
    dateFiled: cleaned(cells["date_filed"]),
    dateTerminated: cleaned(cells["date_terminated"]),
    status: cleaned(cells["date_terminated"]) ? "terminated" : null,
    role: "member",
    evidence: "fjc_idb",
    evidenceDetail: cleaned(cells["mdl_number_raw"])
      ? `FJC multidistrict_litigation_docket_number ${String(cells["mdl_number_raw"])}`
      : null,
    route: null,
    defendant: null,
    sourceUrl: clDocketUrl(nativeId),
    source: "fjc",
  };
}

export type MasterDocketInput = {
  clDocketId: string | null;
  docketNumber: string | null;
  courtId: string | null;
  dateFiled: string | null;
  dateTerminated: string | null;
  title: string | null;
};

export function masterCase(m: MasterDocketInput): CaseRow | null {
  if (!m.clDocketId && !m.docketNumber) return null;
  return {
    id: `master:${m.clDocketId ?? m.docketNumber}`,
    clDocketId: m.clDocketId,
    docketNumber: m.docketNumber,
    caption: m.title,
    captionWithheld: false,
    courtId: m.courtId,
    dateFiled: m.dateFiled,
    dateTerminated: m.dateTerminated,
    status: m.dateTerminated ? "terminated" : null,
    role: "master",
    evidence: "master_docket",
    evidenceDetail: null,
    route: null,
    defendant: null,
    sourceUrl: clDocketUrl(m.clDocketId),
    source: "master",
  };
}

const EVIDENCE_RANK: Record<CaseEvidence, number> = {
  master_docket: 0,
  registry: 1,
  crosswalk_master: 2,
  crosswalk_member_edge: 3,
  catalog_master_reference: 4,
  fjc_idb: 5,
};

/** Fill only the fields the stronger row leaves unknown; a recorded value is never overwritten. */
function fillGaps(winner: CaseRow, other: CaseRow): CaseRow {
  const out: CaseRow = { ...winner };
  out.docketNumber = winner.docketNumber ?? other.docketNumber;
  out.courtId = winner.courtId ?? other.courtId;
  out.dateFiled = winner.dateFiled ?? other.dateFiled;
  out.dateTerminated = winner.dateTerminated ?? other.dateTerminated;
  out.status = winner.status ?? other.status;
  out.route = winner.route ?? other.route;
  out.defendant = winner.defendant ?? other.defendant;
  out.sourceUrl = winner.sourceUrl ?? other.sourceUrl;
  out.evidenceDetail = winner.evidenceDetail ?? other.evidenceDetail;
  if (!winner.caption && other.caption) {
    out.caption = other.caption;
    out.captionWithheld = false;
  }
  if (!winner.registry && other.registry) out.registry = other.registry;
  return out;
}

/**
 * Merge rows from several sources by CourtListener docket id; the strongest evidence wins and the weaker rows only
 * fill fields the winner does not record. A matter-registry row keeps its own role, route and evidence kinds.
 */
export function mergeCases(rows: CaseRow[]): CaseRow[] {
  const byKey = new Map<string, CaseRow>();
  for (const row of rows) {
    const key = row.clDocketId ? `cl:${row.clDocketId}` : row.id;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const [winner, loser] =
      EVIDENCE_RANK[row.evidence] < EVIDENCE_RANK[existing.evidence]
        ? [row, existing]
        : [existing, row];
    const merged = fillGaps(winner, loser);
    // The registry's role/route are source statements; they replace the legacy derivation when present.
    const reg = merged.registry;
    if (reg) {
      const regRow = winner.registry ? winner : loser;
      merged.role = regRow.role;
      merged.route = regRow.route ?? merged.route;
    }
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

export type CaseFilter = {
  q?: string;
  court?: string;
  year?: string;
  status?: string;
  /** An evidence kind: a legacy class or a matter-registry kind. */
  evidence?: string;
  role?: CaseRole | "";
  route?: string;
  /** "action" keeps only rows the registry counts as an action (one per transferred action). */
  actions?: "" | "action";
};

export function caseYear(row: CaseRow): string | null {
  const m = /^(\d{4})-/.exec(row.dateFiled ?? "");
  return m ? m[1]! : null;
}

export function filterCases(rows: CaseRow[], f: CaseFilter): CaseRow[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.court && r.courtId !== f.court) return false;
    if (f.year && caseYear(r) !== f.year) return false;
    if (f.status && (r.status ?? "") !== f.status) return false;
    if (f.evidence && !evidenceKindsOf(r).includes(f.evidence)) return false;
    if (f.role && r.role !== f.role) return false;
    if (f.route && (r.route ?? "") !== f.route) return false;
    if (f.actions === "action" && r.registry?.countsAsAction !== true) return false;
    if (
      q &&
      !`${r.docketNumber ?? ""} ${r.caption ?? ""} ${r.defendant ?? ""} ${r.courtId ?? ""} ${r.clDocketId ?? ""} ${r.registry?.nativeCaseIds.join(" ") ?? ""}`
        .toLowerCase()
        .includes(q)
    )
      return false;
    return true;
  });
}

export type FacetOption = { value: string; label: string; count: number };
export type CaseFacets = {
  court: FacetOption[];
  year: FacetOption[];
  status: FacetOption[];
  /** Counts per evidence kind; a docket with several kinds counts once under each, so the counts can exceed the rows. */
  evidence: FacetOption[];
  role: FacetOption[];
  route: FacetOption[];
  /** True when at least one row records a route into the MDL. */
  routeRecorded: boolean;
  /** Rows the registry counts as one action each (a transferor/transferee pair counts once). */
  actionRows: number;
};

function tally(
  values: (string | null)[],
  label: (v: string) => string,
  sort: (a: FacetOption, b: FacetOption) => number,
): FacetOption[] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort(sort);
}

const byCountThenLabel = (a: FacetOption, b: FacetOption) =>
  b.count - a.count || a.label.localeCompare(b.label);

/**
 * Facet counts over exactly the rows passed in. To make each facet reflect the OTHER active filters (so counts never
 * describe a different result set than the table), pass the rows already narrowed by every filter except that facet.
 */
export function computeFacets(rows: CaseRow[], labels?: RegistryLabels): CaseFacets {
  const routes = tally(
    rows.map((r) => r.route),
    routeLabel,
    byCountThenLabel,
  );
  return {
    court: tally(
      rows.map((r) => r.courtId),
      (v) => v,
      byCountThenLabel,
    ),
    year: tally(
      rows.map(caseYear),
      (v) => v,
      (a, b) => b.value.localeCompare(a.value),
    ),
    status: tally(
      rows.map((r) => r.status),
      (v) => v.replace(/_/g, " "),
      byCountThenLabel,
    ),
    evidence: tally(
      rows.flatMap(evidenceKindsOf),
      (v) => evidenceKindLabel(v, labels),
      byCountThenLabel,
    ),
    role: tally(
      rows.map((r) => r.role),
      (v) => labels?.role?.[v] ?? ROLE_LABELS[v as CaseRole] ?? v,
      byCountThenLabel,
    ),
    route: routes,
    routeRecorded: routes.length > 0,
    actionRows: rows.filter((r) => r.registry?.countsAsAction === true).length,
  };
}

/** Facets where each facet ignores its own filter but honours all the others. */
export function scopedFacets(rows: CaseRow[], f: CaseFilter, labels?: RegistryLabels): CaseFacets {
  const without = (key: keyof CaseFilter): CaseRow[] =>
    filterCases(rows, {
      ...f,
      [key]: key === "evidence" || key === "role" || key === "actions" ? "" : undefined,
    });
  const base = computeFacets(rows, labels);
  return {
    ...base,
    court: computeFacets(without("court"), labels).court,
    year: computeFacets(without("year"), labels).year,
    status: computeFacets(without("status"), labels).status,
    evidence: computeFacets(without("evidence"), labels).evidence,
    role: computeFacets(without("role"), labels).role,
    route: computeFacets(without("route"), labels).route,
    actionRows: computeFacets(without("actions"), labels).actionRows,
  };
}

export type CaseSort = "filed-desc" | "filed-asc" | "docket";

export const CASE_SORTS: readonly CaseSort[] = ["filed-desc", "filed-asc", "docket"];

export function sortCases(rows: CaseRow[], sort: CaseSort): CaseRow[] {
  const out = [...rows];
  const docketCmp = (a: CaseRow, b: CaseRow) =>
    (a.docketNumber ?? "").localeCompare(b.docketNumber ?? "", "en", { numeric: true });
  if (sort === "docket") return out.sort(docketCmp);
  const dir = sort === "filed-desc" ? -1 : 1;
  return out.sort((a, b) => {
    if (a.dateFiled && b.dateFiled && a.dateFiled !== b.dateFiled)
      return a.dateFiled.localeCompare(b.dateFiled) * dir;
    if (a.dateFiled && !b.dateFiled) return -1;
    if (!a.dateFiled && b.dateFiled) return 1;
    return docketCmp(a, b);
  });
}

/** Rows per page of the member-case list. */
export const CASE_PAGE_SIZE = 50;

export type CasesPage = {
  /** The requested page of the filtered, sorted list. */
  rows: CaseRow[];
  /** Rows matching the filter (all pages). */
  total: number;
  /** Facets that each ignore their own filter and honour the others, so counts match the table. */
  facets: CaseFacets;
  offset: number;
  pageSize: number;
};

/**
 * One page of a matter's cases: filter, sort, count and facet the full list, return only the slice asked for. The
 * server runs this over its cached list so the browser never receives the whole list.
 */
export function pageCases(
  rows: CaseRow[],
  filter: CaseFilter,
  sort: CaseSort,
  offset: number,
  pageSize: number = CASE_PAGE_SIZE,
  labels?: RegistryLabels,
): CasesPage {
  const filtered = sortCases(filterCases(rows, filter), sort);
  const start = Math.min(Math.max(0, Math.floor(offset)), Math.max(0, filtered.length - 1));
  // A page always starts on a page boundary, so "Next" and "Previous" never leave a short page in the middle.
  const aligned = start - (start % pageSize);
  return {
    rows: filtered.slice(aligned, aligned + pageSize),
    total: filtered.length,
    facets: scopedFacets(rows, filter, labels),
    offset: aligned,
    pageSize,
  };
}
