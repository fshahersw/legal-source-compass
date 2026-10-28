/** MDL and mass-tort analytics built from JPML monthly reports (datasets mdl_analytics, mdl_terminated_history). */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";
import { validSeries, windowFigures } from "./mdlSeries";

import type { MdlPoint } from "./mdlSeries";
export type { MdlPoint } from "./mdlSeries";
export type MdlRow = {
  mdl: number;
  title: string;
  type: string | null;
  massTort: boolean;
  status: "pending" | "terminated" | "no_longer_listed";
  district: string | null;
  judge: string | null;
  /** Actions pending in the latest report; null when the record does not carry the figure (never read as 0). */
  pending: number | null;
  total: number | null;
  change1m: number | null;
  change3m: number | null;
  change12m: number | null;
  new12m: number | null;
  resolved12m: number | null;
  ageYears: number | null;
  growth: string;
  dateTransferred: string | null;
  dateClosed: string | null;
  rank: number | null;
  sharePct: number | null;
  series: MdlPoint[];
};
export type GroupStat = {
  key: string;
  mdls: number;
  pending: number;
  total: number;
  change_12m: number;
  top: { mdl: number; title: string; pending: number }[];
};
export type MdlOverview = {
  as_of: string;
  reports: number;
  first_report: string;
  pending_mdls: number;
  pending_actions: number;
  mass_tort_mdls: number;
  mass_tort_actions: number;
  median_age_years: number | null;
  top10_share_pct: number;
  new_mdls_in_series: number;
  left_series: number;
  portfolio: {
    date: string;
    pending: number;
    mdls: number;
    mass_tort_pending: number;
    mass_tort_mdls: number;
  }[];
  by_type: GroupStat[];
  by_district: GroupStat[];
  by_judge: GroupStat[];
};
export type TerminatedStats = {
  rows: number;
  byDecade: { decade: string; mdls: number; actions: number; remanded: number }[];
  byCircuit: { circuit: string; mdls: number; actions: number; remandPct: number | null }[];
  largest: {
    mdl: number;
    caption: string;
    district: string;
    year: number;
    actions: number;
    remanded: number;
  }[];
  totals: { actions: number; closed: number; remanded: number; remandPct: number | null };
};
export type MdlAnalytics = { overview: MdlOverview; mdls: MdlRow[]; terminated: TerminatedStats };

type TerminatedHistory = {
  mdl: number;
  caption: string;
  circuit: string | null;
  district_name: string;
  actions_transferred: number;
  actions_filed_in_transferee: number;
  actions_closed: number;
  actions_remanded: number;
  termination_year: number;
};
type AnalyticsItem = {
  kind?: string;
  overview?: MdlOverview;
  rank?: number | null;
  share_pct?: number | null;
  title?: string;
  analytics?: Record<string, unknown>;
  history?: TerminatedHistory | undefined;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
function toRow(item: AnalyticsItem): MdlRow | null {
  const a = item.analytics;
  if (!a || typeof a["mdl"] !== "number") return null;
  const series = validSeries(a["series"]);
  // Windowed changes come from the validated series with exact calendar-month matching (see windowFigures): the
  // record's own fields can carry a nearest-report substitute when the Panel skipped a month.
  const w = windowFigures(series);
  const status =
    a["status"] === "terminated" || a["status"] === "no_longer_listed" ? a["status"] : "pending";
  return {
    mdl: a["mdl"],
    title: item.title ?? "",
    type: str(a["type"]),
    massTort: a["mass_tort"] === true,
    status,
    district: str(a["district"]),
    judge: str(a["judge"]),
    pending: num(a["pending"]),
    total: num(a["total"]),
    change1m: w.change1m,
    change3m: w.change3m,
    change12m: w.change12m,
    new12m: w.new12m,
    resolved12m: w.resolved12m,
    ageYears: num(a["age_years"]),
    growth: str(a["growth"]) ?? "insufficient_history",
    dateTransferred: str(a["date_transferred"]),
    dateClosed: str(a["date_closed"]),
    rank: num(item.rank),
    sharePct: num(item.share_pct),
    series,
  };
}

function terminatedStats(items: AnalyticsItem[]): TerminatedStats {
  const decades = new Map<string, { mdls: number; actions: number; remanded: number }>();
  const circuits = new Map<string, { mdls: number; actions: number; remanded: number }>();
  const largest: TerminatedStats["largest"] = [];
  let actions = 0;
  let closed = 0;
  let remanded = 0;
  for (const { history: h } of items) {
    if (!h) continue;
    const terminatedActions = h.actions_closed + h.actions_remanded;
    actions += terminatedActions;
    closed += h.actions_closed;
    remanded += h.actions_remanded;
    const decade = `${Math.floor(h.termination_year / 10) * 10}s`;
    const d = decades.get(decade) ?? { mdls: 0, actions: 0, remanded: 0 };
    d.mdls++;
    d.actions += terminatedActions;
    d.remanded += h.actions_remanded;
    decades.set(decade, d);
    const circuit = h.circuit ?? "Not recorded";
    const c = circuits.get(circuit) ?? { mdls: 0, actions: 0, remanded: 0 };
    c.mdls++;
    c.actions += terminatedActions;
    c.remanded += h.actions_remanded;
    circuits.set(circuit, c);
    largest.push({
      mdl: h.mdl,
      caption: h.caption,
      district: h.district_name,
      year: h.termination_year,
      actions: terminatedActions,
      remanded: h.actions_remanded,
    });
  }
  const pct = (part: number, whole: number) =>
    whole ? Math.round((1000 * part) / whole) / 10 : null;
  return {
    rows: items.length,
    byDecade: [...decades.entries()]
      .map(([decade, v]) => ({ decade, ...v }))
      .sort((a, b) => a.decade.localeCompare(b.decade)),
    byCircuit: [...circuits.entries()]
      .map(([circuit, v]) => ({
        circuit,
        mdls: v.mdls,
        actions: v.actions,
        remandPct: pct(v.remanded, v.actions),
      }))
      .sort((a, b) => b.actions - a.actions),
    largest: largest.sort((a, b) => b.actions - a.actions).slice(0, 15),
    totals: { actions, closed, remanded, remandPct: pct(remanded, actions) },
  };
}

let cache: { at: number; value: MdlAnalytics } | null = null;
const TTL_MS = 10 * 60 * 1000;

async function readAll(dataset: string, select: string) {
  const rows: { id: string; item: AnalyticsItem }[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await restGet<{ id: string; item: AnalyticsItem }[]>(
      `corpus_records?select=${select}&dataset=eq.${dataset}&order=ordinal.asc`,
      { range: [start, start + 999] },
    );
    rows.push(...page.rows);
    if (page.rows.length < 1000) return rows;
  }
}

export const getMdlAnalytics = createServerFn({ method: "GET" }).handler(
  async (): Promise<MdlAnalytics | null> => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    const [records, history] = await Promise.all([
      readAll("mdl_analytics", "id,item"),
      readAll("mdl_terminated_history", "id,item:item->history"),
    ]);
    const overview = records.find((r) => r.id === "summary:overview")?.item.overview;
    if (!overview) return null;
    const mdls = records.map((r) => toRow(r.item)).filter((r): r is MdlRow => r !== null);
    const value: MdlAnalytics = {
      overview,
      mdls,
      terminated: terminatedStats(
        history.map((r) => ({ history: r.item as TerminatedHistory | undefined })),
      ),
    };
    cache = { at: Date.now(), value };
    return value;
  },
);
