/**
 * JPML filing velocity, pure and tested (velocity.test.ts).
 *
 * Input: the per-MDL series of the JPML monthly "Pending MDL Dockets by Actions Pending" reports
 * (`jpml_pending_history_mdls`, item.analytics.series: report date, cumulative total actions, actions pending).
 * Output: actions added to each MDL over the last 3 and 12 reports (the change in the Panel's cumulative total),
 * the national pending series (every MDL listed in a report) and the hub portfolio's share of it.
 *
 * Rules:
 * - Reports are keyed by month (YYYY-MM): the Panel dates them between the 1st and the 5th.
 * - A window needs a report exactly 3 or 12 months before the latest one; otherwise it is "partial" and the figure
 *   is Not recorded (a new MDL never shows a short-window count as a 12-month one).
 * - A negative change means the Panel re-counted the docket: the figure is Not recorded ("recount"), never read as
 *   dismissals.
 * - An MDL missing from the latest report has no current figures.
 * - Registry membership is an exact MDL-number match; when the registry could not be read it is unknown (null),
 *   never "not in our registry".
 */

export type JpmlPoint = { date: string; total: number | null; pending: number | null };

export type JpmlMdlInput = {
  mdl: string;
  title: string | null;
  /** JPML docket type as printed ("Products Liability"). */
  type: string | null;
  points: readonly JpmlPoint[];
};

export type WindowState = "complete" | "partial" | "recount";

export type VelocityRow = {
  mdl: string;
  title: string | null;
  type: string | null;
  /** Listed in the latest monthly report. */
  inLatest: boolean;
  /** Actions pending and cumulative total in the latest report; null when not listed in it. */
  pending: number | null;
  total: number | null;
  /** Actions added over the last 12 and 3 reports; null unless the window is complete. */
  added12m: number | null;
  window12: WindowState;
  added3m: number | null;
  window3: WindowState;
  /** The last 3 months' additions times four: the recent annual pace, comparable with added12m. */
  pace3m: number | null;
  /** In the Seeger Weiss matter registry (exact MDL number); null when the registry could not be read. */
  inRegistry: boolean | null;
  /** On the Seeger Weiss hub's priority list. */
  inPortfolio: boolean;
  reports: number;
  firstMonth: string | null;
};

export type VelocityMonth = {
  month: string;
  /** Report date as printed for this month (the latest date seen for the month). */
  reportDate: string;
  /** Actions pending in every MDL listed in the report. */
  national: number;
  nationalMdls: number;
  /** Actions pending in the hub's matters listed in the report. */
  portfolio: number;
  portfolioMdls: number;
};

export type VelocityModel = {
  latestMonth: string | null;
  latestReport: string | null;
  months: VelocityMonth[];
  rows: VelocityRow[];
};

const MONTH = /^(\d{4})-(\d{2})/;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** "2026-10" for "2026-10-01"; null for anything else. */
export function monthOf(date: string | null | undefined): string | null {
  const m = MONTH.exec(date ?? "");
  if (!m) return null;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${m[2]}` : null;
}

/** The month `by` months after `month` ("2026-10", -12 -> "2025-10"). */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + by;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

type ByMonth = Map<string, JpmlPoint>;

function byMonth(points: readonly JpmlPoint[]): ByMonth {
  const out: ByMonth = new Map();
  for (const p of points) {
    const m = monthOf(p.date);
    if (!m) continue;
    const prev = out.get(m);
    // Two reports in one month: keep the later one.
    if (!prev || p.date > prev.date) out.set(m, p);
  }
  return out;
}

function windowDelta(
  months: ByMonth,
  latest: string,
  span: number,
): { value: number | null; state: WindowState } {
  const last = months.get(latest);
  const base = months.get(shiftMonth(latest, -span));
  if (!last || !base || !finite(last.total) || !finite(base.total))
    return { value: null, state: "partial" };
  const d = last.total - base.total;
  return d < 0 ? { value: null, state: "recount" } : { value: d, state: "complete" };
}

export function buildVelocity(
  inputs: readonly JpmlMdlInput[],
  options: { portfolio: ReadonlySet<string>; registry: ReadonlySet<string> | null },
): VelocityModel {
  const parsed = inputs.map((i) => ({ input: i, months: byMonth(i.points) }));
  let latestMonth: string | null = null;
  for (const p of parsed)
    for (const m of p.months.keys()) if (!latestMonth || m > latestMonth) latestMonth = m;

  const monthAgg = new Map<string, VelocityMonth>();
  for (const { input, months } of parsed)
    for (const [m, pt] of months) {
      if (!finite(pt.pending)) continue;
      const agg = monthAgg.get(m) ?? {
        month: m,
        reportDate: pt.date,
        national: 0,
        nationalMdls: 0,
        portfolio: 0,
        portfolioMdls: 0,
      };
      if (pt.date > agg.reportDate) agg.reportDate = pt.date;
      agg.national += pt.pending;
      agg.nationalMdls += 1;
      if (options.portfolio.has(input.mdl)) {
        agg.portfolio += pt.pending;
        agg.portfolioMdls += 1;
      }
      monthAgg.set(m, agg);
    }
  const monthsOut = [...monthAgg.values()].sort((a, b) => a.month.localeCompare(b.month));

  const rows: VelocityRow[] = parsed.map(({ input, months }) => {
    const keys = [...months.keys()].sort();
    const inLatest = latestMonth !== null && months.has(latestMonth);
    const last = inLatest && latestMonth ? months.get(latestMonth)! : null;
    const w12 = inLatest && latestMonth ? windowDelta(months, latestMonth, 12) : null;
    const w3 = inLatest && latestMonth ? windowDelta(months, latestMonth, 3) : null;
    return {
      mdl: input.mdl,
      title: input.title,
      type: input.type,
      inLatest,
      pending: last && finite(last.pending) ? last.pending : null,
      total: last && finite(last.total) ? last.total : null,
      added12m: w12?.value ?? null,
      window12: w12?.state ?? "partial",
      added3m: w3?.value ?? null,
      window3: w3?.state ?? "partial",
      pace3m: w3 && w3.value !== null ? w3.value * 4 : null,
      inRegistry: options.registry ? options.registry.has(input.mdl) : null,
      inPortfolio: options.portfolio.has(input.mdl),
      reports: keys.length,
      firstMonth: keys[0] ?? null,
    };
  });

  return {
    latestMonth,
    latestReport: latestMonth ? (monthAgg.get(latestMonth)?.reportDate ?? null) : null,
    months: monthsOut,
    rows,
  };
}

/** Rows in the latest report with a complete 12-month window, most added first; the rest apart. */
export function growthLeaders(
  rows: readonly VelocityRow[],
  filter: (r: VelocityRow) => boolean = () => true,
): { ranked: VelocityRow[]; notRecorded: VelocityRow[] } {
  const current = rows.filter((r) => r.inLatest && filter(r));
  return {
    ranked: current
      .filter((r) => r.added12m !== null)
      .sort((a, b) => b.added12m! - a.added12m! || Number(a.mdl) - Number(b.mdl)),
    notRecorded: current
      .filter((r) => r.added12m === null)
      .sort((a, b) => Number(a.mdl) - Number(b.mdl)),
  };
}

export const PRODUCTS_LIABILITY = "Products Liability";

export type LeaderboardKpis = {
  /** MDLs in the latest report that added more than 100 actions in the last 3 reports. */
  fastQuarter: number;
  /** Actions added in the last 12 reports to products-liability MDLs with a complete window. */
  plAdded12m: number;
  plAdded12mMdls: number;
  /** Products-liability MDLs left out of plAdded12m (window partial or re-counted). */
  plAdded12mExcluded: number;
  /** Products-liability MDLs in the latest report outside the registry, and their pending actions (null: unknown). */
  plOutside: number | null;
  plOutsidePending: number | null;
};

export function leaderboardKpis(rows: readonly VelocityRow[]): LeaderboardKpis {
  const current = rows.filter((r) => r.inLatest);
  const pl = current.filter((r) => r.type === PRODUCTS_LIABILITY);
  const complete = pl.filter((r) => r.added12m !== null);
  const registryKnown = current.every((r) => r.inRegistry !== null);
  const outside = pl.filter((r) => r.inRegistry === false);
  return {
    fastQuarter: current.filter((r) => r.added3m !== null && r.added3m > 100).length,
    plAdded12m: complete.reduce((a, r) => a + r.added12m!, 0),
    plAdded12mMdls: complete.length,
    plAdded12mExcluded: pl.length - complete.length,
    plOutside: registryKnown ? outside.length : null,
    plOutsidePending: registryKnown
      ? outside.reduce((a, r) => a + (r.pending ?? 0), 0)
      : null,
  };
}

/** "3140" -> the short name a reader knows ("Depo-Provera"), from the JPML caption. */
export function shortCaption(title: string | null): string | null {
  if (!title) return null;
  const t = title
    .replace(/^IN RE:?\s*/i, "")
    .replace(/\s+(Products? Liability|Marketing, Sales Practices,? and Products Liability)\s+Litigation.*$/i, "")
    .replace(/\s+Litigation.*$/i, "")
    .trim();
  return t || null;
}
