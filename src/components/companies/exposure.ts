/**
 * Exposure rules for the company views, applied on top of the published company_sec_* records. Pure; no I/O.
 *
 * - A link counts toward a company's exposure only when the published record counts it (defendant reading, not
 *   dismissed, no review note) AND its evidence is tier A or B. Tier C ("describes the MDL by its subject, requires
 *   review") is shown, labelled, but never counted, whatever the stored counts_toward_exposure flag says.
 * - JPML pending actions are MDL-wide: the same docket is shared by every co-defendant. A company is "named in N
 *   pending MDLs with X pending actions (MDL-wide)"; X is never shown as the company's own share, and across companies
 *   each MDL is counted once.
 * - XBRL financials whose latest fiscal year is 2023 or earlier are flagged stale; a co-registrant filer is flagged.
 */
import type { CompanyMdl, CompanySummary, CoverageRow, SeriesPoint, Tier } from "./companyData";

/** Latest fiscal year at or below which a company's XBRL financials are flagged stale. */
export const STALE_FY = 2023;

type LinkLike = Pick<CompanyMdl, "countsTowardExposure" | "tier" | "review" | "dismissed" | "role">;

/** Whether a link counts toward exposure in the UI (published rule plus: tier C never counts). */
export function countsInUi(m: LinkLike): boolean {
  return (
    m.countsTowardExposure &&
    m.tier !== "C" &&
    !m.review &&
    !m.dismissed &&
    m.role === "defendant"
  );
}

/** A defendant reading held back only because its evidence is tier C. */
export function tierCOnly(m: LinkLike): boolean {
  return m.tier === "C" && m.role === "defendant" && !m.dismissed;
}

export type UiExposure = {
  /** Pending MDLs counted (tier A/B defendant links). */
  namedPendingMdls: number;
  /** Sum of the JPML pending actions of those MDLs: MDL-wide, shared with co-defendants. */
  namedPendingActions: number | null;
  /** Their 12-month change, MDL-wide (null when none is recorded). */
  change12m: number | null;
  /** Strongest tier among counted links. */
  strongestTier: Exclude<Tier, "C"> | null;
  /** Pending defendant links held back because their evidence is tier C (requires review). */
  tierCPendingMdls: number;
  tierCPendingActions: number | null;
};

const sumOrNull = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, v) => a + v, 0) : null;
};

export function uiExposure(mdls: readonly CompanyMdl[]): UiExposure {
  const pending = mdls.filter((m) => m.status === "pending");
  const counted = pending.filter(countsInUi);
  const held = pending.filter((m) => !countsInUi(m) && tierCOnly(m));
  const tiers = counted.map((m) => m.tier);
  return {
    namedPendingMdls: counted.length,
    namedPendingActions: counted.length ? sumOrNull(counted.map((m) => m.pending)) : null,
    change12m: counted.length ? sumOrNull(counted.map((m) => m.change12m)) : null,
    strongestTier: tiers.includes("A") ? "A" : tiers.includes("B") ? "B" : null,
    tierCPendingMdls: held.length,
    tierCPendingActions: held.length ? sumOrNull(held.map((m) => m.pending)) : null,
  };
}

/** Flags whose rule reads the counted docket; dropped when no pending MDL counts under the UI rule. */
const DOCKET_FLAGS = new Set(["accrual_surge", "docket_growth", "multi_mdl"]);

/**
 * The summary with its exposure fields recomputed under the UI rule (tier C never counts), so every table, sort and
 * filter reads the same numbers. `pendingActions` stays the MDL-wide sum of the company's counted MDLs; the stored
 * share of all pending actions is dropped (it was summed across co-defendants).
 */
export function applyUiExposure(c: CompanySummary): CompanySummary {
  const e = uiExposure(c.mdls);
  return {
    ...c,
    mdls: c.mdls.map((m) => ({ ...m, countsTowardExposure: countsInUi(m) })),
    exposure: {
      ...c.exposure,
      pendingMdls: e.namedPendingMdls,
      pendingActions: e.namedPendingActions,
      pendingChange12m: e.change12m,
      pendingChangePct: null,
      sharePct: null,
      strongestTier: e.strongestTier,
      pendingActionsAB: e.namedPendingActions,
      pendingActionsC: null,
    },
    flags: e.namedPendingMdls ? c.flags : c.flags.filter((f) => !DOCKET_FLAGS.has(f)),
  };
}

/** "Named in 3 pending MDLs with 27,464 pending actions (MDL-wide)". */
export function exposureSentence(e: UiExposure): string {
  if (!e.namedPendingMdls)
    return e.tierCPendingMdls
      ? `No counted pending MDL; ${e.tierCPendingMdls} tier C link${e.tierCPendingMdls === 1 ? "" : "s"} require${e.tierCPendingMdls === 1 ? "s" : ""} review`
      : "No counted pending MDL";
  const mdls = `${e.namedPendingMdls} pending MDL${e.namedPendingMdls === 1 ? "" : "s"}`;
  return e.namedPendingActions === null
    ? `Named in ${mdls}; pending actions not recorded`
    : `Named in ${mdls} with ${e.namedPendingActions.toLocaleString("en-US")} pending actions (MDL-wide)`;
}

export type DataFlag = { id: "stale" | "co_registrant" | "no_xbrl"; label: string; detail: string };

/** Stale XBRL, co-registrant filing and missing XBRL, as flags for the company row and page. */
export function dataFlags(
  c: Pick<CompanySummary, "latestFy" | "coRegistrantOf" | "hasFinancials">,
  evidenceCoRegistrants: readonly string[] = [],
): DataFlag[] {
  const out: DataFlag[] = [];
  if (!c.hasFinancials || c.latestFy === null)
    out.push({
      id: "no_xbrl",
      label: "No XBRL financials",
      detail: "The registrant publishes no XBRL company facts that this atlas could read.",
    });
  else if (c.latestFy <= STALE_FY)
    out.push({
      id: "stale",
      label: `Latest XBRL FY${c.latestFy}`,
      detail: `The newest fiscal year in its XBRL facts is FY${c.latestFy}; its figures are not current.`,
    });
  const co = [...new Set([...c.coRegistrantOf, ...evidenceCoRegistrants])];
  if (co.length)
    out.push({
      id: "co_registrant",
      label: "Co-registrant filer",
      detail: `Files together with ${co.join("; ")}: some figures may be the combined filer's.`,
    });
  return out;
}

export type CoverageGroup = "ab" | "c" | "unclear" | "none";
export const COVERAGE_GROUP_LABEL: Record<CoverageGroup, string> = {
  ab: "SEC filer acknowledges it as defendant (tier A or B)",
  c: "Only subject-level evidence (tier C, requires review)",
  unclear: "SEC filer names it, role not stated",
  none: "No SEC filer names it",
};

type CoverageCompany = CoverageRow["companies"][number];

/** The best evidence group of one MDL from its linked filers (UI rule: tier C never counts as acknowledged). */
export function coverageGroup(companies: readonly CoverageCompany[]): CoverageGroup {
  if (!companies.length) return "none";
  if (
    companies.some(
      (c) => c.counted && c.tier !== "C" && c.role === "defendant" && !c.dismissed && !c.review,
    )
  )
    return "ab";
  if (companies.some((c) => c.tier === "C" && c.role === "defendant" && !c.dismissed)) return "c";
  return "unclear";
}

export type CoverageMdl = {
  mdl: number;
  title: string;
  titleTruncated: boolean;
  pending: number;
  change12m: number | null;
  group: CoverageGroup;
  companies: CoverageCompany[];
};

/**
 * Pending products-liability MDLs (each counted once) with their best evidence group. `change12m` comes from the
 * MDL-level change map (exact MDL number); MDLs without a pending count are left out and counted in `noCount`.
 */
export function coverageMap(
  coverage: readonly (CoverageRow & { type?: string | null })[],
  change: ReadonlyMap<number, number | null>,
  type = "Products Liability",
): { rows: CoverageMdl[]; noCount: number } {
  const seen = new Set<number>();
  const rows: CoverageMdl[] = [];
  let noCount = 0;
  for (const r of coverage) {
    if (r.status !== "pending" || (r.type ?? null) !== type || seen.has(r.mdl)) continue;
    seen.add(r.mdl);
    if (r.pending === null) {
      noCount += 1;
      continue;
    }
    rows.push({
      mdl: r.mdl,
      title: r.title,
      titleTruncated: r.titleTruncated,
      pending: r.pending,
      change12m: change.get(r.mdl) ?? null,
      group: coverageGroup(r.companies),
      companies: r.companies,
    });
  }
  rows.sort((a, b) => b.pending - a.pending || a.mdl - b.mdl);
  return { rows, noCount };
}

/** Totals by group; the groups partition the MDLs and their pending actions exactly. */
export function coverageTotals(rows: readonly CoverageMdl[]) {
  const out: Record<CoverageGroup, { mdls: number; pending: number }> = {
    ab: { mdls: 0, pending: 0 },
    c: { mdls: 0, pending: 0 },
    unclear: { mdls: 0, pending: 0 },
    none: { mdls: 0, pending: 0 },
  };
  for (const r of rows) {
    out[r.group].mdls += 1;
    out[r.group].pending += r.pending;
  }
  const all = rows.reduce((a, r) => a + r.pending, 0);
  return { groups: out, mdls: rows.length, pending: all };
}

/** Accrual as % of revenue in the latest two consecutive fiscal years, for companies whose financials are current. */
export function accrualDumbbell(
  companies: readonly CompanySummary[],
  limit = 15,
): { id: string; label: string; a: number; b: number; note: string }[] {
  return companies
    .flatMap((c) => {
      if (c.latestFy === null || c.latestFy <= STALE_FY || !c.accrualCurrent) return [];
      const s = [...c.accrualPctSeries].sort((x, y) => x.fy - y.fy);
      const last = s.at(-1);
      const prev = s.at(-2);
      if (!last || !prev || last.fy !== prev.fy + 1) return [];
      return [
        {
          id: c.profile.cik,
          label: c.profile.name,
          a: prev.pct,
          b: last.pct,
          note: `FY${prev.fy} → FY${last.fy}`,
        },
      ];
    })
    .sort((x, y) => y.b - x.b)
    .slice(0, limit);
}

/**
 * The JPML monthly report that follows a quarter end: the report dated in the first seven days of the next month
 * (reports are dated the first business day of each month). Exact rule; no nearest-date search.
 */
export function reportAfterQuarter(quarterEnd: string, reports: ReadonlyMap<string, number>) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(quarterEnd);
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]) + 1;
  if (mo === 13) {
    mo = 1;
    y += 1;
  }
  const prefix = `${y}-${String(mo).padStart(2, "0")}-0`;
  for (let d = 1; d <= 7; d++) {
    const v = reports.get(`${prefix}${d}`);
    if (v !== undefined) return v;
  }
  return null;
}

export type IndexSeries = { id: string; label: string; points: { date: string; value: number | null }[] };

/**
 * Reserve vs docket series for one company on shared quarter-end dates: the company-wide litigation accrual (XBRL,
 * period-end balance) and the pending actions of its counted MDLs (and, separately, of its tier C MDLs) from the JPML
 * report after each quarter end. Dates run over the quarters the JPML series covers; a missing value stays null.
 */
export function reserveDocketSeries(
  accrual: readonly { end: string; value: number; unit: string; concept: string }[],
  counted: readonly SeriesPoint[],
  tierC: readonly SeriesPoint[] = [],
): { series: IndexSeries[]; concept: string | null; unit: string | null } {
  const reports = (s: readonly SeriesPoint[]) => new Map(s.map((p) => [p.date, p.pending]));
  const all = [...counted, ...tierC].map((p) => p.date).sort();
  const first = all[0];
  const last = all.at(-1);
  const usd = accrual.filter((p) => p.unit === "USD");
  const concepts = [...new Set(usd.map((p) => p.concept))];
  if (!first || !last || concepts.length !== 1)
    return { series: [], concept: concepts.length === 1 ? concepts[0]! : null, unit: null };
  // quarter ends from the month before the first report to the month before the last report
  const ends: string[] = [];
  const [fy, fm] = first.split("-").map(Number) as [number, number];
  const [ly, lm] = last.split("-").map(Number) as [number, number];
  let y = fm === 1 ? fy - 1 : fy;
  let mo = fm === 1 ? 12 : fm - 1;
  const stopY = lm === 1 ? ly - 1 : ly;
  const stopM = lm === 1 ? 12 : lm - 1;
  while (y < stopY || (y === stopY && mo <= stopM)) {
    if (mo % 3 === 0) {
      const day = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      ends.push(`${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
    mo += 1;
    if (mo === 13) {
      mo = 1;
      y += 1;
    }
  }
  const byEnd = new Map(usd.map((p) => [p.end, p.value]));
  const cr = reports(counted);
  const tr = reports(tierC);
  const series: IndexSeries[] = [
    {
      id: "accrual",
      label: "Litigation accrual (company-wide)",
      points: ends.map((d) => ({ date: d, value: byEnd.get(d) ?? null })),
    },
  ];
  if (counted.length)
    series.push({
      id: "docket",
      label: "Pending in counted MDLs (MDL-wide)",
      points: ends.map((d) => ({ date: d, value: reportAfterQuarter(d, cr) })),
    });
  if (tierC.length)
    series.push({
      id: "docket_c",
      label: "Pending in tier C MDLs (requires review)",
      points: ends.map((d) => ({ date: d, value: reportAfterQuarter(d, tr) })),
    });
  return { series, concept: concepts[0]!, unit: "USD" };
}

/** Sum of the monthly JPML series of the given links, by report date (an MDL created later counts from its first report). */
export function sumSeries(series: readonly (readonly SeriesPoint[])[]): SeriesPoint[] {
  const by = new Map<string, number>();
  for (const s of series) for (const p of s) by.set(p.date, (by.get(p.date) ?? 0) + p.pending);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pending]) => ({ date, pending }));
}
