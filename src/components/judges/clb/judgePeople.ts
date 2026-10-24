/**
 * Pure parsers and derivations for a judge's CourtListener people-database record (dataset clb_judge_people) and the
 * contents of their financial disclosure reports (dataset clb_judge_disclosure_items). Stored JSON is validated here;
 * a malformed value is dropped, never repaired. Nothing is estimated: an interval is computed only between two dates
 * recorded to the day, and a missing value stays missing.
 */

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 320): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const yearOf = (v: unknown, lo = 1700): number | null => {
  const n = count(v);
  return n != null && n >= lo && n <= 2100 ? n : null;
};

/** A date at the precision CourtListener recorded: "1986", "1986-03" or "1986-03-15". */
export const PARTIAL_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
const date = (v: unknown): string | null => {
  const s = str(v, 10);
  return s && PARTIAL_DATE.test(s) ? s : null;
};
const COURT_ID = /^[a-z0-9_-]{1,40}$/;

export type PersonRef = { id: number; name: string };
export type PositionDates = {
  nominated: string | null;
  elected: string | null;
  recessAppointment: string | null;
  referredToCommittee: string | null;
  committeeAction: string | null;
  hearing: string | null;
  confirmation: string | null;
  start: string | null;
  termination: string | null;
  retirement: string | null;
};
export type Votes = {
  type: string | null;
  voiceVote: boolean | null;
  yes: number | null;
  no: number | null;
  yesPercent: number | null;
  noPercent: number | null;
};
export type Position = {
  id: number;
  positionType: string | null;
  /** CourtListener's display name for the position type, or the free-text job title. */
  title: string | null;
  courtId: string | null;
  court: string | null;
  /** `/courts/<courtId>` only when the stored link named exactly that court. */
  courtLink: string | null;
  organization: string | null;
  location: string | null;
  howSelected: string | null;
  nominationProcess: string | null;
  committeeAction: string | null;
  terminationReason: string | null;
  dates: PositionDates;
  votes: Votes | null;
  appointer: (PersonRef & { position: string | null }) | null;
  predecessor: PersonRef | null;
  inferred: boolean;
};
export type Education = {
  id: number;
  degree: string | null;
  degreeLevel: string | null;
  degreeDetail: string | null;
  year: number | null;
  school: string | null;
  schoolAliasOf: string | null;
};
export const ABA_CODES = ["ewq", "wq", "q", "nq", "nqa"] as const;
export type AbaCode = (typeof ABA_CODES)[number];
export type AbaRating = {
  id: number;
  code: AbaCode;
  rating: string;
  year: number | null;
  retrievedAt: string | null;
};
export type LowerCourtAppeals = {
  /** Originating-court records naming the person as the lower-court (assigned) judge. */
  assigned: number;
  /** Records naming the person as the ordering judge. */
  ordering: number;
  byNoticeYear: { year: number; n: number }[];
  noticeAfterExport: number;
  noNoticeDate: number;
};
export type JudgePeople = {
  personId: number;
  name: string;
  fjcId: number | null;
  born: string | null;
  died: string | null;
  positions: Position[];
  positionsTotal: number;
  education: Education[];
  aba: AbaRating[];
  lowerCourtAppeals: LowerCourtAppeals | null;
};

function personRef(v: unknown): PersonRef | null {
  const o = obj(v);
  const id = count(o?.["id"]);
  const name = str(o?.["name"], 200);
  return id != null && name ? { id, name } : null;
}

function parsePosition(v: unknown): Position | null {
  const o = obj(v);
  const id = count(o?.["id"]);
  if (!o || id == null) return null;
  const d = obj(o["dates"]) ?? {};
  const courtId = str(o["court_id"], 40);
  const validCourt = courtId && COURT_ID.test(courtId) ? courtId : null;
  const court = validCourt ? str(o["court"], 200) : null;
  const link = str(o["court_link"], 60);
  const vt = obj(o["votes"]);
  const votes: Votes | null = vt
    ? {
        type: str(vt["type"], 60),
        voiceVote: typeof vt["voice_vote"] === "boolean" ? vt["voice_vote"] : null,
        yes: count(vt["yes"]),
        no: count(vt["no"]),
        yesPercent: num(vt["yes_percent"]),
        noPercent: num(vt["no_percent"]),
      }
    : null;
  const ap = obj(o["appointer"]);
  const appointerRef = personRef(ap);
  return {
    id,
    positionType: str(o["position_type"], 30),
    title: str(o["position"], 120) ?? str(o["job_title"], 200),
    courtId: court ? validCourt : null,
    court,
    courtLink: validCourt && court && link === `/courts/${validCourt}` ? link : null,
    organization: str(o["organization"], 200),
    location: str(o["location"], 200),
    howSelected: str(o["how_selected"], 80),
    nominationProcess: str(o["nomination_process"], 80),
    committeeAction: str(o["committee_action"], 80),
    terminationReason: str(o["termination_reason"], 80),
    dates: {
      nominated: date(d["nominated"]),
      elected: date(d["elected"]),
      recessAppointment: date(d["recess_appointment"]),
      referredToCommittee: date(d["referred_to_committee"]),
      committeeAction: date(d["committee_action"]),
      hearing: date(d["hearing"]),
      confirmation: date(d["confirmation"]),
      start: date(d["start"]),
      termination: date(d["termination"]),
      retirement: date(d["retirement"]),
    },
    votes: votes && Object.values(votes).some((x) => x !== null && x !== undefined) ? votes : null,
    appointer: appointerRef ? { ...appointerRef, position: str(ap?.["position"], 120) } : null,
    predecessor: personRef(o["predecessor"]),
    inferred: o["has_inferred_values"] === true,
  };
}

export function parseJudgePeople(raw: unknown, personId: number): JudgePeople | null {
  const p = obj(raw);
  if (!p || p["person_id"] !== personId) return null;
  const name = str(p["name"], 200);
  if (!name) return null;
  const positions = arr(p["positions"]).flatMap((x) => {
    const pos = parsePosition(x);
    return pos ? [pos] : [];
  });
  const education: Education[] = arr(p["education"]).flatMap((x) => {
    const o = obj(x);
    const id = count(o?.["id"]);
    if (!o || id == null) return [];
    const school = obj(o["school"]);
    return [
      {
        id,
        degree: str(o["degree"], 120),
        degreeLevel: str(o["degree_level"], 10),
        degreeDetail: str(o["degree_detail"], 160),
        year: yearOf(o["year"]),
        school: str(school?.["name"], 200),
        schoolAliasOf: str(obj(school?.["alias_of"])?.["name"], 200),
      },
    ];
  });
  const aba: AbaRating[] = arr(p["aba_ratings"]).flatMap((x) => {
    const o = obj(x);
    const id = count(o?.["id"]);
    const code = o?.["rating_code"];
    const rating = str(o?.["rating"], 80);
    if (id == null || !(ABA_CODES as readonly unknown[]).includes(code) || !rating) return [];
    const at = str(o?.["retrieved_at"], 30);
    return [
      {
        id,
        code: code as AbaCode,
        rating,
        year: yearOf(o?.["year"], 1900),
        retrievedAt: at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at) ? at : null,
      },
    ];
  });
  const lca = obj(p["lower_court_appeals"]);
  let lowerCourtAppeals: LowerCourtAppeals | null = null;
  if (lca) {
    const assigned = count(lca["assigned"]) ?? 0;
    const byNoticeYear = arr(lca["by_notice_year"]).flatMap((x) => {
      if (!Array.isArray(x) || x.length !== 2) return [];
      const y = yearOf(x[0], 1900);
      const n = count(x[1]);
      return y != null && n ? [{ year: y, n }] : [];
    });
    const noticeAfterExport = count(lca["notice_after_export"]) ?? 0;
    const noNoticeDate = count(lca["no_notice_date"]) ?? 0;
    // the parts add up to the records naming the person as assigned judge, or the block is dropped
    if (byNoticeYear.reduce((t, r) => t + r.n, 0) + noticeAfterExport + noNoticeDate === assigned)
      lowerCourtAppeals = {
        assigned,
        ordering: count(lca["ordering"]) ?? 0,
        byNoticeYear,
        noticeAfterExport,
        noNoticeDate,
      };
  }
  return {
    personId,
    name,
    fjcId: count(p["fjc_id"]),
    born: date(p["born"]),
    died: date(p["died"]),
    positions,
    positionsTotal: Math.max(count(p["positions_total"]) ?? positions.length, positions.length),
    education,
    aba: aba.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.id - b.id),
    lowerCourtAppeals,
  };
}

/** Whole days between two dates recorded to the day, or null (a coarser date or a reversed pair gives nothing). */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b || !/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 86_400_000) : null;
}

/** The year of a recorded date, at any precision. */
export const yearOfDate = (d: string | null): number | null => (d ? Number(d.slice(0, 4)) : null);

export const courtPositions = (j: JudgePeople) => j.positions.filter((p) => p.courtId);
export const otherPositions = (j: JudgePeople) => j.positions.filter((p) => !p.courtId);

/** The vote as recorded: "96–2 (Senate)", "Voice vote (Senate)", "71.2% yes"; null when nothing is recorded. */
export function voteText(v: Votes | null): string | null {
  if (!v) return null;
  const how = v.type ? ` (${v.type})` : "";
  if (v.yes != null && v.no != null) return `${v.yes}–${v.no}${how}`;
  if (v.voiceVote === true) return `Voice vote${how}`;
  if (v.yesPercent != null)
    return `${v.yesPercent.toLocaleString("en-US", { maximumFractionDigits: 2 })}% yes${how}`;
  if (v.yes != null) return `${v.yes} yes${how}`;
  return v.type;
}

/** The year of the people-database export (Sept 30, 2026): an open position is drawn to it. */
export const EXPORT_YEAR = 2026;

export type Lane = { p: Position; from: number; to: number; open: boolean };

/** Court positions as horizontal bars by year (start to end, or to the export year when no end is recorded). */
export function serviceLanes(
  positions: readonly Position[],
  died: string | null,
): { lanes: Lane[]; lo: number; hi: number } | null {
  const deathYear = yearOfDate(died);
  const lanes = positions.flatMap((p) => {
    const from = yearOfDate(p.dates.start);
    if (from == null) return [];
    const end = yearOfDate(p.dates.termination);
    // an open position is drawn to the export year, or to the recorded year of death when there is one
    const to = end ?? deathYear ?? EXPORT_YEAR;
    return to >= from ? [{ p, from, to, open: end == null }] : [];
  });
  if (!lanes.length) return null;
  return {
    lanes,
    lo: Math.min(...lanes.map((l) => l.from)),
    hi: Math.max(...lanes.map((l) => l.to)),
  };
}

/** Law degrees first (J.D., LL.B.), then the rest by year; the law degree is what readers look for. */
export function lawDegree(j: JudgePeople): Education | null {
  return j.education.find((e) => e.degreeLevel === "jd" || e.degreeLevel === "llb") ?? null;
}

/** First confirmation recorded on a court position, with the court. */
export function firstConfirmation(j: JudgePeople): Position | null {
  return courtPositions(j).find((p) => p.dates.confirmation) ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Financial disclosure contents (clb_judge_disclosure_items)
// ---------------------------------------------------------------------------------------------------

/** The form's value codes in form order, with the ranges the form gives them (in dollars); CourtListener's legend. */
export const VALUE_CODES = [
  ["J", "1 - 15,000"],
  ["K", "15,001 - 50,000"],
  ["L", "50,001 - 100,000"],
  ["M", "100,001 - 250,000"],
  ["N", "250,001 - 500,000"],
  ["O", "500,001 - 1,000,000"],
  ["P1", "1,000,001 - 5,000,000"],
  ["P2", "5,000,001 - 25,000,000"],
  ["P3", "25,000,001 - 50,000,000"],
  ["P4", "50,000,001 - "],
  ["-1", "Failed Extraction"],
] as const;
/** Codes the data uses beyond the form's: a line without a code, and a code outside the legend. */
export const EXTRA_CODES = [
  ["none", "No code on the line"],
  ["other", "Code outside the form's legend"],
] as const;
const KNOWN_CODES = new Set<string>([...VALUE_CODES, ...EXTRA_CODES].map(([c]) => c));
export const SECTION_KEYS = [
  "investments",
  "gifts",
  "reimbursements",
  "agreements",
  "outside_positions",
  "debts",
  "non_investment_income",
  "spousal_income",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_LABEL: Record<SectionKey, string> = {
  investments: "Investments",
  gifts: "Gifts",
  reimbursements: "Reimbursements",
  agreements: "Agreements",
  outside_positions: "Outside positions",
  debts: "Debts",
  non_investment_income: "Non-investment income",
  spousal_income: "Spousal income",
};
export type CodeCount = { code: string; n: number };
export type ReportType = { code: string; label: string; n: number };
export type ItemsYear = {
  year: number;
  reports: number;
  amended: number;
  reportTypes: ReportType[];
  items: Record<SectionKey, number>;
  grossValue: CodeCount[];
  transactions: number;
  debtValue: CodeCount[];
};
export type OutsidePosition = {
  key: string;
  year: number | null;
  redacted: boolean;
  position: string | null;
  organization: string | null;
};
export type IncomeItem = {
  key: string;
  year: number | null;
  redacted: boolean;
  source: string | null;
  amount: string | null;
  date: string | null;
};
export type DebtItem = {
  key: string;
  year: number | null;
  redacted: boolean;
  creditor: string | null;
  description: string | null;
  code: string | null;
};
export type DisclosureItems = {
  personId: number;
  name: string;
  reports: number;
  years: ItemsYear[];
  totals: Record<SectionKey, number>;
  conflict: boolean;
  listed: {
    outsidePositions: OutsidePosition[];
    nonInvestmentIncome: IncomeItem[];
    spousalIncome: IncomeItem[];
    debts: DebtItem[];
  };
  listedTotal: {
    outsidePositions: number;
    nonInvestmentIncome: number;
    spousalIncome: number;
    debts: number;
  };
};

function codeCounts(v: unknown): CodeCount[] {
  const seen = new Set<string>();
  return arr(v).flatMap((x) => {
    if (!Array.isArray(x) || x.length !== 2) return [];
    const code = typeof x[0] === "string" ? x[0] : null;
    const n = count(x[1]);
    if (!code || !KNOWN_CODES.has(code) || n == null || n === 0 || seen.has(code)) return [];
    seen.add(code);
    return [{ code, n }];
  });
}

function sectionCounts(v: unknown): Record<SectionKey, number> {
  const o = obj(v) ?? {};
  const out = {} as Record<SectionKey, number>;
  // a section without a stored count had no line items (the builder drops zero only from code lists, not from items)
  for (const k of SECTION_KEYS) out[k] = count(o[k]) ?? 0;
  return out;
}

export function parseDisclosureItems(raw: unknown, personId: number): DisclosureItems | null {
  const p = obj(raw);
  if (!p || p["person_id"] !== personId) return null;
  const name = str(p["name"], 200);
  const reports = count(p["reports"]);
  if (!name || !reports) return null;
  const years: ItemsYear[] = arr(p["years"]).flatMap((x) => {
    const o = obj(x);
    const y = yearOf(o?.["year"], 1970);
    const n = count(o?.["reports"]);
    if (!o || y == null || n == null || n > reports) return [];
    const inv = obj(o["investments"]) ?? {};
    const reportTypes = arr(o["report_types"]).flatMap((t) => {
      if (!Array.isArray(t) || t.length !== 3) return [];
      const code = typeof t[0] === "string" ? t[0] : null;
      const label = str(t[1], 80);
      const k = count(t[2]);
      return code && label && k ? [{ code, label, n: k }] : [];
    });
    const items = sectionCounts(o["items"]);
    const grossValue = codeCounts(inv["gross_value"]);
    // the code counts of one year add up to its investment lines; a year that does not is dropped, not adjusted
    if (grossValue.length && grossValue.reduce((s, c) => s + c.n, 0) !== items.investments)
      return [];
    return [
      {
        year: y,
        reports: n,
        amended: count(o["amended"]) ?? 0,
        reportTypes,
        items,
        grossValue,
        transactions: count(inv["transactions"]) ?? 0,
        debtValue: codeCounts(obj(o["debts"])?.["value"]),
      },
    ];
  });
  const att = obj(p["attribution"]);
  const conflict = att?.["status"] === "conflict";
  const listed = obj(p["listed"]) ?? {};
  const yr = (o: Record<string, unknown> | null) => yearOf(o?.["year"], 1970);
  const red = (o: Record<string, unknown> | null) => o?.["redacted"] === true;
  // every listed item gets a stable key: its report id and its place in the stored list (two reports of one year,
  // such as an original and an amendment, can list the same item twice, and both are shown as filed)
  const list = <T>(
    key: string,
    map: (o: Record<string, unknown>, redacted: boolean) => T,
  ): (T & { key: string })[] =>
    conflict
      ? []
      : arr(listed[key]).flatMap((x, i) => {
          const o = obj(x);
          return o ? [{ ...map(o, red(o)), key: `${count(o["report_id"]) ?? "r"}:${i}` }] : [];
        });
  const lt = obj(p["listed_total"]) ?? {};
  return {
    personId,
    name,
    reports,
    years: years.sort((a, b) => a.year - b.year),
    totals: sectionCounts(p["items_total"]),
    conflict,
    listed: {
      outsidePositions: list("outside_positions", (o, r) => ({
        year: yr(o),
        redacted: r,
        position: r ? null : str(o["position"], 200),
        organization: r ? null : str(o["organization"], 240),
      })),
      nonInvestmentIncome: list("non_investment_income", (o, r) => ({
        year: yr(o),
        redacted: r,
        source: r ? null : str(o["source_as_filed"], 260),
        amount: r ? null : str(o["amount_as_filed"], 100),
        date: r ? null : str(o["date_as_filed"], 80),
      })),
      spousalIncome: list("spousal_income", (o, r) => ({
        year: yr(o),
        redacted: r,
        source: r ? null : str(o["source_as_filed"], 260),
        amount: null,
        date: r ? null : str(o["date_as_filed"], 80),
      })),
      debts: list("debts", (o, r) => {
        const code = str(o["value_code"], 4);
        return {
          year: yr(o),
          redacted: r,
          creditor: r ? null : str(o["creditor_as_filed"], 200),
          description: r ? null : str(o["description_as_filed"], 240),
          code: code && KNOWN_CODES.has(code) ? code : null,
        };
      }),
    },
    listedTotal: {
      outsidePositions: conflict ? 0 : (count(lt["outside_positions"]) ?? 0),
      nonInvestmentIncome: conflict ? 0 : (count(lt["non_investment_income"]) ?? 0),
      spousalIncome: conflict ? 0 : (count(lt["spousal_income"]) ?? 0),
      debts: conflict ? 0 : (count(lt["debts"]) ?? 0),
    },
  };
}

export const codeRange = (code: string): string =>
  ([...VALUE_CODES, ...EXTRA_CODES] as readonly (readonly [string, string])[]).find(
    ([c]) => c === code,
  )?.[1] ?? code;

/** Value-code columns that occur in any year, in form order (so the matrix never shows an always-empty column). */
export function usedCodes(
  years: readonly ItemsYear[],
  pick: (y: ItemsYear) => CodeCount[],
): string[] {
  const used = new Set(years.flatMap((y) => pick(y).map((c) => c.code)));
  return [...VALUE_CODES, ...EXTRA_CODES].map(([c]) => c).filter((c) => used.has(c));
}
