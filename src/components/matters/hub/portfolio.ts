/**
 * The Seeger Weiss hub's portfolio figures, pure and tested (portfolio.test.ts). Every figure is built from the
 * same hub rows and PDF counts the table shows, so the command center never disagrees with a matter page.
 *
 * - Pending actions: the sum over matters whose JPML counts carry the latest report date; a matter dated otherwise
 *   (a terminated MDL from the fiscal-year report) is left out and named, never mixed in.
 * - Share of national: that sum over the national pending total of the same report only.
 * - Registry coverage: member-like dockets the matter registry published against the JPML cumulative total, shown as
 *   "N of M"; it is not a census and can exceed the JPML count (the registry also lists transferor dockets).
 * - PDF records: the per-matter verified-PDF counts the matter headers show, summed; a matter whose reader was not
 *   connected makes the total partial.
 */
import type { HubRegistry, HubRow } from "@/lib/matters/types";
import { shortCaption, type SeriesDrop, type VelocityModel, type VelocityRow } from "./velocity";

export type PortfolioKpis = {
  matters: number;
  /** Matters the JPML report lists as pending. */
  pendingMatters: number;
  /** Actions pending in the matters dated `reportDate`; null when none is. */
  pendingActions: number | null;
  /** Matters counted in pendingActions. */
  counted: number;
  /** Matters with JPML counts of another date, left out of the sum. */
  otherDates: { mdl: string; asOf: string | null }[];
  reportDate: string | null;
  national: number | null;
  nationalMdls: number | null;
  /** pendingActions / national × 100, same report only. */
  sharePct: number | null;
};

export function portfolioKpis(rows: readonly HubRow[], model: VelocityModel | null): PortfolioKpis {
  const reportDate = model?.latestReport ?? null;
  const latest = model?.months.find((m) => m.month === model.latestMonth) ?? null;
  const counted = rows.filter(
    (r) => r.pendingActions !== null && reportDate !== null && r.asOf === reportDate,
  );
  const pendingActions = counted.length
    ? counted.reduce((a, r) => a + (r.pendingActions ?? 0), 0)
    : null;
  const national = latest?.national ?? null;
  return {
    matters: rows.length,
    pendingMatters: rows.filter((r) => r.status === "pending").length,
    pendingActions,
    counted: counted.length,
    otherDates: rows.filter((r) => !counted.includes(r)).map((r) => ({ mdl: r.mdl, asOf: r.asOf })),
    reportDate,
    national,
    nationalMdls: latest?.nationalMdls ?? null,
    sharePct:
      pendingActions !== null && national !== null && national > 0
        ? (pendingActions / national) * 100
        : null,
  };
}

/**
 * "Hub matters held 78% of the 204,977 actions pending in all MDLs in Oct 2026, against 71% in Oct 2024" from the
 * series' first and last reports; null with fewer than two reports or no national total.
 */
export function portfolioShareTakeaway(
  months: VelocityModel["months"],
  label: (month: string) => string,
): string | null {
  const recorded = months.filter((m) => m.national > 0);
  const first = recorded[0];
  const last = recorded.at(-1);
  if (!first || !last || first === last) return null;
  const share = (m: (typeof recorded)[number]) => (m.portfolio / m.national) * 100;
  const p = (v: number) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}%`;
  return `Hub matters held ${p(share(last))} of the ${last.national.toLocaleString("en-US")} actions pending in all MDLs in ${label(last.month)}, against ${p(share(first))} in ${label(first.month)}`;
}

/**
 * "Most of the fall between Oct 2024 and Apr 2025 (223,205 actions) is MDL 2885 (3M Combat Arms Earplug), a hub
 * matter: its pending actions fell by 224,377." Computed from the loaded series; null unless one MDL accounts for at
 * least half of the series' largest national fall, so the note never outlives the data that supports it.
 */
export function largestDropNote(
  drop: SeriesDrop | null,
  label: (month: string) => string,
  fmt: (v: number) => string,
): string | null {
  if (!drop || drop.national <= 0 || drop.mdlDrop < drop.national / 2) return null;
  const name = shortCaption(drop.title);
  const who = `MDL ${drop.mdl}${name ? ` (${name})` : ""}${drop.inPortfolio ? ", a hub matter" : ""}`;
  return `Most of the fall between ${label(drop.from)} and ${label(drop.to)} (${fmt(drop.national)} actions) is ${who}: its pending actions fell by ${fmt(drop.mdlDrop)}.`;
}

export type PortfolioGrowth = {
  /** Hub matters with a complete 12-month window, most added first. */
  ranked: (VelocityRow & { name: string })[];
  /** Hub matters in the latest report without a complete window (new MDL or a re-count). */
  notRecorded: (VelocityRow & { name: string })[];
  /** Sum of added12m over `ranked`. */
  added12m: number | null;
  added3m: number | null;
};

export function portfolioGrowth(
  rows: readonly HubRow[],
  model: VelocityModel | null,
): PortfolioGrowth {
  const names = new Map(rows.map((r) => [r.mdl, r.shortName]));
  const mine = (model?.rows ?? [])
    .filter((v) => v.inLatest && names.has(v.mdl))
    .map((v) => ({ ...v, name: names.get(v.mdl)! }));
  const ranked = mine
    .filter((v) => v.added12m !== null)
    .sort((a, b) => b.added12m! - a.added12m! || Number(a.mdl) - Number(b.mdl));
  const notRecorded = mine.filter((v) => v.added12m === null);
  const with3 = ranked.filter((v) => v.added3m !== null);
  return {
    ranked,
    notRecorded,
    added12m: ranked.length ? ranked.reduce((a, v) => a + v.added12m!, 0) : null,
    added3m: with3.length ? with3.reduce((a, v) => a + v.added3m!, 0) : null,
  };
}

export type CoverageRow = {
  id: string;
  label: string;
  /** Registry member-like dockets as a percentage of JPML total actions. */
  value: number;
  dockets: number;
  actions: number;
  asOf: string | null;
};

export function coverageRows(rows: readonly HubRow[]): {
  rows: CoverageRow[];
  notRecorded: HubRow[];
} {
  const out: CoverageRow[] = [];
  const missing: HubRow[] = [];
  for (const r of rows) {
    if (r.registryDockets === null || r.totalActions === null || !(r.totalActions > 0)) {
      missing.push(r);
      continue;
    }
    out.push({
      id: r.mdl,
      label: `${r.shortName} (${r.mdl})`,
      value: (r.registryDockets / r.totalActions) * 100,
      dockets: r.registryDockets,
      actions: r.totalActions,
      asOf: r.asOf,
    });
  }
  out.sort((a, b) => a.value - b.value || Number(a.id) - Number(b.id));
  return { rows: out, notRecorded: missing };
}

/** "The registry holds under 10% of the JPML actions for 14 of 37 matters" (null without rows). */
export function coverageTakeaway(rows: readonly CoverageRow[], below = 10): string | null {
  if (!rows.length) return null;
  const under = rows.filter((r) => r.value < below).length;
  if (!under)
    return `The registry holds at least ${below}% of the JPML actions for all ${rows.length} matters compared`;
  return `The registry holds under ${below}% of the JPML actions for ${under} of ${rows.length} matters`;
}

export type PdfTotals = {
  total: number;
  open: number;
  held: number;
  /** Matters with verified PDF records. */
  matters: number;
  /** Matters whose reader was not connected: the totals leave them out. */
  notConnected: number;
};

/** Sum of the per-matter PDF counts the hub chips show; null when nothing was counted. */
export function pdfTotals(
  counts: Readonly<Record<string, HubRegistry>> | undefined,
): PdfTotals | null {
  if (!counts) return null;
  const out: PdfTotals = { total: 0, open: 0, held: 0, matters: 0, notConnected: 0 };
  let any = false;
  for (const c of Object.values(counts)) {
    if (!c) continue;
    if ("notConnected" in c) {
      out.notConnected += 1;
      continue;
    }
    any = true;
    if ("none" in c) continue;
    out.total += c.total;
    out.open += c.open;
    out.held += c.held;
    out.matters += 1;
  }
  return any ? out : null;
}
