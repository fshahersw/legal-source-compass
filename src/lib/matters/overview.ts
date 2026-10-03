/**
 * Pure: turn the corpus's MDL detail JSON (`corpus_detail` for the `mdls` dataset) into the matter header model.
 * Nothing is inferred: absent or malformed values stay null and render as "Not recorded".
 */
import { matterCaseKeys, type MatterCaseKeys } from "./docketKeys";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const idStr = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : str(v);

export type JpmlReport = {
  documentId: string;
  kind: string | null;
  title: string;
  reportDate: string | null;
  periodLabel: string | null;
  /** The publisher's own URL (jpml.uscourts.gov); the stored copy is a separate, possibly held, artifact. */
  officialUrl: string | null;
  /** App route of the stored copy, when the corpus lists one. Availability is checked separately. */
  storedRoute: string | null;
  pages: number | null;
  bytes: number | null;
  capturedAt: string | null;
};

export type JudgeInfo = {
  /** Name exactly as the JPML report printed it ("M. Casey Rodgers"). */
  printedName: string | null;
  printedTitle: string | null;
  /** The profile's own name when a judge link exists. */
  profileName: string | null;
  /** judge_entities id of the single linked profile, or null. */
  entityId: string | null;
  /**
   * Id of the `judges` profile the data-quality passes linked to this MDL (`summary.judge_profile_id`, or the single
   * "#judge/<id>" link of the record); shown as a link once the profile is confirmed to exist.
   */
  profileId: string | null;
  /** How that profile was tied to the MDL ("cl_person_native_bridge", "jpml_name_court"); shown with the link. */
  profileLinkBasis: string | null;
  /** How the CourtListener person id was established ("judge_profile_native_bridge", "cl_docket_assigned_to"...). */
  clPersonBasis: string | null;
  fjcJid: string | null;
  fjcNid: string | null;
  clPersonId: string | null;
  linkBasis: string | null;
  /** True only when a native identifier ties the profile to this MDL (never a name match alone). */
  nativeIdEvidence: boolean;
  evidenceNote: string | null;
};

export type CountSnapshot = {
  asOf: string;
  total: number | null;
  pending: number | null;
  label: string | null;
};

export type CasesSummary = {
  total: number | null;
  byCourt: Record<string, number>;
  byStatus: Record<string, number>;
  byFiledYear: Record<string, number>;
  byMembershipKind: Record<string, number>;
  jpmlTotal: number | null;
  jpmlPending: number | null;
  qualification: string | null;
};

export type DocketDocumentsSummary = {
  total: number | null;
  byDocType: Record<string, number>;
  sourceSnapshotTotal: number | null;
  excludedUncategorized: number | null;
  qualification: string | null;
};

export type ActivitySummary = {
  total: number | null;
  capped: boolean | null;
  dateFirst: string | null;
  dateLast: string | null;
  byEntryType: Record<string, number>;
  qualification: string | null;
};

export type CounselFirm = { id: string; name: string; appearances: number | null };
export type CounselSummary = {
  firms: CounselFirm[];
  totalFirms: number | null;
  totalAttorneys: number | null;
  bySide: Record<string, number>;
  leadershipOrders: { url: string; date: string | null; title: string | null }[];
  qualification: string | null;
};

export type TrackedFirmAppearances = { firmId: string; name: string; appearances: number | null };
export type AppearancesSummary = {
  firms: TrackedFirmAppearances[];
  totalParties: number | null;
  partyCountsByCategory: Record<string, number>;
  leadAttorneyAppearances: number | null;
  qualification: string | null;
};

export type MatterOverview = {
  /** MDL number without leading zeros, e.g. "3140". */
  mdl: string;
  recordId: string;
  title: string;
  titleBasis: string | null;
  status: string | null;
  litigationType: string | null;
  /** JPML report date the counts and status are "as of". */
  asOf: string | null;
  countsLabel: string | null;
  court: {
    clId: string | null;
    shortName: string | null;
    fullName: string | null;
    fjcName: string | null;
    districtCode: string | null;
    circuit: string | null;
  };
  masterDocket: { number: string | null; clDocketId: string | null };
  dates: { filed: string | null; transferred: string | null; closed: string | null };
  actions: { total: number | null; pending: number | null; snapshots: CountSnapshot[] };
  judge: JudgeInfo;
  reports: JpmlReport[];
  cases: CasesSummary | null;
  docketDocuments: DocketDocumentsSummary | null;
  activity: ActivitySummary | null;
  counsel: CounselSummary | null;
  appearances: AppearancesSummary | null;
  expertRulingsTotal: number | null;
  keys: MatterCaseKeys;
};

function countMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, n] of Object.entries(v))
    if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  return out;
}

export function parseReports(value: unknown): JpmlReport[] {
  if (!Array.isArray(value)) return [];
  const out: JpmlReport[] = [];
  for (const raw of value) {
    if (!isObj(raw)) continue;
    const documentId = str(raw["document_id"]) ?? str(raw["id"]);
    const officialUrl = str(raw["final_url"]) ?? str(raw["seed_url"]);
    if (!documentId) continue;
    out.push({
      documentId,
      kind: str(raw["report_kind"]),
      title: str(raw["title"]) ?? "JPML statistics report",
      reportDate: str(raw["report_date"]),
      periodLabel: str(raw["period_label"]),
      officialUrl: officialUrl && /^https:\/\//i.test(officialUrl) ? officialUrl : null,
      storedRoute: str(raw["url"])?.startsWith("/") ? str(raw["url"]) : null,
      pages: num(raw["pages"]),
      bytes: num(raw["bytes"]),
      capturedAt: str(raw["captured_at"]),
    });
  }
  return out;
}

const PROFILE_ID = /^[A-Za-z0-9_-]{6,80}$/;

/** The `judges` profile id: the summary field, else the one "#judge/<id>" link on the record; null when ambiguous. */
function profileIdOf(
  summary: Record<string, unknown>,
  links: Record<string, unknown>[],
): string | null {
  const direct = idStr(summary["judge_profile_id"]);
  if (direct && PROFILE_ID.test(direct)) return direct;
  if (links.length !== 1) return null;
  const raw = links[0]!["links"];
  const ids = (Array.isArray(raw) ? raw : [])
    .filter(isObj)
    .map((l) => /^#judge\/([A-Za-z0-9_-]{6,80})$/.exec(str(l["url"]) ?? "")?.[1])
    .filter((id): id is string => !!id);
  return ids.length === 1 ? ids[0]! : null;
}

/**
 * The judge profile is linked only when exactly one profile is linked AND a native identifier supports it:
 * an explicit CourtListener-person bridge, or a CourtListener docket assigned_to person that agrees with the
 * FJC link. A printed name matching a directory name is never enough.
 */
export function parseJudge(detail: Record<string, unknown>): JudgeInfo {
  const printed = isObj(detail["transferee_judge"]) ? detail["transferee_judge"] : {};
  const summary = isObj(detail["summary"]) ? detail["summary"] : {};
  const clLinks = isObj(detail["cl_links"]) ? detail["cl_links"] : {};
  const links = Array.isArray(detail["judge_links"]) ? detail["judge_links"].filter(isObj) : [];
  const info: JudgeInfo = {
    printedName: str(printed["name_as_printed"]) ?? str(summary["judge_name_as_printed"]),
    printedTitle: str(printed["title_as_printed"]) ?? str(summary["judge_title_as_printed"]),
    profileName: null,
    entityId: null,
    profileId: profileIdOf(summary, links),
    profileLinkBasis: str(summary["judge_link_basis"]),
    clPersonBasis: str(summary["judge_cl_person_basis"]),
    fjcJid: null,
    fjcNid: null,
    clPersonId: null,
    linkBasis: null,
    nativeIdEvidence: false,
    evidenceNote: null,
  };
  // The person id the data-quality passes recorded on the MDL record (FJC bridge or the docket's assigned_to).
  info.clPersonId = idStr(summary["judge_cl_person_id"]);
  if (links.length !== 1) return info;
  const link = links[0]!;
  const entityId = str(link["entity_id"]);
  info.profileName = str(link["display_name"]) ?? str(link["fjc_name"]);
  info.fjcJid = idStr(link["fjc_jid"]);
  info.fjcNid = idStr(link["fjc_nid"]);
  info.clPersonId =
    info.clPersonId ?? idStr(link["cl_person_id"]) ?? idStr(summary["cl_assigned_to_id"]);
  info.linkBasis = str(link["basis"]);
  if (!entityId) return info;
  info.entityId = entityId;
  if (str(link["basis"]) === "cl_person_native_bridge") {
    info.nativeIdEvidence = true;
    info.evidenceNote =
      str(link["alias_basis"]) ?? "CourtListener person id bridged to the FJC judge id";
  } else if (
    summary["cl_assigned_to_id"] != null &&
    str(clLinks["agreement_with_name_join"]) === "agree"
  ) {
    info.nativeIdEvidence = true;
    info.evidenceNote = `CourtListener docket assigned_to person ${idStr(summary["cl_assigned_to_id"])} agrees with the FJC judge link`;
  }
  return info;
}

/** What the basis of a judge link means, in words (the data-quality passes record these strings on the MDL record). */
const JUDGE_LINK_BASIS_LABELS: Record<string, string> = {
  cl_person_native_bridge: "native-id bridge between the CourtListener person and the FJC judge",
  jpml_name_court: "the JPML-printed name and the transferee court match the profile exactly",
};
const JUDGE_PERSON_BASIS_LABELS: Record<string, string> = {
  judge_profile_native_bridge: "FJC judge id bridged to the CourtListener person id",
  cl_docket_assigned_to: "assigned_to on the CourtListener docket",
  "judge_profile_native_bridge+cl_docket_assigned_to":
    "FJC bridge, confirmed by the docket's assigned_to",
  same_judge_entity_cl_docket_assigned_to:
    "assigned_to on the CourtListener docket, same judge entity",
};

export function judgeLinkBasisLabel(basis: string | null): string | null {
  return basis ? (JUDGE_LINK_BASIS_LABELS[basis] ?? basis.replace(/_/g, " ")) : null;
}

export function judgePersonBasisLabel(basis: string | null): string | null {
  return basis ? (JUDGE_PERSON_BASIS_LABELS[basis] ?? basis.replace(/[_+]/g, " ")) : null;
}

function parseCases(v: unknown): CasesSummary | null {
  if (!isObj(v)) return null;
  return {
    total: num(v["total"]),
    byCourt: countMap(v["by_court"]),
    byStatus: countMap(v["by_status"]),
    byFiledYear: countMap(v["by_filed_year"]),
    byMembershipKind: countMap(v["by_membership_kind"]),
    jpmlTotal: num(v["jpml_total_actions"]),
    jpmlPending: num(v["jpml_actions_pending"]),
    qualification: str(v["qualification"]),
  };
}

function parseDocketDocuments(v: unknown): DocketDocumentsSummary | null {
  if (!isObj(v)) return null;
  return {
    total: num(v["total"]),
    byDocType: countMap(v["by_doc_type"]),
    sourceSnapshotTotal: num(v["source_snapshot_total"]),
    excludedUncategorized: num(v["excluded_uncategorized"]),
    qualification: str(v["qualification"]),
  };
}

function parseActivity(v: unknown): ActivitySummary | null {
  if (!isObj(v)) return null;
  return {
    total: num(v["total"]),
    capped: typeof v["capped"] === "boolean" ? v["capped"] : null,
    dateFirst: str(v["date_first"]),
    dateLast: str(v["date_last"]),
    byEntryType: countMap(v["by_entry_type"]),
    qualification: str(v["qualification"]),
  };
}

function parseCounsel(v: unknown): CounselSummary | null {
  if (!isObj(v)) return null;
  const firms = (Array.isArray(v["firms"]) ? v["firms"] : [])
    .filter(isObj)
    .flatMap((f): CounselFirm[] => {
      const id = str(f["id"]);
      const name = str(f["title"]);
      return id && name ? [{ id, name, appearances: num(f["appearance_count"]) }] : [];
    });
  const orders = (Array.isArray(v["leadership_orders"]) ? v["leadership_orders"] : [])
    .filter(isObj)
    .flatMap((o) => {
      const url = str(o["url"]);
      return url && /^https:\/\//i.test(url)
        ? [{ url, date: str(o["date"]), title: str(o["title"]) }]
        : [];
    });
  return {
    firms,
    totalFirms: num(v["total_firms"]),
    totalAttorneys: num(v["total_attorneys"]),
    bySide: countMap(v["by_side"]),
    leadershipOrders: orders,
    qualification: str(v["qualification"]),
  };
}

function parseAppearances(v: unknown): AppearancesSummary | null {
  if (!isObj(v)) return null;
  const firms = (Array.isArray(v["firms"]) ? v["firms"] : [])
    .filter(isObj)
    .flatMap((f): TrackedFirmAppearances[] => {
      const firmId = str(f["firm_id"]);
      const name = str(f["canonical_name"]);
      return firmId && name ? [{ firmId, name, appearances: num(f["appearance_count"]) }] : [];
    });
  return {
    firms,
    totalParties: num(v["total_parties"]),
    partyCountsByCategory: countMap(v["party_counts_by_category"]),
    leadAttorneyAppearances: num(v["lead_attorney_appearance_count"]),
    qualification: str(v["qualification"]),
  };
}

/** Normalize an MDL id ("mdl:03047", "3047") to digits without leading zeros, or null. */
export function normalizeMdlNumber(value: unknown): string | null {
  const s = (typeof value === "number" ? String(value) : (str(value) ?? ""))
    .replace(/^mdl[:-]?/i, "")
    .trim();
  return /^\d{1,6}$/.test(s) && Number(s) > 0 ? String(Number(s)) : null;
}

export function parseMdlDetail(raw: unknown): MatterOverview | null {
  if (!isObj(raw)) return null;
  const summary = isObj(raw["summary"]) ? raw["summary"] : {};
  const court = isObj(raw["court"]) ? raw["court"] : {};
  const mdl = normalizeMdlNumber(raw["mdl_number"] ?? summary["mdl_number"] ?? raw["id"]);
  if (!mdl) return null;
  const title = str(raw["title"]) ?? str(summary["title"]) ?? `MDL ${mdl}`;
  const clCourt =
    str(raw["cl_court_id"]) ?? str(court["cl_court_id"]) ?? str(summary["cl_court_id"]);
  const masterDocket = str(raw["master_docket"]) ?? str(summary["master_docket"]);
  const snapshots = (Array.isArray(raw["snapshots"]) ? raw["snapshots"] : [])
    .filter(isObj)
    .flatMap((s): CountSnapshot[] => {
      const asOf = str(s["as_of"]);
      return asOf
        ? [
            {
              asOf,
              total: num(s["total_actions"]),
              pending: num(s["actions_pending"]),
              label: str(s["counts_label"]),
            },
          ]
        : [];
    });
  snapshots.sort((a, b) => b.asOf.localeCompare(a.asOf));
  const expert = isObj(raw["expert_rulings"]) ? num(raw["expert_rulings"]["total"]) : null;
  return {
    mdl,
    recordId: str(summary["id"]) ?? `mdl:${mdl}`,
    title,
    titleBasis: str(raw["title_basis"]),
    status: str(raw["status"]) ?? str(summary["status"]),
    litigationType: str(raw["litigation_type"]) ?? str(summary["litigation_type"]),
    asOf: str(summary["as_of"]) ?? snapshots[0]?.asOf ?? null,
    countsLabel: str(raw["counts_label"]) ?? str(summary["counts_label"]),
    court: {
      clId: clCourt,
      shortName: str(raw["court_name"]) ?? str(court["cl_short_name"]),
      fullName: str(court["cl_full_name"]),
      fjcName: str(raw["fjc_court_name"]) ?? str(court["fjc_court_name"]),
      districtCode: str(raw["district_code"]) ?? str(court["jpml_code"]),
      circuit: str(raw["circuit"]) ?? str(court["circuit"]),
    },
    masterDocket: {
      number: masterDocket,
      clDocketId:
        idStr(summary["cl_docket_id"]) ??
        idStr(isObj(raw["cl_links"]) ? raw["cl_links"]["docket_id"] : null),
    },
    dates: {
      filed: str(raw["date_filed"]),
      transferred: str(raw["date_transferred"]),
      closed: str(raw["date_closed"]),
    },
    actions: {
      total: num(raw["total_actions"]) ?? num(summary["total_actions"]),
      pending: num(raw["actions_pending"]) ?? num(summary["actions_pending"]),
      snapshots,
    },
    judge: parseJudge(raw),
    // Every entry of the MDL record's `documents` array is a JPML statistics report PDF (verified across all 176 MDLs).
    reports: parseReports(raw["documents"]),
    cases: parseCases(raw["cases"]),
    docketDocuments: parseDocketDocuments(raw["docket_documents"]),
    activity: parseActivity(raw["docket_activity"]),
    counsel: parseCounsel(raw["counsel_directory"]),
    appearances: parseAppearances(raw["appearances"]),
    expertRulingsTotal: expert,
    keys: matterCaseKeys(clCourt, masterDocket),
  };
}

/** Display helper: unknown values are "Not recorded", never a guessed placeholder. */
export const NOT_RECORDED = "Not recorded";
export function orNotRecorded(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return NOT_RECORDED;
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}
