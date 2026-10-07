/**
 * Pure: read side of the Seeger Weiss matter registry projection
 * (datasets `sw_matters_v1` and `sw_matter_dockets_v1`, schema `sw-matter-registry/1`; contract in
 * _work/contracts/sw-matter-registry.md).
 *
 * The registry supplies the explicit relationships the matter page used to derive: which provider case ids
 * belong to a matter's master and JPML dockets, which dockets are members with which evidence, and newer JPML
 * counts. Everything here is defensive: a record that does not match the expected schema yields null and the
 * caller falls back to the labelled "derived" path. Nothing is inferred and unknown values stay null.
 */
import {
  CASE_ROLES,
  type CaseRole,
  type CaseRow,
  type RegistryCaseDetail,
  type RegistryLabels,
} from "./cases";
import { matterCaseKeys } from "./docketKeys";
import type { CountSnapshot, MatterOverview } from "./overview";
import { arr, cleaned, idStr, isObj, safeUint as num, str } from "./values";

export const REGISTRY_SCHEMA_PREFIX = "sw-matter-registry/";
export const REGISTRY_MATTERS_DATASET = "sw_matters_v1";
export const REGISTRY_DOCKETS_DATASET = "sw_matter_dockets_v1";

/** Provider case ids are passed to the PDF reader; only plain identifier characters are accepted. */
const NATIVE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/;
export const isNativeCaseId = (v: string): boolean => NATIVE_ID_PATTERN.test(v);

/* ------------------------------------------------------------------ matter record */

export type NativeCaseId = {
  provider: string;
  sourceSystem: string;
  id: string;
  /** How the registry resolved this id ("provider_native_id", "exact_docket_key"...). */
  basis: string | null;
  pacerCaseId: string | null;
};

export type RegistryCaseIds = {
  role: string;
  docketKey: string;
  courtId: string | null;
  docketNumber: string | null;
  nativeCaseIds: NativeCaseId[];
  /** Evidence kinds for the master / JPML identity. */
  basis: string[];
};

export type RegistryJudge = {
  role: string;
  clPersonId: string | null;
  sourceString: string | null;
  docketKey: string | null;
  basis: string | null;
};

export type RegistryEntryCapture = {
  provider: string;
  docketKey: string | null;
  clDocketId: string | null;
  captured: number | null;
  providerTotal: number | null;
  /** Capture completeness after checking any known captured/provider totals. */
  complete: boolean | null;
  /** The provider's raw completeness flag before count consistency checks. */
  reportedComplete: boolean | null;
  observedAt: string | null;
};

/** Replaces only the registry generator's exact stale CourtListener capture sentence when identity is unambiguous. */
export function currentRegistryGapText(
  gap: string,
  entries: RegistryEntryCapture[],
  caseIds: RegistryCaseIds[],
): string {
  const match =
    /^CourtListener entries for docket ([1-9]\d*): \d+ captured of \d+ total; collection continues\.$/.exec(
      gap,
    );
  if (!match) return gap;

  const nativeId = match[1]!;
  const matchingDockets = caseIds.filter((docket) =>
    docket.nativeCaseIds.some(
      (id) =>
        id.provider === "courtlistener" &&
        id.sourceSystem === "courtlistener" &&
        id.id === nativeId,
    ),
  );
  if (matchingDockets.length !== 1) return gap;

  const docketKey = matchingDockets[0]!.docketKey;
  const matchingCaptures = entries.filter(
    (entry) =>
      entry.provider === "courtlistener" &&
      entry.docketKey === docketKey &&
      entry.clDocketId === nativeId,
  );
  if (matchingCaptures.length !== 1) return gap;

  const capture = matchingCaptures[0]!;
  const count =
    capture.captured === null
      ? "count not recorded"
      : `${capture.captured.toLocaleString()} captured`;
  const completeness =
    capture.complete === true
      ? "complete at last check"
      : capture.complete === false
        ? "partial at last check"
        : "completeness not recorded";
  const observed = capture.observedAt?.slice(0, 10);
  const observedText = observed && /^\d{4}-\d{2}-\d{2}$/.test(observed) ? observed : null;
  const providerTotal =
    capture.providerTotal === null
      ? "provider total not recorded"
      : `${capture.providerTotal.toLocaleString()} reported by provider`;
  return `CourtListener entries for docket ${nativeId}: ${count}; ${completeness}; ${observedText ? `observed ${observedText}` : "observation date not recorded"}; ${providerTotal}.`;
}

export type RegistryPartyCapture = {
  kind: string;
  provider: string;
  docketKey: string | null;
  captured: number | null;
  complete: boolean | null;
};

export type RegistryJpmlOrder = {
  url: string;
  docType: string | null;
  docDate: string | null;
  rows: number | null;
  ctoNo: string | null;
  sha256: string | null;
  altCopies: { url: string; rows: number | null; retrievedAt: string | null }[];
};

/** One DocketBird relationship-graph query for the master docket: what it returned versus what it reports indexed. */
export type RegistryGraphQuery = {
  retrievedAt: string | null;
  masterCaseId: string | null;
  returned: number | null;
  totalMembers: number | null;
  truncated: boolean | null;
};

/** The matter record's own fields (title, listing cells, detail facts), when the whole record was read. */
export type RegistryRecordInfo = {
  /** Caption as the JPML report prints it. */
  caption: string | null;
  status: "pending" | "terminated" | null;
  /** CourtListener court id of the transferee court. */
  transfereeCourt: string | null;
  judgeAsPrinted: string | null;
  dateCentralized: string | null;
  /** Rows of the entries dataset held for the matter, and of those how many are published without their text (v1.3). */
  entriesPublished: number | null;
  entriesWithheld: number | null;
  /** Rows of the parties dataset held for the matter, and the counsel entries on them (v1.3). */
  partiesPublished: number | null;
  counselLinks: number | null;
};

export type RegistryMatter = {
  mdl: string;
  tier: string | null;
  /** Null when only the machine block was read. */
  record: RegistryRecordInfo | null;
  /** DocketBird graph queries: provider-indexed totals, evidence and never a census. */
  docketbirdGraph: RegistryGraphQuery[];
  caseIds: RegistryCaseIds[];
  /** Flat, de-duplicated list the registry says is ready to pass to the PDF reader. */
  pdfCaseIds: string[];
  members: { rows: number | null; actions: number | null; byBasis: Record<string, number> };
  judges: RegistryJudge[];
  entries: RegistryEntryCapture[];
  parties: RegistryPartyCapture[];
  jpml: {
    asOf: string | null;
    pending: number | null;
    historicalTotal: number | null;
    reportUrl: string | null;
    scope: string | null;
  } | null;
  jpmlOrders: RegistryJpmlOrder[];
  unassignedNativeCaseIds: string[];
  gaps: string[];
  projectedAt: string | null;
  runIds: string[];
};

function httpsUrl(v: unknown): string | null {
  const s = str(v);
  return s && /^https:\/\//i.test(s) ? s : null;
}

function parseNativeCaseIds(v: unknown): NativeCaseId[] {
  const out: NativeCaseId[] = [];
  for (const raw of arr(v)) {
    if (!isObj(raw)) continue;
    const id = idStr(raw["id"]);
    const provider = str(raw["provider"]);
    const sourceSystem = str(raw["source_system"]);
    if (!id || !isNativeCaseId(id) || !provider || !sourceSystem) continue;
    out.push({
      provider,
      sourceSystem,
      id,
      basis: str(raw["resolution_basis"]),
      pacerCaseId: idStr(raw["pacer_case_id"]),
    });
  }
  return out;
}

const strings = (v: unknown): string[] =>
  arr(v).flatMap((x) => {
    const s = str(x);
    return s ? [s] : [];
  });

/**
 * The provider case ids of one docket (`detail.registry.native_case_ids`) that may be passed to the PDF reader. An id
 * whose own provider header conflicts with the docket identity is shown for transparency in the registry but is never a
 * source of this docket's PDFs (contract §6.5), so it is dropped here.
 */
export function pdfLookupCaseIds(raw: unknown, limit = 30): string[] {
  const out: string[] = [];
  for (const entry of arr(raw)) {
    if (!isObj(entry)) continue;
    const id = idStr(entry["id"]);
    if (!id || !isNativeCaseId(id) || out.includes(id)) continue;
    if (entry["pdf_lookup"] === false) continue;
    const basis = str(entry["resolution_basis"]);
    if (basis && /header_conflicts$/.test(basis)) continue;
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * `detail.registry` of a `sw_matters_v1` record. Returns null when the block is absent, is not the registry schema
 * or names a different MDL than the one requested.
 */
export function parseRegistryMatter(raw: unknown, expectedMdl?: string): RegistryMatter | null {
  if (!isObj(raw)) return null;
  const schema = str(raw["schema"]);
  const mdl = idStr(raw["mdl"]);
  if (!schema || !schema.startsWith(REGISTRY_SCHEMA_PREFIX) || !mdl || !/^\d{1,6}$/.test(mdl))
    return null;
  if (expectedMdl !== undefined && mdl !== expectedMdl) return null;

  const caseIds: RegistryCaseIds[] = [];
  for (const c of arr(raw["case_ids"])) {
    if (!isObj(c)) continue;
    const docketKey = str(c["docket_key"]);
    const role = str(c["role"]);
    if (!docketKey || !role) continue;
    caseIds.push({
      role,
      docketKey,
      courtId: str(c["court_id"]),
      docketNumber: str(c["docket_number"]),
      nativeCaseIds: parseNativeCaseIds(c["native_case_ids"]),
      basis: strings(c["basis"]),
    });
  }

  const pdfCaseIds = [...new Set(strings(raw["pdf_case_ids"]).filter(isNativeCaseId))].slice(
    0,
    100,
  );

  const membersRaw = isObj(raw["members"]) ? raw["members"] : {};
  const byBasis: Record<string, number> = {};
  if (isObj(membersRaw["by_basis"]))
    for (const [k, n] of Object.entries(membersRaw["by_basis"])) {
      const count = num(n);
      if (count !== null) byBasis[k] = count;
    }

  const judges: RegistryJudge[] = [];
  for (const j of arr(raw["judges"])) {
    if (!isObj(j)) continue;
    const role = str(j["role"]);
    if (!role) continue;
    judges.push({
      role,
      clPersonId: idStr(j["cl_person_id"]),
      sourceString: str(j["source_string"]),
      docketKey: str(j["docket_key"]),
      basis: str(j["basis"]),
    });
  }

  const entries: RegistryEntryCapture[] = [];
  for (const e of arr(raw["entries"])) {
    if (!isObj(e)) continue;
    const provider = str(e["provider"]);
    if (!provider) continue;
    const captured = num(e["captured"]);
    const providerTotal = num(e["provider_total"]);
    const reportedComplete = typeof e["complete"] === "boolean" ? e["complete"] : null;
    entries.push({
      provider,
      docketKey: str(e["docket_key"]),
      clDocketId: idStr(e["cl_docket_id"]),
      captured,
      providerTotal,
      complete:
        reportedComplete === true &&
        captured !== null &&
        providerTotal !== null &&
        captured < providerTotal
          ? false
          : reportedComplete,
      reportedComplete,
      observedAt: str(e["observed_at"]),
    });
  }

  // `parties_summary` is an array in the live projection and a single object in the contract's example.
  const partiesRaw = Array.isArray(raw["parties_summary"])
    ? raw["parties_summary"]
    : isObj(raw["parties_summary"])
      ? [raw["parties_summary"]]
      : [];
  const parties: RegistryPartyCapture[] = [];
  for (const p of partiesRaw) {
    if (!isObj(p)) continue;
    const provider = str(p["provider"]);
    if (!provider) continue;
    if (str(p["kind"])) {
      parties.push({
        kind: str(p["kind"])!,
        provider,
        docketKey: str(p["docket_key"]),
        captured: num(p["captured"]),
        complete: typeof p["complete"] === "boolean" ? p["complete"] : null,
      });
    } else {
      const base = { provider, docketKey: str(p["docket_key"]) };
      parties.push({
        kind: "parties",
        ...base,
        captured: num(p["parties_captured"]),
        complete: typeof p["complete"] === "boolean" ? p["complete"] : null,
      });
      parties.push({
        kind: "attorneys",
        ...base,
        captured: num(p["attorneys_captured"]),
        complete: typeof p["complete"] === "boolean" ? p["complete"] : null,
      });
    }
  }

  const jpmlRaw = isObj(raw["jpml"]) ? raw["jpml"] : null;
  const jpml = jpmlRaw
    ? {
        asOf: str(jpmlRaw["as_of"]),
        pending: num(jpmlRaw["pending"]),
        historicalTotal: num(jpmlRaw["historical_total"]),
        reportUrl: httpsUrl(jpmlRaw["report_url"]),
        scope: str(jpmlRaw["scope"]),
      }
    : null;

  const jpmlOrders: RegistryJpmlOrder[] = [];
  for (const o of arr(raw["jpml_orders"])) {
    if (!isObj(o)) continue;
    const url = httpsUrl(o["url"]);
    if (!url) continue;
    jpmlOrders.push({
      url,
      docType: str(o["doc_type"]),
      docDate: str(o["doc_date"]),
      rows: num(o["rows"]),
      ctoNo: idStr(o["cto_no"]),
      sha256:
        typeof o["document_sha256"] === "string" && /^[a-f0-9]{64}$/.test(o["document_sha256"])
          ? o["document_sha256"]
          : null,
      altCopies: arr(o["alt_copies"]).flatMap((a) => {
        if (!isObj(a)) return [];
        const altUrl = httpsUrl(a["url"]);
        return altUrl
          ? [{ url: altUrl, rows: num(a["rows"]), retrievedAt: str(a["retrieved_at"]) }]
          : [];
      }),
    });
  }

  const docketbirdGraph: RegistryGraphQuery[] = [];
  for (const g of arr(raw["docketbird_graph"])) {
    if (!isObj(g)) continue;
    docketbirdGraph.push({
      retrievedAt: str(g["retrieved_at"]),
      masterCaseId: str(g["master_case_id"]),
      returned: num(g["returned"]),
      totalMembers: num(g["total_members"]),
      truncated: typeof g["truncated"] === "boolean" ? g["truncated"] : null,
    });
  }

  const provenance = isObj(raw["provenance"]) ? raw["provenance"] : {};
  return {
    mdl,
    tier: str(raw["tier"]),
    record: null,
    docketbirdGraph,
    caseIds,
    pdfCaseIds,
    members: {
      rows: num(membersRaw["rows"]),
      actions: num(membersRaw["actions"]),
      byBasis,
    },
    judges,
    entries,
    parties,
    jpml,
    jpmlOrders,
    unassignedNativeCaseIds: strings(raw["unassigned_native_case_ids"]),
    gaps: strings(raw["gaps"]).map((gap) => currentRegistryGapText(gap, entries, caseIds)),
    projectedAt: str(provenance["projected_at"]),
    runIds: strings(provenance["run_ids"]),
  };
}

/**
 * A whole `sw_matters_v1` record (title, listing cells, detail facts and the machine block). The record fields are
 * read as published: status only from the closed vocabulary, everything else as the projection states it.
 */
export function parseRegistryRecord(
  row: { title: unknown; cells: unknown; facts: unknown; registry: unknown },
  expectedMdl?: string,
): RegistryMatter | null {
  const matter = parseRegistryMatter(row.registry, expectedMdl);
  if (!matter) return null;
  const cells = isObj(row.cells) ? row.cells : {};
  const facts = new Map<string, string>();
  for (const f of arr(row.facts))
    if (Array.isArray(f) && typeof f[0] === "string" && f[1] != null) facts.set(f[0], String(f[1]));
  const status = str(cells["status"]);
  const centralized = [...facts.entries()].find(([k]) => /^Date centralized/i.test(k))?.[1];
  return {
    ...matter,
    record: {
      caption: str(row.title),
      status: status === "pending" || status === "terminated" ? status : null,
      transfereeCourt: str(cells["transferee_court"]),
      judgeAsPrinted: str(cells["judge_as_printed"]),
      dateCentralized:
        centralized && /^\d{4}-\d{2}-\d{2}$/.test(centralized.trim()) ? centralized.trim() : null,
      entriesPublished: num(cells["entries_published"]),
      entriesWithheld: num(cells["entries_withheld"]),
      partiesPublished: num(cells["parties_published"]),
      counselLinks: num(cells["counsel_links"]),
    },
  };
}

/**
 * A matter page for an MDL the JPML pending-MDL directory (`mdls`) does not hold (a closed matter, for example) but
 * the registry does. Only what the registry states is filled in; the rest stays unrecorded.
 */
export function overviewFromRegistry(reg: RegistryMatter): MatterOverview | null {
  const rec = reg.record;
  if (!rec || !rec.caption) return null;
  const master = reg.caseIds.find((c) => c.role === "master") ?? null;
  const clMaster = master?.nativeCaseIds.find((n) => n.provider === "courtlistener")?.id ?? null;
  const assigned = reg.judges.find((j) => j.role === "assigned_to") ?? null;
  const jpml = reg.jpml;
  const snapshots: CountSnapshot[] =
    jpml && jpml.asOf && /^\d{4}-\d{2}-\d{2}$/.test(jpml.asOf)
      ? [
          {
            asOf: jpml.asOf,
            total: jpml.historicalTotal,
            pending: jpml.pending,
            label: `JPML report ${jpml.asOf} (via the matter registry)`,
          },
        ]
      : [];
  const court = master?.courtId ?? rec.transfereeCourt;
  const docket = master?.docketNumber ?? null;
  return {
    mdl: reg.mdl,
    recordId: `sw-matter:${reg.mdl}`,
    title: rec.caption,
    titleBasis: "Caption as printed in the JPML report (matter registry)",
    status: rec.status,
    litigationType: null,
    asOf: snapshots[0]?.asOf ?? null,
    countsLabel: snapshots[0]?.label ?? null,
    court: {
      clId: court,
      shortName: null,
      fullName: null,
      fjcName: null,
      districtCode: null,
      circuit: null,
    },
    masterDocket: { number: docket, clDocketId: clMaster },
    dates: { filed: null, transferred: rec.dateCentralized, closed: null },
    actions: {
      total: snapshots[0]?.total ?? null,
      pending: snapshots[0]?.pending ?? null,
      snapshots,
    },
    judge: {
      printedName: rec.judgeAsPrinted,
      printedTitle: null,
      profileName: null,
      entityId: null,
      profileId: null,
      profileLinkBasis: null,
      clPersonBasis: null,
      fjcJid: null,
      fjcNid: null,
      clPersonId: assigned?.clPersonId ?? null,
      linkBasis: null,
      // No judge profile is linked from the registry alone; a name or a person id here is shown, never linked.
      nativeIdEvidence: false,
      evidenceNote: null,
    },
    reports: [],
    cases: null,
    docketDocuments: null,
    activity: null,
    counsel: null,
    appearances: null,
    expertRulingsTotal: null,
    keys: matterCaseKeys(court, docket),
  };
}

/* ------------------------------------------------------------------ metrics */

export type RegistryMetrics = {
  /**
   * Member and transferor dockets the registry holds for the matter (the master docket and the JPML panel proceeding are
   * listed beside them but not counted here); never the size of the MDL.
   */
  dockets: number | null;
  /** Of those, rows counted as one action each. */
  actions: number | null;
  /** Evidence kinds of those dockets, most frequent first (a docket with several kinds counts under each). */
  byBasis: { kind: string; count: number }[];
  /** CourtListener entries: captured vs the provider's own total, and how many the projection published / withheld. */
  entries: {
    captured: number | null;
    providerTotal: number | null;
    complete: boolean | null;
    published: number | null;
    withheld: number | null;
  } | null;
  /** Parties of the master docket the projection published, and the counsel entries on them. */
  parties: { published: number | null; counselLinks: number | null } | null;
  /** Newest day any capture was observed (yyyy-mm-dd), from the captures' own timestamps. */
  lastCaptured: string | null;
};

/**
 * The matter's registry numbers, all computed from the record (nothing is estimated): entries captured against what
 * the provider reports, publication counts, evidence mix and when the newest capture was observed. Null when the
 * registry has no record for the matter.
 */
export function registryMetrics(reg: RegistryMatter | null): RegistryMetrics | null {
  if (!reg) return null;
  const caps = reg.entries.filter((e) => e.captured !== null);
  const captured = caps.length ? caps.reduce((n, e) => n + (e.captured ?? 0), 0) : null;
  const totals = reg.entries.map((e) => e.providerTotal);
  const providerTotal =
    totals.length && totals.every((t): t is number => t !== null)
      ? totals.reduce((n, t) => n + t, 0)
      : null;
  const completes = reg.entries.map((e) => e.complete);
  const complete = !completes.length
    ? null
    : completes.every((c) => c === true)
      ? true
      : completes.some((c) => c === false)
        ? false
        : null;
  const countMismatch = captured !== null && providerTotal !== null && captured < providerTotal;
  const observed = reg.entries
    .map((e) => e.observedAt?.slice(0, 10) ?? null)
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const rec = reg.record;
  const hasEntries = captured !== null || (rec !== null && rec.entriesPublished !== null);
  const hasParties = rec !== null && (rec.partiesPublished !== null || rec.counselLinks !== null);
  return {
    dockets: reg.members.rows,
    actions: reg.members.actions,
    byBasis: Object.entries(reg.members.byBasis)
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    entries: hasEntries
      ? {
          captured,
          providerTotal,
          complete: countMismatch ? false : complete,
          published: rec ? rec.entriesPublished : null,
          withheld: rec ? rec.entriesWithheld : null,
        }
      : null,
    parties: hasParties
      ? { published: rec!.partiesPublished, counselLinks: rec!.counselLinks }
      : null,
    lastCaptured: observed.length ? observed[observed.length - 1]! : null,
  };
}

/* ------------------------------------------------------------------ PDF case ids */

export type CaseIdBasis = "registry" | "derived" | "registered";
export type CaseIdPlanEntry = { id: string; basis: CaseIdBasis };

/**
 * The provider case ids to ask the PDF reader for. A matter the registry covers uses ONLY the registry's explicit
 * ids (`pdf_case_ids`): those are the relationships it records, and an id it did not attach to a docket is not guessed
 * back in. A matter the registry does not cover yet falls back to keys derived from the exact court id and docket
 * number, each labelled "derived".
 */
export function caseIdPlan(
  registry: Pick<RegistryMatter, "pdfCaseIds"> | null,
  derived: string[],
): CaseIdPlanEntry[] {
  const out: CaseIdPlanEntry[] = [];
  const seen = new Set<string>();
  const add = (id: string, basis: CaseIdBasis) => {
    if (!isNativeCaseId(id) || seen.has(id)) return;
    seen.add(id);
    out.push({ id, basis });
  };
  if (registry && registry.pdfCaseIds.length) {
    for (const id of registry.pdfCaseIds) add(id, "registry");
    return out;
  }
  for (const id of derived) add(id, "derived");
  return out;
}

/* ------------------------------------------------------------------ JPML counts */

export type JpmlCounts = { asOf: string | null; total: number | null; pending: number | null };

/**
 * The registry's JPML block replaces the current counts only when its report is dated after the current one; the
 * current counts are returned untouched otherwise (and when the registry block is incomplete).
 */
export function newerJpmlCounts(
  current: JpmlCounts,
  jpml: RegistryMatter["jpml"] | null | undefined,
): JpmlCounts {
  if (!jpml || !jpml.asOf || !/^\d{4}-\d{2}-\d{2}$/.test(jpml.asOf)) return current;
  if (jpml.pending === null && jpml.historicalTotal === null) return current;
  if (current.asOf !== null && jpml.asOf <= current.asOf) return current;
  return { asOf: jpml.asOf, total: jpml.historicalTotal, pending: jpml.pending };
}

/**
 * Adds the registry's JPML count snapshot to the matter's history and, when it is newer than the MDL record's own
 * latest report, makes it the current figure. The older snapshots stay listed with their own dates.
 */
export function withRegistryJpml(
  overview: MatterOverview,
  registry: RegistryMatter | null,
): MatterOverview {
  const j = registry?.jpml;
  if (!j || !j.asOf || !/^\d{4}-\d{2}-\d{2}$/.test(j.asOf)) return overview;
  if (j.pending === null && j.historicalTotal === null) return overview;
  if (overview.actions.snapshots.some((s) => s.asOf === j.asOf)) return overview;
  const snapshot: CountSnapshot = {
    asOf: j.asOf,
    total: j.historicalTotal,
    pending: j.pending,
    label: `JPML pending-MDL report ${j.asOf} (via the matter registry)`,
  };
  const snapshots = [...overview.actions.snapshots, snapshot].sort((a, b) =>
    b.asOf.localeCompare(a.asOf),
  );
  // Only a report dated after the MDL record's own latest one replaces the current figures.
  if (overview.asOf !== null && snapshot.asOf <= overview.asOf)
    return { ...overview, actions: { ...overview.actions, snapshots } };
  return {
    ...overview,
    asOf: snapshot.asOf,
    countsLabel: snapshot.label,
    actions: { total: snapshot.total, pending: snapshot.pending, snapshots },
  };
}

/* ------------------------------------------------------------------ docket rows (list) */

const ROLE_SET = new Set<string>(CASE_ROLES);

function roleOf(v: unknown): CaseRole {
  const s = str(v);
  return s && ROLE_SET.has(s) ? (s as CaseRole) : "unknown";
}

/** A registry status of "no_termination_date_recorded" or "unknown" is the absence of a status, not a status. */
function statusOf(v: unknown): string | null {
  const s = cleaned(v);
  return s && s !== "no_termination_date_recorded" ? s : null;
}

function clDocketIdFrom(links: { url: string }[], nativeIds: string[]): string | null {
  for (const l of links) {
    const m = /^https:\/\/www\.courtlistener\.com\/docket\/(\d+)\/?/.exec(l.url);
    if (m) return m[1]!;
  }
  // CourtListener docket ids are the only purely numeric provider ids in the registry.
  return nativeIds.find((id) => /^[1-9]\d*$/.test(id)) ?? null;
}

/**
 * One `sw_matter_dockets_v1` listing row (id, item, filters) -> CaseRow. Evidence rows are not in the listing;
 * they load on demand for the detail drawer.
 */
export function parseRegistryDocket(row: {
  id: unknown;
  item: unknown;
  filters: unknown;
}): CaseRow | null {
  const id = str(row.id);
  if (!id || !isObj(row.item)) return null;
  const cells = isObj(row.item["cells"]) ? row.item["cells"] : {};
  const filters = isObj(row.filters) ? row.filters : {};
  const m = /^sw-md:(\d{1,6}):(.+)$/.exec(id);
  if (!m) return null;
  const docketKey = m[2]!;
  const links = arr(row.item["links"]).flatMap((l) => {
    if (!isObj(l)) return [];
    const url = httpsUrl(l["url"]);
    // The projection leaves "()" behind when a report has no date ("JPML master docket list ()").
    const label = str(l["label"])?.replace(/\s*\(\s*\)\s*$/, "") ?? null;
    return url ? [{ url, label: label ?? url }] : [];
  });
  const nativeIds = strings(filters["native_case_id"]);
  const clId = clDocketIdFrom(links, nativeIds);
  const basisKinds = strings(filters["basis"]);
  // v1.3: the caption as the court (or the cited source) prints it, when a publishable one exists. Whitespace only is
  // collapsed; the text is otherwise shown exactly as published.
  const caption = cleaned(cells["caption"])?.replace(/\s+/g, " ") ?? null;
  const routeRaw = str(cells["route"]);
  const detail: RegistryCaseDetail = {
    rowId: id,
    docketKey,
    basisKinds,
    evidenceCount: num(cells["evidence_count"]),
    countsAsAction:
      typeof cells["counts_as_action"] === "boolean"
        ? cells["counts_as_action"]
        : filters["counts_as_action"] === "true"
          ? true
          : filters["counts_as_action"] === "false"
            ? false
            : null,
    actionId: str(cells["action_id"]),
    conflict: filters["conflict"] === "true",
    nativeCaseIds: nativeIds,
    links,
    captionSource: caption ? str(cells["caption_source"]) : null,
  };
  return {
    id: `registry:${id}`,
    clDocketId: clId,
    docketNumber: cleaned(cells["docket_number"]),
    caption,
    // No publishable caption: no source prints one, or the printed one matched the publication exclusion.
    captionWithheld: caption === null,
    courtId: cleaned(cells["court_id"]),
    dateFiled: cleaned(cells["filed"]),
    dateTerminated: cleaned(cells["terminated"]),
    status: statusOf(cells["status"]),
    role: roleOf(cells["role"]),
    evidence: "registry",
    evidenceDetail: null,
    route: routeRaw && routeRaw !== "unknown" ? routeRaw : null,
    defendant: null,
    sourceUrl: clId ? `https://www.courtlistener.com/docket/${clId}/` : null,
    source: "registry",
    registry: detail,
  };
}

/**
 * Evidence kind -> label, read from the dataset's own filter metadata (`metadata.listing.filters`), so a new kind
 * shows with the label the registry publishes.
 */
export function parseRegistryLabels(metadata: unknown): RegistryLabels {
  const out: { basis: Record<string, string>; role: Record<string, string> } = {
    basis: {},
    role: {},
  };
  const listing = isObj(metadata) && isObj(metadata["listing"]) ? metadata["listing"] : null;
  for (const f of arr(listing?.["filters"])) {
    if (!isObj(f)) continue;
    const name = str(f["name"]);
    if (name !== "basis" && name !== "role") continue;
    for (const o of arr(f["options"])) {
      if (!isObj(o)) continue;
      const value = str(o["value"]);
      const label = str(o["label"]);
      if (value && label) out[name][value] = label;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ docket row (detail drawer) */

export type EvidenceItem = {
  kind: string;
  label: string | null;
  assertedRole: string | null;
  assertedRoute: string | null;
  /** The source as recorded; shown as text always, as a link only when `linkable`. */
  sourceUrl: string | null;
  linkable: boolean;
  sourceSha256: string | null;
  /** Compact, human-readable locator ("page 4 · row 1 · as printed 2:24-09195"). */
  locator: string | null;
  quote: string | null;
  retrievedAt: string | null;
  asOf: string | null;
  qualification: string | null;
};

export type RegistryDocketDetail = {
  rowId: string;
  facts: [string, string][];
  nativeCaseIds: NativeCaseId[];
  evidence: EvidenceItem[];
  linkedDockets: { docketKey: string; role: string }[];
  judges: RegistryJudge[];
  held: string[];
  hasConflict: boolean;
  qualification: string | null;
  projectedAt: string | null;
};

/** A CourtListener REST API address is a data endpoint, not a page a reader can open. */
export function isLinkableSource(url: string | null): url is string {
  return !!url && /^https:\/\//i.test(url) && !/\/api\/rest\//i.test(url);
}

export function formatLocator(locator: unknown): string | null {
  if (!isObj(locator)) return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(locator)) {
    if (value === null || value === undefined || value === "") continue;
    const text =
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
    parts.push(`${key.replace(/_/g, " ")} ${text.length > 80 ? `${text.slice(0, 77)}…` : text}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function parseRegistryDocketDetail(raw: unknown): RegistryDocketDetail | null {
  if (!isObj(raw)) return null;
  const reg = isObj(raw["registry"]) ? raw["registry"] : null;
  const rowId = str(raw["id"]);
  if (!reg || !rowId) return null;
  const schema = str(reg["schema"]);
  if (!schema || !schema.startsWith(REGISTRY_SCHEMA_PREFIX)) return null;
  const evidence: EvidenceItem[] = [];
  for (const e of arr(reg["evidence"])) {
    if (!isObj(e)) continue;
    const kind = str(e["kind"]);
    if (!kind) continue;
    const sourceUrl = str(e["source_url"]);
    const sha = e["source_sha256"];
    evidence.push({
      kind,
      label: str(e["label"]),
      assertedRole: str(e["asserted_role"]),
      assertedRoute: str(e["asserted_route"]),
      sourceUrl,
      linkable: isLinkableSource(sourceUrl),
      sourceSha256: typeof sha === "string" && /^[a-f0-9]{64}$/.test(sha) ? sha : null,
      locator: formatLocator(e["locator"]),
      quote: str(e["quote"]),
      retrievedAt: str(e["retrieved_at"]),
      asOf: str(e["as_of"]),
      qualification: str(e["qualification"]),
    });
  }
  const facts: [string, string][] = [];
  for (const f of arr(raw["facts"]))
    if (Array.isArray(f) && typeof f[0] === "string" && f[1] != null)
      facts.push([f[0], String(f[1])]);
  const provenance = isObj(raw["provenance"]) ? raw["provenance"] : {};
  return {
    rowId,
    facts,
    nativeCaseIds: parseNativeCaseIds(reg["native_case_ids"]),
    evidence,
    linkedDockets: arr(reg["linked_dockets"]).flatMap((d) => {
      if (!isObj(d)) return [];
      const docketKey = str(d["docket_key"]);
      const role = str(d["role"]);
      return docketKey && role ? [{ docketKey, role }] : [];
    }),
    judges: arr(reg["judges"]).flatMap((j) => {
      if (!isObj(j)) return [];
      const role = str(j["role"]);
      return role
        ? [
            {
              role,
              clPersonId: idStr(j["cl_person_id"]),
              sourceString: str(j["source_string"]),
              docketKey: null,
              basis: str(j["basis"]),
            },
          ]
        : [];
    }),
    held: strings(reg["held"]),
    hasConflict: arr(reg["conflicts"]).length > 0,
    qualification: str(raw["qualification"]),
    projectedAt: str(provenance["projected_at"]),
  };
}

/** "2026-10-03T11:28:30.867Z" -> "2026-10-03 11:28 UTC"; anything else is returned as recorded, null stays null. */
export function formatUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|\+00:00)$/.exec(value);
  return m ? `${m[1]} ${m[2]} UTC` : value;
}

/** True when `rowId` is a registry row of the given MDL (guards the on-demand detail lookup). */
export function isRegistryRowOf(rowId: string, mdl: string): boolean {
  return rowId.startsWith(`sw-md:${mdl}:`) && /^sw-md:\d{1,6}:[A-Za-z0-9:._-]{1,160}$/.test(rowId);
}
