/**
 * Mass-tort rulemaking tracker (pure): comment deadlines of the five agencies whose rules shape failure-to-warn, defect
 * and preemption arguments (FDA, NHTSA, CPSC, EPA, FTC), their Federal Register rule and proposed-rule counts per year,
 * and how much of their Unified Agenda schedule is past its projected month.
 *
 * Rules:
 *  - A comment period is open when its Eastern-time end date is today or later (Regulations.gov's own calendar).
 *  - An end date more than two years ahead is a placeholder some agencies print for open-ended dockets (FDA notices
 *    ending 2050-02-21, an EPA notice ending 2032-10-10). It is shown as "no fixed close date", never as open for
 *    decades and never in a 30/60/90-day window.
 *  - Missing yearly counts stay null ("Not recorded"), never 0; the current year is partial.
 *  - "Past its projected month" compares the projected month printed in the Unified Agenda edition held with the
 *    current month; it describes that edition, not the agency's current plans.
 */

export type TrackedAgency = { code: string; fr: string; name: string };

export const TRACKED_AGENCIES: readonly TrackedAgency[] = [
  { code: "FDA", fr: "199", name: "Food and Drug Administration" },
  { code: "NHTSA", fr: "345", name: "National Highway Traffic Safety Administration" },
  { code: "CPSC", fr: "84", name: "Consumer Product Safety Commission" },
  { code: "EPA", fr: "145", name: "Environmental Protection Agency" },
  { code: "FTC", fr: "192", name: "Federal Trade Commission" },
];

/** Days ahead beyond which a printed comment end date is treated as an open-ended placeholder. */
export const OPEN_ENDED_AFTER_DAYS = 730;

export type DeadlineWindow = "30" | "60" | "90" | "later" | "open_ended";

export const WINDOW_LABEL: Record<DeadlineWindow, string> = {
  "30": "Next 30 days",
  "60": "31–60 days",
  "90": "61–90 days",
  later: "After 90 days",
  open_ended: "No fixed close date",
};

export type DocType = "proposed_rule" | "rule" | "notice" | "other";
export const DOC_TYPE_LABEL: Record<DocType, string> = {
  proposed_rule: "Proposed rule",
  rule: "Rule",
  notice: "Notice",
  other: "Other",
};

export type Deadline = {
  id: string;
  title: string;
  agency: string;
  type: DocType;
  docket: string | null;
  commentEnd: string;
  posted: string | null;
  /** Public comments posted, when the count has been read; null otherwise. */
  comments: number | null;
  url: string | null;
  /** Days from today to the end date (0 = closes today); null for an open-ended placeholder. */
  daysLeft: number | null;
  window: DeadlineWindow;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const first = (v: unknown): string | null => (Array.isArray(v) ? str(v[0]) : str(v));

/** Whole days from `from` to `to` (both ISO dates). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The window a comment end date falls in, seen from `today`; null when it has already closed. */
export function classifyDeadline(
  commentEnd: string,
  today: string,
): { daysLeft: number | null; window: DeadlineWindow } | null {
  if (!ISO.test(commentEnd) || !ISO.test(today)) return null;
  const d = daysBetween(today, commentEnd);
  if (d < 0) return null;
  if (d > OPEN_ENDED_AFTER_DAYS) return { daysLeft: null, window: "open_ended" };
  return { daysLeft: d, window: d <= 30 ? "30" : d <= 60 ? "60" : d <= 90 ? "90" : "later" };
}

const docType = (v: string | null): DocType =>
  v === "proposed_rule" || v === "rule" || v === "notice" ? v : "other";

/** One open Regulations.gov document (row shape: corpus_records of regulations_gov_documents) as a deadline. */
export function toDeadline(raw: unknown, today: string): Deadline | null {
  const r = obj(raw);
  const item = obj(r["item"]);
  const filters = obj(r["filters"]);
  const dates = obj(item["dates_et"]);
  const end = str(dates["comment_end"]);
  const id = str(r["id"]);
  if (!id || !end) return null;
  const c = classifyDeadline(end, today);
  if (!c) return null;
  const comments = obj(item["comments"])["posted"];
  return {
    id,
    title: (str(r["title"]) ?? id).replace(/\s+/g, " "),
    agency: first(filters["agency"]) ?? "Not recorded",
    type: docType(first(filters["type"])),
    docket: first(filters["docket"]),
    commentEnd: end,
    posted: str(dates["posted"]),
    comments: typeof comments === "number" && Number.isFinite(comments) ? comments : null,
    url: str(r["source_url"]),
    ...c,
  };
}

export function sortDeadlines(rows: readonly Deadline[]): Deadline[] {
  return [...rows].sort(
    (a, b) =>
      (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER) ||
      a.agency.localeCompare(b.agency) ||
      a.id.localeCompare(b.id),
  );
}

export type WindowRow = { period: string; values: Record<string, number | null> };

/** Comment periods closing in each of the next three 30-day windows, one value per agency (0 is a real zero). */
export function windowRows(rows: readonly Deadline[], agencies: readonly string[]): WindowRow[] {
  return (["30", "60", "90"] as const).map((w) => ({
    period: WINDOW_LABEL[w],
    values: Object.fromEntries(
      agencies.map((a) => [a, rows.filter((r) => r.agency === a && r.window === w).length]),
    ),
  }));
}

export type AgencyDeadlineSummary = {
  agency: string;
  open: number;
  within30: number;
  proposedRules: number;
  openEnded: number;
  nextClose: string | null;
};

export function agencySummaries(
  rows: readonly Deadline[],
  agencies: readonly string[],
): AgencyDeadlineSummary[] {
  return agencies.map((agency) => {
    const mine = rows.filter((r) => r.agency === agency);
    const dated = sortDeadlines(mine.filter((r) => r.daysLeft !== null));
    return {
      agency,
      open: mine.filter((r) => r.window !== "open_ended").length,
      within30: mine.filter((r) => r.window === "30").length,
      proposedRules: mine.filter((r) => r.type === "proposed_rule" && r.window !== "open_ended")
        .length,
      openEnded: mine.filter((r) => r.window === "open_ended").length,
      nextClose: dated[0]?.commentEnd ?? null,
    };
  });
}

// ------------------------------------------------------------------------------------------------ Federal Register

export type FrYear = {
  year: string;
  rules: number | null;
  proposed: number | null;
  partial: boolean;
};
export type FrAgencyYears = { agency: string; asOf: string | null; years: FrYear[] };

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/**
 * Final and proposed rules per year for one agency from an fr_agency_trends row (item.trends.yearly.RULE / PRORULE),
 * years `from`..the partial year. A year the row does not list stays null.
 */
export function frAgencyYears(agency: string, raw: unknown, from: number): FrAgencyYears {
  const trends = obj(obj(obj(raw)["item"])["trends"]);
  const yearly = obj(trends["yearly"]);
  const rules = obj(yearly["RULE"]);
  const proposed = obj(yearly["PRORULE"]);
  const asOf = str(trends["asOf"]);
  const partialYear = str(trends["partialYear"]) ?? (asOf ? asOf.slice(0, 4) : null);
  const last = Number(partialYear ?? new Date().getUTCFullYear());
  const years: FrYear[] = [];
  for (let y = from; y <= last; y++) {
    const k = String(y);
    years.push({
      year: k,
      rules: count(rules[k]),
      proposed: count(proposed[k]),
      partial: k === partialYear,
    });
  }
  return { agency, asOf, years };
}

// ------------------------------------------------------------------------------------------------ Unified Agenda

export const ACTIVE_STAGES = ["Prerule Stage", "Proposed Rule Stage", "Final Rule Stage"] as const;

export type AgendaItem = {
  rin: string;
  title: string;
  agency: string;
  stage: string;
  nextAction: string | null;
  /** Projected month "YYYY-MM" printed in the edition, when one is printed. */
  projected: string | null;
  url: string | null;
};

/** "Final Rule · 07/00/2026 (projected month passed)" → "2026-07". */
export function projectedMonth(nextAction: string | null): string | null {
  const m = nextAction?.match(/\b(\d{2})\/\d{2}\/(\d{4})\b/);
  if (!m) return null;
  const month = Number(m[1]);
  return month >= 1 && month <= 12 ? `${m[2]}-${m[1]}` : null;
}

/** The Unified Agenda publication id ("202510") in a reginfo.gov source URL. */
export function agendaEdition(url: string | null): string | null {
  return url?.match(/[?&]pubId=(\d{6})\b/)?.[1] ?? null;
}

/** "202510" → "October 2025". */
export function editionLabel(edition: string | null): string | null {
  if (!edition || !/^\d{6}$/.test(edition)) return null;
  const d = new Date(Date.UTC(Number(edition.slice(0, 4)), Number(edition.slice(4)) - 1, 1));
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function toAgendaItem(agency: string, raw: unknown): AgendaItem | null {
  const r = obj(raw);
  const cells = obj(obj(r["item"])["cells"]);
  const rin = str(r["id"]);
  if (!rin) return null;
  const nextAction = str(cells["next_action"]);
  return {
    rin,
    title: (str(r["title"]) ?? rin).replace(/\s+/g, " "),
    agency,
    stage: str(cells["stage"]) ?? "Not recorded",
    nextAction,
    projected: projectedMonth(nextAction),
    url: str(r["source_url"]),
  };
}

export type AgendaSummary = {
  agency: string;
  /** Items in the prerule, proposed and final rule stages. */
  active: number;
  /** Active items with a projected month printed. */
  dated: number;
  /** Dated items whose projected month is before the current month. */
  passed: number;
  /** Dated items still ahead (this month or later). */
  ahead: number;
  /** Active items without a projected month ("To Be Determined"). */
  undated: number;
};

export function agendaSummaries(
  items: readonly AgendaItem[],
  agencies: readonly string[],
  today: string,
): AgendaSummary[] {
  const month = today.slice(0, 7);
  return agencies.map((agency) => {
    const active = items.filter(
      (i) => i.agency === agency && (ACTIVE_STAGES as readonly string[]).includes(i.stage),
    );
    const dated = active.filter((i) => i.projected !== null);
    const passed = dated.filter((i) => (i.projected as string) < month).length;
    return {
      agency,
      active: active.length,
      dated: dated.length,
      passed,
      ahead: dated.length - passed,
      undated: active.length - dated.length,
    };
  });
}

// ------------------------------------------------------------------------------------------------ payload

export type RulemakingTracker = {
  /** Eastern-time date the comment windows are measured from. */
  today: string;
  agencies: readonly TrackedAgency[];
  deadlines: Deadline[];
  fr: FrAgencyYears[];
  agenda: AgendaItem[];
  agendaEdition: string | null;
  readAt: string;
};

/** Today's date on the Eastern-time calendar Regulations.gov uses. */
export function easternToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts.slice(0, 10);
}
