/**
 * CourtListener collection statistics for one court (clb_court_profiles) and the federal district
 * "at a glance" cross-source view (clb_district_crossview). Both are compiled by
 * scripts/enrichment/courtlistener from CourtListener's bulk files (snapshot in each dataset's summary).
 *
 * The figures describe CourtListener's collection, not complete court totals. A docket row can be created
 * from an opinion (`opinionSourceDockets`), in which case the docket count is not a count of cases filed.
 * Stored JSON is validated here; malformed rows and links are dropped, never repaired. A section the
 * builder has not filled yet (`opinions`, `citations`) is not read at all.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
/** A non-negative whole number (a count of rows). */
const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
/** A percentage between 0 and 100. */
const pct = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => {
  const s = str(v);
  return s && ISO_DAY.test(s) ? s : null;
};
const year = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 1000 && n <= 2100 ? n : null;
};

export const COURT_ID = /^[A-Za-z0-9]{2,24}$/;
const CL = "https://www.courtlistener.com";

/** A labelled share of some stated denominator (the denominator is named where it is shown). */
export type ClbShare = { value: string; label: string; count: number; sharePct: number | null };

export type ClbSource = {
  /** CourtListener's source bit mask (1 RECAP, 2 scraper, 4 Columbia, 8 FJC IDB, 16 Harvard). */
  mask: number;
  flags: string[];
  count: number;
  sharePct: number | null;
};

export type ClbDocketYear = {
  yr: number;
  dockets: number;
  /** Docket numbers with the civil case type (-cv-). */
  civil: number;
  /** Docket numbers with the criminal case type (-cr-). */
  criminal: number;
  recap: number;
  /** Dockets filed that year that carry a termination date. */
  terminated: number;
};

export type ClbDuration = { n: number; p25: number; median: number; p75: number; p90: number };

export type ClbJudge = {
  personId: number;
  name: string;
  dockets: number;
  terminated: number | null;
  firstFiled: string | null;
  lastFiled: string | null;
  /** Root-relative cl_people record, only when it names exactly this person id. */
  record: string | null;
  /** Root-relative clb_judge_dockets record, only after an exact id lookup found it. */
  statsRecord: string | null;
};

export type ClbAppealOrigin = {
  courtId: string;
  name: string;
  dockets: number;
  sharePct: number | null;
  /** `/courts/<id>` only when the stored link names exactly this court id. */
  link: string | null;
};

export type ClbDockets = {
  total: number;
  dated: number | null;
  noFiledDate: number | null;
  implausibleFiled: number | null;
  firstFiled: string | null;
  lastFiled: string | null;
  terminated: number | null;
  /** Share of dated dockets that carry a termination date. */
  terminatedPct: number | null;
  recap: number | null;
  recapPct: number | null;
  withAssignedJudge: number | null;
  withAssignedPct: number | null;
  withAppealFrom: number | null;
  byYear: ClbDocketYear[];
  sources: ClbSource[];
  /** Dockets with any nature-of-suit entry; the denominator of the NOS shares. */
  nosRecorded: number | null;
  nosGroups: ClbShare[];
  topNos: ClbShare[];
  /** Dockets with a cause entry; the denominator of the cause shares. */
  withCause: number | null;
  topCauses: ClbShare[];
  durationCivil: ClbDuration | null;
  durationAll: ClbDuration | null;
  judgesAssigned: ClbJudge[];
  judgesReferred: ClbJudge[];
  appealFrom: ClbAppealOrigin[];
};

export type ClbClusterYear = { yr: number; clusters: number; cited: number; citeTotal: number };

export type ClbTopCited = {
  clusterId: number;
  caseName: string | null;
  dateFiled: string | null;
  timesCited: number;
  /** https://www.courtlistener.com/opinion/<cluster id>/ only when it names exactly this cluster. */
  url: string | null;
};

export type ClbScotusYear = {
  yr: number;
  clusters: number;
  /** Clusters linked to a Supreme Court Database record. */
  scdb: number;
  withVotes: number;
  unanimous: number;
  fiveFour: number;
};

export type ClbClusters = {
  total: number;
  dated: number | null;
  firstFiled: string | null;
  lastFiled: string | null;
  byYear: ClbClusterYear[];
  /** Mix of the cluster precedential status; shares are of all clusters. */
  precedential: ClbShare[];
  cited: number | null;
  citedPct: number | null;
  citeTotal: number | null;
  citeMax: number | null;
  citeMedianAmongCited: number | null;
  citeP90AmongCited: number | null;
  topCited: ClbTopCited[];
  /** Reporter citations on file; shares are of all reporter citation rows, a cluster can carry several. */
  reporters: ClbShare[];
  withReporterCite: number | null;
  withReporterCitePct: number | null;
  withScdb: number | null;
  scotusByYear: ClbScotusYear[];
};

export type ClbOral = {
  total: number;
  dockets: number | null;
  /** Dates the recordings were created in CourtListener, not the argument dates. */
  firstCreated: string | null;
  lastCreated: string | null;
  medianMinutes: number | null;
  totalHours: number | null;
  withTranscript: number | null;
  /** Recordings by the year they were created in CourtListener. */
  byYear: { yr: number; n: number }[];
};

export type ClbCoverageYear = {
  fy: number;
  clCivilDockets: number;
  fjcFilings: number;
  ratio: number;
};

export type ClbCoverage = {
  byFy: ClbCoverageYear[];
  latestCompleteFy: number | null;
  latestRatio: number | null;
  medianRatioLast10Fy: number | null;
};

export type ClbBench = {
  positions: number;
  /** Positions with no recorded end date. */
  active: number | null;
  persons: number | null;
  womenActivePct: number | null;
  medianTenureYearsEnded: number | null;
};

export type ClbCourtProfile = {
  courtId: string;
  name: string;
  shortName: string | null;
  level: string | null;
  state: string | null;
  /** true: docket rows were created from opinions, so the docket count is not a count of cases filed. */
  opinionSourceDockets: boolean;
  dockets: ClbDockets | null;
  clusters: ClbClusters | null;
  oral: ClbOral | null;
  coverage: ClbCoverage | null;
  bench: ClbBench | null;
};

export type ClbMethod = {
  snapshot: string | null;
  caveats: string[];
  definitions: { term: string; text: string }[];
  metrics: { key: string; label: string; unit: string; source: string; period: string }[];
};

export type ClbCourtCollection = {
  profile: ClbCourtProfile;
  /** CourtListener's own court page, from the record's stored links. */
  courtPageUrl: string | null;
  method: ClbMethod | null;
};

// ---------------------------------------------------------------------------------------------------
// Parsers (pure; exported for tests)
// ---------------------------------------------------------------------------------------------------

export function parseShares(raw: unknown): ClbShare[] {
  return arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const n = count(r?.["count"]);
    const value = r?.["value"];
    const label = str(r?.["label"]) ?? (typeof value === "number" ? String(value) : str(value));
    if (!r || n == null || !label) return [];
    return [
      {
        value: typeof value === "string" || typeof value === "number" ? String(value) : label,
        label,
        count: n,
        sharePct: pct(r["share_pct"]),
      },
    ];
  });
}

export function parseSources(raw: unknown): ClbSource[] {
  return arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const mask = count(r?.["value"]);
    const n = count(r?.["count"]);
    if (!r || mask == null || n == null) return [];
    const flags = arr(r["flags"]).flatMap((f) => (typeof f === "string" && f.trim() ? [f] : []));
    return [{ mask, flags, count: n, sharePct: pct(r["share_pct"]) }];
  });
}

export function parseDocketYears(raw: unknown): ClbDocketYear[] {
  const out = arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const yr = year(r?.["yr"]);
    const dockets = count(r?.["dockets"]);
    const civil = count(r?.["civil"]);
    const criminal = count(r?.["criminal"]);
    const recap = count(r?.["recap"]);
    const terminated = count(r?.["terminated"]);
    if (!r || yr == null || dockets == null) return [];
    if (civil == null || criminal == null || recap == null || terminated == null) return [];
    // A split that exceeds the year's total is not a valid row; it is dropped rather than clamped.
    if (civil + criminal > dockets || recap > dockets || terminated > dockets) return [];
    return [{ yr, dockets, civil, criminal, recap, terminated }];
  });
  return out.sort((a, b) => a.yr - b.yr);
}

export function parseDuration(raw: unknown): ClbDuration | null {
  const r = obj(raw);
  const n = count(r?.["n"]);
  const p25 = num(r?.["p25_days"]);
  const median = num(r?.["median_days"]);
  const p75 = num(r?.["p75_days"]);
  const p90 = num(r?.["p90_days"]);
  if (!r || n == null || p25 == null || median == null || p75 == null || p90 == null) return null;
  // The builder publishes a duration only from 30 dockets; the percentiles must be ordered.
  if (n < 30 || p25 < 0 || !(p25 <= median && median <= p75 && p75 <= p90)) return null;
  return { n, p25, median, p75, p90 };
}

const PERSON_RECORD = /^\/records\/cl_people\/(cl:people:(\d+))$/;

export function parseJudges(raw: unknown, assigned: boolean): ClbJudge[] {
  return arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const personId = count(r?.["person_id"]);
    const name = str(r?.["name"]);
    const dockets = count(r?.["dockets"]);
    if (!r || personId == null || personId <= 0 || !name || dockets == null) return [];
    const record = str(r["record"]);
    const m = record ? PERSON_RECORD.exec(record) : null;
    return [
      {
        personId,
        name,
        dockets,
        terminated: assigned ? count(r["terminated"]) : null,
        firstFiled: assigned ? day(r["first_filed"]) : null,
        lastFiled: assigned ? day(r["last_filed"]) : null,
        // Only a record that names exactly this person id is a link; a name is never matched.
        record: m && Number(m[2]) === personId ? record : null,
        statsRecord: null,
      },
    ];
  });
}

export function parseAppealOrigins(raw: unknown): ClbAppealOrigin[] {
  return arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const courtId = str(r?.["court_id"]);
    const name = str(r?.["name"]) ?? courtId;
    const dockets = count(r?.["dockets"]);
    if (!r || !courtId || !name || dockets == null) return [];
    const link = str(r["link"]);
    return [
      {
        courtId,
        name,
        dockets,
        sharePct: pct(r["share_pct"]),
        link: link && COURT_ID.test(courtId) && link === `/courts/${courtId}` ? link : null,
      },
    ];
  });
}

export function parseDockets(raw: unknown): ClbDockets | null {
  const d = obj(raw);
  const total = count(d?.["total"]);
  if (!d || total == null) return null;
  const duration = obj(d["duration"]);
  return {
    total,
    dated: count(d["dated"]),
    noFiledDate: count(d["no_filed_date"]),
    implausibleFiled: count(d["implausible_filed"]),
    firstFiled: day(d["first_filed"]),
    lastFiled: day(d["last_filed"]),
    terminated: count(d["terminated"]),
    terminatedPct: pct(d["terminated_pct"]),
    recap: count(d["recap"]),
    recapPct: pct(d["recap_pct"]),
    withAssignedJudge: count(d["with_assigned_judge"]),
    withAssignedPct: pct(d["with_assigned_pct"]),
    withAppealFrom: count(d["with_appeal_from"]),
    byYear: parseDocketYears(d["by_year"]),
    sources: parseSources(d["sources"]),
    nosRecorded: count(d["nos_recorded"]),
    nosGroups: parseShares(d["nos_groups"]),
    topNos: parseShares(d["top_nos"]),
    withCause: count(d["with_cause"]),
    topCauses: parseShares(d["top_causes"]),
    durationCivil: parseDuration(duration?.["civil"]),
    durationAll: parseDuration(duration?.["all"]),
    judgesAssigned: parseJudges(d["judges_assigned"], true),
    judgesReferred: parseJudges(d["judges_referred"], false),
    appealFrom: parseAppealOrigins(d["appeal_from"]),
  };
}

export function parseClusterYears(raw: unknown): ClbClusterYear[] {
  const out = arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const yr = year(r?.["yr"]);
    const clusters = count(r?.["clusters"]);
    const cited = count(r?.["cited"]);
    const citeTotal = count(r?.["cite_total"]);
    if (!r || yr == null || clusters == null || cited == null || citeTotal == null) return [];
    if (cited > clusters) return [];
    return [{ yr, clusters, cited, citeTotal }];
  });
  return out.sort((a, b) => a.yr - b.yr);
}

export function parseTopCited(raw: unknown): ClbTopCited[] {
  return arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const clusterId = count(r?.["cluster_id"]);
    const timesCited = count(r?.["times_cited"]);
    if (!r || clusterId == null || timesCited == null) return [];
    const url = str(r["url"]);
    return [
      {
        clusterId,
        caseName: str(r["case_name"]),
        dateFiled: day(r["date_filed"]),
        timesCited,
        url: url === `${CL}/opinion/${clusterId}/` ? url : null,
      },
    ];
  });
}

export function parseScotusYears(raw: unknown): ClbScotusYear[] {
  const out = arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const yr = year(r?.["yr"]);
    const clusters = count(r?.["clusters"]);
    const scdb = count(r?.["scdb"]);
    const withVotes = count(r?.["with_votes"]);
    const unanimous = count(r?.["unanimous"]);
    const fiveFour = count(r?.["five_four"]);
    if (!r || yr == null || clusters == null || scdb == null || withVotes == null) return [];
    if (unanimous == null || fiveFour == null) return [];
    if (scdb > clusters || withVotes > scdb || unanimous + fiveFour > withVotes) return [];
    return [{ yr, clusters, scdb, withVotes, unanimous, fiveFour }];
  });
  return out.sort((a, b) => a.yr - b.yr);
}

export function parseClusters(raw: unknown): ClbClusters | null {
  const c = obj(raw);
  const total = count(c?.["total"]);
  if (!c || total == null) return null;
  return {
    total,
    dated: count(c["dated"]),
    firstFiled: day(c["first_filed"]),
    lastFiled: day(c["last_filed"]),
    byYear: parseClusterYears(c["by_year"]),
    precedential: parseShares(c["precedential"]),
    cited: count(c["cited"]),
    citedPct: pct(c["cited_pct"]),
    citeTotal: count(c["cite_total"]),
    citeMax: count(c["cite_max"]),
    citeMedianAmongCited: num(c["cite_median_among_cited"]),
    citeP90AmongCited: num(c["cite_p90_among_cited"]),
    topCited: parseTopCited(c["top_cited"]),
    reporters: parseShares(c["reporters"]),
    withReporterCite: count(c["with_reporter_cite"]),
    withReporterCitePct: pct(c["with_reporter_cite_pct"]),
    withScdb: count(c["with_scdb"]),
    scotusByYear: parseScotusYears(c["scotus_by_year"]),
  };
}

export function parseOral(raw: unknown): ClbOral | null {
  const o = obj(raw);
  const total = count(o?.["total"]);
  if (!o || total == null) return null;
  const withTranscript = count(o["with_transcript"]);
  const median = num(o["median_minutes"]);
  const hours = num(o["total_hours"]);
  const byYear = arr(o["by_year"])
    .flatMap((entry) => {
      const r = obj(entry);
      const yr = year(r?.["yr"]);
      const n = count(r?.["n"]);
      return r && yr != null && n != null ? [{ yr, n }] : [];
    })
    .sort((a, b) => a.yr - b.yr);
  return {
    total,
    dockets: count(o["dockets"]),
    firstCreated: day(o["first_created"]),
    lastCreated: day(o["last_created"]),
    medianMinutes: median != null && median > 0 ? median : null,
    totalHours: hours != null && hours >= 0 ? hours : null,
    withTranscript: withTranscript != null && withTranscript <= total ? withTranscript : null,
    byYear,
  };
}

export function parseCoverage(raw: unknown): ClbCoverage | null {
  const c = obj(raw);
  if (!c) return null;
  const byFy = arr(c["by_fy"])
    .flatMap((entry) => {
      const r = obj(entry);
      const fy = year(r?.["fy"]);
      const clCivilDockets = count(r?.["cl_civil_dockets"]);
      const fjcFilings = count(r?.["fjc_filings"]);
      const ratio = num(r?.["cl_to_fjc_ratio"]);
      if (!r || fy == null || clCivilDockets == null || fjcFilings == null || ratio == null)
        return [];
      // The stored ratio must be the stored quotient (rounded to three places); otherwise drop the year.
      if (fjcFilings <= 0 || Math.abs(clCivilDockets / fjcFilings - ratio) > 0.002) return [];
      return [{ fy, clCivilDockets, fjcFilings, ratio }];
    })
    .sort((a, b) => a.fy - b.fy);
  if (!byFy.length) return null;
  return {
    byFy,
    latestCompleteFy: year(c["latest_complete_fy"]),
    latestRatio: num(c["latest_ratio"]),
    medianRatioLast10Fy: num(c["median_ratio_last_10_fy"]),
  };
}

export function parseBench(raw: unknown): ClbBench | null {
  const b = obj(raw);
  const positions = count(b?.["positions"]);
  if (!b || positions == null) return null;
  const tenure = num(b["median_tenure_years_ended"]);
  return {
    positions,
    active: count(b["active"]),
    persons: count(b["persons"]),
    womenActivePct: pct(b["women_active_pct"]),
    medianTenureYearsEnded: tenure != null && tenure >= 0 ? tenure : null,
  };
}

/** The profile payload of one clb_court_profiles record; null when its identity is missing. */
export function parseClbCourtProfile(raw: unknown): ClbCourtProfile | null {
  const p = obj(raw);
  const courtId = str(p?.["court_id"]);
  const name = str(p?.["name"]);
  if (!p || !courtId || !name) return null;
  return {
    courtId,
    name,
    shortName: str(p["short_name"]),
    level: str(p["level"]),
    state: str(p["state"]),
    opinionSourceDockets: p["opinion_source_dockets"] === true,
    dockets: parseDockets(p["dockets"]),
    clusters: parseClusters(p["clusters"]),
    oral: parseOral(p["oral_arguments"]),
    coverage: parseCoverage(p["fjc_coverage"]),
    bench: parseBench(p["bench"]),
  };
}

/** Adds the clb_judge_dockets record link for exactly those person ids that an id lookup found. */
export function withJudgeStats(
  profile: ClbCourtProfile,
  found: ReadonlySet<number>,
): ClbCourtProfile {
  if (!profile.dockets || !found.size) return profile;
  const link = (j: ClbJudge): ClbJudge =>
    found.has(j.personId) ? { ...j, statsRecord: `/records/clb_judge_dockets/${j.personId}` } : j;
  return {
    ...profile,
    dockets: {
      ...profile.dockets,
      judgesAssigned: profile.dockets.judgesAssigned.map(link),
      judgesReferred: profile.dockets.judgesReferred.map(link),
    },
  };
}

/** The dataset's stored method block: snapshot, caveats, definitions and (cross view) measure definitions. */
export function parseClbMethod(raw: unknown): ClbMethod | null {
  const s = obj(raw);
  if (!s) return null;
  const definitions = Object.entries(obj(s["definitions"]) ?? {}).flatMap(([term, text]) =>
    typeof text === "string" && text.trim() ? [{ term, text }] : [],
  );
  const metrics = arr(s["metrics"]).flatMap((entry) => {
    const r = obj(entry);
    const key = str(r?.["key"]);
    const label = str(r?.["label"]);
    const unit = str(r?.["unit"]);
    const source = str(r?.["source"]);
    const period = str(r?.["period"]);
    return key && label && unit && source && period ? [{ key, label, unit, source, period }] : [];
  });
  return {
    snapshot: day(s["snapshot"]),
    caveats: arr(s["caveats"]).flatMap((c) => (typeof c === "string" && c.trim() ? [c] : [])),
    definitions,
    metrics,
  };
}

export function parseCourtPageUrl(links: unknown, courtId: string): string | null {
  for (const entry of arr(links)) {
    const r = obj(entry);
    if (str(r?.["url"]) === `${CL}/court/${courtId}/`) return `${CL}/court/${courtId}/`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// District cross-source view
// ---------------------------------------------------------------------------------------------------

export type GlanceMeasure = {
  key: string;
  label: string;
  unit: string;
  source: string;
  period: string;
  /** null: the district's record carries no value for this measure ("Not recorded"). */
  value: number | null;
  /** Rank among the districts that have the measure, 1 = highest value. */
  rank: { position: number; of: number } | null;
};

export type GlanceAgreement = {
  id: string;
  a: { key: string; label: string; source: string; period: string };
  b: { key: string; label: string; source: string; period: string };
  rho: number;
  n: number;
  ciLow: number;
  ciHigh: number;
  strength: string | null;
  why: string | null;
};

export type DistrictGlance = {
  courtId: string;
  name: string | null;
  measures: GlanceMeasure[];
  agreement: GlanceAgreement[];
  snapshot: string | null;
  caveats: string[];
};

function metricRef(raw: unknown) {
  const r = obj(raw);
  const key = str(r?.["key"]);
  const label = str(r?.["label"]);
  const source = str(r?.["source"]);
  const period = str(r?.["period"]);
  return key && label && source && period ? { key, label, source, period } : null;
}

export function parseGlanceMeasures(raw: unknown, defs: ClbMethod["metrics"]): GlanceMeasure[] {
  const present = new Map<string, GlanceMeasure>();
  for (const entry of arr(raw)) {
    const r = obj(entry);
    const ref = metricRef(r);
    const unit = str(r?.["unit"]);
    if (!r || !ref || !unit) continue;
    const value = num(r["value"]);
    const rk = arr(r["rank"]);
    const position = count(rk[0]);
    const of = count(rk[1]);
    const rank =
      value != null && position != null && of != null && position >= 1 && position <= of
        ? { position, of }
        : null;
    present.set(ref.key, { ...ref, unit, value, rank });
  }
  // The measures the dataset defines come first, in its order; a defined measure the record lacks is
  // listed as not recorded, never dropped or filled.
  const ordered: GlanceMeasure[] = [];
  for (const def of defs) {
    ordered.push(present.get(def.key) ?? { ...def, value: null, rank: null });
    present.delete(def.key);
  }
  return [...ordered, ...present.values()];
}

export function parseGlanceAgreement(
  rows: { id?: unknown; c?: unknown; a?: unknown; b?: unknown }[],
): GlanceAgreement[] {
  return rows.flatMap((row) => {
    const id = str(row.id);
    const c = obj(row.c);
    const a = metricRef(row.a);
    const b = metricRef(row.b);
    const rho = num(c?.["rho"]);
    const n = count(c?.["n"]);
    const ciLow = num(c?.["ci_low"]);
    const ciHigh = num(c?.["ci_high"]);
    if (!id || !c || !a || !b || rho == null || n == null || ciLow == null || ciHigh == null)
      return [];
    if (c["role"] !== "validity" || n < 4 || rho < -1 || rho > 1) return [];
    // The stored interval must contain the stored estimate (to the three places it is rounded to).
    if (ciLow > rho + 0.0006 || ciHigh < rho - 0.0006) return [];
    // The pair keys in the record id must be the keys of the metrics shown.
    if (id !== `corr:${a.key}|${b.key}`) return [];
    return [{ id, a, b, rho, n, ciLow, ciHigh, strength: str(c["strength"]), why: str(c["why"]) }];
  });
}

export function parseDistrictGlance(input: {
  courtId: string;
  name: unknown;
  metrics: unknown;
  method: ClbMethod | null;
  agreement: GlanceAgreement[];
}): DistrictGlance | null {
  const measures = parseGlanceMeasures(input.metrics, input.method?.metrics ?? []);
  if (!measures.some((m) => m.value != null)) return null;
  return {
    courtId: input.courtId,
    name: str(input.name),
    measures,
    agreement: input.agreement,
    snapshot: input.method?.snapshot ?? null,
    caveats: input.method?.caveats ?? [],
  };
}

// ---------------------------------------------------------------------------------------------------
// Server reads (read-only; 10-minute memo)
// ---------------------------------------------------------------------------------------------------

const TTL = 10 * 60 * 1000;
const MAX_ENTRIES = 400;
type Entry<T> = { at: number; value: T };

async function memo<T>(
  store: Map<string, Entry<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load();
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, { at: Date.now(), value });
  return value;
}

const methodCache = new Map<string, Entry<ClbMethod | null>>();
const collectionCache = new Map<string, Entry<ClbCourtCollection | null>>();
const glanceCache = new Map<string, Entry<DistrictGlance | null>>();
const agreementCache = new Map<string, Entry<GlanceAgreement[]>>();

/** A dataset's method block. A failed read leaves the panel without it (not cached), never without data. */
async function loadMethod(dataset: string): Promise<ClbMethod | null> {
  const hit = methodCache.get(dataset);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  try {
    const r = await restGet<{ s: unknown }[]>(
      `corpus_datasets?select=s:metadata->summary&id=eq.${encodeURIComponent(dataset)}&limit=1`,
    );
    const value = parseClbMethod(r.rows[0]?.s);
    methodCache.set(dataset, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

/** Which of these person ids have a clb_judge_dockets record (exact id lookup; failure means no link). */
async function judgeStatsFound(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  try {
    const r = await restGet<{ id: unknown }[]>(
      `corpus_records?select=id&dataset=eq.clb_judge_dockets&id=in.(${ids.join(",")})&limit=${ids.length}`,
    );
    return new Set(
      r.rows.flatMap((row) => {
        const n = typeof row.id === "string" && /^\d+$/.test(row.id) ? Number(row.id) : null;
        return n != null && ids.includes(n) ? [n] : [];
      }),
    );
  } catch {
    return new Set();
  }
}

export const getClbCourtCollection = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<ClbCourtCollection | null> => {
    return memo(collectionCache, data.id, async () => {
      const [rec, method] = await Promise.all([
        restGet<{ p: unknown; l: unknown }[]>(
          `corpus_records?select=p:item->profile,l:item->links&dataset=eq.clb_court_profiles&id=eq.${encodeURIComponent(data.id)}&limit=1`,
        ),
        loadMethod("clb_court_profiles"),
      ]);
      const row = rec.rows[0];
      const parsed = row ? parseClbCourtProfile(row.p) : null;
      // The record id and the profile's own court id must agree before anything is shown.
      if (!parsed || parsed.courtId !== data.id) return null;
      const ids = [
        ...(parsed.dockets?.judgesAssigned ?? []),
        ...(parsed.dockets?.judgesReferred ?? []),
      ].map((j) => j.personId);
      const found = await judgeStatsFound([...new Set(ids)]);
      return {
        profile: withJudgeStats(parsed, found),
        courtPageUrl: parseCourtPageUrl(row?.l, data.id),
        method,
      };
    });
  });

/** The five validity pairs (same concept in two sources); district-independent. */
function loadAgreement(): Promise<GlanceAgreement[]> {
  return memo(agreementCache, "validity", async () => {
    const r = await restGet<{ id: unknown; c: unknown; a: unknown; b: unknown }[]>(
      "corpus_records?select=id,c:item->profile->correlation,a:item->profile->a,b:item->profile->b&dataset=eq.clb_district_crossview&id=like.corr:*&order=ordinal.asc",
    );
    return parseGlanceAgreement(r.rows);
  });
}

export const getClbDistrictGlance = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<DistrictGlance | null> => {
    return memo(glanceCache, data.id, async () => {
      const rec = await restGet<{ p: unknown }[]>(
        `corpus_records?select=p:item->profile&dataset=eq.clb_district_crossview&id=eq.${encodeURIComponent(data.id)}&limit=1`,
      );
      const profile = obj(rec.rows[0]?.p);
      // The record id and the profile's own court id must agree before anything is shown.
      if (!profile || profile["court_id"] !== data.id) return null;
      const [method, agreement] = await Promise.all([
        loadMethod("clb_district_crossview"),
        loadAgreement(),
      ]);
      return parseDistrictGlance({
        courtId: data.id,
        name: profile["name"],
        metrics: profile["metrics"],
        method,
        agreement,
      });
    });
  });
