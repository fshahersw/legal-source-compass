/**
 * Federal judiciary statistics and appointment records (stream "judiciary", built by scripts/enrichment/judiciary):
 *   fjc_appeals_outcomes         FJC Integrated Database, appeals FY2008 - Jun 2026 (AO Table B-5 definitions)
 *   fjc_criminal_districts       FJC Integrated Database, criminal defendants FY1996 - Jun 2026 (Tables D, D-4, D-5)
 *   fjc_bankruptcy_districts     FJC Integrated Database, bankruptcy cases FY2008 - Jun 2026 (Table F-2 definitions)
 *   judicial_vacancies           uscourts.gov vacancy, future-vacancy, emergency and confirmation lists, 1981-2026
 *   judicial_nominations         Congress.gov nominations to federal judgeships, 1981-2026
 *   judicial_confirmation_votes  Senate roll-call votes (senate.gov XML) on those nominations, 1989-2026
 *   judge_profiles_fjc           FJC Biographical Directory of Article III judges
 * Read-only. Stored JSON is validated here: a malformed value is dropped (never repaired), counts must be non-negative
 * integers whose parts do not exceed their whole, percentages lie within 0-100, dates are ISO days, external links must
 * be https on the publisher's host, and in-app links are passed on only as bare ids of the shapes the routes accept.
 * Unknown values stay null and are shown as "Not recorded".
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 300) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
export const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
export const pct = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
const nonneg = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n < 1_000_000 ? n : null;
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const day = (v: unknown) => {
  const s = str(v, 10);
  return s && ISO_DAY.test(s) ? s : null;
};
const month = (v: unknown) => {
  const s = str(v, 7);
  return s && /^\d{4}-\d{2}$/.test(s) ? s : null;
};
const fy = (v: unknown) => {
  const n = count(v);
  return n != null && n >= 1700 && n <= 2100 ? n : null;
};

export const COURT_ID = /^[a-z0-9]{2,20}$/;
export const CIRCUIT_ID = /^(ca([1-9]|1[01])|cadc)$/;
export const JUDGE_ID = /^[a-z0-9]{8,64}$/;
/** The FY2026 files end on June 30, 2026 (three quarters). */
export const PARTIAL_FY = 2026;

/** A court id for `/courts/<id>`; anything else is dropped. */
export const courtLink = (v: unknown) => {
  const s = str(v, 40);
  return s && COURT_ID.test(s) ? s : null;
};
/** A judge profile id for `/judges/<id>`; anything else is dropped. */
export const judgeLink = (v: unknown) => {
  const s = str(v, 64);
  return s && JUDGE_ID.test(s) ? s : null;
};
export const safeHttps = (v: unknown, hosts: readonly string[]) => {
  const s = str(v, 600);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && hosts.includes(u.hostname) ? s : null;
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------------------------------------ appeals
export type AppealsCell = {
  terminated: number;
  merits: number;
  meritsAppeals: number;
  meritsOriginal: number;
  procedural: number;
  consolidated: number;
  affirmed: number;
  affirmedInPart: number;
  reversed: number;
  dismissed: number;
  remanded: number;
  other: number;
  coaDenied: number;
  reversedPct: number | null;
  affirmedPct: number | null;
  publishedPct: number | null;
  medianDays: number | null;
};
export type AppealsYear = AppealsCell & { fy: number; partialYear: boolean };
export type AppealsNature = AppealsCell & { nature: string; label: string };
export type AppealsOrigin = AppealsCell & { origin: string; label: string; courtId: string | null };
export type AppealsNos = AppealsCell & { nos: number; label: string };
export type AppealsProfile = {
  kind: "circuit" | "district";
  courtId: string;
  label: string | null;
  circuitId: string | null;
  series: AppealsYear[];
  byNature: AppealsNature[];
  byNatureLatest: AppealsNature[];
  byOrigin: AppealsOrigin[];
  topNos: AppealsNos[];
  window: AppealsCell | null;
  circuitBase: AppealsCell | null;
  reversalRank: number | null;
  rankedDistricts: number | null;
  pending: number | null;
};

const OUTCOME_KEYS = [
  "affirmed",
  "partial",
  "reversed",
  "dismissed",
  "remanded",
  "other",
  "coa_denied",
] as const;

export function parseAppealsCell(v: unknown): AppealsCell | null {
  const o = obj(v);
  if (!o) return null;
  const terminated = count(o["terminated"]);
  const merits = count(o["merits"]);
  const meritsAppeals = count(o["merits_appeals"]);
  const outcomes = OUTCOME_KEYS.map((k) => count(o[k]));
  if (terminated == null || merits == null || meritsAppeals == null) return null;
  if (outcomes.some((x) => x == null)) return null;
  const [affirmed, affirmedInPart, reversed, dismissed, remanded, other, coaDenied] =
    outcomes as number[];
  // the outcome counts are parts of the merits terminations, which are part of all terminations
  if (merits > terminated || meritsAppeals > merits) return null;
  const parts =
    (outcomes as number[]).reduce((a, b) => a + b, 0) + (count(o["outcome_missing"]) ?? 0);
  if (parts > meritsAppeals) return null;
  return {
    terminated,
    merits,
    meritsAppeals,
    meritsOriginal: count(o["merits_original"]) ?? merits - meritsAppeals,
    procedural: count(o["procedural"]) ?? 0,
    consolidated: count(o["consolidated"]) ?? 0,
    affirmed: affirmed!,
    affirmedInPart: affirmedInPart!,
    reversed: reversed!,
    dismissed: dismissed!,
    remanded: remanded!,
    other: other!,
    coaDenied: coaDenied!,
    reversedPct: pct(o["reversed_pct"]),
    affirmedPct: pct(o["affirmed_pct"]),
    publishedPct: pct(o["published_pct"]),
    medianDays: nonneg(o["median_days"]),
  };
}

export function parseAppealsProfile(raw: unknown, courtId: string): AppealsProfile | null {
  const p = obj(raw);
  if (!p) return null;
  const kind = p["kind"] === "circuit" ? "circuit" : p["kind"] === "district" ? "district" : null;
  if (!kind || p["court_id"] !== courtId) return null;
  const series: AppealsYear[] = [];
  const seen = new Set<number>();
  for (const y of arr(p["series"])) {
    const o = obj(y);
    const year = fy(o?.["fy"]);
    const cell = parseAppealsCell(o);
    if (year == null || !cell || seen.has(year)) continue;
    seen.add(year);
    series.push({ ...cell, fy: year, partialYear: year === PARTIAL_FY });
  }
  series.sort((a, b) => a.fy - b.fy);
  const natures = (v: unknown) =>
    arr(v).flatMap((x) => {
      const o = obj(x);
      const cell = parseAppealsCell(o);
      const nature = str(o?.["nature"], 40);
      const label = str(o?.["label"], 120);
      return cell && nature && label ? [{ ...cell, nature, label }] : [];
    });
  const byOrigin = arr(p["by_origin_window"]).flatMap((x) => {
    const o = obj(x);
    const cell = parseAppealsCell(o);
    const origin = str(o?.["origin"], 80);
    const label = str(o?.["label"], 160);
    return cell && origin && label
      ? [{ ...cell, origin, label, courtId: courtLink(o?.["court_id"]) }]
      : [];
  });
  const topNos = arr(p["top_nos_window"]).flatMap((x) => {
    const o = obj(x);
    const cell = parseAppealsCell(o);
    const nos = count(o?.["nos"]);
    const label = str(o?.["label"], 160);
    return cell && nos != null && label ? [{ ...cell, nos, label }] : [];
  });
  const circuitId = str(p["circuit_id"], 8);
  const rank = count(p["reversal_rank_in_circuit"]);
  const ranked = count(p["districts_ranked_in_circuit"]);
  return {
    kind,
    courtId,
    label: str(kind === "circuit" ? p["circuit_name"] : p["district_label"], 80),
    circuitId: kind === "district" && circuitId && CIRCUIT_ID.test(circuitId) ? circuitId : null,
    series,
    byNature: natures(p["by_nature_window"]),
    byNatureLatest: natures(p["by_nature_latest"]),
    byOrigin,
    topNos,
    window: parseAppealsCell(p["window"]),
    circuitBase: parseAppealsCell(
      kind === "circuit" ? p["from_districts_window"] : p["circuit_from_districts_window"],
    ),
    reversalRank: rank != null && ranked != null && rank >= 1 && rank <= ranked ? rank : null,
    rankedDistricts: ranked,
    pending: count(p["pending_2026_06_30"]),
  };
}

const APPEALS_SELECT = [
  "kind:item->kind",
  "court_id:item->court_id",
  "circuit_id:item->circuit_id",
  "circuit_name:item->circuit_name",
  "district_label:item->district_label",
  "series:item->series",
  "by_nature_window:item->by_nature_window",
  "by_nature_latest:item->by_nature_latest",
  "by_origin_window:item->by_origin_window",
  "top_nos_window:item->top_nos_window",
  "window:item->window",
  "from_districts_window:item->from_districts_window",
  "circuit_from_districts_window:item->circuit_from_districts_window",
  "reversal_rank_in_circuit:item->reversal_rank_in_circuit",
  "districts_ranked_in_circuit:item->districts_ranked_in_circuit",
  "pending_2026_06_30:item->pending_2026_06_30",
].join(",");

export const getAppealsOutcomes = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<AppealsProfile | null> => {
    const rid = CIRCUIT_ID.test(data.id) ? `circuit:${data.id}` : `district:${data.id}`;
    const r = await restGet<Record<string, unknown>[]>(
      `corpus_records?select=${APPEALS_SELECT}&dataset=eq.fjc_appeals_outcomes&id=eq.${encodeURIComponent(rid)}&limit=1`,
    );
    return r.rows.length === 1 ? parseAppealsProfile(r.rows[0], data.id) : null;
  });

// ------------------------------------------------------------------------------------------------ criminal
export type CriminalYear = {
  fy: number;
  partialYear: boolean;
  filed: number;
  terminated: number;
  disposed: number;
  pending: number | null;
  convicted: number;
  plea: number;
  convictedBench: number;
  convictedJury: number;
  acquitted: number;
  dismissed: number;
  prison: number;
  probation: number;
  fineOnly: number;
  convictionPct: number | null;
  pleaPct: number | null;
  trialPct: number | null;
  prisonPct: number | null;
  medianPrisonMonths: number | null;
  medianDays: number | null;
};
export type CriminalOffense = {
  group: string;
  label: string;
  filed: number;
  disposed: number;
  convicted: number;
  pleaPct: number | null;
  prisonPct: number | null;
  medianPrisonMonths: number | null;
};
export type CriminalProfile = {
  courtId: string;
  label: string | null;
  series: CriminalYear[];
  offenses: CriminalOffense[];
  topCodes: { code: string; label: string; disposed: number }[];
  counsel: { label: string; disposed: number; sharePct: number | null }[];
  ranks: {
    filed: number | null;
    prisonPct: number | null;
    medianPrisonMonths: number | null;
    trialPct: number | null;
    of: number | null;
  };
};

export function parseCriminalYear(v: unknown): CriminalYear | null {
  const o = obj(v);
  const year = fy(o?.["fy"]);
  const filed = count(o?.["filed"]);
  const terminated = count(o?.["terminated"]);
  const disposed = count(o?.["disposed"]);
  const convicted = count(o?.["convicted"]);
  if (!o || year == null || filed == null || terminated == null || disposed == null) return null;
  if (convicted == null || convicted > disposed || disposed > terminated) return null;
  const c = (k: string) => count(o[k]) ?? 0;
  const plea = c("disp_convicted_plea");
  const convictedBench = c("disp_convicted_bench");
  const convictedJury = c("disp_convicted_jury");
  if (plea + convictedBench + convictedJury !== convicted) return null;
  const prison = c("sent_prison");
  const probation = c("sent_probation");
  const fineOnly = c("sent_fine_only");
  if (prison + probation + fineOnly > convicted) return null;
  return {
    fy: year,
    partialYear: year === PARTIAL_FY,
    filed,
    terminated,
    disposed,
    pending: count(o["pending"]),
    convicted,
    plea,
    convictedBench,
    convictedJury,
    acquitted: c("disp_acquitted_bench") + c("disp_acquitted_jury"),
    dismissed: c("disp_dismissed"),
    prison,
    probation,
    fineOnly,
    convictionPct: pct(o["conviction_pct"]),
    pleaPct: pct(o["plea_pct"]),
    trialPct: pct(o["trial_pct"]),
    prisonPct: pct(o["prison_pct"]),
    medianPrisonMonths: nonneg(o["median_prison_months"]),
    medianDays: nonneg(o["median_days_to_termination"]),
  };
}

export function parseCriminalProfile(raw: unknown, courtId: string): CriminalProfile | null {
  const p = obj(raw);
  if (!p || p["court_id"] !== courtId) return null;
  const series = arr(p["series"])
    .map(parseCriminalYear)
    .filter((x): x is CriminalYear => !!x)
    .sort((a, b) => a.fy - b.fy);
  if (!series.length) return null;
  const offenses = arr(p["offenses_window"]).flatMap((x) => {
    const o = obj(x);
    const group = str(o?.["group"], 40);
    const label = str(o?.["label"], 120);
    const disposed = count(o?.["disposed"]);
    const convicted = count(o?.["convicted"]);
    return group && label && disposed != null && convicted != null && convicted <= disposed
      ? [
          {
            group,
            label,
            filed: count(o?.["filed"]) ?? 0,
            disposed,
            convicted,
            pleaPct: pct(o?.["plea_pct"]),
            prisonPct: pct(o?.["prison_pct"]),
            medianPrisonMonths: nonneg(o?.["median_prison_months"]),
          },
        ]
      : [];
  });
  const topCodes = arr(p["top_offense_codes_window"]).flatMap((x) => {
    const o = obj(x);
    const code = str(o?.["code"], 8);
    const label = str(o?.["label"], 120);
    const n = count(o?.["disposed"]);
    return code && label && n != null ? [{ code, label, disposed: n }] : [];
  });
  const counsel = arr(p["counsel_window"]).flatMap((x) => {
    const o = obj(x);
    const label = str(o?.["label"], 120);
    const n = count(o?.["disposed"]);
    return label && n != null ? [{ label, disposed: n, sharePct: pct(o?.["share_pct"]) }] : [];
  });
  const ranks = obj(p["ranks_latest"]);
  const of = obj(p["ranks_of"]);
  return {
    courtId,
    label: str(p["district_label"], 80),
    series,
    offenses,
    topCodes,
    counsel,
    ranks: {
      filed: count(ranks?.["filed"]),
      prisonPct: count(ranks?.["prison_pct"]),
      medianPrisonMonths: count(ranks?.["median_prison_months"]),
      trialPct: count(ranks?.["trial_pct"]),
      of: count(of?.["filed"]),
    },
  };
}

export const getCriminalCaseload = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<CriminalProfile | null> => {
    const sel =
      "court_id:item->court_id,district_label:item->district_label,series:item->series,offenses_window:item->offenses_window,top_offense_codes_window:item->top_offense_codes_window,counsel_window:item->counsel_window,ranks_latest:item->ranks_latest,ranks_of:item->ranks_of";
    const r = await restGet<Record<string, unknown>[]>(
      `corpus_records?select=${sel}&dataset=eq.fjc_criminal_districts&id=eq.${encodeURIComponent(`district:${data.id}`)}&limit=1`,
    );
    return r.rows.length === 1 ? parseCriminalProfile(r.rows[0], data.id) : null;
  });

// ------------------------------------------------------------------------------------------------ bankruptcy
export type BankruptcyPeriod = {
  period: string;
  label: string;
  filed: number;
  closed: number;
  pendingEnd: number;
  ch7: number;
  ch11: number;
  ch12: number;
  ch13: number;
  ch15: number;
  business: number;
  consumer: number;
  businessCh11: number;
  subchapterV: number;
  businessSharePct: number | null;
};
export type BankruptcyFilings = {
  districtId: string;
  bankruptcyCourtId: string | null;
  districtLabel: string | null;
  series: BankruptcyPeriod[];
  ranks: { filed: number | null; businessCh11: number | null; of: number | null };
};

export function parseBankruptcyPeriod(v: unknown): BankruptcyPeriod | null {
  const o = obj(v);
  const period = str(o?.["period"], 12);
  const label = str(o?.["label"], 60);
  const filed = count(o?.["filed"]);
  if (!o || !period || !/^(\d{4}|\d{4}-\d{2}-\d{2})$/.test(period) || !label || filed == null)
    return null;
  const c = (k: string) => count(o[k]) ?? 0;
  const chapters =
    c("filed_ch7") + c("filed_ch11") + c("filed_ch12") + c("filed_ch13") + c("filed_ch15");
  const debt = c("filed_business") + c("filed_consumer");
  if (chapters > filed || debt > filed || c("filed_business_ch11") > c("filed_business"))
    return null;
  return {
    period,
    label,
    filed,
    closed: c("closed"),
    pendingEnd: c("pending_end"),
    ch7: c("filed_ch7"),
    ch11: c("filed_ch11"),
    ch12: c("filed_ch12"),
    ch13: c("filed_ch13"),
    ch15: c("filed_ch15"),
    business: c("filed_business"),
    consumer: c("filed_consumer"),
    businessCh11: c("filed_business_ch11"),
    subchapterV: c("filed_subchapter_v"),
    businessSharePct: pct(o["business_share_pct"]),
  };
}

export function parseBankruptcyFilings(raw: unknown, courtId: string): BankruptcyFilings | null {
  const p = obj(raw);
  if (!p) return null;
  const districtId = courtLink(p["court_id"]);
  const bk = courtLink(p["bankruptcy_court_id"]);
  if (!districtId || (districtId !== courtId && bk !== courtId)) return null;
  const series = arr(p["series"])
    .map(parseBankruptcyPeriod)
    .filter((x): x is BankruptcyPeriod => !!x);
  if (!series.length) return null;
  const r = obj(p["ranks_fy2025"]);
  return {
    districtId,
    bankruptcyCourtId: bk,
    districtLabel: str(p["district_label"], 80),
    series,
    ranks: {
      filed: count(r?.["filed"]),
      businessCh11: count(r?.["business_ch11"]),
      of: count(r?.["of"]),
    },
  };
}

export const getBankruptcyFilings = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<BankruptcyFilings | null> => {
    const filter = encodeURIComponent(JSON.stringify({ court: [data.id] }));
    const sel =
      "court_id:item->court_id,bankruptcy_court_id:item->bankruptcy_court_id,district_label:item->district_label,series:item->series,ranks_fy2025:item->ranks_fy2025";
    const r = await restGet<Record<string, unknown>[]>(
      `corpus_records?select=${sel}&dataset=eq.fjc_bankruptcy_districts&filters=cs.${filter}&limit=2`,
    );
    // exactly one district record may name the court; anything else shows nothing
    return r.rows.length === 1 ? parseBankruptcyFilings(r.rows[0], data.id) : null;
  });

// ------------------------------------------------------------------------------------------------ vacancies
export type Vacancy = {
  id: string | null;
  courtId: string | null;
  courtName: string | null;
  courtAsPublished: string | null;
  incumbent: string | null;
  reason: string | null;
  vacancyDate: string | null;
  notificationDate: string | null;
  status: string;
  daysOpen: number | null;
  pendingNominee: string | null;
  pendingNominationDate: string | null;
  latestNominee: string | null;
  emergencyDaysPending: string | null;
  weightedFilings: string | null;
  emergency: boolean;
  confirmation: { nominee: string | null; date: string | null; judgeId: string | null } | null;
  firstListed: string | null;
  lastListed: string | null;
  incumbentJudgeId: string | null;
};
const VAC_STATUS = new Set(["open", "announced", "confirmation_listed", "no_longer_listed"]);
const FIGURE = /^[\d,.]+$/;

export function parseVacancy(v: unknown): Vacancy | null {
  const o = obj(v);
  if (!o) return null;
  const status = str(o["status"], 40);
  if (!status || !VAC_STATUS.has(status)) return null;
  const conf = obj(o["confirmation"]) ?? obj(arr(o["confirmations"]).at(-1));
  const lastNom = obj(arr(o["nominees"]).at(-1));
  const pending = obj(o["pending_nominee"]);
  const em = obj(o["emergency"]);
  const emLatest = obj(em?.["latest"]);
  const fig = (x: unknown) => {
    const s = str(x, 12);
    return s && FIGURE.test(s) ? s : null;
  };
  return {
    id: str(o["id"], 160),
    courtId: courtLink(o["court_id"]),
    courtName: str(o["court_name"], 160),
    courtAsPublished: str(o["court_as_published"], 40),
    incumbent: str(o["incumbent"], 120),
    reason: str(o["reason"], 40),
    vacancyDate: day(o["vacancy_date"]),
    notificationDate: day(o["notification_date"]),
    status,
    daysOpen: count(o["days_open_as_of_2026_10_22"]),
    pendingNominee: str(o["pending_nominee"], 120) ?? str(pending?.["nominee"], 120),
    pendingNominationDate: day(o["pending_nomination_date"]) ?? day(pending?.["nomination_date"]),
    latestNominee: str(o["nominee"], 120) ?? str(lastNom?.["nominee"], 120),
    emergencyDaysPending: fig(o["emergency_days_pending"]) ?? fig(emLatest?.["days_pending"]),
    weightedFilings: fig(o["weighted"]) ?? fig(emLatest?.["weighted"]),
    emergency: em ? em["current"] === true : fig(o["emergency_days_pending"]) != null,
    confirmation: conf
      ? {
          nominee: str(conf["nominee"], 120),
          date: day(conf["confirmation_date"]),
          judgeId: judgeLink(obj(conf["fjc_link"])?.["judge_profile_id"]),
        }
      : null,
    firstListed: month(o["first_listed"]),
    lastListed: month(o["last_listed"]),
    incumbentJudgeId: judgeLink(obj(o["incumbent_fjc_link"])?.["judge_profile_id"]),
  };
}

const vacancyList = (v: unknown) =>
  arr(v)
    .map(parseVacancy)
    .filter((x): x is Vacancy => !!x);

export type CourtVacancies = {
  courtId: string;
  courtName: string | null;
  open: Vacancy[];
  announced: Vacancy[];
  emergencies: Vacancy[];
  recent: Vacancy[];
  byYear: { year: string; vacancies: number }[];
  listedTotal: number | null;
  medianDaysToConfirmation: number | null;
  confirmationsWithDates: number | null;
};

export function parseCourtVacancies(raw: unknown, courtId: string): CourtVacancies | null {
  const p = obj(raw);
  if (!p || p["court_id"] !== courtId) return null;
  const byYear = Object.entries(obj(p["vacancies_by_year_opened"]) ?? {}).flatMap(([y, n]) => {
    const c = count(n);
    return /^\d{4}$/.test(y) && c != null ? [{ year: y, vacancies: c }] : [];
  });
  return {
    courtId,
    courtName: str(p["court_name"], 160),
    open: vacancyList(p["open"]),
    announced: vacancyList(p["announced"]),
    emergencies: vacancyList(p["emergencies"]),
    recent: vacancyList(p["recent_history"]),
    byYear: byYear.sort((a, b) => a.year.localeCompare(b.year)),
    listedTotal: count(p["vacancies_listed_total"]),
    medianDaysToConfirmation: count(p["median_days_vacancy_to_confirmation"]),
    confirmationsWithDates: count(p["confirmations_with_dates"]),
  };
}

export const getCourtVacancies = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<CourtVacancies | null> => {
    const sel =
      "court_id:item->court_id,court_name:item->court_name,open:item->open,announced:item->announced,emergencies:item->emergencies,recent_history:item->recent_history,vacancies_by_year_opened:item->vacancies_by_year_opened,vacancies_listed_total:item->vacancies_listed_total,median_days_vacancy_to_confirmation:item->median_days_vacancy_to_confirmation,confirmations_with_dates:item->confirmations_with_dates";
    const r = await restGet<Record<string, unknown>[]>(
      `corpus_records?select=${sel}&dataset=eq.judicial_vacancies&id=eq.${encodeURIComponent(`court:${data.id}`)}&limit=1`,
    );
    return r.rows.length === 1 ? parseCourtVacancies(r.rows[0], data.id) : null;
  });

export type VacancyMonth = {
  month: string;
  vacanciesListed: number | null;
  futureListed: number | null;
  emergenciesListed: number | null;
  publishedTotal: number | null;
  parsed: boolean;
};
export type VacanciesOverview = {
  open: Vacancy[];
  announced: Vacancy[];
  emergencies: Vacancy[];
  recentConfirmations: Vacancy[];
  series: VacancyMonth[];
  coverage: { parsed: number; notParsed: number; partial: number; noRows: number };
};

export function parseVacancyMonth(v: unknown): VacancyMonth | null {
  const o = obj(v);
  const m = month(o?.["month"]);
  if (!o || !m) return null;
  const reports = obj(o["reports"]) ?? {};
  return {
    month: m,
    vacanciesListed: count(o["vacancies_listed"]),
    futureListed: count(o["future_listed"]),
    emergenciesListed: count(o["emergencies_listed"]),
    publishedTotal: count(o["published_total_vacancies"]),
    parsed: reports["vacancies"] === "parsed",
  };
}

export function parseCoverage(v: unknown) {
  const cov = obj(v) ?? {};
  let notParsed = 0;
  let partial = 0;
  for (const [k, n] of Object.entries(cov)) {
    if (k.startsWith("not parsed")) notParsed += count(n) ?? 0;
    if (k.startsWith("partial")) partial += count(n) ?? 0;
  }
  return {
    parsed: count(cov["parsed"]) ?? 0,
    notParsed,
    partial,
    noRows: count(cov["no rows found"]) ?? 0,
  };
}

const VACANCY_ROW_SELECT =
  "id,court_id:item->court_id,court_name:item->court_name,court_as_published:item->court_as_published,incumbent:item->incumbent,reason:item->reason,vacancy_date:item->vacancy_date,notification_date:item->notification_date,status:item->status,days_open_as_of_2026_10_22:item->days_open_as_of_2026_10_22,nominees:item->nominees,pending_nominee:item->pending_nominee,emergency:item->emergency,confirmations:item->confirmations,first_listed:item->first_listed,last_listed:item->last_listed,incumbent_fjc_link:item->incumbent_fjc_link";

const byCourt = (a: Vacancy, b: Vacancy) =>
  (a.courtName ?? a.courtAsPublished ?? "").localeCompare(
    b.courtName ?? b.courtAsPublished ?? "",
  ) || (a.vacancyDate ?? "").localeCompare(b.vacancyDate ?? "");

export const getVacanciesOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<VacanciesOverview | null> => {
    const rows = (filter: Record<string, string[]>) =>
      restGet<Record<string, unknown>[]>(
        `corpus_records?select=${VACANCY_ROW_SELECT}&dataset=eq.judicial_vacancies&filters=cs.${encodeURIComponent(JSON.stringify(filter))}&limit=300`,
      );
    const [nat, open, ann, em] = await Promise.all([
      restGet<{ series: unknown; coverage: unknown; recent: unknown }[]>(
        "corpus_records?select=series:item->series,coverage:item->coverage,recent:item->recent_confirmations&dataset=eq.judicial_vacancies&id=eq.national&limit=1",
      ),
      rows({ status: ["open"] }),
      rows({ status: ["announced"] }),
      rows({ emergency: ["yes"] }),
    ]);
    if (nat.rows.length !== 1) return null;
    const n = nat.rows[0]!;
    return {
      open: vacancyList(open.rows).sort(byCourt),
      announced: vacancyList(ann.rows).sort(byCourt),
      emergencies: vacancyList(em.rows).sort(byCourt),
      recentConfirmations: vacancyList(n.recent),
      series: arr(n.series)
        .map(parseVacancyMonth)
        .filter((x): x is VacancyMonth => !!x),
      coverage: parseCoverage(n.coverage),
    };
  },
);

// ------------------------------------------------------------------------------------------------ nominations and votes
export type PartySplit = {
  party: string;
  yea: number;
  nay: number;
  notVoting: number;
  present: number;
};
export type SenateVote = {
  voteId: string;
  date: string | null;
  question: string;
  result: string | null;
  yeas: number | null;
  nays: number | null;
  split: PartySplit[];
  enBlocSize: number;
  pageUrl: string | null;
};
export type Nomination = {
  id: string;
  citation: string;
  congress: number;
  receivedDate: string | null;
  nominee: string | null;
  description: string | null;
  category: string | null;
  courtIds: string[];
  predecessor: string | null;
  newPosition: boolean;
  status: string;
  statusDate: string | null;
  referral: { date: string | null; committee: string | null } | null;
  hearings: { date: string | null; citation: string | null }[];
  committeeActions: { date: string | null; text: string }[];
  cloture: { date: string | null; text: string; yeas: number | null; nays: number | null }[];
  confirmation: {
    date: string | null;
    method: string;
    yeas: number | null;
    nays: number | null;
    recordVote: number | null;
  } | null;
  votes: SenateVote[];
  congressUrl: string | null;
};

export const VOTE_ID = /^\d{3}-[12]-\d{1,5}$/;
const PARTY = /^[A-Z]{1,3}$/;
const NOM_STATUS = new Set([
  "confirmed",
  "withdrawn",
  "returned",
  "rejected",
  "pending",
  "no_final_action",
]);
const CONF_METHOD = new Set(["Roll call", "Voice vote", "Unanimous consent", "As published"]);

export function parsePartySplit(v: unknown): PartySplit[] {
  return arr(v).flatMap((x) => {
    const s = obj(x);
    const party = str(s?.["party"], 3);
    const yea = count(s?.["yea"]);
    const nay = count(s?.["nay"]);
    const nv = count(s?.["not_voting"]);
    const present = count(s?.["present"]) ?? 0;
    return party &&
      PARTY.test(party) &&
      yea != null &&
      nay != null &&
      nv != null &&
      yea + nay + nv + present <= 101
      ? [{ party, yea, nay, notVoting: nv, present }]
      : [];
  });
}

export function parseSenateVote(v: unknown): SenateVote | null {
  const o = obj(v);
  const voteId = str(o?.["vote_id"], 20);
  const question = str(o?.["question"], 120);
  if (!o || !voteId || !VOTE_ID.test(voteId) || !question) return null;
  const yeas = count(o["yeas"]);
  const nays = count(o["nays"]);
  const split = parsePartySplit(o["party_split"]);
  // a party split is shown only when it adds up to the published tally
  const sums =
    yeas != null &&
    nays != null &&
    split.reduce((a, s) => a + s.yea, 0) === yeas &&
    split.reduce((a, s) => a + s.nay, 0) === nays;
  return {
    voteId,
    date: day(o["date"]),
    question,
    result: str(o["result_text"], 160),
    yeas,
    nays,
    split: sums ? split : [],
    enBlocSize: count(o["en_bloc_size"]) ?? 1,
    pageUrl: safeHttps(o["page_url"], ["www.senate.gov"]),
  };
}

export function parseNomination(raw: unknown): Nomination | null {
  const o = obj(raw);
  const id = str(o?.["id"], 40);
  const citation = str(o?.["citation"], 20);
  const congress = count(o?.["congress"]);
  const status = str(o?.["status"], 30);
  if (!o || !id || !citation || !/^PN\d+(-\d+)?$/.test(citation)) return null;
  if (congress == null || congress < 97 || congress > 130 || !status || !NOM_STATUS.has(status))
    return null;
  const ref = obj(o["referral"]);
  const conf = obj(o["confirmation"]);
  const method = str(conf?.["method"], 40);
  return {
    id,
    citation,
    congress,
    receivedDate: day(o["received_date"]),
    nominee: str(o["nominee_name"], 160),
    description: str(o["description"], 800),
    category: str(o["category"], 40),
    courtIds: arr(o["court_ids"]).flatMap((c) => {
      const cid = courtLink(c);
      return cid ? [cid] : [];
    }),
    predecessor: str(o["predecessor_text"], 300),
    newPosition: o["new_position"] === true,
    status,
    statusDate: day(o["status_date"]),
    referral: ref ? { date: day(ref["date"]), committee: str(ref["committee"], 160) } : null,
    hearings: arr(o["hearings"]).flatMap((h) => {
      const x = obj(h);
      return x ? [{ date: day(x["date"]), citation: str(x["citation"], 80) }] : [];
    }),
    committeeActions: arr(o["committee_actions"]).flatMap((h) => {
      const x = obj(h);
      const text = str(x?.["text"], 500);
      return x && text ? [{ date: day(x["date"]), text }] : [];
    }),
    cloture: arr(o["cloture"]).flatMap((h) => {
      const x = obj(h);
      const text = str(x?.["text"], 500);
      return x && text
        ? [{ date: day(x["date"]), text, yeas: count(x["yeas"]), nays: count(x["nays"]) }]
        : [];
    }),
    confirmation:
      conf && method && CONF_METHOD.has(method)
        ? {
            date: day(conf["date"]),
            method,
            yeas: count(conf["yeas"]),
            nays: count(conf["nays"]),
            recordVote: count(conf["record_vote"]),
          }
        : null,
    votes: arr(o["senate_votes"])
      .map(parseSenateVote)
      .filter((x): x is SenateVote => !!x),
    congressUrl: safeHttps(o["congress_url"], ["www.congress.gov"]),
  };
}

const NOMINATION_SELECT =
  "id,citation:item->citation,congress:item->congress,received_date:item->received_date,nominee_name:item->nominee_name,description:item->description,category:item->category,court_ids:item->court_ids,predecessor_text:item->predecessor_text,new_position:item->new_position,status:item->status,status_date:item->status_date,referral:item->referral,hearings:item->hearings,committee_actions:item->committee_actions,cloture:item->cloture,confirmation:item->confirmation,senate_votes:item->senate_votes,congress_url:item->congress_url";

/** Nominations linked to this judge by exact key (see build_nominations.py), oldest first. */
export const getJudgeNominations = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<Nomination[]> => {
    const f = encodeURIComponent(JSON.stringify({ judge_profile: [data.id] }));
    const r = await restGet<Record<string, unknown>[]>(
      `corpus_records?select=${NOMINATION_SELECT}&dataset=eq.judicial_nominations&filters=cs.${f}&limit=30`,
    );
    return r.rows
      .map(parseNomination)
      .filter((x): x is Nomination => !!x)
      .sort((a, b) => (a.receivedDate ?? "").localeCompare(b.receivedDate ?? ""));
  });

export type SenatorVote = { name: string; party: string; state: string; vote: string };
export type SenateVoteMembers = {
  voteId: string;
  members: SenatorVote[];
  pageUrl: string | null;
};

export function parseVoteMembers(raw: unknown, voteId: string): SenateVoteMembers | null {
  const o = obj(raw);
  if (!o || o["vote_id"] !== voteId) return null;
  const members = arr(o["members"]).flatMap((m) => {
    const x = obj(m);
    const name = str(x?.["name"], 80);
    const party = str(x?.["party"], 3);
    const state = str(x?.["state"], 2);
    const vote = str(x?.["vote"], 40);
    return name && party && PARTY.test(party) && state && /^[A-Z]{2}$/.test(state) && vote
      ? [{ name, party, state, vote }]
      : [];
  });
  if (!members.length || members.length > 101) return null;
  return { voteId, members, pageUrl: safeHttps(o["page_url"], ["www.senate.gov"]) };
}

/** Every senator's vote on one roll call, exactly as the Senate published it. */
export const getSenateVoteMembers = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ voteId: z.string().regex(VOTE_ID) }).parse(d))
  .handler(async ({ data }): Promise<SenateVoteMembers | null> => {
    const r = await restGet<Record<string, unknown>[]>(
      `corpus_records?select=vote_id:item->vote_id,members:item->members,page_url:item->page_url&dataset=eq.judicial_confirmation_votes&id=eq.${encodeURIComponent(`vote:${data.voteId}`)}&limit=1`,
    );
    return r.rows.length === 1 ? parseVoteMembers(r.rows[0], data.voteId) : null;
  });

// ------------------------------------------------------------------------------------------------ FJC record
export type FjcService = {
  court: string;
  courtId: string | null;
  title: string | null;
  president: string | null;
  /** "Appointed by a Democratic president" and the like; never a bare party. */
  partyLabel: string | null;
  abaRating: string | null;
  seatId: string | null;
  statute: string | null;
  recessAppointment: string | null;
  nomination: string | null;
  committeeReferral: string | null;
  hearing: string | null;
  committeeAction: string | null;
  committeeActionDate: string | null;
  voteLabel: string;
  confirmation: string | null;
  commission: string | null;
  chiefBegin: string | null;
  chiefEnd: string | null;
  seniorStatus: string | null;
  termination: string | null;
  terminationDate: string | null;
};
export type FjcRecord = {
  nid: string;
  name: string;
  status: string;
  sitting: boolean;
  birthYear: number | null;
  birthPlace: string | null;
  deathYear: number | null;
  gender: string | null;
  raceEthnicity: string | null;
  demographicsLabel: string;
  yearsService: number | null;
  services: FjcService[];
  education: { school: string; degree: string | null; year: string | null }[];
  career: string | null;
  otherFederalService: string[];
  otherNominations: string[];
  mdls: { mdl: number; title: string; pending: number }[];
  courtWorkload: { weightedPerJudge: number | null; pendingPerJudge: number | null } | null;
};

const PARTY_LABEL = /^Appointed by an? [A-Z][A-Za-z -]+ president$/;
const DEMOGRAPHICS_LABEL = "as recorded by the Federal Judicial Center";

export function parseFjcService(v: unknown): FjcService | null {
  const s = obj(v);
  const court = str(s?.["court"], 200);
  if (!s || !court) return null;
  const label = str(s["appointing_party_label"], 80);
  return {
    court,
    courtId: courtLink(s["court_id"]),
    title: str(s["title"], 80),
    president: str(s["president"], 80),
    partyLabel: label && PARTY_LABEL.test(label) ? label : null,
    abaRating: str(s["aba_rating"], 60),
    seatId: str(s["seat_id"], 40),
    statute: str(s["statute"], 160),
    recessAppointment: day(s["recess_appointment"]),
    nomination: day(s["nomination"]),
    committeeReferral: day(s["committee_referral"]),
    hearing: day(s["hearing"]),
    committeeAction: str(s["committee_action"], 120),
    committeeActionDate: day(s["committee_action_date"]),
    voteLabel: str(s["vote_label"], 60) ?? "Not recorded",
    confirmation: day(s["confirmation"]),
    commission: day(s["commission"]),
    chiefBegin: day(s["chief_begin"]),
    chiefEnd: day(s["chief_end"]),
    seniorStatus: day(s["senior_status"]),
    termination: str(s["termination"], 80),
    terminationDate: day(s["termination_date"]),
  };
}

export function parseFjcRecord(raw: unknown): FjcRecord | null {
  const p = obj(raw);
  const nid = str(p?.["nid"], 20);
  const name = str(p?.["name"], 200);
  if (!p || !nid || !/^\d+$/.test(nid) || !name) return null;
  const wl = obj(p["court_workload"]);
  const strings = (v: unknown, max: number) =>
    arr(v).flatMap((x) => {
      const t = str(x, max) ?? str(obj(x)?.["text"], max);
      return t ? [t] : [];
    });
  return {
    nid,
    name,
    status: str(p["status"], 40) ?? "Not recorded",
    sitting: p["sitting"] === true,
    birthYear: fy(p["birth_year"]),
    birthPlace: str(p["birth_place"], 120),
    deathYear: fy(p["death_year"]),
    gender: str(p["gender"], 60),
    raceEthnicity: str(p["race_ethnicity"], 160),
    demographicsLabel: str(p["demographics_label"], 80) ?? DEMOGRAPHICS_LABEL,
    yearsService: nonneg(p["years_service"]),
    services: arr(p["services"])
      .map(parseFjcService)
      .filter((x): x is FjcService => !!x),
    education: arr(p["education"]).flatMap((e) => {
      const o = obj(e);
      const school = str(o?.["school"], 200);
      return school ? [{ school, degree: str(o?.["degree"], 80), year: str(o?.["year"], 8) }] : [];
    }),
    career: str(p["career"], 8000),
    otherFederalService: strings(p["other_federal_service"], 300),
    otherNominations: strings(p["other_nominations"], 400),
    mdls: arr(p["mdls"]).flatMap((m) => {
      const o = obj(m);
      const mdl = count(o?.["mdl"]);
      const title = str(o?.["title"], 400);
      const pending = count(o?.["pending"]);
      return mdl != null && title && pending != null ? [{ mdl, title, pending }] : [];
    }),
    courtWorkload: wl
      ? {
          weightedPerJudge: nonneg(wl["per_judge_weighted_filings"]),
          pendingPerJudge: nonneg(wl["per_judge_pending"]),
        }
      : null,
  };
}

export const getJudgeFjcRecord = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<FjcRecord | null> => {
    const filter = encodeURIComponent(JSON.stringify({ judge_profile: [data.id] }));
    const r = await restGet<{ profile: unknown }[]>(
      `corpus_records?select=profile:item->profile&dataset=eq.judge_profiles_fjc&filters=cs.${filter}&limit=2`,
    );
    // only a single exact link is shown; an ambiguous link shows nothing
    return r.rows.length === 1 ? parseFjcRecord(r.rows[0]!.profile) : null;
  });

export type CourtJudge = {
  nid: string;
  name: string;
  status: string;
  president: string | null;
  partyLabel: string | null;
  commission: string | null;
  voteLabel: string;
  mdls: number;
  mdlActions: number;
  profileId: string | null;
};

export function toCourtJudge(raw: unknown, courtId: string): CourtJudge | null {
  const p = obj(raw);
  const rec = parseFjcRecord(p);
  if (!p || !rec) return null;
  const here = rec.services.filter((s) => s.courtId === courtId);
  const current = here.filter((s) => !s.terminationDate).at(-1) ?? here.at(-1);
  if (!current) return null;
  return {
    nid: rec.nid,
    name: rec.name,
    status: rec.status,
    president: current.president,
    partyLabel: current.partyLabel,
    commission: current.commission,
    voteLabel: current.voteLabel,
    mdls: rec.mdls.length,
    mdlActions: rec.mdls.reduce((a, m) => a + m.pending, 0),
    profileId: judgeLink(p["judge_profile_id"]),
  };
}

/** Sitting judges whose current court is this court (FJC directory): active first, then by commission date. */
export const getCourtSittingJudges = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<CourtJudge[]> => {
    const filter = encodeURIComponent(JSON.stringify({ court: [data.id], sitting: ["yes"] }));
    const r = await restGet<{ profile: unknown }[]>(
      `corpus_records?select=profile:item->profile&dataset=eq.judge_profiles_fjc&filters=cs.${filter}&limit=300`,
    );
    return r.rows
      .map((row) => toCourtJudge(row.profile, data.id))
      .filter((x): x is CourtJudge => !!x)
      .sort(
        (a, b) =>
          (a.status === "Senior" ? 1 : 0) - (b.status === "Senior" ? 1 : 0) ||
          (a.commission ?? "").localeCompare(b.commission ?? ""),
      );
  });
