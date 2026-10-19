/**
 * CourtListener collection analytics for /courts/collection, read from six published corpus datasets compiled by
 * scripts/enrichment/courtlistener from CourtListener's bulk files (snapshot in each dataset's summary):
 * clb_docket_master (dockets by year, court level, state, case type, nature of suit and cause), clb_court_flows
 * (citation and appeal flows between courts), clb_top_cited (the 1,000 most-cited opinion clusters),
 * clb_disclosure_coverage (financial-disclosure report counts), clb_bulk_schema (the published database schema and which
 * tables have a public bulk file) and clb_district_crossview (rank correlations across districts).
 *
 * Everything here counts rows in CourtListener's collection. It is not a complete count of court filings, and the
 * citation map is CourtListener's extraction from opinion text, not a census of citations. Disclosure data is counts only.
 *
 * Stored JSON is validated here. A record that cannot be read is dropped, never repaired, and the number dropped is
 * returned so the page can say so. Counts are non-negative whole numbers, shares are 0-100, and every unknown value is
 * null (the page shows "Not recorded"). A court is linked to /courts/<id> only when the record's own link says so.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Listed } from "./courtCaseload.functions";
import { restGet } from "./rest.server";

export type { Listed };

// ---------------------------------------------------------------------------------------------- primitives

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A non-negative whole number (a count of rows). */
const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
/** A percentage between 0 and 100. */
const pctOf = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
/** A non-negative number that need not be whole (years between opinions, pages). */
const nonNeg = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date written YYYY-MM-DD, or null. */
export function isoDay(v: unknown): string | null {
  const s = str(v);
  if (!s || !ISO_DAY.test(s)) return null;
  const t = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s ? null : s;
}
const wholeYear = (v: unknown, min = 1000, max = 2100) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
/** a, or null when it exceeds the whole it is a part of. */
const atMost = (a: number | null, whole: number) => (a != null && a <= whole ? a : null);
const shareOfPct = (part: number | null, whole: number | null) =>
  part != null && whole != null && whole > 0 ? (100 * part) / whole : null;

/**
 * Federal, State and Other counts of a record whose groups partition `whole`. A group the record leaves out is 0
 * only when the groups it does have add up to the whole; otherwise it is unknown (null), never assumed.
 */
export function groupCounts(raw: unknown, whole: number | null) {
  const g = obj(raw);
  const f = count(g?.["Federal"]);
  const st = count(g?.["State"]);
  const o = count(g?.["Other"]);
  const complete = whole != null && (f ?? 0) + (st ?? 0) + (o ?? 0) === whole;
  const fill = (n: number | null) => n ?? (complete ? 0 : null);
  return { federal: fill(f), state: fill(st), other: fill(o) };
}

export const COURT_ID = /^[A-Za-z0-9]{2,24}$/;

/** `/courts/<id>` only when `link` is exactly that path for this exact court id. */
export function courtHref(id: string | null, link: unknown): string | null {
  return id && COURT_ID.test(id) && link === `/courts/${id}` ? `/courts/${id}` : null;
}

/** `/courts/<id>` only when one of the record's links is exactly that path. */
export function courtHrefIn(id: string | null, links: readonly unknown[]): string | null {
  return id && links.some((l) => courtHref(id, l)) ? `/courts/${id}` : null;
}

/** The snapshot's year is a partial year unless the snapshot is the last day of it. */
export function isPartialYear(year: number, snapshot: string | null): boolean {
  if (!snapshot) return false;
  return year === Number(snapshot.slice(0, 4)) && !snapshot.endsWith("-12-31");
}

function parseList<S, T>(rows: readonly S[], total: number | null, one: (row: S) => T | null) {
  const out: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = one(row);
    if (parsed) out.push(parsed);
    else dropped += 1;
  }
  return { rows: out, total, dropped } satisfies Listed<T>;
}

/** Keeps the first record of each key; a repeated key is dropped, not merged. */
function dedupe<T>(rows: Listed<T>, key: (row: T) => string): Listed<T> {
  const seen = new Set<string>();
  const out: T[] = [];
  let dropped = rows.dropped;
  for (const row of rows.rows) {
    const k = key(row);
    if (seen.has(k)) dropped += 1;
    else {
      seen.add(k);
      out.push(row);
    }
  }
  return { rows: out, total: rows.total, dropped };
}

// ---------------------------------------------------------------------------------------------- shared shapes

/** A court with a count in some record's list (dockets, citation links), with its share where the record gives one. */
export type CourtCount = {
  courtId: string;
  name: string;
  count: number;
  sharePct: number | null;
  /** `/courts/<id>` only when the record's own link names exactly this court. */
  href: string | null;
};

function parseCourtCounts(raw: unknown, countKey: "dockets" | "count"): CourtCount[] {
  return arr(raw).flatMap((entry) => {
    const r = obj(entry);
    const courtId = str(r?.["court_id"]);
    const name = str(r?.["name"]);
    const n = count(r?.[countKey]);
    if (!r || !courtId || !COURT_ID.test(courtId) || !name || n == null) return [];
    return [
      {
        courtId,
        name,
        count: n,
        sharePct: pctOf(r["share_pct"]),
        href: courtHref(courtId, r["link"]),
      },
    ];
  });
}

export type ClbNote = {
  dataset: string;
  /** ISO date of the bulk files the figures were compiled from. */
  snapshot: string | null;
  source: string | null;
  terms: string | null;
  caveats: string[];
  definitions: { term: string; text: string }[];
};

export type SchemaNote = ClbNote & {
  /** The dataset's own statement of what the bulk files do not contain, and the tables it names. */
  notInBulk: { statement: string; tables: string[] } | null;
  loadStatus: { label: string; count: number }[];
  totals: {
    tables: number | null;
    tablesWithBulk: number | null;
    tablesWithoutBulk: number | null;
    columns: number | null;
    columnsWithDescription: number | null;
    foreignKeys: number | null;
  } | null;
};

export type ClbNotes = {
  docket: ClbNote | null;
  flows: ClbNote | null;
  topCited: ClbNote | null;
  disclosures: ClbNote | null;
  schema: SchemaNote | null;
  crossview: ClbNote | null;
};

export function parseNote(dataset: string, raw: unknown): ClbNote | null {
  const s = obj(raw);
  if (!s) return null;
  return {
    dataset,
    snapshot: isoDay(s["snapshot"]),
    source: str(s["source"]),
    terms: str(s["terms"]),
    caveats: arr(s["caveats"]).flatMap((c) => (str(c) ? [c as string] : [])),
    definitions: Object.entries(obj(s["definitions"]) ?? {}).flatMap(([term, text]) =>
      str(text) ? [{ term, text: text as string }] : [],
    ),
  };
}

export function parseSchemaNote(raw: unknown): SchemaNote | null {
  const base = parseNote("clb_bulk_schema", raw);
  const s = obj(raw);
  if (!base || !s) return null;
  const nb = obj(s["not_in_bulk"]);
  const statement = str(nb?.["statement"]);
  const t = obj(s["totals"]);
  return {
    ...base,
    notInBulk: statement
      ? {
          statement,
          tables: arr(nb?.["tables"]).flatMap((x) => (str(x) ? [x as string] : [])),
        }
      : null,
    loadStatus: Object.entries(obj(s["load_status"]) ?? {}).flatMap(([label, n]) =>
      count(n) != null ? [{ label, count: count(n)! }] : [],
    ),
    totals: t
      ? {
          tables: count(t["tables_in_schema"]),
          tablesWithBulk: count(t["tables_with_bulk_file"]),
          tablesWithoutBulk: count(t["tables_without_bulk_file"]),
          columns: count(t["columns"]),
          columnsWithDescription: count(t["columns_with_description"]),
          foreignKeys: count(t["foreign_keys"]),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------------------------- docket collection

export type SourceMix = { value: number; flags: string[]; count: number; sharePct: number | null };

export type DocketOverview = {
  dockets: number;
  courtsWithDockets: number | null;
  clusters: number | null;
  withFilingDate: number | null;
  noFilingDate: number | null;
  /** Filing dates outside 1700 to the snapshot date; excluded from the year series. */
  implausibleDates: number | null;
  firstFiled: string | null;
  lastFiled: string | null;
  recap: number | null;
  assignedJudge: number | null;
  natureOfSuit: number | null;
  fjcRecord: number | null;
  /** CourtListener source flags; a docket carries one combination, so the listed shares do not overlap. */
  sources: SourceMix[];
  /** Case type read from the docket number (the two letters between the year and the sequence). */
  caseTypes: { code: string; count: number }[];
  withCaseType: number | null;
  withoutCaseType: number | null;
};

export function parseDocketOverview(overview: unknown, caseTypes: unknown): DocketOverview | null {
  const p = obj(overview);
  const t = obj(p?.["totals"]);
  const dockets = count(t?.["dockets"]);
  if (!p || !t || dockets == null || dockets <= 0) return null;
  const c = obj(caseTypes);
  const caseTypeRows = arr(c?.["case_types"]).flatMap((e) => {
    const r = obj(e);
    const code = str(r?.["value"]) ?? str(r?.["label"]);
    const n = count(r?.["count"]);
    return code && n != null && n <= dockets ? [{ code, count: n }] : [];
  });
  const withoutCaseType = atMost(count(c?.["without_case_type"]), dockets);
  const caseTotal = count(c?.["total"]);
  return {
    dockets,
    courtsWithDockets: count(t["courts_with_dockets"]),
    clusters: count(t["clusters"]),
    withFilingDate: atMost(count(t["dockets_with_filing_date"]), dockets),
    noFilingDate: atMost(count(t["no_filing_date"]), dockets),
    implausibleDates: atMost(count(t["implausible_filing_dates"]), dockets),
    firstFiled: isoDay(t["first_filed"]),
    lastFiled: isoDay(t["last_filed"]),
    recap: atMost(count(t["recap_dockets"]), dockets),
    assignedJudge: atMost(count(t["with_assigned_judge"]), dockets),
    natureOfSuit: atMost(count(t["with_nature_of_suit"]), dockets),
    fjcRecord: atMost(count(t["with_fjc_record"]), dockets),
    sources: arr(p["sources"]).flatMap((e) => {
      const r = obj(e);
      const n = atMost(count(r?.["count"]), dockets);
      const value = count(r?.["value"]);
      const flags = arr(r?.["flags"]).flatMap((f) => (str(f) ? [f as string] : []));
      return r && n != null && value != null && flags.length
        ? [{ value, flags, count: n, sharePct: shareOfPct(n, dockets) }]
        : [];
    }),
    caseTypes: caseTotal === dockets ? caseTypeRows : [],
    withCaseType: withoutCaseType != null ? dockets - withoutCaseType : null,
    withoutCaseType,
  };
}

export type DocketYear = {
  year: number;
  /** The snapshot's own year: counted through the snapshot date, never compared with a complete year. */
  partial: boolean;
  dockets: number;
  civil: number | null;
  criminal: number | null;
  /** Dockets less the civil-numbered and criminal-numbered ones; null when those are not both recorded. */
  other: number | null;
  recap: number | null;
  terminated: number | null;
  clusters: number | null;
  citedClusters: number | null;
  federal: number | null;
  state: number | null;
  otherGroup: number | null;
  /** Change from the previous year as published; null for a partial year or when not recorded. */
  yoyPct: number | null;
};

type Rec = { id?: unknown; p?: unknown; l0?: unknown; l1?: unknown };

export function parseDocketYear(row: Rec, snapshot: string | null): DocketYear | null {
  const p = obj(row.p);
  const year = wholeYear(p?.["year"], 1000, 2100);
  const dockets = count(p?.["dockets"]);
  if (!p || year == null || dockets == null || row.id !== `year:${year}`) return null;
  const civil = atMost(count(p["civil"]), dockets);
  const criminal = atMost(count(p["criminal"]), dockets);
  const group = groupCounts(p["by_group"], dockets);
  const partial = p["partial"] === true || isPartialYear(year, snapshot);
  return {
    year,
    partial,
    dockets,
    civil,
    criminal,
    other:
      civil != null && criminal != null && civil + criminal <= dockets
        ? dockets - civil - criminal
        : null,
    recap: atMost(count(p["recap"]), dockets),
    terminated: atMost(count(p["terminated"]), dockets),
    clusters: count(p["clusters"]),
    citedClusters: count(p["cited_clusters"]),
    federal: group.federal,
    state: group.state,
    otherGroup: group.other,
    yoyPct: partial ? null : num(p["yoy_pct"]),
  };
}

export function parseDocketYears(
  rows: readonly Rec[],
  snapshot: string | null,
  total: number | null = null,
): Listed<DocketYear> {
  const listed = dedupe(
    parseList(rows, total, (r) => parseDocketYear(r, snapshot)),
    (y) => String(y.year),
  );
  return { ...listed, rows: [...listed.rows].sort((a, b) => a.year - b.year) };
}

export type DocketLevelFamily = "federal" | "state" | "other";
/** The dataset defines federal as F, FD, FB, FBP and FS and state as S, SA, ST, SS and SAG; the rest are listed separately. */
const FEDERAL_LEVELS: ReadonlySet<string> = new Set(["F", "FD", "FB", "FBP", "FS"]);
const STATE_LEVELS: ReadonlySet<string> = new Set(["S", "SA", "ST", "SS", "SAG"]);
export const levelFamily = (code: string | null): DocketLevelFamily =>
  code && FEDERAL_LEVELS.has(code) ? "federal" : code && STATE_LEVELS.has(code) ? "state" : "other";

export type DocketLevel = {
  id: string;
  /** Null for the record of courts with no level code. */
  code: string | null;
  label: string;
  family: DocketLevelFamily;
  courts: number;
  dockets: number;
  recap: number | null;
  terminated: number | null;
  clusters: number | null;
  topCourts: CourtCount[];
};

export function parseDocketLevel(row: Rec): DocketLevel | null {
  const p = obj(row.p);
  const id = str(row.id);
  const m = id ? /^level:([A-Za-z]{1,4}|none)$/.exec(id) : null;
  const code = str(p?.["code"]);
  const label = str(p?.["label"]);
  const dockets = count(p?.["dockets"]);
  const courts = count(p?.["courts"]);
  if (!p || !m || !label || dockets == null || courts == null) return null;
  // The record id and the stored code must agree; "none" is the record of courts without a code.
  if ((code ?? "none") !== m[1]) return null;
  return {
    id: id!,
    code,
    label,
    family: levelFamily(code),
    courts,
    dockets,
    recap: atMost(count(p["recap"]), dockets),
    terminated: atMost(count(p["terminated"]), dockets),
    clusters: count(p["clusters"]),
    topCourts: parseCourtCounts(p["top_courts"], "dockets"),
  };
}

export type DocketState = {
  /** USPS code from the record: a state, DC or a territory. */
  code: string;
  courts: number;
  dockets: number;
  civil: number | null;
  recap: number | null;
  clusters: number | null;
  federal: number | null;
  stateCourts: number | null;
  other: number | null;
  topCourts: CourtCount[];
};

export function parseDocketState(row: Rec): DocketState | null {
  const p = obj(row.p);
  const code = str(p?.["state"]);
  const dockets = count(p?.["dockets"]);
  const courts = count(p?.["courts"]);
  if (!p || !code || !/^[A-Z]{2}$/.test(code) || row.id !== `state:${code}`) return null;
  if (dockets == null || courts == null) return null;
  const group = groupCounts(p["by_group"], dockets);
  return {
    code,
    courts,
    dockets,
    civil: atMost(count(p["civil"]), dockets),
    recap: atMost(count(p["recap"]), dockets),
    clusters: count(p["clusters"]),
    federal: group.federal,
    stateCourts: group.state,
    other: group.other,
    topCourts: parseCourtCounts(p["top_courts"], "dockets"),
  };
}

type NosFlat = {
  id?: unknown;
  code?: unknown;
  text?: unknown;
  dockets?: unknown;
  dated?: unknown;
  terminated?: unknown;
  tpct?: unknown;
  grp?: unknown;
  grpLabel?: unknown;
  l0?: unknown;
  l1?: unknown;
};

export type DocketNos = {
  id: string;
  code: number;
  /** The most common recorded text, which starts with the code. */
  name: string;
  dockets: number;
  dated: number | null;
  terminated: number | null;
  /** Share of the code's dated dockets that carry a termination date. */
  terminatedPct: number | null;
  /** This project's grouping of FJC codebook codes, not a CourtListener or FJC category. */
  group: string | null;
  groupLabel: string | null;
  /** `/records/fjc_civil_nos/<id>` only when the record's own links contain exactly that path. */
  fjcHref: string | null;
};

const fjcLink = (id: string, links: readonly unknown[]) =>
  links.includes(`/records/fjc_civil_nos/${id}`) ? `/records/fjc_civil_nos/${id}` : null;

export function parseDocketNos(row: NosFlat): DocketNos | null {
  const id = str(row.id);
  const code = count(row.code);
  const name = str(row.text);
  const dockets = count(row.dockets);
  if (!id || code == null || code < 100 || code > 999 || !name || dockets == null) return null;
  if (id !== `nos:${code}`) return null;
  const dated = atMost(count(row.dated), dockets);
  const terminated = atMost(count(row.terminated), dated ?? dockets);
  return {
    id,
    code,
    name,
    dockets,
    dated,
    terminated,
    terminatedPct: pctOf(row.tpct) ?? shareOfPct(terminated, dated),
    group: str(row.grp),
    groupLabel: str(row.grpLabel),
    fjcHref: fjcLink(id, [row.l0, row.l1]),
  };
}

export type DocketNosGroup = {
  id: string;
  key: string;
  label: string;
  dockets: number;
  fjcHref: string | null;
};

type GroupFlat = {
  id?: unknown;
  key?: unknown;
  label?: unknown;
  dockets?: unknown;
  l0?: unknown;
  l1?: unknown;
};

export function parseDocketGroup(row: GroupFlat): DocketNosGroup | null {
  const id = str(row.id);
  const key = str(row.key);
  const label = str(row.label);
  const dockets = count(row.dockets);
  if (!id || !key || !label || dockets == null || id !== `group:${key}`) return null;
  return { id, key, label, dockets, fjcHref: fjcLink(id, [row.l0, row.l1]) };
}

export type DocketNosList = {
  nos: Listed<DocketNos>;
  groups: Listed<DocketNosGroup>;
  /** Dockets whose nature-of-suit text starts with a three-digit code: the groups' sum, the denominator of every share. */
  numericCodeDockets: number | null;
};

export function parseDocketNosList(
  nos: readonly NosFlat[],
  groups: readonly GroupFlat[],
  totals: { nos: number | null; groups: number | null } = { nos: null, groups: null },
): DocketNosList {
  const g = dedupe(parseList(groups, totals.groups, parseDocketGroup), (x) => x.id);
  return {
    nos: dedupe(parseList(nos, totals.nos, parseDocketNos), (x) => x.id),
    groups: g,
    numericCodeDockets: g.rows.length ? g.rows.reduce((a, x) => a + x.dockets, 0) : null,
  };
}

export type DocketCause = {
  id: string;
  rank: number;
  /** The exact cause string as recorded, so near-duplicates stay separate. */
  cause: string;
  dockets: number;
  topCourts: CourtCount[];
};

export function parseDocketCause(row: Rec): DocketCause | null {
  const p = obj(row.p);
  const rank = count(p?.["rank"]);
  const cause = str(p?.["cause"]);
  const dockets = count(p?.["dockets"]);
  if (!p || rank == null || rank < 1 || !cause || dockets == null) return null;
  if (row.id !== `cause:${String(rank).padStart(3, "0")}`) return null;
  return {
    id: row.id as string,
    rank,
    cause,
    dockets,
    topCourts: parseCourtCounts(p["top_courts"], "dockets"),
  };
}

export type DocketDetail = {
  id: string;
  /** Dockets by filing year; `terminated` is null for a group record, which carries no termination counts. */
  byYear: { year: number; dockets: number; terminated: number | null; partial: boolean }[];
  topCourts: CourtCount[];
};

export function parseDocketDetail(
  id: string,
  raw: unknown,
  snapshot: string | null,
): DocketDetail | null {
  const p = obj(raw);
  if (!p || !/^(nos:\d{3}|group:[a-z_]{2,40})$/.test(id)) return null;
  const seen = new Set<number>();
  const byYear = arr(p["by_year"])
    .flatMap((e) => {
      const r = obj(e);
      const year = wholeYear(r?.["yr"]);
      const n = count(r?.["n"]);
      if (!r || year == null || n == null || seen.has(year)) return [];
      seen.add(year);
      return [
        {
          year,
          dockets: n,
          terminated: atMost(count(r["n_term"]), n),
          partial: isPartialYear(year, snapshot),
        },
      ];
    })
    .sort((a, b) => a.year - b.year);
  const topCourts = parseCourtCounts(p["top_courts"], "dockets");
  return byYear.length || topCourts.length ? { id, byYear, topCourts } : null;
}

// ---------------------------------------------------------------------------------------------- cross-source correlations

export type CorrelationMeasure = { key: string; label: string; source: string; period: string };

/** A rank correlation across districts between two measures, as stored (association, not cause). */
export type Correlation = {
  id: string;
  a: CorrelationMeasure;
  b: CorrelationMeasure;
  rho: number;
  ciLow: number;
  ciHigh: number;
  n: number;
  strength: string | null;
  why: string | null;
};

function measureRef(raw: unknown): CorrelationMeasure | null {
  const r = obj(raw);
  const key = str(r?.["key"]);
  const label = str(r?.["label"]);
  const source = str(r?.["source"]);
  const period = str(r?.["period"]);
  return key && label && source && period ? { key, label, source, period } : null;
}

/** The "validity" pairs only (the same concept counted by two sources); a context pair is never shown as a check. */
export function parseCorrelations(
  rows: readonly { id?: unknown; c?: unknown; a?: unknown; b?: unknown }[],
): Correlation[] {
  return rows.flatMap((row) => {
    const id = str(row.id);
    const c = obj(row.c);
    const a = measureRef(row.a);
    const b = measureRef(row.b);
    const rho = num(c?.["rho"]);
    const n = count(c?.["n"]);
    const ciLow = num(c?.["ci_low"]);
    const ciHigh = num(c?.["ci_high"]);
    if (!id || !c || !a || !b || rho == null || n == null || ciLow == null || ciHigh == null)
      return [];
    if (c["role"] !== "validity" || n < 4 || rho < -1 || rho > 1) return [];
    // The stored interval must contain the stored estimate (to the three places it is rounded to).
    if (ciLow > rho + 0.0006 || ciHigh < rho - 0.0006 || ciLow < -1 || ciHigh > 1) return [];
    if (id !== `corr:${a.key}|${b.key}`) return [];
    return [{ id, a, b, rho, ciLow, ciHigh, n, strength: str(c["strength"]), why: str(c["why"]) }];
  });
}

// ---------------------------------------------------------------------------------------------- citation and appeal flows

export type FlowsOverview = {
  /** Rows in the bulk citation map. */
  mapLinks: number | null;
  /** Links with a court on both sides: the denominator of every citation share. */
  resolved: number;
  sameCourt: number | null;
  /** Both opinions exist but a court could not be resolved; excluded. */
  unresolved: number | null;
  /** An opinion is not in the opinion table; excluded. */
  notInOpinionTable: number | null;
  /** Links between two opinions of the same decision; set aside, not counted as citations. */
  sameDecisionLinks: number | null;
  /** Map links less the resolved links: everything left out, when the map has at least as many rows. */
  excluded: number | null;
  /** Links whose citing opinion is dated before the cited one: kept in the counts, left out of ages and decade series. */
  citingFiledBeforeCited: number | null;
  /** Links where a date is missing. */
  undatedLinks: number | null;
  appealDockets: number | null;
  /** Court pairs with at least 100 links, how many are published, and the smallest published pair. */
  crossPairsAtLeast100: number | null;
  crossEdgesPublished: number | null;
  crossEdgeFloor: number | null;
  /** The smaller pairs that are not published, and the links they hold. */
  crossPairsNotPublished: number | null;
  crossLinksNotPublished: number | null;
  /** True when map links less the excluded groups equals the resolved links. */
  reconciles: boolean;
};

export function parseFlowsOverview(raw: unknown): FlowsOverview | null {
  const p = obj(raw);
  const resolved = count(p?.["citations"]);
  if (!p || resolved == null || resolved <= 0) return null;
  const mapLinks = count(p["map_links"]);
  const unresolved = count(p["unresolved"]);
  const notIn = count(p["opinion_not_in_opinion_table"]);
  const sameDecision = count(p["same_decision_links"]);
  const atLeast100 = count(p["cross_pairs_at_least_100"]);
  const published = count(p["cross_edges_published"]);
  const tailPairs = count(p["cross_pairs_not_published"]);
  // The unpublished tail is only stated when it agrees with the pairs and edges the record counts.
  const tailKnown =
    atLeast100 != null &&
    published != null &&
    published <= atLeast100 &&
    tailPairs === atLeast100 - published;
  return {
    mapLinks,
    resolved,
    sameCourt: atMost(count(p["same_court"]), resolved),
    unresolved,
    notInOpinionTable: notIn,
    sameDecisionLinks: sameDecision,
    excluded: mapLinks != null && mapLinks >= resolved ? mapLinks - resolved : null,
    citingFiledBeforeCited: atMost(count(p["citing_filed_before_cited"]), resolved),
    undatedLinks: atMost(count(p["undated_links"]), resolved),
    appealDockets: count(p["appeal_dockets"]),
    crossPairsAtLeast100: atLeast100,
    crossEdgesPublished: published,
    crossEdgeFloor: count(p["cross_edge_floor"]),
    crossPairsNotPublished: tailKnown ? tailPairs : null,
    crossLinksNotPublished: tailKnown ? count(p["cross_links_not_published"]) : null,
    reconciles:
      mapLinks != null &&
      unresolved != null &&
      notIn != null &&
      mapLinks - notIn - (sameDecision ?? 0) - unresolved === resolved,
  };
}

export type CitationMatrix = {
  rows: { key: string; label: string; total: number | null }[];
  columns: { key: string; label: string }[];
  /** cells[row][column]: citation links from the row court to the column court; null when a cell is not a count. */
  cells: (number | null)[][];
  /** Only the level matrix states how complete it is. */
  meta: {
    /** Links that resolve to a court on both sides, and the part of them in the table. */
    totalLinks: number | null;
    shownLinks: number | null;
    /** The levels left out of the table. */
    omittedLevels: string[];
    /** CourtListener codes the Supreme Court as Federal appellate: the share of links cited to that level that point to it. */
    federalAppellateCitedScotusPct: number | null;
  } | null;
};

/** `totals` maps a row key to that court's citations made to all courts (from its citing-court profile). */
export function parseMatrix(
  raw: unknown,
  kind: "circuits" | "levels",
  totals: ReadonlyMap<string, number> = new Map(),
): CitationMatrix | null {
  const p = obj(raw);
  if (!p) return null;
  const names = obj(p["names"]);
  const rowKeys =
    kind === "circuits"
      ? arr(p["rows"]).flatMap((x) => (str(x) ? [x as string] : []))
      : arr(p["levels"]).flatMap((x) => (str(x) ? [x as string] : []));
  const colKeys =
    kind === "circuits" ? arr(p["columns"]).flatMap((x) => (str(x) ? [x as string] : [])) : rowKeys;
  const cells = arr(p["cells"]);
  if (!rowKeys.length || !colKeys.length || cells.length !== rowKeys.length) return null;
  if (new Set(rowKeys).size !== rowKeys.length || new Set(colKeys).size !== colKeys.length)
    return null;
  const grid: (number | null)[][] = [];
  for (const r of cells) {
    const line = arr(r);
    if (line.length !== colKeys.length) return null;
    grid.push(line.map(count));
  }
  const label = (k: string) => (kind === "circuits" ? (str(names?.[k]) ?? k) : k);
  // A level's row total is every link its courts make, including those to levels the table leaves out; it can never
  // be smaller than the row's own cells.
  const rowTotals = arr(p["row_totals"]).map(count);
  const rowSum = (i: number) => {
    const line = grid[i] ?? [];
    return line.some((c) => c == null) ? null : (line as number[]).reduce((a, b) => a + b, 0);
  };
  const levelTotal = (i: number) => {
    const t = rowTotals.length === rowKeys.length ? (rowTotals[i] ?? null) : null;
    const sum = rowSum(i);
    return t != null && sum != null && t >= sum ? t : null;
  };
  const totalLinks = count(p["total_links"]);
  const shownLinks = count(p["shown_links"]);
  return {
    rows: rowKeys.map((key, i) => ({
      key,
      label: label(key),
      total: kind === "circuits" ? (totals.get(key) ?? null) : levelTotal(i),
    })),
    columns: colKeys.map((key) => ({ key, label: label(key) })),
    cells: grid,
    meta:
      kind === "levels"
        ? {
            totalLinks,
            shownLinks: atMost(shownLinks, totalLinks ?? Number.MAX_SAFE_INTEGER),
            omittedLevels: arr(p["omitted_levels"]).flatMap((x) => (str(x) ? [x as string] : [])),
            federalAppellateCitedScotusPct: pctOf(p["federal_appellate_cited_scotus_pct"]),
          }
        : null,
  };
}

export type ScotusCiters = { total: number; citers: CourtCount[] };

export function parseScotusCiters(raw: unknown): ScotusCiters | null {
  const p = obj(raw);
  const total = count(p?.["total"]);
  if (!p || total == null || total <= 0) return null;
  const citers = parseCourtCounts(p["citers"], "count").filter((c) => c.count <= total);
  return citers.length ? { total, citers } : null;
}

export type FlowsMap = {
  overview: FlowsOverview;
  circuits: CitationMatrix | null;
  levels: CitationMatrix | null;
  scotus: ScotusCiters | null;
};

export type CitingCourt = {
  id: string;
  name: string;
  level: string | null;
  /** Citation links the court's opinions make that resolve to a court. */
  total: number;
  selfPct: number | null;
  scotusPct: number | null;
  /** Citations to federal, state and other courts, as counts and as shares of `total`. */
  federal: number | null;
  state: number | null;
  other: number | null;
  federalPct: number | null;
  statePct: number | null;
  otherPct: number | null;
  lag: { median: number | null; mean: number | null; p90: number | null; n: number | null } | null;
  href: string | null;
};

type CitingFlat = {
  id?: unknown;
  name?: unknown;
  level?: unknown;
  courtId?: unknown;
  total?: unknown;
  selfPct?: unknown;
  scotusPct?: unknown;
  groups?: unknown;
  lag?: unknown;
  l0?: unknown;
};

export function parseCitingCourt(row: CitingFlat): CitingCourt | null {
  const courtId = str(row.courtId);
  const name = str(row.name);
  const total = count(row.total);
  if (!courtId || !COURT_ID.test(courtId) || !name || total == null || total <= 0) return null;
  if (row.id !== `citing:${courtId}`) return null;
  const g = groupCounts(row.groups, total);
  const lag = obj(row.lag);
  return {
    id: courtId,
    name,
    level: str(row.level),
    total,
    selfPct: pctOf(row.selfPct),
    scotusPct: pctOf(row.scotusPct),
    federal: g.federal,
    state: g.state,
    other: g.other,
    federalPct: shareOfPct(g.federal, total),
    statePct: shareOfPct(g.state, total),
    otherPct: shareOfPct(g.other, total),
    lag: lag
      ? {
          median: nonNeg(lag["median_years"]),
          mean: nonNeg(lag["mean_years"]),
          p90: nonNeg(lag["p90_years"]),
          n: count(lag["n"]),
        }
      : null,
    href: courtHref(courtId, row.l0),
  };
}

export type CitingDetail = { courtId: string; total: number | null; top: CourtCount[] };

export function parseCitingDetail(courtId: string, raw: unknown): CitingDetail | null {
  const p = obj(raw);
  if (!p || !COURT_ID.test(courtId) || str(p["court_id"]) !== courtId) return null;
  const top = parseCourtCounts(p["top"], "count");
  return top.length ? { courtId, total: count(p["total"]), top } : null;
}

export type FlowCourt = { id: string; name: string; level: string | null; href: string | null };

export type CiteEdge = {
  id: string;
  citing: FlowCourt;
  cited: FlowCourt;
  links: number;
  /** Share of the citing court's links that resolve to a court. */
  shareOfCitingPct: number | null;
  /** Share of the links that resolve to the cited court. */
  shareOfCitedPct: number | null;
};

type EdgeFlat = {
  id?: unknown;
  p?: unknown;
  from?: unknown;
  to?: unknown;
  fl?: unknown;
  tl?: unknown;
  l0?: unknown;
  l1?: unknown;
};

export function parseCiteEdge(row: EdgeFlat): CiteEdge | null {
  const p = obj(row.p);
  const from = str(p?.["citing_court"]);
  const to = str(p?.["cited_court"]);
  const links = count(p?.["count"]);
  const fromName = str(row.from);
  const toName = str(row.to);
  if (!p || !from || !to || !COURT_ID.test(from) || !COURT_ID.test(to) || from === to) return null;
  if (links == null || links <= 0 || !fromName || !toName) return null;
  if (row.id !== `cite:${from}>${to}`) return null;
  const linkList = [row.l0, row.l1];
  return {
    id: row.id as string,
    citing: { id: from, name: fromName, level: str(row.fl), href: courtHrefIn(from, linkList) },
    cited: { id: to, name: toName, level: str(row.tl), href: courtHrefIn(to, linkList) },
    links,
    shareOfCitingPct: pctOf(p["share_of_citing_pct"]),
    shareOfCitedPct: pctOf(p["share_of_cited_pct"]),
  };
}

export type AppealEdge = {
  id: string;
  /** The court appealed from, as recorded on the appellate docket. */
  from: FlowCourt;
  /** The court holding the appellate docket. */
  to: FlowCourt;
  dockets: number;
  /** Share of the receiving court's dockets that record an appeal-from court. */
  sharePct: number | null;
};

export function parseAppealEdge(row: EdgeFlat): AppealEdge | null {
  const p = obj(row.p);
  const from = str(p?.["from_court"]);
  const to = str(p?.["appellate_court"]);
  const dockets = count(p?.["dockets"]);
  const fromName = str(row.from);
  const toName = str(row.to);
  if (!p || !from || !to || !COURT_ID.test(from) || !COURT_ID.test(to)) return null;
  if (dockets == null || dockets <= 0 || !fromName || !toName) return null;
  if (row.id !== `appeal:${from}>${to}`) return null;
  const linkList = [row.l0, row.l1];
  return {
    id: row.id as string,
    from: { id: from, name: fromName, level: str(row.fl), href: courtHrefIn(from, linkList) },
    to: { id: to, name: toName, level: str(row.tl), href: courtHrefIn(to, linkList) },
    dockets,
    sharePct: pctOf(p["share_pct"]),
  };
}

export type FlowYear = {
  year: number;
  partial: boolean;
  /** Citation links made by opinions filed this year that resolve to a court. */
  citations: number;
  sameCourt: number | null;
  federal: number | null;
  state: number | null;
  other: number | null;
};

export function parseFlowYear(row: Rec, snapshot: string | null): FlowYear | null {
  const p = obj(row.p);
  const year = wholeYear(p?.["year"], 1000, 2100);
  const citations = count(p?.["citations"]);
  if (!p || year == null || citations == null || row.id !== `year:${year}`) return null;
  const g = groupCounts(p["by_group"], citations);
  return {
    year,
    partial: isPartialYear(year, snapshot),
    citations,
    sameCourt: atMost(count(p["same_court"]), citations),
    federal: g.federal,
    state: g.state,
    other: g.other,
  };
}

export function parseFlowYears(
  rows: readonly Rec[],
  snapshot: string | null,
  total: number | null = null,
): Listed<FlowYear> {
  const listed = dedupe(
    parseList(rows, total, (r) => parseFlowYear(r, snapshot)),
    (y) => String(y.year),
  );
  return { ...listed, rows: [...listed.rows].sort((a, b) => a.year - b.year) };
}

// ---------------------------------------------------------------------------------------------- most-cited opinions

export type TopCited = {
  clusterId: number;
  rank: number;
  caseName: string;
  courtId: string;
  court: string;
  year: number;
  dateFiled: string | null;
  /** One reporter citation as recorded, or null. */
  citation: string | null;
  /** CourtListener's citation_count for the cluster. */
  timesCited: number;
  /** Rows of the bulk citation map pointing at the cluster: a different measure from timesCited. */
  mapLinks: number;
  /**
   * Map links whose citing opinion is in the opinion table and is not dated before the cited opinion: the denominator of
   * the federal and state shares and the source of the citing courts and decades.
   */
  knownCitingCourt: number | null;
  /** Map links whose citing opinion is dated before the cited one (set aside from the shares above). */
  linksCitingFiledBeforeCited: number | null;
  /** Map links as a share of times cited (1 means they agree). */
  mapToCountRatio: number | null;
  /** True when the map holds under half as many links as citation_count says, so the rank rests on citation_count alone. */
  lowMapRatio: boolean;
  /** Ranks of other listed clusters with the same reporter citation: the decision's citations are split across clusters. */
  twinRanks: number[];
  federalPct: number | null;
  statePct: number | null;
  otherPct: number | null;
  parentheticals: number | null;
  /** The record's own `profile.url`, only when it is exactly the CourtListener opinion URL of this cluster. */
  url: string | null;
  courtHref: string | null;
};

type TopCitedFlat = {
  id?: unknown;
  c?: unknown;
  courtId?: unknown;
  cluster?: unknown;
  url?: unknown;
  filed?: unknown;
  known?: unknown;
  groups?: unknown;
  par?: unknown;
  ratio?: unknown;
  twins?: unknown;
  before?: unknown;
  l0?: unknown;
  l1?: unknown;
};

/** The rule the dataset states: under half as many map links as citation_count. */
export const LOW_MAP_RATIO = 0.5;

export function parseTopCited(row: TopCitedFlat): TopCited | null {
  const c = obj(row.c);
  const clusterId = count(row.cluster);
  const rank = count(c?.["rank"]);
  const caseName = str(c?.["case"]);
  const court = str(c?.["court"]);
  const courtId = str(row.courtId);
  const year = wholeYear(c?.["year"], 1000, 2100);
  const timesCited = count(c?.["times_cited"]);
  const mapLinks = count(c?.["map_links"]);
  if (!c || clusterId == null || clusterId < 1 || rank == null || rank < 1) return null;
  if (!caseName || !court || !courtId || !COURT_ID.test(courtId) || year == null) return null;
  if (timesCited == null || mapLinks == null || row.id !== `cluster:${clusterId}`) return null;
  const known = count(row.known);
  const ratio = nonNeg(row.ratio);
  const g = groupCounts(row.groups, known);
  const par = obj(row.par);
  const url = str(row.url);
  return {
    clusterId,
    rank,
    caseName,
    courtId,
    court,
    year,
    dateFiled: isoDay(row.filed),
    citation: str(c["citation"]),
    timesCited,
    mapLinks,
    knownCitingCourt: known != null && known <= mapLinks ? known : null,
    linksCitingFiledBeforeCited: atMost(count(row.before), mapLinks),
    mapToCountRatio: ratio,
    lowMapRatio: ratio != null && ratio < LOW_MAP_RATIO,
    twinRanks: arr(row.twins).flatMap((n) => {
      const k = count(n);
      return k != null && k >= 1 && k !== rank ? [k] : [];
    }),
    federalPct: pctOf(c["federal_pct"]),
    statePct: pctOf(c["state_pct"]),
    otherPct: shareOfPct(g.other, known),
    parentheticals: count(par?.["n"]),
    url: url === `https://www.courtlistener.com/opinion/${clusterId}/` ? url : null,
    courtHref: courtHrefIn(courtId, [row.l0, row.l1]),
  };
}

export function parseTopCitedList(rows: readonly TopCitedFlat[], total: number | null = null) {
  const listed = dedupe(parseList(rows, total, parseTopCited), (r) => String(r.clusterId));
  return { ...listed, rows: [...listed.rows].sort((a, b) => a.rank - b.rank) };
}

export type TopCitedDetail = {
  clusterId: number;
  citingCourts: CourtCount[];
  /** Map links by the decade of the citing opinion. */
  byDecade: { decade: number; links: number }[];
  /** Every reporter citation the cluster carries, as "volume reporter page". */
  reporterCitations: string[];
  firstCitedYear: number | null;
  lastCitedYear: number | null;
  federal: number | null;
  state: number | null;
  other: number | null;
  parentheticals: { total: number; describingOpinions: number | null } | null;
};

export function parseTopCitedDetail(clusterId: number, raw: unknown): TopCitedDetail | null {
  const p = obj(raw);
  if (!p || count(p["cluster_id"]) !== clusterId) return null;
  const g = groupCounts(p["citing_groups"], count(p["links_with_known_citing_court"]));
  const par = obj(p["parentheticals"]);
  const parTotal = count(par?.["n"]);
  const seen = new Set<number>();
  const byDecade = arr(p["citing_by_decade"])
    .flatMap((e) => {
      const r = obj(e);
      const decade = wholeYear(r?.["decade"], 1000, 2100);
      const n = count(r?.["n"]);
      if (!r || decade == null || decade % 10 !== 0 || n == null || seen.has(decade)) return [];
      seen.add(decade);
      return [{ decade, links: n }];
    })
    .sort((a, b) => a.decade - b.decade);
  const citingCourts = parseCourtCounts(p["citing_courts"], "count");
  if (!citingCourts.length && !byDecade.length) return null;
  const seenCites = new Set<string>();
  const reporterCitations = arr(p["citations"]).flatMap((e) => {
    const r = obj(e);
    const volume = str(r?.["volume"]);
    const reporter = str(r?.["reporter"]);
    const page = str(r?.["page"]);
    const text = volume && reporter && page ? `${volume} ${reporter} ${page}` : null;
    if (!text || seenCites.has(text)) return [];
    seenCites.add(text);
    return [text];
  });
  return {
    clusterId,
    citingCourts,
    byDecade,
    reporterCitations,
    firstCitedYear: wholeYear(p["first_cited_year"]),
    lastCitedYear: wholeYear(p["last_cited_year"]),
    federal: g.federal,
    state: g.state,
    other: g.other,
    parentheticals:
      parTotal != null
        ? { total: parTotal, describingOpinions: count(par?.["describing_opinions"]) }
        : null,
  };
}

// ---------------------------------------------------------------------------------------------- disclosure coverage (counts only)

export const DISCLOSURE_SECTIONS = [
  "investments",
  "outside positions",
  "reimbursements",
  "spousal income",
  "debts",
  "non-investment income",
  "agreements",
  "gifts",
] as const;

export type DisclosureOverview = {
  reports: number;
  people: number | null;
  firstYear: number | null;
  lastYear: number | null;
  /** People with a judicial position on record (people-db positions). */
  judicialPeople: number | null;
  /** Of those, people with at least one report. */
  judicialWithReport: number | null;
  /** Row counts of each section's line-item table; nothing about what the rows contain. */
  sections: { section: string; items: number }[];
  /** People by how many reports they have: bucket label and people. */
  reportsPerPerson: { bucket: string; people: number }[];
};

export type DisclosureYear = {
  year: number;
  reports: number;
  people: number | null;
  amended: number | null;
  extracted: number | null;
  medianPages: number | null;
  lineItems: number | null;
};

export type DisclosureCourt = {
  id: string;
  name: string;
  level: string | null;
  /** People with a judicial position at the court on record. */
  people: number;
  /** Of those, people with at least one report (a report follows the person to any court). */
  withReport: number;
  reports: number;
  firstYear: number | null;
  lastYear: number | null;
  href: string | null;
};

export type DisclosureData = {
  overview: DisclosureOverview | null;
  years: Listed<DisclosureYear>;
  courts: Listed<DisclosureCourt>;
};

function parseDisclosureOverview(raw: unknown): DisclosureOverview | null {
  const p = obj(raw);
  const reports = count(p?.["reports"]);
  if (!p || reports == null) return null;
  const judicialPeople = count(p["judicial_people"]);
  const judicialWithReport = count(p["judicial_people_with_report"]);
  const sec = obj(p["sections"]);
  const dist = obj(p["reports_by_person_distribution"]);
  const bucketOrder = ["1", "2-5", "6-10", "11+"];
  return {
    reports,
    people: count(p["persons"]),
    firstYear: wholeYear(p["first_year"]),
    lastYear: wholeYear(p["last_year"]),
    judicialPeople,
    judicialWithReport:
      judicialPeople != null && judicialWithReport != null && judicialWithReport <= judicialPeople
        ? judicialWithReport
        : null,
    sections: Object.entries(sec ?? {})
      .flatMap(([section, n]) => (count(n) != null ? [{ section, items: count(n)! }] : []))
      .sort((a, b) => b.items - a.items),
    reportsPerPerson: Object.entries(dist ?? {})
      .flatMap(([bucket, n]) => (count(n) != null ? [{ bucket, people: count(n)! }] : []))
      .sort((a, b) => {
        const ia = bucketOrder.indexOf(a.bucket);
        const ib = bucketOrder.indexOf(b.bucket);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }),
  };
}

export function parseDisclosureYear(row: Rec): DisclosureYear | null {
  const p = obj(row.p);
  const year = wholeYear(p?.["year"]);
  const reports = count(p?.["reports"]);
  if (!p || year == null || reports == null || row.id !== `year:${year}`) return null;
  const items = obj(p["items"]);
  const itemCounts = Object.values(items ?? {}).map(count);
  return {
    year,
    reports,
    people: atMost(count(p["persons"]), reports),
    amended: atMost(count(p["amended"]), reports),
    extracted: atMost(count(p["extracted"]), reports),
    medianPages: nonNeg(p["median_pages"]),
    // The sum is only a total when every section's count is a count.
    lineItems:
      items && itemCounts.every((n) => n != null)
        ? itemCounts.reduce<number>((a, n) => a + n!, 0)
        : null,
  };
}

export function parseDisclosureCourt(row: Rec): DisclosureCourt | null {
  const p = obj(row.p);
  const id = str(p?.["court_id"]);
  const name = str(p?.["name"]);
  const people = count(p?.["people"]);
  const withReport = count(p?.["with_report"]);
  const reports = count(p?.["reports"]);
  if (!p || !id || !COURT_ID.test(id) || !name || row.id !== `court:${id}`) return null;
  if (people == null || people <= 0 || withReport == null || withReport > people || reports == null)
    return null;
  const first = wholeYear(p["first_year"]);
  const last = wholeYear(p["last_year"]);
  return {
    id,
    name,
    level: str(p["level"]),
    people,
    withReport,
    reports,
    firstYear: first != null && last != null && first <= last ? first : null,
    lastYear: first != null && last != null && first <= last ? last : null,
    href: courtHrefIn(id, [row.l0, row.l1]),
  };
}

export function parseDisclosures(
  rows: readonly Rec[],
  total: number | null = null,
): DisclosureData {
  const overviewRow = rows.find((r) => r.id === "overview:all");
  return {
    overview: parseDisclosureOverview(obj(overviewRow?.p) ?? null),
    years: dedupe(
      parseList(
        rows.filter((r) => typeof r.id === "string" && r.id.startsWith("year:")),
        null,
        parseDisclosureYear,
      ),
      (y) => String(y.year),
    ),
    courts: dedupe(
      parseList(
        rows.filter((r) => typeof r.id === "string" && r.id.startsWith("court:")),
        total,
        parseDisclosureCourt,
      ),
      (c) => c.id,
    ),
  };
}

// ---------------------------------------------------------------------------------------------- bulk schema

export type SchemaLoad = "none" | "not_loaded" | "selected" | "all" | "unknown";

const LOAD_KEYS: Record<string, SchemaLoad> = {
  "No public bulk file": "none",
  "Public bulk file, not loaded here": "not_loaded",
  "Public bulk file, loaded here (selected columns)": "selected",
  "Public bulk file, loaded here (all columns, as text)": "all",
};

export type SchemaTableRow = {
  table: string;
  label: string;
  group: string;
  bulk: boolean;
  load: SchemaLoad;
  /** The dataset's own wording of the load status. */
  loadLabel: string;
  columns: number;
  foreignKeys: number;
  referencedBy: number;
  rowsLoaded: number | null;
  compressedMb: number | null;
};

export const TABLE_NAME = /^[a-z][a-z0-9_]{1,80}$/;

export function parseSchemaTableRow(row: { id?: unknown; c?: unknown }): SchemaTableRow | null {
  const c = obj(row.c);
  const table = str(c?.["table"]);
  const label = str(c?.["label"]);
  const group = str(c?.["group"]);
  const loadLabel = str(c?.["loaded"]);
  const columns = count(c?.["columns"]);
  const bulkText = c?.["bulk"];
  if (!c || !table || !TABLE_NAME.test(table) || row.id !== `table:${table}`) return null;
  if (!label || !group || !loadLabel || columns == null) return null;
  if (bulkText !== "Yes" && bulkText !== "No") return null;
  const bulk = bulkText === "Yes";
  const load = LOAD_KEYS[loadLabel] ?? "unknown";
  // A table without a bulk file cannot be loaded, and a loaded table must have one.
  if ((load === "none") === bulk) return null;
  return {
    table,
    label,
    group,
    bulk,
    load,
    loadLabel,
    columns,
    foreignKeys: count(c["foreign_keys"]) ?? 0,
    referencedBy: count(c["referenced_by"]) ?? 0,
    rowsLoaded: count(c["rows_loaded"]),
    compressedMb: nonNeg(c["compressed_mb"]),
  };
}

export function parseSchemaTables(
  rows: readonly { id?: unknown; c?: unknown }[],
  total: number | null = null,
): Listed<SchemaTableRow> {
  return dedupe(parseList(rows, total, parseSchemaTableRow), (r) => r.table);
}

export type SchemaColumn = {
  name: string;
  type: string;
  notNull: boolean;
  /** The schema's own comment, when it has one. */
  comment: string | null;
  inBulkFile: boolean;
  /** True when the column is in this project's loaded copy of the table. */
  loadedHere: boolean;
  /** Non-null share of the loaded rows; null when the column is not loaded or no rows were loaded. */
  populatedPct: number | null;
};

export type SchemaTableDetail = {
  table: string;
  label: string;
  group: string;
  load: SchemaLoad;
  loadLabel: string;
  bulkFile: string | null;
  columns: SchemaColumn[];
  foreignKeys: { column: string; references: string; referencedColumn: string }[];
  rowsLoaded: number | null;
  /** Published schema (SQL) and bulk-data load script, only as http(s) links the record carries. */
  schemaUrl: string | null;
  loadScriptUrl: string | null;
};

const httpUrl = (v: unknown) => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

export function parseSchemaTable(
  table: string,
  raw: unknown,
  links: unknown,
): SchemaTableDetail | null {
  const p = obj(raw);
  if (!p || str(p["table"]) !== table || !TABLE_NAME.test(table)) return null;
  const label = str(p["label"]);
  const group = str(p["group"]);
  const loadLabel = str(p["loaded"]);
  if (!label || !group || !loadLabel) return null;
  const lp = obj(p["load_profile"]);
  const loadedRows = count(lp?.["rows"]);
  const loaded = new Map<string, Record<string, unknown>>();
  for (const e of arr(lp?.["columns"])) {
    const r = obj(e);
    const name = str(r?.["name"]);
    if (r && name) loaded.set(name, r);
  }
  const columns = arr(p["columns"]).flatMap((e) => {
    const r = obj(e);
    const name = str(r?.["name"]);
    const type = str(r?.["type"]);
    if (!r || !name || !type) return [];
    const lc = loaded.get(name);
    const populated = count(lc?.["populated"]);
    const stored = pctOf(lc?.["populated_pct"]);
    return [
      {
        name,
        type,
        notNull: r["not_null"] === true,
        comment: str(r["comment"]),
        inBulkFile: r["in_bulk_file"] === true,
        loadedHere: Boolean(lc),
        populatedPct:
          stored ??
          (loadedRows != null && loadedRows > 0 && populated != null && populated <= loadedRows
            ? (100 * populated) / loadedRows
            : null),
      },
    ];
  });
  if (!columns.length) return null;
  const linkRows = arr(links).map((l) => obj(l));
  const byLabel = (label: string) => httpUrl(linkRows.find((l) => l?.["label"] === label)?.["url"]);
  return {
    table,
    label,
    group,
    load: LOAD_KEYS[loadLabel] ?? "unknown",
    loadLabel,
    bulkFile: str(p["bulk_file"]),
    columns,
    foreignKeys: arr(p["foreign_keys"]).flatMap((e) => {
      const r = obj(e);
      const column = str(r?.["column"]);
      const references = str(r?.["references"]);
      const referencedColumn = str(r?.["referenced_column"]);
      return column && references && TABLE_NAME.test(references) && referencedColumn
        ? [{ column, references, referencedColumn }]
        : [];
    }),
    rowsLoaded: loadedRows,
    schemaUrl: byLabel("Published schema (SQL)"),
    loadScriptUrl: byLabel("Bulk-data load script"),
  };
}

// ---------------------------------------------------------------------------------------------- server reads

const TTL = 10 * 60 * 1000;
const MAX_ENTRIES = 300;
const PAGE = 1000;
type Entry = { at: number; value: Promise<unknown> };
const memoStore = new Map<string, Entry>();

/** A 10-minute memo that also shares an in-flight read; a failed read is forgotten, never cached. */
function memo<T>(
  key: string,
  load: () => Promise<T>,
  keep: (value: T) => boolean = () => true,
): Promise<T> {
  const hit = memoStore.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  if (memoStore.size >= MAX_ENTRIES) {
    const oldest = memoStore.keys().next();
    if (!oldest.done) memoStore.delete(oldest.value);
  }
  const value = load().then(
    (v) => {
      if (!keep(v)) memoStore.delete(key);
      return v;
    },
    (e: unknown) => {
      memoStore.delete(key);
      throw e;
    },
  );
  memoStore.set(key, { at: Date.now(), value });
  return value;
}

/** Every row of a corpus listing, a page at a time (the source returns at most 1,000 rows per request). */
async function readAll<R>(path: string): Promise<{ rows: R[]; total: number | null }> {
  const first = await restGet<R[]>(path, { count: true, range: [0, PAGE - 1] });
  const total = first.total;
  const rows = [...first.rows];
  if (first.rows.length < PAGE) return { rows, total };
  if (total == null) {
    // No total came back: keep reading until a short page, up to a bound.
    for (let start = PAGE; start < PAGE * 20; start += PAGE) {
      const page = await restGet<R[]>(path, { range: [start, start + PAGE - 1] });
      rows.push(...page.rows);
      if (page.rows.length < PAGE) break;
    }
    return { rows, total };
  }
  if (total <= PAGE) return { rows, total };
  const starts = Array.from({ length: Math.ceil((total - PAGE) / PAGE) }, (_, i) => PAGE * (i + 1));
  const rest = await Promise.all(
    starts.map((start) => restGet<R[]>(path, { range: [start, start + PAGE - 1] })),
  );
  for (const page of rest) rows.push(...page.rows);
  return { rows, total };
}

const DS = {
  docket: "clb_docket_master",
  flows: "clb_court_flows",
  topCited: "clb_top_cited",
  disclosures: "clb_disclosure_coverage",
  schema: "clb_bulk_schema",
  crossview: "clb_district_crossview",
} as const;

const recs = (dataset: string, filter: string, select: string) =>
  `corpus_records?select=${select}&dataset=eq.${dataset}&${filter}&order=ordinal.asc`;

/** A dataset's snapshot date, used to flag the partial year; null when it cannot be read. */
function loadSnapshot(dataset: string): Promise<string | null> {
  return memo(
    `snapshot:${dataset}`,
    async () => {
      try {
        const r = await restGet<{ s: unknown }[]>(
          `corpus_datasets?select=s:metadata->summary->>snapshot&id=eq.${dataset}&limit=1`,
        );
        return isoDay(r.rows[0]?.s);
      } catch {
        return null;
      }
    },
    (v) => v != null,
  );
}

export const getClbNotes = createServerFn({ method: "GET" }).handler((): Promise<ClbNotes> =>
  memo("notes", async () => {
    const r = await restGet<{ id: unknown; s: unknown }[]>(
      `corpus_datasets?select=id,s:metadata->summary&id=in.(${Object.values(DS).join(",")})`,
    );
    const by = new Map(r.rows.map((row) => [str(row.id), row.s]));
    return {
      docket: parseNote(DS.docket, by.get(DS.docket)),
      flows: parseNote(DS.flows, by.get(DS.flows)),
      topCited: parseNote(DS.topCited, by.get(DS.topCited)),
      disclosures: parseNote(DS.disclosures, by.get(DS.disclosures)),
      schema: parseSchemaNote(by.get(DS.schema)),
      crossview: parseNote(DS.crossview, by.get(DS.crossview)),
    };
  }),
);

// ----- docket collection

export const getClbDocketOverview = createServerFn({ method: "GET" }).handler(
  (): Promise<DocketOverview | null> =>
    memo(
      "docket:overview",
      async () => {
        const r = await restGet<{ id: unknown; p: unknown }[]>(
          recs(DS.docket, "id=in.(overview:all,casetype:all)", "id,p:item->profile"),
        );
        const by = new Map(r.rows.map((row) => [str(row.id), row.p]));
        return parseDocketOverview(by.get("overview:all"), by.get("casetype:all"));
      },
      (v) => v != null,
    ),
);

export const getClbDocketYears = createServerFn({ method: "GET" }).handler(
  (): Promise<Listed<DocketYear>> =>
    memo(
      "docket:years",
      async () => {
        const [list, snapshot] = await Promise.all([
          readAll<Rec>(recs(DS.docket, "id=like.year:*", "id,p:item->profile")),
          loadSnapshot(DS.docket),
        ]);
        return parseDocketYears(list.rows, snapshot, list.total);
      },
      (v) => v.rows.length > 0,
    ),
);

export type DocketBreakdown = { levels: Listed<DocketLevel>; states: Listed<DocketState> };

export const getClbDocketBreakdown = createServerFn({ method: "GET" }).handler(
  (): Promise<DocketBreakdown> =>
    memo(
      "docket:breakdown",
      async () => {
        const [levels, states] = await Promise.all([
          readAll<Rec>(recs(DS.docket, "id=like.level:*", "id,p:item->profile")),
          readAll<Rec>(recs(DS.docket, "id=like.state:*", "id,p:item->profile")),
        ]);
        return {
          levels: dedupe(parseList(levels.rows, levels.total, parseDocketLevel), (l) => l.id),
          states: dedupe(parseList(states.rows, states.total, parseDocketState), (s) => s.code),
        };
      },
      (v) => v.levels.rows.length > 0 || v.states.rows.length > 0,
    ),
);

export const getClbDocketNos = createServerFn({ method: "GET" }).handler(
  (): Promise<DocketNosList> =>
    memo(
      "docket:nos",
      async () => {
        const [nos, groups] = await Promise.all([
          readAll<NosFlat>(
            recs(
              DS.docket,
              "id=like.nos:*",
              "id,code:item->profile->code,text:item->profile->>text,dockets:item->profile->dockets,dated:item->profile->dated_dockets,terminated:item->profile->terminated,tpct:item->profile->terminated_pct_of_dated,grp:item->profile->>group,grpLabel:item->profile->>group_label,l0:item->links->0->>url,l1:item->links->1->>url",
            ),
          ),
          readAll<GroupFlat>(
            recs(
              DS.docket,
              "id=like.group:*",
              "id,key:item->profile->>group,label:item->profile->>label,dockets:item->profile->dockets,l0:item->links->0->>url,l1:item->links->1->>url",
            ),
          ),
        ]);
        return parseDocketNosList(nos.rows, groups.rows, { nos: nos.total, groups: groups.total });
      },
      (v) => v.nos.rows.length > 0 || v.groups.rows.length > 0,
    ),
);

export const getClbDocketDetail = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ id: z.string().regex(/^(nos:\d{3}|group:[a-z_]{2,40})$/) }).parse(d),
  )
  .handler(({ data }): Promise<DocketDetail | null> =>
    memo(
      `docket:detail:${data.id}`,
      async () => {
        const [r, snapshot] = await Promise.all([
          restGet<{ p: unknown }[]>(
            recs(DS.docket, `id=eq.${encodeURIComponent(data.id)}&limit=1`, "p:item->profile"),
          ),
          loadSnapshot(DS.docket),
        ]);
        return parseDocketDetail(data.id, r.rows[0]?.p, snapshot);
      },
      (v) => v != null,
    ),
  );

export const getClbDocketCauses = createServerFn({ method: "GET" }).handler(
  (): Promise<Listed<DocketCause>> =>
    memo(
      "docket:causes",
      async () => {
        const list = await readAll<Rec>(recs(DS.docket, "id=like.cause:*", "id,p:item->profile"));
        return dedupe(parseList(list.rows, list.total, parseDocketCause), (c) => c.id);
      },
      (v) => v.rows.length > 0,
    ),
);

export const getClbCorrelations = createServerFn({ method: "GET" }).handler(
  (): Promise<Correlation[]> =>
    memo(
      "crossview:corr",
      async () => {
        const r = await restGet<{ id: unknown; c: unknown; a: unknown; b: unknown }[]>(
          recs(
            DS.crossview,
            "id=like.corr:*",
            "id,c:item->profile->correlation,a:item->profile->a,b:item->profile->b",
          ),
        );
        return parseCorrelations(r.rows);
      },
      (v) => v.length > 0,
    ),
);

// ----- citation and appeal flows

export const getClbFlowsMap = createServerFn({ method: "GET" }).handler(
  (): Promise<FlowsMap | null> =>
    memo(
      "flows:map",
      async () => {
        const r = await restGet<{ id: unknown; p: unknown }[]>(
          recs(
            DS.flows,
            "id=in.(overview:all,matrix:circuits,matrix:levels,scotus:citers)",
            "id,p:item->profile",
          ),
        );
        const by = new Map(r.rows.map((row) => [str(row.id), row.p]));
        const overview = parseFlowsOverview(by.get("overview:all"));
        if (!overview) return null;
        // Each circuit's total citations made, for the share of its citations that stay inside this matrix.
        const rowKeys = arr(obj(by.get("matrix:circuits"))?.["rows"]).flatMap((x) =>
          typeof x === "string" && COURT_ID.test(x) ? [x] : [],
        );
        const totals = new Map<string, number>();
        if (rowKeys.length) {
          const t = await restGet<{ id: unknown; total: unknown }[]>(
            recs(
              DS.flows,
              `id=in.(${rowKeys.map((k) => `citing:${k}`).join(",")})`,
              "id,total:item->profile->total",
            ),
          );
          for (const row of t.rows) {
            const id = str(row.id);
            const n = count(row.total);
            if (id && n != null) totals.set(id.replace(/^citing:/, ""), n);
          }
        }
        return {
          overview,
          circuits: parseMatrix(by.get("matrix:circuits"), "circuits", totals),
          levels: parseMatrix(by.get("matrix:levels"), "levels"),
          scotus: parseScotusCiters(by.get("scotus:citers")),
        };
      },
      (v) => v != null,
    ),
);

export const getClbCitingCourts = createServerFn({ method: "GET" }).handler(
  (): Promise<Listed<CitingCourt>> =>
    memo(
      "flows:citing",
      async () => {
        const list = await readAll<CitingFlat>(
          recs(
            DS.flows,
            "id=like.citing:*",
            "id,name:item->cells->>from,level:item->cells->>from_level,courtId:item->profile->>court_id,total:item->profile->total,selfPct:item->profile->self_pct,scotusPct:item->profile->scotus_pct,groups:item->profile->groups,lag:item->profile->lag,l0:item->links->0->>url",
          ),
        );
        return dedupe(parseList(list.rows, list.total, parseCitingCourt), (c) => c.id);
      },
      (v) => v.rows.length > 0,
    ),
);

export const getClbCitingDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ court: z.string().regex(COURT_ID) }).parse(d))
  .handler(({ data }): Promise<CitingDetail | null> =>
    memo(
      `flows:citing:${data.court}`,
      async () => {
        const r = await restGet<{ p: unknown }[]>(
          recs(
            DS.flows,
            `id=eq.${encodeURIComponent(`citing:${data.court}`)}&limit=1`,
            "p:item->profile",
          ),
        );
        return parseCitingDetail(data.court, r.rows[0]?.p);
      },
      (v) => v != null,
    ),
  );

const EDGE_SELECT =
  "id,p:item->profile,from:item->cells->>from,to:item->cells->>to,fl:item->cells->>from_level,tl:item->cells->>to_level,l0:item->links->0->>url,l1:item->links->1->>url";

export const getClbCiteEdges = createServerFn({ method: "GET" }).handler(
  (): Promise<Listed<CiteEdge>> =>
    memo(
      "flows:cite",
      async () => {
        const list = await readAll<EdgeFlat>(recs(DS.flows, "id=like.cite:*", EDGE_SELECT));
        return dedupe(parseList(list.rows, list.total, parseCiteEdge), (e) => e.id);
      },
      (v) => v.rows.length > 0,
    ),
);

export const getClbAppealEdges = createServerFn({ method: "GET" }).handler(
  (): Promise<Listed<AppealEdge>> =>
    memo(
      "flows:appeal",
      async () => {
        const list = await readAll<EdgeFlat>(recs(DS.flows, "id=like.appeal:*", EDGE_SELECT));
        return dedupe(parseList(list.rows, list.total, parseAppealEdge), (e) => e.id);
      },
      (v) => v.rows.length > 0,
    ),
);

export const getClbFlowYears = createServerFn({ method: "GET" }).handler(
  (): Promise<Listed<FlowYear>> =>
    memo(
      "flows:years",
      async () => {
        const [list, snapshot] = await Promise.all([
          readAll<Rec>(recs(DS.flows, "id=like.year:*", "id,p:item->profile")),
          loadSnapshot(DS.flows),
        ]);
        return parseFlowYears(list.rows, snapshot, list.total);
      },
      (v) => v.rows.length > 0,
    ),
);

// ----- most-cited opinions

export const getClbTopCited = createServerFn({ method: "GET" }).handler(
  (): Promise<Listed<TopCited>> =>
    memo(
      "cited:list",
      async () => {
        const list = await readAll<TopCitedFlat>(
          recs(
            DS.topCited,
            "id=like.cluster:*",
            "id,c:item->cells,courtId:item->profile->>court_id,cluster:item->profile->cluster_id,url:item->profile->>url,filed:item->profile->>date_filed,known:item->profile->links_with_known_citing_court,groups:item->profile->citing_groups,par:item->profile->parentheticals,ratio:item->profile->map_to_count_ratio,twins:item->profile->same_reporter_citation_as_ranks,before:item->profile->links_citing_filed_before_cited,l0:item->links->0->>url,l1:item->links->1->>url",
          ),
        );
        return parseTopCitedList(list.rows, list.total);
      },
      (v) => v.rows.length > 0,
    ),
);

export const getClbTopCitedDetail = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ clusterId: z.number().int().min(1).max(2_000_000_000) }).parse(d),
  )
  .handler(({ data }): Promise<TopCitedDetail | null> =>
    memo(
      `cited:detail:${data.clusterId}`,
      async () => {
        const r = await restGet<{ p: unknown }[]>(
          recs(DS.topCited, `id=eq.cluster:${data.clusterId}&limit=1`, "p:item->profile"),
        );
        return parseTopCitedDetail(data.clusterId, r.rows[0]?.p);
      },
      (v) => v != null,
    ),
  );

// ----- disclosure coverage

export const getClbDisclosures = createServerFn({ method: "GET" }).handler(
  (): Promise<DisclosureData> =>
    memo(
      "disclosures",
      async () => {
        const list = await readAll<Rec>(
          recs(
            DS.disclosures,
            "id=not.is.null",
            "id,p:item->profile,l0:item->links->0->>url,l1:item->links->1->>url",
          ),
        );
        return parseDisclosures(list.rows, null);
      },
      (v) => v.overview != null || v.years.rows.length > 0 || v.courts.rows.length > 0,
    ),
);

// ----- bulk schema

export const getClbSchemaTables = createServerFn({ method: "GET" }).handler(
  (): Promise<Listed<SchemaTableRow>> =>
    memo(
      "schema:list",
      async () => {
        const list = await readAll<{ id: unknown; c: unknown }>(
          recs(DS.schema, "id=like.table:*", "id,c:item->cells"),
        );
        return parseSchemaTables(list.rows, list.total);
      },
      (v) => v.rows.length > 0,
    ),
);

export const getClbSchemaTable = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ table: z.string().regex(TABLE_NAME) }).parse(d))
  .handler(({ data }): Promise<SchemaTableDetail | null> =>
    memo(
      `schema:table:${data.table}`,
      async () => {
        const r = await restGet<{ p: unknown; l: unknown }[]>(
          recs(
            DS.schema,
            `id=eq.${encodeURIComponent(`table:${data.table}`)}&limit=1`,
            "p:item->profile,l:item->links",
          ),
        );
        return parseSchemaTable(data.table, r.rows[0]?.p, r.rows[0]?.l);
      },
      (v) => v != null,
    ),
  );
