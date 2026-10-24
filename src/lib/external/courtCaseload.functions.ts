/**
 * Federal civil caseload from the Federal Judicial Center Integrated Database (IDB), published as five corpus datasets
 * by scripts/enrichment/fjc_idb: fjc_civil_districts (94 districts), fjc_civil_states (state roll-ups), fjc_civil_national
 * (national series), fjc_civil_nos (nature-of-suit codes and this project's groups) and fjc_civil_mdls (cases that carry an
 * MDL docket number, a historical association, not JPML membership).
 *
 * Stored JSON is validated here. A record or series row that cannot be read is dropped, never repaired, and the number
 * dropped is returned so the page can say so. Counts are non-negative numbers, shares are 0-100, and every unknown value is
 * null (the page shows "Not recorded"). FY2026 is a partial year (through 2026-06-30) and is flagged `partial` on each
 * point; the page never ranks on it.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

// ---------------------------------------------------------------------------------------------- primitives

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const count = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};
const share = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
const whole = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) ? n : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date written YYYY-MM-DD, or null (so "2026-13-45" is not a date). */
const isoDate = (v: unknown) => {
  const s = str(v);
  if (!s || !ISO_DATE.test(s)) return null;
  const t = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s ? null : s;
};

// ---------------------------------------------------------------------------------------------- types

/** One fiscal year of a caseload series. Fiscal years run Oct 1 to Sep 30 and are named for the year they end. */
export type CaseloadYear = {
  fy: number;
  /** True for a fiscal year still in progress at the snapshot (FY2026 runs through 2026-06-30). */
  partial: boolean;
  filings: number | null;
  terminations: number | null;
  /** Pending at the fiscal year end (Sep 30); for a partial year, pending at the snapshot. */
  pendingEnd: number | null;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  p90Days: number | null;
  /** Share of filings alleging a class action. */
  classActionPct: number | null;
  /** Share of filings with a recorded pro se status that have a pro se plaintiff. */
  proSePct: number | null;
  /** Share of filings in product liability or health-care/pharma injury. */
  productPct: number | null;
  /** Share of filings with a recorded jury demand that demand a jury. */
  juryDemandedPct: number | null;
  /** Share of terminations coded settled (disposition 13). */
  settledPct: number | null;
  /** Share of terminations by trial judgment (dispositions 7, 8 and 9). */
  trialPct: number | null;
  withMdlNumber: number | null;
  mdlTransferIn: number | null;
  mdlOriginating: number | null;
};

export type ShareRow = {
  key: string;
  label: string;
  count: number | null;
  sharePct: number | null;
  /** Disposition group, or procedural stage, when the row carries one. */
  group: string | null;
};

export type GroupMix = {
  group: string;
  label: string;
  filings: number | null;
  sharePct: number | null;
  terminations: number | null;
  medianDays: number | null;
  settledPct: number | null;
  trialPct: number | null;
};

export type NosMix = {
  nos: number;
  label: string;
  filings: number | null;
  sharePct: number | null;
};

/** Mix of one multi-year window (FY2021 to FY2025), shares over the window's filings or terminations. */
export type WindowMix = {
  fyFrom: number;
  fyTo: number;
  filings: number | null;
  groups: GroupMix[];
  topNos: NosMix[];
  jurisdiction: ShareRow[];
  origin: ShareRow[];
  dispositionGroups: ShareRow[];
  dispositions: ShareRow[];
  procedural: ShareRow[];
};

export type NationalCaseload = {
  /** Latest complete fiscal year. */
  latestFy: number;
  /** The fiscal year in progress, when the series has one. */
  partialFy: number | null;
  years: CaseloadYear[];
  window: WindowMix | null;
};

export const RANK_METRICS = [
  "filings",
  "pending_end",
  "median_days",
  "class_action_pct",
  "pro_se_plaintiff_pct",
  "product_pct",
  "settled_pct",
  "trial_pct",
] as const;
export type RankMetric = (typeof RANK_METRICS)[number];
/** Competition rank among the districts for the latest complete year: 1 is the highest value, ties share the lowest number. */
export type RankEntry = { metric: RankMetric; rank: number; of: number };

export type DistrictRow = {
  id: string;
  name: string;
  state: string | null;
  circuitId: string | null;
  circuit: string | null;
  filings: number | null;
  terminations: number | null;
  pending: number | null;
  medianDays: number | null;
  classActionPct: number | null;
  proSePct: number | null;
  productPct: number | null;
  trialPct: number | null;
  /** True only when the record's own links include /courts/<id>. */
  hasCourtPage: boolean;
};

export type DistrictDetail = {
  id: string;
  name: string;
  state: string | null;
  circuitId: string | null;
  latestFy: number;
  years: CaseloadYear[];
  window: WindowMix | null;
  ranks: RankEntry[];
  change: {
    filingsPct: number | null;
    medianDaysDelta: number | null;
    pendingPct: number | null;
  } | null;
};

export type StateRow = {
  code: string;
  districts: number | null;
  filings: number | null;
  terminations: number | null;
  pending: number | null;
  medianDays: number | null;
};

export type NosKind = "nos" | "group";
export type NosRow = {
  id: string;
  kind: NosKind;
  /** The nature-of-suit code; null for a group. */
  code: number | null;
  /** This project's group key (a group's own key for a group record). */
  groupKey: string | null;
  name: string;
  /** Latest complete year; null when the code has no cases in that year. */
  filings: number | null;
  terminations: number | null;
  medianDays: number | null;
  settledPct: number | null;
  trialPct: number | null;
  proSePct: number | null;
  classActionPct: number | null;
};

export type NosDetail = {
  id: string;
  kind: NosKind;
  name: string;
  groupKey: string | null;
  years: CaseloadYear[];
  window: WindowMix | null;
  /** Districts with the most filings over the window (FY2021 to FY2025). */
  topDistricts: { courtId: string; filings: number }[];
  /** For a group: the codes it holds. */
  members: { nos: number; name: string }[];
};

export type MdlRow = {
  id: string;
  mdl: number;
  cases: number;
  pending: number | null;
  districts: number | null;
  firstFiled: string | null;
  lastFiled: string | null;
  medianDays: number | null;
  topDistrict: string | null;
  /** True when the number is also in the JPML MDL records already in the corpus. */
  inJpml: boolean;
  /** Set only when the record's own links contain these exact paths. */
  lensHref: string | null;
  recordHref: string | null;
};

export type MdlDetail = {
  mdl: number;
  inJpml: boolean;
  byFy: { fy: number; cases: number }[];
  districts: { courtId: string; cases: number }[];
  nos: { nos: number; label: string; cases: number }[];
  /** Exact text as recorded in the IDB, with the number of cases carrying it. */
  defendants: { name: string; cases: number }[];
  totals: {
    cases: number;
    pending: number | null;
    districts: number | null;
    firstFiled: string | null;
    lastFiled: string | null;
    medianDays: number | null;
    withDays: number | null;
    transferredIn: number | null;
    originating: number | null;
    settled: number | null;
    mdlTransferOut: number | null;
    classAction: number | null;
    trial: number | null;
  };
};

export type Comparison = {
  compared: number;
  exact: number;
  /** Within 1% or 1 case, a superset of `exact`; null when the validation does not record it. */
  withinOnePct: number | null;
};

export type CaseloadMethod = {
  source: string | null;
  sourcePage: string | null;
  sourceFile: string | null;
  codebook: string | null;
  snapshot: string | null;
  /** ISO date the data run through, read from the snapshot note ("filing dates through 2026-06-30"); null when not stated. */
  through: string | null;
  terms: string | null;
  builtAt: string | null;
  latestCompleteFy: number | null;
  partialFy: number | null;
  window: string | null;
  countingRules: string[];
  formulas: { key: string; text: string }[];
  groupingNote: string | null;
  ranksNote: string | null;
  quality: {
    rowsLoaded: number | null;
    rowsRejected: number | null;
    pending: number | null;
    terminated: number | null;
    terminatedWithDuration: number | null;
    missingDisposition: number | null;
    missingNos: number | null;
    terminatedBeforeFiled: number | null;
    unmappedNosRows: number | null;
    filedRange: [number, number] | null;
    terminatedRange: [number, number] | null;
  } | null;
  vsAo: {
    scope: string | null;
    source: string | null;
    reading: string | null;
    filings: Comparison | null;
    pending: Comparison | null;
    terminations: Comparison | null;
    worst: { courtId: string; fy: number; idb: number; ao: number; diff: number }[];
  } | null;
  recheck: {
    figures: number;
    mismatches: number;
    method: string | null;
    note: string | null;
    rawRows: number | null;
  } | null;
  mdl: {
    evidenceRule: string | null;
    nonNumeric: { distinctValues: number; records: number } | null;
  } | null;
};

/** A list read from the corpus: the parsed rows, the dataset's record total, and how many were unreadable. */
export type Listed<T> = { rows: T[]; total: number | null; dropped: number };

// ---------------------------------------------------------------------------------------------- series and mix

export function parseYears(raw: unknown, latestFy: number | null): CaseloadYear[] {
  const seen = new Set<number>();
  const out: CaseloadYear[] = [];
  for (const entry of arr(raw)) {
    const r = obj(entry);
    const fy = whole(r?.["fy"]);
    if (!r || fy == null || fy < 1900 || fy > 2200 || seen.has(fy)) continue;
    seen.add(fy);
    out.push({
      fy,
      partial: r["partial"] === true || (latestFy != null && fy > latestFy),
      filings: count(r["filings"]),
      terminations: count(r["terminations"]),
      pendingEnd: count(r["pending_end"]),
      medianDays: count(r["median_days"]),
      p25Days: count(r["p25_days"]),
      p75Days: count(r["p75_days"]),
      p90Days: count(r["p90_days"]),
      classActionPct: share(r["class_action_pct"]),
      proSePct: share(r["pro_se_plaintiff_pct"]),
      productPct: share(r["product_pct"]),
      juryDemandedPct: share(r["jury_demanded_pct"]),
      settledPct: share(r["settled_pct"]),
      trialPct: share(r["trial_pct"]),
      withMdlNumber: count(r["with_mdl_number"]),
      mdlTransferIn: count(r["mdl_transfer_in"]),
      mdlOriginating: count(r["mdl_originating"]),
    });
  }
  return out.sort((a, b) => a.fy - b.fy);
}

function shareRows(raw: unknown, countKey: string, groupKey?: string): ShareRow[] {
  const out: ShareRow[] = [];
  for (const entry of arr(raw)) {
    const r = obj(entry);
    const label = str(r?.["label"]) ?? str(r?.["group"]);
    const n = count(r?.[countKey]);
    const s = share(r?.["share_pct"]);
    if (!r || !label || (n == null && s == null)) continue;
    const code = r["code"];
    out.push({
      key: `${typeof code === "number" || typeof code === "string" ? code : ""}|${label}`,
      label,
      count: n,
      sharePct: s,
      group: groupKey ? str(r[groupKey]) : null,
    });
  }
  return out;
}

export function parseWindow(raw: unknown): WindowMix | null {
  const w = obj(raw);
  const fyFrom = whole(w?.["fy_from"]);
  const fyTo = whole(w?.["fy_to"]);
  if (!w || fyFrom == null || fyTo == null || fyFrom > fyTo) return null;
  const groups: GroupMix[] = [];
  for (const entry of arr(w["groups"])) {
    const r = obj(entry);
    const group = str(r?.["group"]);
    const label = str(r?.["label"]);
    if (!r || !group || !label) continue;
    groups.push({
      group,
      label,
      filings: count(r["filings"]),
      sharePct: share(r["share_pct"]),
      terminations: count(r["terminations"]),
      medianDays: count(r["median_days"]),
      settledPct: share(r["settled_pct"]),
      trialPct: share(r["trial_pct"]),
    });
  }
  const topNos: NosMix[] = [];
  for (const entry of arr(w["top_nos"])) {
    const r = obj(entry);
    const nos = whole(r?.["nos"]);
    const label = str(r?.["label"]);
    if (!r || nos == null || !label) continue;
    topNos.push({ nos, label, filings: count(r["filings"]), sharePct: share(r["share_pct"]) });
  }
  return {
    fyFrom,
    fyTo,
    filings: count(w["filings"]),
    groups,
    topNos,
    jurisdiction: shareRows(w["jurisdiction"], "filings"),
    origin: shareRows(w["origin"], "filings"),
    dispositionGroups: shareRows(w["disposition_groups"], "terminations"),
    dispositions: shareRows(w["dispositions"], "terminations", "group"),
    procedural: shareRows(w["procedural_progress"], "terminations", "stage"),
  };
}

function parseList<S, T>(rows: S[], total: number | null, one: (row: S) => T | null): Listed<T> {
  const out: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = one(row);
    if (parsed) out.push(parsed);
    else dropped += 1;
  }
  return { rows: out, total, dropped };
}

// ---------------------------------------------------------------------------------------------- national, states

export function parseNational(profile: unknown): NationalCaseload | null {
  const p = obj(profile);
  if (!p) return null;
  const declared = whole(p["latest_fy"]);
  const partialFy = whole(p["partial_fy"]);
  const years = parseYears(p["series"], declared);
  if (!years.length) return null;
  const latestFy = declared ?? years.filter((y) => !y.partial).at(-1)?.fy ?? null;
  if (latestFy == null) return null;
  return { latestFy, partialFy, years, window: parseWindow(p["window"]) };
}

type CellRow = { id?: unknown; cells?: unknown; links?: unknown; filters?: unknown };

export function parseStateRow(row: CellRow): StateRow | null {
  const code = str(row.id);
  const c = obj(row.cells);
  if (!code || !c || !/^[A-Z]{2}$/.test(code)) return null;
  return {
    code,
    districts: count(c["districts"]),
    filings: count(c["filings"]),
    terminations: count(c["terminations"]),
    pending: count(c["pending"]),
    medianDays: count(c["median_days"]),
  };
}

// ---------------------------------------------------------------------------------------------- districts

const firstString = (v: unknown) => str(arr(v)[0]);

export function parseDistrictRow(row: CellRow): DistrictRow | null {
  const id = str(row.id);
  const c = obj(row.cells);
  const name = str(c?.["court"]);
  if (!id || !c || !name || !/^[a-z]{2,8}$/.test(id)) return null;
  const filters = obj(row.filters);
  const hasCourtPage = arr(row.links).some((l) => obj(l)?.["url"] === `/courts/${id}`);
  return {
    id,
    name,
    state: str(c["state"]),
    circuitId: firstString(filters?.["circuit"]),
    circuit: str(c["circuit"]),
    filings: count(c["filings"]),
    terminations: count(c["terminations"]),
    pending: count(c["pending"]),
    medianDays: count(c["median_days"]),
    classActionPct: share(c["class_action_pct"]),
    proSePct: share(c["pro_se_pct"]),
    productPct: share(c["product_pct"]),
    trialPct: share(c["trial_pct"]),
    hasCourtPage,
  };
}

export function parseDistrictRows(
  rows: CellRow[],
  total: number | null = null,
): Listed<DistrictRow> {
  const seen = new Set<string>();
  const listed = parseList(rows, total, (r) => {
    const d = parseDistrictRow(r);
    if (!d || seen.has(d.id)) return null;
    seen.add(d.id);
    return d;
  });
  return listed;
}

function parseRanks(raw: unknown): RankEntry[] {
  const r = obj(raw);
  if (!r) return [];
  const out: RankEntry[] = [];
  for (const metric of RANK_METRICS) {
    const pair = arr(r[metric]);
    const rank = whole(pair[0]);
    const of = whole(pair[1]);
    if (pair.length === 2 && rank != null && of != null && rank >= 1 && of >= rank)
      out.push({ metric, rank, of });
  }
  return out;
}

export function parseDistrictDetail(id: string, raw: unknown): DistrictDetail | null {
  const p = obj(raw);
  const name = str(p?.["name"]);
  const latestFy = whole(p?.["latest_fy"]);
  if (!p || !name || latestFy == null) return null;
  const years = parseYears(p["series"], latestFy);
  if (!years.length) return null;
  const change = obj(p["change_vs_prior_fy"]);
  return {
    id,
    name,
    state: str(p["state"]),
    circuitId: str(p["circuit"]),
    latestFy,
    years,
    window: parseWindow(p["window"]),
    ranks: parseRanks(p["ranks"]),
    change: change
      ? {
          filingsPct: num(change["filings_pct"]),
          medianDaysDelta: num(change["median_days_delta"]),
          pendingPct: num(change["pending_pct"]),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------------------------- nature of suit

const NOS_ID = /^(nos:\d{3}|group:[a-z_]{2,40})$/;

export function parseNosRow(row: CellRow): NosRow | null {
  const id = str(row.id);
  const c = obj(row.cells);
  const name = str(c?.["name"]);
  if (!id || !c || !name || !NOS_ID.test(id)) return null;
  const kind: NosKind = id.startsWith("group:") ? "group" : "nos";
  const code = kind === "nos" ? whole(c["code"]) : null;
  if (kind === "nos" && code == null) return null;
  const filters = obj(row.filters);
  return {
    id,
    kind,
    code,
    groupKey: firstString(filters?.["group"]),
    name,
    filings: count(c["filings"]),
    terminations: count(c["terminations"]),
    medianDays: count(c["median_days"]),
    settledPct: share(c["settled_pct"]),
    trialPct: share(c["trial_pct"]),
    proSePct: share(c["pro_se_pct"]),
    classActionPct: share(c["class_action_pct"]),
  };
}

export function parseNosRows(rows: CellRow[], total: number | null = null): Listed<NosRow> {
  const seen = new Set<string>();
  return parseList(rows, total, (r) => {
    const n = parseNosRow(r);
    if (!n || seen.has(n.id)) return null;
    seen.add(n.id);
    return n;
  });
}

export function parseNosDetail(id: string, raw: unknown): NosDetail | null {
  const p = obj(raw);
  if (!p || !NOS_ID.test(id)) return null;
  const kind: NosKind = id.startsWith("group:") ? "group" : "nos";
  const name = str(p["name"]) ?? str(p["label"]);
  if (!name) return null;
  const years = parseYears(p["series"], null);
  const members = arr(p["members"]).flatMap((m) => {
    const r = obj(m);
    const nos = whole(r?.["nos"]);
    const memberName = str(r?.["name"]);
    return nos != null && memberName ? [{ nos, name: memberName }] : [];
  });
  const topDistricts = arr(p["top_districts"]).flatMap((d) => {
    const r = obj(d);
    const courtId = str(r?.["court_id"]);
    const filings = count(r?.["filings"]);
    return courtId && /^[a-z]{2,8}$/.test(courtId) && filings != null ? [{ courtId, filings }] : [];
  });
  return {
    id,
    kind,
    name,
    groupKey: str(p["group"]),
    years,
    window: parseWindow(p["window"]),
    topDistricts,
    members,
  };
}

// ---------------------------------------------------------------------------------------------- MDL association

export function parseMdlRow(
  row: CellRow & { inCorpus?: unknown },
  links: ReadonlyMap<string, unknown> = new Map(),
): MdlRow | null {
  const id = str(row.id);
  const c = obj(row.cells);
  const mdl = whole(c?.["mdl"]);
  const cases = count(c?.["cases"]);
  if (!id || !c || mdl == null || mdl < 0 || cases == null || id !== `mdl:${mdl}`) return null;
  const inJpml = row.inCorpus === true;
  const linkUrls = arr(links.get(id)).map((l) => obj(l)?.["url"]);
  return {
    id,
    mdl,
    cases,
    pending: count(c["pending"]),
    districts: count(c["districts"]),
    firstFiled: isoDate(c["first_filed"]),
    lastFiled: isoDate(c["last_filed"]),
    medianDays: count(c["median_days"]),
    topDistrict: str(c["top_district"]),
    inJpml,
    // A cross-reference is offered only when the record already carries it, on the exact key.
    lensHref: inJpml && linkUrls.includes(`/matters/lens/${mdl}`) ? `/matters/lens/${mdl}` : null,
    recordHref: inJpml && linkUrls.includes(`/records/mdls/${mdl}`) ? `/records/mdls/${mdl}` : null,
  };
}

export function parseMdlRows(
  rows: (CellRow & { inCorpus?: unknown })[],
  linkRows: { id?: unknown; links?: unknown }[],
  total: number | null = null,
): Listed<MdlRow> {
  const links = new Map<string, unknown>();
  for (const l of linkRows) {
    const id = str(l.id);
    if (id) links.set(id, l.links);
  }
  const seen = new Set<string>();
  return parseList(rows, total, (r) => {
    const m = parseMdlRow(r, links);
    if (!m || seen.has(m.id)) return null;
    seen.add(m.id);
    return m;
  });
}

export function parseMdlDetail(raw: unknown): MdlDetail | null {
  const p = obj(raw);
  const mdl = whole(p?.["mdl"]);
  const t = obj(p?.["totals"]);
  const cases = count(t?.["cases"]);
  if (!p || !t || mdl == null || cases == null) return null;
  const byFy = arr(p["by_fy"])
    .flatMap((e) => {
      const r = obj(e);
      const fy = whole(r?.["fy"]);
      const n = count(r?.["cases"]);
      return fy != null && n != null ? [{ fy, cases: n }] : [];
    })
    .sort((a, b) => a.fy - b.fy);
  const districts = arr(p["districts"]).flatMap((e) => {
    const r = obj(e);
    const courtId = str(r?.["court_id"]);
    const n = count(r?.["cases"]);
    return courtId && /^[a-z]{2,8}$/.test(courtId) && n != null ? [{ courtId, cases: n }] : [];
  });
  const nos = arr(p["nos"]).flatMap((e) => {
    const r = obj(e);
    const code = whole(r?.["nos"]);
    const label = str(r?.["label"]);
    const n = count(r?.["cases"]);
    return code != null && label && n != null ? [{ nos: code, label, cases: n }] : [];
  });
  const defendants = arr(p["defendants"]).flatMap((e) => {
    const r = obj(e);
    const name = str(r?.["first_listed_defendant"]);
    const n = count(r?.["cases"]);
    return name && n != null ? [{ name, cases: n }] : [];
  });
  return {
    mdl,
    inJpml: p["in_corpus"] === true,
    byFy,
    districts: districts.sort((a, b) => b.cases - a.cases),
    nos: nos.sort((a, b) => b.cases - a.cases),
    defendants: defendants.sort((a, b) => b.cases - a.cases),
    totals: {
      cases,
      pending: count(t["pending"]),
      districts: count(t["districts"]),
      firstFiled: isoDate(t["first_filed"]),
      lastFiled: isoDate(t["last_filed"]),
      medianDays: count(t["median_days"]),
      withDays: count(t["with_days"]),
      transferredIn: count(t["transferred_in"]),
      originating: count(t["originating"]),
      settled: count(t["settled"]),
      mdlTransferOut: count(t["mdl_transfer_out"]),
      classAction: count(t["class_action"]),
      trial: count(t["trial"]),
    },
  };
}

// ---------------------------------------------------------------------------------------------- method and checks

function parseComparison(raw: unknown): Comparison | null {
  const r = obj(raw);
  const compared = count(r?.["compared"]);
  const exact = count(r?.["exact"]);
  if (!r || compared == null || compared <= 0 || exact == null || exact > compared) return null;
  const within = count(r["within_1pct_or_1_case"]);
  return {
    compared,
    exact,
    withinOnePct: within != null && within >= exact && within <= compared ? within : null,
  };
}

function yearRange(raw: unknown): [number, number] | null {
  const a = arr(raw);
  const from = whole(a[0]);
  const to = whole(a[1]);
  return a.length === 2 && from != null && to != null && from <= to ? [from, to] : null;
}

/** The ISO date after "through" in the snapshot note, e.g. "filing dates through 2026-06-30". */
export function throughDate(snapshot: string | null): string | null {
  const m = /through (\d{4}-\d{2}-\d{2})/.exec(snapshot ?? "");
  return isoDate(m?.[1]);
}

export function parseMethod(input: { districts: unknown; mdls?: unknown }): CaseloadMethod | null {
  const s = obj(input.districts);
  if (!s) return null;
  const q = obj(s["quality"]);
  const v = obj(s["validation"]);
  const ao = obj(v?.["vs_ao"]);
  const re = obj(v?.["independent_recheck"]);
  const formulas = Object.entries(obj(s["formulas"]) ?? {}).flatMap(([key, text]) =>
    str(text) ? [{ key, text: text as string }] : [],
  );
  const worst = arr(ao?.["worst_filing_differences"]).flatMap((e) => {
    const r = obj(e);
    const courtId = str(r?.["court_id"]);
    const fy = whole(r?.["fy"]);
    const idb = count(r?.["idb"]);
    const aoN = count(r?.["ao"]);
    const diff = num(r?.["diff"]);
    return courtId && fy != null && idb != null && aoN != null && diff != null
      ? [{ courtId, fy, idb, ao: aoN, diff }]
      : [];
  });
  const filings = parseComparison(ao?.["filings"]);
  const pending = parseComparison(ao?.["pending"]);
  const terminations = parseComparison(ao?.["terminations"]);
  const figures = count(re?.["figures_recomputed"]);
  const mismatches = count(re?.["mismatches"]);
  const m = obj(input.mdls);
  const nonNumeric = obj(m?.["non_numeric_mdl_values_excluded"]);
  const distinctValues = count(nonNumeric?.["distinct_values"]);
  const records = count(nonNumeric?.["records"]);
  return {
    source: str(s["source"]),
    sourcePage: str(s["source_page"]),
    sourceFile: str(s["source_file"]),
    codebook: str(s["codebook"]),
    snapshot: str(s["snapshot"]),
    through: throughDate(str(s["snapshot"])),
    terms: str(s["terms"]),
    builtAt: str(s["built_at"]),
    latestCompleteFy: whole(s["latest_complete_fy"]),
    partialFy: whole(s["partial_fy"]),
    window: str(s["window"]),
    countingRules: arr(s["counting_rules"]).flatMap((r) => (str(r) ? [r as string] : [])),
    formulas,
    groupingNote: str(s["grouping_note"]),
    ranksNote: str(s["ranks_note"]),
    quality: q
      ? {
          rowsLoaded: count(q["csv_records_loaded"]),
          rowsRejected: count(q["csv_records_rejected_by_reader"]),
          pending: count(q["pending"]),
          terminated: count(q["terminated"]),
          terminatedWithDuration: count(q["terminated_with_valid_duration"]),
          missingDisposition: count(q["missing_disp_terminated"]),
          missingNos: count(q["missing_nos"]),
          terminatedBeforeFiled: count(q["terminated_before_filed"]),
          unmappedNosRows: count(q["unmapped_nos_rows"]),
          filedRange: yearRange(q["fy_filed_range"]),
          terminatedRange: yearRange(q["fy_terminated_range"]),
        }
      : null,
    vsAo:
      ao && (filings || pending || terminations)
        ? {
            scope: str(ao["scope"]),
            source: str(ao["source"]),
            reading: str(ao["reading"]),
            filings,
            pending,
            terminations,
            worst,
          }
        : null,
    recheck:
      re && figures != null && mismatches != null
        ? {
            figures,
            mismatches,
            method: str(re["method"]),
            note: str(re["note"]),
            rawRows: count(re["raw_rows_read"]),
          }
        : null,
    mdl: m
      ? {
          evidenceRule: str(m["evidence_rule"]),
          nonNumeric:
            distinctValues != null && records != null ? { distinctValues, records } : null,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------------------------- server functions

const TTL = 10 * 60 * 1000;
const MAX_ENTRIES = 400;

type Cached<T> = { at: number; value: T };
function fresh<T>(entry: Cached<T> | undefined | null): T | null {
  return entry && Date.now() - entry.at < TTL ? entry.value : null;
}
function remember<T>(map: Map<string, Cached<T>>, key: string, value: T) {
  if (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value as string);
  map.set(key, { at: Date.now(), value });
}

const districtsCache: { current: Cached<Listed<DistrictRow>> | null } = { current: null };
const statesCache: { current: Cached<Listed<StateRow>> | null } = { current: null };
const nationalCache: { current: Cached<NationalCaseload | null> | null } = { current: null };
const nosCache: { current: Cached<Listed<NosRow>> | null } = { current: null };
const mdlsCache: { current: Cached<Listed<MdlRow>> | null } = { current: null };
const methodCache: { current: Cached<CaseloadMethod | null> | null } = { current: null };
const districtCache = new Map<string, Cached<DistrictDetail | null>>();
const nosDetailCache = new Map<string, Cached<NosDetail | null>>();
const mdlDetailCache = new Map<string, Cached<MdlDetail | null>>();

type CellsRow = { id: unknown; cells: unknown; links?: unknown; filters?: unknown };

export const getCaseloadDistricts = createServerFn({ method: "GET" }).handler(
  async (): Promise<Listed<DistrictRow>> => {
    const hit = fresh(districtsCache.current);
    if (hit) return hit;
    const res = await restGet<CellsRow[]>(
      "corpus_records?select=id,cells:item->cells,links:item->links,filters&dataset=eq.fjc_civil_districts&order=ordinal.asc&limit=200",
      { count: true },
    );
    const value = parseDistrictRows(res.rows, res.total);
    if (value.rows.length) districtsCache.current = { at: Date.now(), value };
    return value;
  },
);

export const getCaseloadStates = createServerFn({ method: "GET" }).handler(
  async (): Promise<Listed<StateRow>> => {
    const hit = fresh(statesCache.current);
    if (hit) return hit;
    const res = await restGet<CellsRow[]>(
      "corpus_records?select=id,cells:item->cells&dataset=eq.fjc_civil_states&order=ordinal.asc&limit=200",
      { count: true },
    );
    const value = parseList(res.rows, res.total, parseStateRow);
    if (value.rows.length) statesCache.current = { at: Date.now(), value };
    return value;
  },
);

export const getCaseloadNational = createServerFn({ method: "GET" }).handler(
  async (): Promise<NationalCaseload | null> => {
    const hit = fresh(nationalCache.current);
    if (hit) return hit;
    const res = await restGet<{ p: unknown }[]>(
      "corpus_records?select=p:item->profile&dataset=eq.fjc_civil_national&id=eq.US:summary&limit=1",
    );
    const value = parseNational(res.rows[0]?.p);
    if (value) nationalCache.current = { at: Date.now(), value };
    return value;
  },
);

export const getCaseloadDistrict = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^[a-z]{2,8}$/) }).parse(d))
  .handler(async ({ data }): Promise<DistrictDetail | null> => {
    const hit = fresh(districtCache.get(data.id));
    if (hit) return hit;
    const res = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.fjc_civil_districts&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    const value = parseDistrictDetail(data.id, res.rows[0]?.p);
    if (value) remember(districtCache, data.id, value);
    return value;
  });

export const getCaseloadNos = createServerFn({ method: "GET" }).handler(
  async (): Promise<Listed<NosRow>> => {
    const hit = fresh(nosCache.current);
    if (hit) return hit;
    const res = await restGet<CellsRow[]>(
      "corpus_records?select=id,cells:item->cells,filters&dataset=eq.fjc_civil_nos&order=ordinal.asc&limit=500",
      { count: true },
    );
    const value = parseNosRows(res.rows, res.total);
    if (value.rows.length) nosCache.current = { at: Date.now(), value };
    return value;
  },
);

export const getCaseloadNosDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(NOS_ID) }).parse(d))
  .handler(async ({ data }): Promise<NosDetail | null> => {
    const hit = fresh(nosDetailCache.get(data.id));
    if (hit) return hit;
    const res = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.fjc_civil_nos&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    const value = parseNosDetail(data.id, res.rows[0]?.p);
    if (value) remember(nosDetailCache, data.id, value);
    return value;
  });

export const getCaseloadMdls = createServerFn({ method: "GET" }).handler(
  async (): Promise<Listed<MdlRow>> => {
    const hit = fresh(mdlsCache.current);
    if (hit) return hit;
    // Cross-reference links are read only for the numbers already in the JPML records (the rest carry none).
    const [list, links] = await Promise.all([
      restGet<(CellsRow & { inCorpus: unknown })[]>(
        "corpus_records?select=id,cells:item->cells,inCorpus:item->profile->in_corpus&dataset=eq.fjc_civil_mdls&order=ordinal.asc&limit=2000",
        { count: true },
      ),
      restGet<{ id: unknown; links: unknown }[]>(
        `corpus_records?select=id,links:item->links&dataset=eq.fjc_civil_mdls&filters->in_corpus=cs.${encodeURIComponent('["yes"]')}&limit=2000`,
      ),
    ]);
    const value = parseMdlRows(list.rows, links.rows, list.total);
    if (value.rows.length) mdlsCache.current = { at: Date.now(), value };
    return value;
  },
);

export const getCaseloadMdl = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ mdl: z.number().int().min(0).max(99999) }).parse(d))
  .handler(async ({ data }): Promise<MdlDetail | null> => {
    const key = String(data.mdl);
    const hit = fresh(mdlDetailCache.get(key));
    if (hit) return hit;
    const res = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.fjc_civil_mdls&id=eq.${encodeURIComponent(`mdl:${data.mdl}`)}&limit=1`,
    );
    const value = parseMdlDetail(res.rows[0]?.p);
    if (value && value.mdl === data.mdl) remember(mdlDetailCache, key, value);
    return value && value.mdl === data.mdl ? value : null;
  });

export const getCaseloadMethod = createServerFn({ method: "GET" }).handler(
  async (): Promise<CaseloadMethod | null> => {
    const hit = fresh(methodCache.current);
    if (hit) return hit;
    const res = await restGet<{ id: unknown; summary: unknown }[]>(
      "corpus_datasets?select=id,summary:metadata->summary&id=in.(fjc_civil_districts,fjc_civil_mdls)",
    );
    const by = new Map(res.rows.map((r) => [str(r.id), r.summary]));
    const value = parseMethod({
      districts: by.get("fjc_civil_districts"),
      mdls: by.get("fjc_civil_mdls"),
    });
    if (value) methodCache.current = { at: Date.now(), value };
    return value;
  },
);

// ---------------------------------------------------------------------------------------------- case-type groups over time

/** One of this project's nature-of-suit groups: civil filings per fiscal year (FJC IDB). */
export type CaseGroupTrend = {
  id: string;
  label: string;
  years: { fy: number; partial: boolean; filings: number | null }[];
};

export function parseGroupTrends(
  rows: readonly { id?: unknown; name?: unknown; s?: unknown }[],
): Listed<CaseGroupTrend> {
  const seen = new Set<string>();
  return parseList([...rows], rows.length, (r) => {
    const id = str(r.id);
    const label = str(r.name);
    if (!id || !label || !/^group:[a-z_]{2,40}$/.test(id) || seen.has(id)) return null;
    seen.add(id);
    const years = parseYears(r.s, null).map((y) => ({
      fy: y.fy,
      partial: y.partial,
      filings: y.filings,
    }));
    return years.length ? { id, label, years } : null;
  });
}

const groupTrendCache: { current: { at: number; value: Listed<CaseGroupTrend> } | null } = {
  current: null,
};

/** Filings per fiscal year for every nature-of-suit group (one read; the series are trimmed to filings here). */
export const getCaseloadGroupTrends = createServerFn({ method: "GET" }).handler(
  async (): Promise<Listed<CaseGroupTrend>> => {
    const hit = fresh(groupTrendCache.current);
    if (hit) return hit;
    const res = await restGet<{ id: unknown; name: unknown; s: unknown }[]>(
      "corpus_records?select=id,name:item->cells->name,s:item->profile->series&dataset=eq.fjc_civil_nos&id=like.group:*&order=ordinal.asc&limit=100",
    );
    const value = parseGroupTrends(res.rows);
    if (value.rows.length) groupTrendCache.current = { at: Date.now(), value };
    return value;
  },
);
