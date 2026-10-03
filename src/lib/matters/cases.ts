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

export type CaseRole = "master" | "member" | "unknown";

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
  source: "inventory" | "fjc" | "master";
};

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

/** Merge rows from several sources by CourtListener docket id; the strongest evidence role wins, nothing is dropped. */
export function mergeCases(rows: CaseRow[]): CaseRow[] {
  const byKey = new Map<string, CaseRow>();
  const rank: Record<CaseEvidence, number> = {
    master_docket: 0,
    registry: 1,
    crosswalk_master: 2,
    crosswalk_member_edge: 3,
    catalog_master_reference: 4,
    fjc_idb: 5,
  };
  for (const row of rows) {
    const key = row.clDocketId ? `cl:${row.clDocketId}` : row.id;
    const existing = byKey.get(key);
    if (!existing || rank[row.evidence] < rank[existing.evidence])
      byKey.set(key, existing ? { ...row, dateFiled: row.dateFiled ?? existing.dateFiled } : row);
  }
  return [...byKey.values()];
}

export type CaseFilter = {
  q?: string;
  court?: string;
  year?: string;
  status?: string;
  evidence?: CaseEvidence | "";
  role?: CaseRole | "";
  route?: string;
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
    if (f.evidence && r.evidence !== f.evidence) return false;
    if (f.role && r.role !== f.role) return false;
    if (f.route && (r.route ?? "") !== f.route) return false;
    if (
      q &&
      !`${r.docketNumber ?? ""} ${r.caption ?? ""} ${r.defendant ?? ""} ${r.courtId ?? ""} ${r.clDocketId ?? ""}`
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
  evidence: FacetOption[];
  role: FacetOption[];
  route: FacetOption[];
  /** True when at least one row records a route into the MDL. */
  routeRecorded: boolean;
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
export function computeFacets(rows: CaseRow[]): CaseFacets {
  const routes = tally(
    rows.map((r) => r.route),
    (v) => v,
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
      rows.map((r) => r.evidence),
      (v) => EVIDENCE_LABELS[v as CaseEvidence] ?? v,
      byCountThenLabel,
    ),
    role: tally(
      rows.map((r) => r.role),
      (v) => (v === "master" ? "Master docket" : v === "member" ? "Member" : "Unknown"),
      byCountThenLabel,
    ),
    route: routes,
    routeRecorded: routes.length > 0,
  };
}

/** Facets where each facet ignores its own filter but honours all the others. */
export function scopedFacets(rows: CaseRow[], f: CaseFilter): CaseFacets {
  const without = (key: keyof CaseFilter): CaseRow[] =>
    filterCases(rows, { ...f, [key]: key === "evidence" || key === "role" ? "" : undefined });
  const base = computeFacets(rows);
  return {
    ...base,
    court: computeFacets(without("court")).court,
    year: computeFacets(without("year")).year,
    status: computeFacets(without("status")).status,
    evidence: computeFacets(without("evidence")).evidence,
    role: computeFacets(without("role")).role,
    route: computeFacets(without("route")).route,
  };
}

export type CaseSort = "filed-desc" | "filed-asc" | "docket";

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
