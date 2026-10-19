/**
 * Pure view-model helpers for the agency directory and profile: chart rows, administration bands, directory
 * sorting/tree and number-backed takeaways. Every helper returns null / "Not recorded" for unknown inputs.
 */
import {
  changePct,
  int,
  signedPct,
  usableTakeaways,
  usdCompact,
  type Takeaway,
} from "@/components/analysis/analysisFormat";
import { STATES } from "@/lib/corpus/geo";
import type {
  AdminRow,
  AgencyBudget,
  AgencyKind,
  AgendaAction,
  AgencyProfileData,
  AgencySpending,
  AgencyTrends,
  DirectoryRow,
  Series,
} from "@/lib/external/agencyProfile.functions";

export const TYPE_LABEL = {
  ALL: "All documents",
  RULE: "Final rules",
  PRORULE: "Proposed rules",
  NOTICE: "Notices",
  PRESDOCU: "Presidential documents",
} as const;
export type ChartType = keyof typeof TYPE_LABEL;

export const KIND_LABEL: Record<AgencyKind, string> = {
  department: "Department",
  component: "Component",
  independent: "Independent or other",
};

/** The administration in office on July 1 of a calendar year (terms begin January 20). */
export function adminForYear(year: string, admins: readonly AdminRow[]): AdminRow | null {
  const mid = `${year}-07-01`;
  return admins.find((a) => a.start <= mid && mid <= a.end) ?? null;
}

export type YearRow = {
  year: string;
  ALL: number;
  RULE: number;
  PRORULE: number;
  NOTICE: number;
  PRESDOCU: number;
  significant: number;
  partial: boolean;
  admin: string | null;
};

/** One row per calendar year from `from` to the partial current year (marked partial). */
export function yearRows(t: AgencyTrends, from = 1994): YearRow[] {
  const last = Number(t.partialYear);
  if (!Number.isFinite(last)) return [];
  const rows: YearRow[] = [];
  for (let y = from; y <= last; y++) {
    const year = String(y);
    rows.push({
      year,
      ALL: t.yearly.ALL[year] ?? 0,
      RULE: t.yearly.RULE[year] ?? 0,
      PRORULE: t.yearly.PRORULE[year] ?? 0,
      NOTICE: t.yearly.NOTICE[year] ?? 0,
      PRESDOCU: t.yearly.PRESDOCU[year] ?? 0,
      significant: t.significantYearly.RULE[year] ?? 0,
      partial: year === t.partialYear,
      admin: adminForYear(year, t.byAdministration)?.key ?? null,
    });
  }
  return rows;
}

export type Band = { key: string; label: string; x1: string; x2: string; index: number };

/** Contiguous runs of years by administration, for shaded chart bands. */
export function adminBands(rows: readonly YearRow[], admins: readonly AdminRow[]): Band[] {
  const out: Band[] = [];
  for (const r of rows) {
    if (!r.admin) continue;
    const last = out.at(-1);
    if (last && last.key === r.admin) last.x2 = r.year;
    else {
      const a = admins.find((x) => x.key === r.admin);
      out.push({
        key: r.admin,
        label: a?.label ?? r.admin,
        x1: r.year,
        x2: r.year,
        index: out.length,
      });
    }
  }
  return out;
}

export type MonthRow = {
  month: string;
  RULE: number;
  PRORULE: number;
  NOTICE: number;
  partial: boolean;
};
export function monthRows(t: AgencyTrends): MonthRow[] {
  const months = new Set([
    ...Object.keys(t.monthly.RULE),
    ...Object.keys(t.monthly.PRORULE),
    ...Object.keys(t.monthly.NOTICE),
  ]);
  return [...months].sort().map((month) => ({
    month,
    RULE: t.monthly.RULE[month] ?? 0,
    PRORULE: t.monthly.PRORULE[month] ?? 0,
    NOTICE: t.monthly.NOTICE[month] ?? 0,
    partial: month === t.partialMonth,
  }));
}

/** Last complete year against the mean of the five years before it. */
export function lastYearVsAverage(s: Series, partialYear: string) {
  const last = String(Number(partialYear) - 1);
  const prior = Array.from({ length: 5 }, (_, i) => s[String(Number(last) - 1 - i)] ?? 0);
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  const value = s[last] ?? 0;
  return {
    year: last,
    from: String(Number(last) - 5),
    to: String(Number(last) - 1),
    value,
    avg5: avg,
    ratio: avg > 0 ? value / avg : null,
  };
}

/** Complete months of the current year against the same months a year earlier (monthly series). */
export function yearToDate(s: Series, partialMonth: string) {
  const [y, m] = partialMonth.split("-").map(Number);
  if (!y || !m || m < 2) return null;
  let current = 0;
  let previous = 0;
  for (let i = 1; i < m; i++) {
    const mm = String(i).padStart(2, "0");
    const cur = s[`${y}-${mm}`];
    const prev = s[`${y - 1}-${mm}`];
    if (cur == null || prev == null) return null;
    current += cur;
    previous += prev;
  }
  return {
    through: `${y}-${String(m - 1).padStart(2, "0")}`,
    months: m - 1,
    current,
    previous,
    changePct: changePct(current, previous),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (ym: string) => {
  const m = Number(ym.slice(5, 7));
  return m >= 1 && m <= 12 ? MONTHS[m - 1]! : ym;
};

/** Administration of the current window and the one before it, with significant-rule rates. */
export function adminComparison(admins: readonly AdminRow[]) {
  const current = admins.find((a) => a.current) ?? null;
  const idx = current ? admins.indexOf(current) : -1;
  const previous = idx > 0 ? admins[idx - 1]! : null;
  return { current, previous };
}

/** "$2.79T" from a trillion up (whole-department obligations), otherwise the shared compact dollar format. */
export const usd = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) >= 1e12
    ? `${v < 0 ? "−" : ""}$${(Math.abs(v) / 1e12).toLocaleString("en-US", { maximumFractionDigits: 2 })}T`
    : usdCompact(v);
export const fmt = (v: number | null | undefined) => int(v);

export const FIPS_BY_USPS = new Map(STATES.map((s) => [s.usps, s.fips]));
export const USPS_BY_FIPS = new Map(STATES.map((s) => [s.fips, s.usps]));

/** FIPS -> per-resident obligations for the map; jurisdictions without a population are omitted. */
export function perResidentByFips(sp: AgencySpending): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sp.states) {
    const fips = FIPS_BY_USPS.get(s.code);
    if (fips && s.perResident != null && s.perResident >= 0) out.set(fips, s.perResident);
  }
  return out;
}

export type BudgetRow = {
  fy: string;
  resources: number | null;
  obligated: number | null;
  outlayed: number | null;
  partial: boolean;
  period: number | null;
};
export function budgetRows(b: AgencyBudget): BudgetRow[] {
  return b.years.map((y) => ({
    fy: `FY${y.fy}`,
    resources: y.budgetaryResources,
    obligated: y.obligated,
    outlayed: y.outlayed,
    partial: y.partial,
    period: y.latestPeriod,
  }));
}

export function nextActionLabel(n: AgendaAction | null): string {
  if (!n) return "Not recorded";
  return `${n.action} · ${n.date ?? "Not recorded"}${n.passed ? " (projected month passed)" : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------------------------------------------
export type AgencySearch = {
  q?: string;
  view?: "register";
  kind?: AgencyKind;
  sort?: SortKey;
  /** Only when it differs from the column's default (names ascending, figures descending). */
  dir?: "asc" | "desc";
  layout?: "tree";
  active?: true;
};

const SORTS: readonly string[] = [
  "name",
  "rulesLastYear",
  "proposedLastYear",
  "significantRules",
  "openComments",
  "agendaActions",
  "obligationsLatestFy",
  "documentsSince1994",
];

/** /agencies URL search: unknown values are dropped rather than guessed; defaults stay out of the URL. */
export function normalizeAgencySearch(search: Record<string, unknown>): AgencySearch {
  const out: AgencySearch = {};
  const q = search["q"];
  if (typeof q === "string" && q.trim()) out.q = q.trim().slice(0, 160);
  if (search["view"] === "register") out.view = "register";
  const kind = search["kind"];
  if (kind === "department" || kind === "component" || kind === "independent") out.kind = kind;
  const sort = search["sort"];
  if (typeof sort === "string" && SORTS.includes(sort) && sort !== "rulesLastYear")
    out.sort = sort as SortKey;
  const effective = out.sort ?? "rulesLastYear";
  const dir = search["dir"];
  if ((dir === "asc" && effective !== "name") || (dir === "desc" && effective === "name"))
    out.dir = dir;
  if (search["layout"] === "tree") out.layout = "tree";
  if (search["active"] === true || search["active"] === "true") out.active = true;
  return out;
}
export type SortKey =
  | "name"
  | "rulesLastYear"
  | "proposedLastYear"
  | "significantRules"
  | "openComments"
  | "agendaActions"
  | "obligationsLatestFy"
  | "documentsSince1994";

export function sortDirectory(
  rows: readonly DirectoryRow[],
  key: SortKey,
  desc: boolean,
): DirectoryRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === "name") return dir * a.name.localeCompare(b.name);
    const av = a[key];
    const bv = b[key];
    // Unknown values (no budget match) always sort last, whichever direction.
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir * (av - bv) || a.name.localeCompare(b.name);
  });
}

export function filterDirectory(
  rows: readonly DirectoryRow[],
  term: string,
  kind: AgencyKind | "all",
  activeOnly: boolean,
): DirectoryRow[] {
  const q = term.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (!activeOnly ||
        (r.lastActiveYear != null && r.lastActiveYear >= String(Number(r.lastFullYear) - 1))) &&
      (!q || r.name.toLowerCase().includes(q) || (r.shortName ?? "").toLowerCase().includes(q)),
  );
}

export type TreeNode = { row: DirectoryRow; children: TreeNode[] };

/** Parent/child tree as the Federal Register records it; rows whose parent is absent become roots. */
export function buildTree(
  rows: readonly DirectoryRow[],
  key: SortKey = "name",
  desc = false,
): TreeNode[] {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map<number, DirectoryRow[]>();
  const roots: DirectoryRow[] = [];
  for (const r of rows) {
    if (r.parentId != null && ids.has(r.parentId) && r.parentId !== r.id) {
      const list = kids.get(r.parentId) ?? [];
      list.push(r);
      kids.set(r.parentId, list);
    } else roots.push(r);
  }
  const seen = new Set<number>();
  const build = (r: DirectoryRow): TreeNode => {
    seen.add(r.id);
    return {
      row: r,
      children: sortDirectory(kids.get(r.id) ?? [], key, desc)
        .filter((c) => !seen.has(c.id))
        .map(build),
    };
  };
  return sortDirectory(roots, key, desc).map(build);
}

// ---------------------------------------------------------------------------------------------------------------
// Takeaways
// ---------------------------------------------------------------------------------------------------------------
const times = (r: number) => `${r.toLocaleString("en-US", { maximumFractionDigits: 2 })}×`;
const rate = (r: number) => `${r.toLocaleString("en-US", { maximumFractionDigits: 1 })}/yr`;

/** Number-backed statements computed from the loaded profile; each names its comparison and source section. */
export function agencyTakeaways({
  profile,
  trends,
  budget,
  spending,
}: AgencyProfileData): Takeaway[] {
  const items: (Takeaway | null)[] = [];
  if (trends) {
    const fy = lastYearVsAverage(trends.yearly.RULE, trends.partialYear);
    if (fy.ratio != null && fy.avg5 >= 5 && (fy.ratio >= 1.25 || fy.ratio <= 0.75))
      items.push({
        id: "rules-vs-average",
        figure: times(fy.ratio),
        text: `Final rules in ${fy.year} (${int(fy.value)}) against the ${fy.from}–${fy.to} average (${fy.avg5.toLocaleString("en-US", { maximumFractionDigits: 1 })} a year).`,
        anchor: "agency-activity",
      });
    else if (fy.value > 0 || fy.avg5 > 0)
      items.push({
        id: "rules-last-year",
        figure: int(fy.value),
        text: `Final rules published in ${fy.year}; the ${fy.from}–${fy.to} average was ${fy.avg5.toLocaleString("en-US", { maximumFractionDigits: 1 })} a year.`,
        anchor: "agency-activity",
      });
    const ytd = yearToDate(trends.monthly.RULE, trends.partialMonth);
    if (ytd && ytd.previous >= 10 && ytd.changePct != null)
      items.push({
        id: "rules-ytd",
        figure: signedPct(ytd.changePct),
        text: `Final rules January–${monthName(ytd.through)} ${ytd.through.slice(0, 4)} (${int(ytd.current)}) against the same months of ${Number(ytd.through.slice(0, 4)) - 1} (${int(ytd.previous)}).`,
        anchor: "agency-activity",
      });
    const { current, previous } = adminComparison(trends.byAdministration);
    if (
      current &&
      previous &&
      current.significantRulesPerYear != null &&
      previous.significantRulesPerYear != null &&
      current.significantRules + previous.significantRules >= 5
    )
      items.push({
        id: "significant-pace",
        figure: rate(current.significantRulesPerYear),
        text: `Significant final rules a year since ${current.start} (${int(current.significantRules)} published), against ${rate(previous.significantRulesPerYear)} under ${previous.label}.`,
        anchor: "agency-administrations",
      });
    const share = trends.shareOfFinalRules[String(Number(trends.partialYear) - 1)];
    if (share != null && share >= 0.5)
      items.push({
        id: "share-of-rules",
        figure: `${share.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`,
        text: `Share of all final rules published in the Federal Register in ${Number(trends.partialYear) - 1}.`,
        anchor: "agency-activity",
      });
    if (trends.openComments.count > 0)
      items.push({
        id: "open-comments",
        figure: int(trends.openComments.count),
        text: `Documents with a comment period open on ${trends.openComments.asOf}; ${int(trends.openComments.closingWithin30Days)} close within 30 days.`,
        anchor: "agency-comments",
      });
  }
  const agenda = profile?.agenda;
  if (agenda && agenda.total > 0)
    items.push({
      id: "agenda",
      figure: int(agenda.total),
      text: `Unified Agenda actions (publication ${agenda.edition}): ${int(agenda.byPriority["Economically Significant"] ?? 0)} economically significant, ${int(agenda.byStage["Final Rule Stage"] ?? 0)} at the final rule stage.`,
      anchor: "agency-agenda",
    });
  const fy25 = budget?.years.find((y) => y.fy === 2025);
  const fy24 = budget?.years.find((y) => y.fy === 2024);
  const delta = changePct(fy25?.obligated, fy24?.obligated);
  if (fy25 && fy24 && delta != null)
    items.push({
      id: "obligations",
      figure: signedPct(delta),
      text: `Obligations in FY2025 (${usdCompact(fy25.obligated)}) against FY2024 (${usdCompact(fy24.obligated)}).`,
      anchor: "agency-budget",
    });
  if (spending) {
    const ranked = spending.states
      .filter((s) => s.perResident != null && s.code !== "DC" && s.code !== "PR")
      .sort((a, b) => b.perResident! - a.perResident!);
    const top = ranked[0];
    if (top && spending.medianPerResidentStates != null && spending.medianPerResidentStates > 0)
      items.push({
        id: "top-state",
        figure: usdCompact(top.perResident),
        text: `Highest FY${spending.fiscalYear} award obligations per resident among the 50 states: ${top.name}; the state median is ${usdCompact(spending.medianPerResidentStates)}.`,
        anchor: "agency-spending",
      });
  }
  const part = profile?.cfrParts?.top[0];
  if (part)
    items.push({
      id: "top-part",
      figure: `${part.title} CFR ${part.part}`,
      text: `Most-cited CFR part in this agency's rules and proposed rules (${int(part.docs)} documents, ${part.first}–${part.last}).`,
      anchor: "agency-cfr",
    });
  return usableTakeaways(items, 6);
}
