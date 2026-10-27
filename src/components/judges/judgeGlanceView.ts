/**
 * Pure view model of the "At a glance" section of a judge page: the KPI tiles, the CJRA trend (axis, series, MDL
 * annotations) and the figures handed to the AI summary. Every value comes from an exactly linked record; a missing
 * value is null ("Not recorded"), never 0. Nothing here ranks judges or forecasts a ruling.
 */
import type { FigureInput } from "@/components/kit";
import type { PeriodAxis, TrendSeriesInput } from "@/components/charts/series";
import type { TrendEvent } from "@/components/charts/editorial";
import type { JudgeCrossProfile } from "@/lib/external/judgeCross.functions";
import {
  NOS_COVERAGE_FLOOR,
  shownProductShare,
  type JudgeActivity,
} from "@/lib/external/judgeCourtListener.functions";
import {
  CJRA_LABELS,
  lastPoint,
  type CjraSeriesKey,
  type JudgeCjra,
} from "@/lib/external/judgeCjra.functions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar 31, 2026" from "2026-03-31"; the input itself when it is not a date. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const mo = m ? Number(m[2]) : 0;
  return m && mo >= 1 && mo <= 12 ? `${MONTHS[mo - 1]} ${Number(m[3])}, ${m[1]}` : iso;
}

export const fmtCount = (v: number) => Math.round(v).toLocaleString("en-US");

export type GlanceKpi = {
  id: "mdls" | "motions" | "civil3y" | "dockets" | "days" | "rulings";
  label: string;
  /** Display text; null reads "Not recorded". */
  value: string | null;
  meta: string;
  source: { label: string; href?: string | undefined };
  period?: string | undefined;
};

export type GlanceInput = {
  cross: JudgeCrossProfile | null;
  cjra: JudgeCjra | null;
  activity: JudgeActivity | null;
  /** Case-law person id when the crosswalk links one exactly. */
  clPersonId: number | null;
  /**
   * null: the rulings dataset is not published; else the count. The tile is left out at 0 too, because 0 may only mean
   * the dataset does not cover this judge's court or dockets.
   */
  rulings: number | null;
  /** Coverage note from the rulings dataset's published metadata; never a hard-coded provenance. */
  rulingsNote?: string | null | undefined;
};

const JPML = {
  label: "JPML pending MDL report",
  href: "https://www.jpml.uscourts.gov/pending-mdls-0",
};
const CJRA = {
  label: "U.S. Courts, CJRA Appendix A",
  href: "https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report",
};
// prose says "case-law collection"; the source name stays only on the link label, as on the service panel
const clSource = (personId: number | null) =>
  personId !== null
    ? { label: "CourtListener person page", href: `https://www.courtlistener.com/person/${personId}/` }
    : { label: "Case-law collection" };
/**
 * Tile meta for assigned dockets: the product share always with its own base and that base's coverage, and only when
 * the base covers enough of the caseload. Kept under the 140-character note limit of the AI context.
 */
export function docketsMeta(d: NonNullable<JudgeActivity["dockets"]>): string {
  const shown = shownProductShare(d);
  if (shown !== null && d.nosRecorded !== null && d.nosCoveragePct !== null)
    return `${shown}% of ${fmtCount(d.nosRecorded)} with a recorded nature of suit (${d.nosCoveragePct}% of assigned) are product liability or pharma · source's collection`;
  if (d.productShare !== null && d.nosCoveragePct !== null)
    return `Nature of suit recorded for only ${d.nosCoveragePct}% of assigned; no product share shown (needs ${NOS_COVERAGE_FLOOR}%) · source's collection`;
  return "source's collection, not complete caseload";
}

/** Whether the CJRA civil_3y count is driven by MDL member cases: the judge holds pending MDLs or the report says so. */
export function civil3yIncludesMdl(
  cjra: JudgeCjra | null,
  cross: JudgeCrossProfile | null,
): boolean {
  if (cross && cross.pending.length > 0) return true;
  return !!cjra?.notes.some((n) => n.column === "civil_3y" && /multidistrict/i.test(n.text));
}

/** Up to six tiles. Each source that holds nothing for this judge still shows its tile as "Not recorded". */
export function glanceKpis(g: GlanceInput): GlanceKpi[] {
  const out: GlanceKpi[] = [];
  const x = g.cross;
  out.push({
    id: "mdls",
    label: "Pending MDLs",
    value: x ? fmtCount(x.pending.length) : null,
    meta: x
      ? `${fmtCount(x.pendingActions)} actions pending${x.asOf ? ` · JPML ${shortDate(x.asOf)}` : ""}`
      : "No JPML MDL record is linked to this judge",
    source: JPML,
    ...(x?.asOf ? { period: shortDate(x.asOf) } : {}),
  });
  const m6 = g.cjra ? lastPoint(g.cjra, "motions_6m") : null;
  out.push({
    id: "motions",
    label: "Motions pending > 6 months",
    value: m6 ? fmtCount(m6.value) : null,
    meta: m6
      ? `CJRA report of ${shortDate(m6.period)}${g.cjra && m6.period !== g.cjra.latestPeriod ? " (not listed in the latest report)" : ""}`
      : "No CJRA report is linked to this judge",
    source: CJRA,
    ...(m6 ? { period: shortDate(m6.period) } : {}),
  });
  const c3 = g.cjra ? lastPoint(g.cjra, "civil_3y") : null;
  out.push({
    id: "civil3y",
    label: "Civil cases pending > 3 years",
    value: c3 ? fmtCount(c3.value) : null,
    meta: c3
      ? `CJRA report of ${shortDate(c3.period)}${g.cjra && c3.period !== g.cjra.latestPeriod ? " (not listed in the latest report)" : ""}${civil3yIncludesMdl(g.cjra, x) ? " · includes MDL member cases" : ""}`
      : "No CJRA report is linked to this judge",
    source: CJRA,
    ...(c3 ? { period: shortDate(c3.period) } : {}),
  });
  const d = g.activity?.dockets ?? null;
  out.push({
    id: "dockets",
    label: "Assigned dockets",
    value: d ? fmtCount(d.assigned) : null,
    meta: d ? docketsMeta(d) : "No case-law docket record is linked",
    source: clSource(g.clPersonId),
    ...(d?.firstYear && d.lastYear ? { period: `${d.firstYear}–${d.lastYear}` } : {}),
  });
  out.push({
    id: "days",
    label: "Median days to termination, civil",
    value: d?.medianDaysCivil != null ? fmtCount(d.medianDaysCivil) : null,
    meta:
      d?.medianDaysCivil != null
        ? d.medianDaysN
          ? `n = ${fmtCount(d.medianDaysN)} civil dockets with both dates`
          : "civil dockets with both dates"
        : d
          ? "Not enough dated civil dockets in the collection"
          : "No case-law docket record is linked",
    source: clSource(g.clPersonId),
  });
  if (g.rulings !== null && g.rulings > 0)
    out.push({
      id: "rulings",
      label: "Recorded expert-admissibility rulings",
      value: fmtCount(g.rulings),
      meta: g.rulingsNote ? `${g.rulingsNote}; not every ruling` : "Recorded in this corpus; not every ruling",
      source: { label: "Judge expert rulings (corpus)" },
    });
  return out;
}

/** True when at least one source holds something for this judge (else the section is not drawn). */
export function glanceHasData(g: GlanceInput): boolean {
  return !!(g.cross || g.cjra || g.activity?.dockets || (g.rulings ?? 0) > 0);
}

// ------------------------------------------------------------------ CJRA trend

/** The report periods from the first one listing this judge to the last; inner gaps stay null. */
export function cjraWindow(
  c: JudgeCjra,
  key: CjraSeriesKey,
): { keys: string[]; values: (number | null)[] } {
  const s = c.series[key];
  const listed = s.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (!listed.length) return { keys: [], values: [] };
  const from = listed[0]!;
  const to = c.periods.length - 1;
  return { keys: c.periods.slice(from, to + 1), values: s.slice(from, to + 1) };
}

export function cjraAxis(keys: readonly string[]): PeriodAxis {
  return {
    keys,
    label: (k) => shortDate(k),
    tick: (k) => k.slice(0, 4),
    showTick: (k, i) => {
      // March reports only, every second year when the window is long
      if (!k.endsWith("-03-31")) return false;
      return keys.length <= 16 || i === 0 || Number(k.slice(0, 4)) % 2 === 0;
    },
  };
}

export function cjraSeries(
  c: JudgeCjra,
  key: CjraSeriesKey,
): { axis: PeriodAxis; series: TrendSeriesInput } | null {
  const w = cjraWindow(c, key);
  if (w.values.filter((v) => v !== null).length < 2) return null;
  return {
    axis: cjraAxis(w.keys),
    series: {
      id: key,
      label: CJRA_LABELS[key],
      points: w.keys.map((k, i) => ({ key: k, value: w.values[i] ?? null })),
    },
  };
}

/**
 * MDL transfer dates (JPML "date transferred") drawn on the first report period on or after each date, inside the
 * window. At most four, largest pending first; MDLs landing on one period share one rule.
 */
export function mdlEvents(cross: JudgeCrossProfile | null, keys: readonly string[]): TrendEvent[] {
  if (!cross || !keys.length) return [];
  const first = keys[0]!;
  const byKey = new Map<string, number[]>();
  const pending = [...cross.pending]
    .filter((m) => m.dateTransferred && /^\d{4}-\d{2}-\d{2}$/.test(m.dateTransferred))
    .sort((a, b) => b.pending - a.pending || a.mdl - b.mdl)
    .slice(0, 4);
  for (const m of pending) {
    const d = m.dateTransferred!;
    if (d < first) continue;
    const key = keys.find((k) => k >= d);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), m.mdl]);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, mdls]) => ({ key, label: `MDL ${mdls.join(", ")} transferred` }));
}

// ------------------------------------------------------------------ AI figures

/** The figures the section shows, in the order shown: KPI tiles first, then the charted latest values. */
export function glanceFigures(kpis: readonly GlanceKpi[], g: GlanceInput): FigureInput[] {
  const figs: FigureInput[] = kpis.map((k) => ({
    label: k.label,
    value: k.value,
    ...(k.period ? { period: k.period } : {}),
    note: k.meta,
  }));
  const d = g.activity?.dockets;
  if (d?.nosCoveragePct != null)
    figs.push({
      label: "Assigned dockets with a recorded nature of suit (base of the product share)",
      value: d.nosCoveragePct,
      unit: "% of assigned",
      decimals: 1,
    });
  const shown = shownProductShare(d);
  if (shown !== null && d?.nosRecorded != null)
    figs.push({
      label: `Product liability and health-care / pharma injury share of the ${fmtCount(d.nosRecorded)} dockets with a recorded nature of suit`,
      value: shown,
      unit: "%",
      decimals: 1,
    });
  if (g.cross)
    for (const m of [...g.cross.pending].sort((a, b) => b.pending - a.pending).slice(0, 4))
      figs.push({
        label: `MDL ${m.mdl} actions pending`,
        value: m.pending,
        unit: "actions",
        ...(g.cross.asOf ? { period: shortDate(g.cross.asOf) } : {}),
      });
  return figs;
}

export const GLANCE_QUESTIONS = [
  "What do these figures cover, and what do they leave out?",
  "How does the CJRA backlog relate to this judge's MDL inventory?",
  "Which sources and dates are these figures from?",
] as const;

/**
 * Scope line sent with the AI context: what the figures are, and what they are not. The clause comes first because
 * buildSectionContext cuts the scope at 120 characters, and a long name must not cut it.
 */
export function glanceScope(name: string): string {
  return `Recorded figures only, not a prediction of how the judge will rule · ${name}`;
}
