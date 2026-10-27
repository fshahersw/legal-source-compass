/**
 * Judges × districts × MDL defendants cross-analysis (datasets judge_cross_profiles, judge_cross_districts,
 * judge_cross_disclosure_matches, built by scripts/enrichment/judges_cross/build_judges_cross.py).
 * Stored JSON is validated defensively: malformed rows are dropped, missing values stay null.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => num(v) ?? 0;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** MDL numbers are integers except a few early dockets printed with a letter ("8A"). */
const mdlLabel = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v)
    ? String(v)
    : typeof v === "string" && /^\d{1,5}[A-Z]?$/.test(v)
      ? v
      : null;
const counts = (v: unknown): Record<string, number> => {
  const o = obj(v);
  if (!o) return {};
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(o))
    if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  return out;
};

export type JudgePoint = {
  nid: string;
  name: string;
  courtId: string | null;
  state: string | null;
  circuit: number | null;
  status: string;
  party: string | null;
  president: string | null;
  years: number | null;
  pendingMdls: number;
  pendingActions: number;
  historicalMdls: number;
  historicalActions: number;
  totalActions: number;
  sharePct: number | null;
  profileId: string | null;
  photo: string | null;
  rank: number | null;
  plMdls: number;
  topMdl: string | null;
};
export type HistoryCoverage = { code: string; name: string; printed: number; parsed: number };
export type ProfilesSummary = {
  asOf: string;
  pendingMdls: number;
  pendingActions: number;
  judges: number;
  judgesWithPending: number;
  judgesHistoryOnly: number;
  judgesMultiPending: number;
  top10SharePct: number | null;
  hhiByJudge: number | null;
  medianYearsPendingJudges: number | null;
  unassignedPending: { mdl: number; title: string; judge: string | null; pending: number }[];
  history: {
    rows: number;
    printedLitigations: number | null;
    unparsedLines: number;
    judgeNotPrinted: { mdl: string; caption: string; district: string; year: number | null }[];
    exitsFy2026: number;
    status: Record<string, number>;
    districts: HistoryCoverage[];
  };
  points: JudgePoint[];
};
export type DistrictRow = {
  courtId: string;
  name: string;
  state: string | null;
  circuit: number | null;
  sitting: number;
  active: number;
  senior: number;
  partyActive: Record<string, number>;
  partyAll: Record<string, number>;
  medianYearsActive: number | null;
  medianYearsAll: number | null;
  tenure: Record<string, number>;
  pendingMdls: number;
  pendingActions: number;
  massTortMdls: number;
  plMdls: number;
  mdlJudges: number;
  topJudge: string | null;
  topJudgeSharePct: number | null;
  hhiByJudge: number | null;
  terminatedMdls: number;
  judgeships: number | null;
  sharePct: number | null;
};
export type NationalSummary = {
  asOf: string;
  districts: number;
  sitting: number;
  active: number;
  senior: number;
  partyActive: Record<string, number>;
  tenure: Record<string, number>;
  medianYearsActive: number | null;
  pendingMdls: number;
  pendingActions: number;
  districtsWithPending: number;
  hhiByDistrict: number | null;
  top5DistrictSharePct: number | null;
  rows: DistrictRow[];
};
export type DisclosureReport = {
  id: string;
  year: number;
  url: string;
  lines: number;
  amended: boolean;
};
export type DisclosureCoverage = {
  nid: string;
  judge: string;
  profileId: string | null;
  clPersonId: string | null;
  clPersonBasis: string | null;
  status: string;
  yearsAvailable: number[];
  yearsChecked: number[];
  linesChecked: number;
  latestReportYear: number | null;
  mdls: {
    mdl: number;
    title: string;
    transferred: string | null;
    afterLatestReport: boolean | null;
  }[];
  companiesChecked: string[];
  companiesBySource: Record<string, number>;
  partiesNotCompared: Record<string, number>;
  matches: number;
  nearMatches: number;
  reports: DisclosureReport[];
};
export type DisclosureMatch = {
  id: string;
  nid: string;
  judge: string;
  profileId: string | null;
  mdl: number;
  mdlTitle: string;
  company: string;
  evidenceKind: string;
  evidenceLabel: string;
  evidenceUrl: string | null;
  investment: string;
  year: number;
  line: number;
  linesInReport: number | null;
  page: number | null;
  disclosureUrl: string;
  grossValue: string | null;
  label: string;
  tier: "match" | "near_match";
  rule: string;
};
export type DisclosureSummary = {
  clBulkDate: string | null;
  judgesTargeted: number;
  status: Record<string, number>;
  matches: number;
  nearMatches: number;
  judgesWithMatches: number;
  partiesNotCompared: Record<string, number>;
  secLinksUsed: boolean;
  label: string;
  latestYears: Record<string, number>;
  yearsPerJudge: number | null;
};
export type JudgeCrossAnalytics = {
  profiles: ProfilesSummary;
  national: NationalSummary | null;
  disclosures: {
    summary: DisclosureSummary | null;
    coverage: DisclosureCoverage[];
    matches: DisclosureMatch[];
  };
};

function toPoint(v: unknown): JudgePoint | null {
  const o = obj(v);
  const nid = str(o?.["nid"]);
  const name = str(o?.["name"]);
  if (!o || !nid || !name) return null;
  return {
    nid,
    name,
    courtId: str(o["court_id"]),
    state: str(o["state"]),
    circuit: num(o["circuit"]),
    status: str(o["status"]) ?? "Not recorded",
    party: str(o["party"]),
    president: str(o["president"]),
    years: num(o["years_since_commission"]),
    pendingMdls: int(o["pending_mdl_count"]),
    pendingActions: int(o["pending_actions"]),
    historicalMdls: int(o["historical_mdl_count"]),
    historicalActions: int(o["historical_actions"]),
    totalActions: int(o["total_actions_handled"]),
    sharePct: num(o["pending_share_pct"]),
    profileId: str(o["judge_profile_id"]),
    photo: str(o["photo"]),
    rank: num(o["rank_pending_actions"]),
    plMdls: int(o["products_liability_mdls"]),
    topMdl: str(o["top_mdl"]),
  };
}

function toProfiles(v: unknown): ProfilesSummary | null {
  const o = obj(v);
  const asOf = str(o?.["as_of"]);
  if (!o || !asOf) return null;
  const history = obj(o["history"]) ?? {};
  return {
    asOf,
    pendingMdls: int(o["pending_mdls"]),
    pendingActions: int(o["pending_actions"]),
    judges: int(o["judges"]),
    judgesWithPending: int(o["judges_with_pending"]),
    judgesHistoryOnly: int(o["judges_with_history_only"]),
    judgesMultiPending: int(o["judges_multi_pending"]),
    top10SharePct: num(o["top10_judge_share_pct"]),
    hhiByJudge: num(o["hhi_by_judge"]),
    medianYearsPendingJudges: num(o["median_years_pending_judges"]),
    unassignedPending: arr(o["unassigned_pending"])
      .map(obj)
      .filter((x): x is Json => !!x && typeof x["mdl"] === "number")
      .map((x) => ({
        mdl: x["mdl"] as number,
        title: str(x["title"]) ?? "",
        judge: str(x["judge"]),
        pending: int(x["pending"]),
      })),
    history: {
      rows: int(history["rows"]),
      printedLitigations: num(history["printed_litigations"]),
      unparsedLines: int(history["unparsed_lines"]),
      judgeNotPrinted: arr(history["judge_not_printed"])
        .map(obj)
        .filter((x): x is Json => !!x && mdlLabel(x["mdl"]) !== null)
        .map((x) => ({
          mdl: mdlLabel(x["mdl"])!,
          caption: str(x["caption"]) ?? "",
          district: str(x["district"]) ?? "",
          year: num(x["year"]),
        })),
      exitsFy2026: arr(history["exits_fy2026"]).length,
      status: counts(history["status"]),
      districts: arr(history["districts"])
        .map(obj)
        .filter((x): x is Json => !!x && !!str(x["code"]))
        .map((x) => ({
          code: str(x["code"])!,
          name: str(x["name"]) ?? "",
          printed: int(x["printed"]),
          parsed: int(x["parsed"]),
        })),
    },
    points: arr(o["scatter"])
      .map(toPoint)
      .filter((p): p is JudgePoint => !!p),
  };
}

function toDistrict(v: unknown): DistrictRow | null {
  const o = obj(v);
  const courtId = str(o?.["court_id"]);
  if (!o || !courtId) return null;
  return {
    courtId,
    name: str(o["name"]) ?? courtId,
    state: str(o["state"]),
    circuit: num(o["circuit"]),
    sitting: int(o["sitting"]),
    active: int(o["active"]),
    senior: int(o["senior"]),
    partyActive: counts(o["party_active"]),
    partyAll: counts(o["party_all"]),
    medianYearsActive: num(o["median_years_active"]),
    medianYearsAll: num(o["median_years_all"]),
    tenure: counts(o["tenure"]),
    pendingMdls: int(o["pending_mdls"]),
    pendingActions: int(o["pending_actions"]),
    massTortMdls: int(o["mass_tort_mdls"]),
    plMdls: int(o["products_liability_mdls"]),
    mdlJudges: int(o["mdl_judges"]),
    topJudge: str(o["top_judge"]),
    topJudgeSharePct: num(o["top_judge_share_pct"]),
    hhiByJudge: num(o["hhi_by_judge"]),
    terminatedMdls: int(o["terminated_mdls"]),
    judgeships: num(o["judgeships"]),
    sharePct: num(o["share_pending_pct"]),
  };
}

function toNational(v: unknown): NationalSummary | null {
  const o = obj(v);
  const asOf = str(o?.["as_of"]);
  if (!o || !asOf) return null;
  return {
    asOf,
    districts: int(o["districts"]),
    sitting: int(o["sitting"]),
    active: int(o["active"]),
    senior: int(o["senior"]),
    partyActive: counts(o["party_active"]),
    tenure: counts(o["tenure"]),
    medianYearsActive: num(o["median_years_active"]),
    pendingMdls: int(o["pending_mdls"]),
    pendingActions: int(o["pending_actions"]),
    districtsWithPending: int(o["districts_with_pending"]),
    hhiByDistrict: num(o["hhi_by_district"]),
    top5DistrictSharePct: num(o["top5_district_share_pct"]),
    rows: arr(o["rows"])
      .map(toDistrict)
      .filter((d): d is DistrictRow => !!d),
  };
}

function toReports(v: unknown): DisclosureReport[] {
  return arr(v)
    .map(obj)
    .filter((x): x is Json => !!x && !!str(x["id"]) && typeof x["year"] === "number")
    .map((x) => ({
      id: str(x["id"])!,
      year: x["year"] as number,
      url: safeUrl(x["url"]) ?? "",
      lines: int(x["lines"]),
      amended: x["amended"] === true,
    }));
}

/** Only absolute https URLs or site-relative paths are passed to the client. */
function safeUrl(v: unknown) {
  const s = str(v);
  return s && (/^https:\/\//.test(s) || /^\/(?!\/)/.test(s)) ? s : null;
}

function toCoverage(v: unknown): DisclosureCoverage | null {
  const o = obj(v);
  const nid = str(o?.["nid"]);
  const judge = str(o?.["judge"]);
  if (!o || !nid || !judge) return null;
  return {
    nid,
    judge,
    profileId: str(o["judge_profile_id"]),
    clPersonId: str(o["cl_person_id"]),
    clPersonBasis: str(o["cl_person_basis"]),
    status: str(o["status"]) ?? "not_recorded",
    yearsAvailable: arr(o["years_available"]).filter((y): y is number => typeof y === "number"),
    yearsChecked: arr(o["years_checked"]).filter((y): y is number => typeof y === "number"),
    linesChecked: int(o["lines_checked"]),
    latestReportYear: num(o["latest_report_year"]),
    mdls: arr(o["mdls"])
      .map(obj)
      .filter((x): x is Json => !!x && typeof x["mdl"] === "number")
      .map((x) => ({
        mdl: x["mdl"] as number,
        title: str(x["title"]) ?? "",
        transferred: str(x["transferred"]),
        afterLatestReport:
          typeof x["after_latest_report"] === "boolean" ? x["after_latest_report"] : null,
      })),
    companiesChecked: arr(o["companies_checked"]).filter((x): x is string => typeof x === "string"),
    companiesBySource: counts(o["companies_by_source"]),
    partiesNotCompared: counts(o["parties_not_compared"]),
    matches: int(o["matches"]),
    nearMatches: int(o["near_matches"]),
    reports: toReports(o["reports"]),
  };
}

function toMatch(id: string, v: unknown): DisclosureMatch | null {
  const o = obj(v);
  const disclosureUrl = safeUrl(o?.["disclosure_url"]);
  if (
    !o ||
    !disclosureUrl ||
    typeof o["mdl"] !== "number" ||
    typeof o["year"] !== "number" ||
    typeof o["line"] !== "number" ||
    !str(o["investment"]) ||
    !str(o["company"]) ||
    !str(o["judge"])
  )
    return null;
  return {
    id,
    nid: str(o["nid"]) ?? "",
    judge: str(o["judge"])!,
    profileId: str(o["judge_profile_id"]),
    mdl: o["mdl"] as number,
    mdlTitle: str(o["mdl_title"]) ?? "",
    company: str(o["company"])!,
    evidenceKind: str(o["evidence_kind"]) ?? "not_recorded",
    evidenceLabel: str(o["evidence_label"]) ?? "Evidence not recorded",
    evidenceUrl: safeUrl(o["evidence_url"]),
    investment: str(o["investment"])!,
    year: o["year"] as number,
    line: o["line"] as number,
    linesInReport: num(o["lines_in_report"]),
    page: num(o["page"]),
    disclosureUrl,
    grossValue: str(o["gross_value"]),
    tier: o["tier"] === "near_match" ? "near_match" : "match",
    rule: str(o["rule"]) ?? "Rule not recorded",
    label:
      str(o["label"]) ??
      (o["tier"] === "near_match"
        ? "Near match — review"
        : "Requires review — disclosure name match, not a finding"),
  };
}

function toDisclosureSummary(v: unknown): DisclosureSummary | null {
  const o = obj(v);
  if (!o) return null;
  return {
    clBulkDate: str(o["cl_bulk_date"]),
    judgesTargeted: int(o["judges_targeted"]),
    status: counts(o["status"]),
    matches: int(o["matches"]),
    nearMatches: int(o["near_matches"]),
    judgesWithMatches: int(o["judges_with_matches"]),
    partiesNotCompared: counts(o["parties_not_compared"]),
    secLinksUsed: o["sec_links_used"] === true,
    label: str(o["label"]) ?? "Requires review — disclosure name match, not a finding",
    latestYears: counts(o["latest_year_distribution"]),
    yearsPerJudge: num(o["years_per_judge"]),
  };
}

type Row = { id: string; item: Json | null };
let cache: { at: number; value: JudgeCrossAnalytics } | null = null;
const TTL_MS = 10 * 60 * 1000;

export const getJudgeCrossAnalytics = createServerFn({ method: "GET" }).handler(
  async (): Promise<JudgeCrossAnalytics | null> => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    const [profiles, national, disclosures] = await Promise.all([
      restGet<Row[]>(
        `corpus_records?select=id,item:item->summary&dataset=eq.judge_cross_profiles&id=eq.${encodeURIComponent("summary:overview")}&limit=1`,
      ),
      restGet<Row[]>(
        `corpus_records?select=id,item:item->national&dataset=eq.judge_cross_districts&id=eq.${encodeURIComponent("summary:national")}&limit=1`,
      ),
      restGet<Row[]>(
        `corpus_records?select=id,item&dataset=eq.judge_cross_disclosure_matches&order=ordinal.asc&limit=2000`,
      ),
    ]);
    const summary = toProfiles(profiles.rows[0]?.item);
    if (!summary) return null;
    const coverage: DisclosureCoverage[] = [];
    const matches: DisclosureMatch[] = [];
    let dsummary: DisclosureSummary | null = null;
    for (const r of disclosures.rows) {
      const item = r.item ?? {};
      if (item["kind"] === "coverage") {
        const c = toCoverage(item["coverage"]);
        if (c) coverage.push(c);
      } else if (item["kind"] === "match" || item["kind"] === "near_match") {
        const m = toMatch(r.id, item["match"]);
        if (m) matches.push(m);
      } else if (item["kind"] === "summary") dsummary = toDisclosureSummary(item["summary"]);
    }
    const value: JudgeCrossAnalytics = {
      profiles: summary,
      national: toNational(national.rows[0]?.item),
      disclosures: { summary: dsummary, coverage, matches },
    };
    cache = { at: Date.now(), value };
    return value;
  },
);

export type JudgePendingMdl = {
  mdl: number;
  title: string;
  type: string | null;
  pending: number;
  total: number;
  change12m: number | null;
  dateTransferred: string | null;
};
export type JudgeHistoricalMdl = {
  mdl: string;
  caption: string;
  district: string;
  year: number;
  actions: number;
  remanded: number | null;
  basis: string | null;
  shared: boolean;
  /** jpml_terminated_fy2025, or jpml_pending_exit (left the pending report after 2025-09-30). */
  source: string;
  dateClosed: string | null;
};
export type JudgeCrossProfile = {
  nid: string;
  name: string;
  asOf: string | null;
  status: string;
  years: number | null;
  pending: JudgePendingMdl[];
  pendingActions: number;
  sharePct: number | null;
  rank: number | null;
  historical: JudgeHistoricalMdl[];
  historicalActions: number;
  totalActions: number;
  coverage: DisclosureCoverage | null;
  matches: DisclosureMatch[];
};

function toCrossProfile(v: unknown): Omit<JudgeCrossProfile, "coverage" | "matches"> | null {
  const o = obj(v);
  const nid = str(o?.["nid"]);
  const name = str(o?.["name"]);
  if (!o || !nid || !name) return null;
  return {
    nid,
    name,
    asOf: str(o["as_of"]),
    status: str(o["status"]) ?? "Not recorded",
    years: num(o["years_since_commission"]),
    pending: arr(o["pending_mdls"])
      .map(obj)
      .filter((x): x is Json => !!x && typeof x["mdl"] === "number")
      .map((x) => ({
        mdl: x["mdl"] as number,
        title: str(x["title"]) ?? "",
        type: str(x["type"]),
        pending: int(x["pending"]),
        total: int(x["total"]),
        change12m: num(x["change_12m"]),
        dateTransferred: str(x["date_transferred"]),
      })),
    pendingActions: int(o["pending_actions"]),
    sharePct: num(o["pending_share_pct"]),
    rank: num(o["rank_pending_actions"]),
    historical: arr(o["historical_mdls"])
      .map(obj)
      .filter((x): x is Json => !!x && mdlLabel(x["mdl"]) !== null && typeof x["year"] === "number")
      .map((x) => ({
        mdl: mdlLabel(x["mdl"])!,
        caption: str(x["caption"]) ?? "",
        district: str(x["district"]) ?? "",
        year: x["year"] as number,
        actions: num(x["actions"]) ?? int(x["transferred"]) + int(x["filed"]),
        remanded: num(x["remanded"]),
        basis: str(x["basis"]),
        shared: x["shared"] === true,
        source: str(x["source"]) ?? "jpml_terminated_fy2025",
        dateClosed: str(x["date_closed"]),
      })),
    historicalActions: int(o["historical_actions"]),
    totalActions: int(o["total_actions_handled"]),
  };
}

const FJC_NID = /^[1-9][0-9]{0,11}$/;

/**
 * Fallback for cross profiles published without a judge_profile link (238 rows on 2026-10-27): the page's crosswalk
 * row gives its FJC nid; it is accepted only when exactly one crosswalk row carries that nid (so the nid maps 1:1 to this
 * judges id) and the cross profile with that id names the same nid and carries no judge_profile link of its own.
 */
async function profileByNid(id: string): Promise<{ row: Row; nid: string } | null> {
  const cw = await restGet<{ id: string; nid: unknown }[]>(
    `corpus_records?select=id,nid:item->profile->>fjc_nid&dataset=eq.judge_cl_crosswalk&id=eq.${id}&limit=2`,
  );
  const nid = cw.rows.length === 1 && cw.rows[0]!.id === id ? cw.rows[0]!.nid : null;
  if (typeof nid !== "string" || !FJC_NID.test(nid)) return null;
  const [owners, profile] = await Promise.all([
    restGet<{ id: string }[]>(
      `corpus_records?select=id&dataset=eq.judge_cl_crosswalk&item->profile->>fjc_nid=eq.${nid}&limit=2`,
    ),
    restGet<(Row & { filters: Json | null })[]>(
      `corpus_records?select=id,filters,item:item->cross&dataset=eq.judge_cross_profiles&id=eq.${nid}&limit=2`,
    ),
  ]);
  if (owners.rows.length !== 1 || owners.rows[0]!.id !== id) return null;
  if (profile.rows.length !== 1) return null;
  const row = profile.rows[0]!;
  if (arr(row.filters?.["judge_profile"]).length !== 0) return null;
  if (str(row.item?.["nid"]) !== nid) return null;
  return { row, nid };
}

/** Compact MDL experience for one judge page (judges dataset id). Ambiguous links show nothing. */
export const getJudgeCrossProfile = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^[a-z0-9]{8,64}$/) }).parse(d))
  .handler(async ({ data }): Promise<JudgeCrossProfile | null> => {
    const filter = encodeURIComponent(JSON.stringify({ judge_profile: [data.id] }));
    let [profile, disclosures] = await Promise.all([
      restGet<Row[]>(
        `corpus_records?select=id,item:item->cross&dataset=eq.judge_cross_profiles&filters=cs.${filter}&limit=2`,
      ),
      restGet<Row[]>(
        `corpus_records?select=id,item&dataset=eq.judge_cross_disclosure_matches&filters=cs.${filter}&limit=200`,
      ),
    ]);
    if (profile.rows.length === 0) {
      const byNid = await profileByNid(data.id);
      if (!byNid) return null;
      profile = { rows: [byNid.row], total: null };
      disclosures = await restGet<Row[]>(
        `corpus_records?select=id,item&dataset=eq.judge_cross_disclosure_matches&filters=cs.${encodeURIComponent(JSON.stringify({ judge: [byNid.nid] }))}&limit=200`,
      );
    }
    if (profile.rows.length !== 1) return null;
    const base = toCrossProfile(profile.rows[0]!.item);
    if (!base) return null;
    let coverage: DisclosureCoverage | null = null;
    const matches: DisclosureMatch[] = [];
    for (const r of disclosures.rows) {
      const item = r.item ?? {};
      if (item["kind"] === "coverage") coverage = toCoverage(item["coverage"]);
      else if (item["kind"] === "match" || item["kind"] === "near_match") {
        const m = toMatch(r.id, item["match"]);
        if (m && m.nid === base.nid) matches.push(m);
      }
    }
    return { ...base, coverage: coverage?.nid === base.nid ? coverage : null, matches };
  });
