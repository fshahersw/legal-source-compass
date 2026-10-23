/**
 * Bridge from the published MDL readers (getMdlAnalytics: JPML monthly "pending MDL dockets" reports; getMdlHierarchy:
 * matter-registry member actions by originating court; getFirmNetwork: co-counsel pairs) to chart inputs and contract
 * facts. Pure and tested (mdl.test.ts). Every number is the reader's; the derivations are date arithmetic, counting
 * and grouping, each stated where it is shown.
 */
import type { Fact, MetricDef } from "@/lib/insights/contract";
import type { MdlAnalytics, MdlRow } from "@/lib/external/mdlAnalytics.functions";
import type { MdlHierarchy } from "@/lib/external/mdlNetwork.functions";
import type { FirmNetwork } from "@/lib/external/firmIntel.functions";
import type { SankeyLinkInput, SankeyNodeInput } from "@/components/charts/sankeyLayout";
import type { NetEdge, NetNode } from "@/components/charts/networkLayout";
import type { SurvivalSubject } from "@/components/charts/stats";

export const MDL_METRIC_PREFIX = "mdl.";
export const JPML_SOURCE = {
  label: "Judicial Panel on Multidistrict Litigation, pending MDL reports",
  url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
} as const;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days from a to b (ISO dates), or null when either is not a valid date. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const pa = ISO.exec(a);
  const pb = ISO.exec(b);
  if (!pa || !pb) return null;
  const ta = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  const tb = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
}

/** Calendar months from the month of a to the month of b (same month = 0). */
export function monthOffset(a: string, b: string): number | null {
  const pa = ISO.exec(a);
  const pb = ISO.exec(b);
  if (!pa || !pb) return null;
  return Number(pb[1]) * 12 + Number(pb[2]) - (Number(pa[1]) * 12 + Number(pa[2]));
}

export const mdlLabel = (r: Pick<MdlRow, "mdl" | "title">) =>
  `MDL ${r.mdl}${r.title ? `: ${r.title}` : ""}`;
export const mdlHref = (mdl: number) => `/matters/lens/${mdl}`;

export function mdlMetricDefs(data: MdlAnalytics): MetricDef[] {
  const common = {
    format: "count" as const,
    topic: "litigation" as const,
    entityTypes: ["mdl" as const],
    periodType: "snapshot" as const,
    sourceDatasets: ["mdl_analytics"],
    sourceLinks: [JPML_SOURCE],
    denominator: null,
    direction: "higher_is_more" as const,
    refreshedAt: data.overview.as_of,
  };
  const facts = data.mdls.reduce((n, r) => n + r.series.length, 0);
  const coverage = {
    from: data.overview.first_report,
    to: data.overview.as_of,
    entities: data.mdls.length,
    facts,
  };
  return [
    {
      ...common,
      id: `${MDL_METRIC_PREFIX}pending_actions`,
      label: "Actions pending in each MDL",
      description: "Actions still open in the MDL, as printed in each monthly JPML report.",
      unit: "actions pending",
      numerator: "Pending actions in the MDL's row of the report",
      method: "Read from each monthly report; a month without a report row for the MDL is a gap.",
      caveats: [
        "Reports start in October 2024 in this dataset; earlier months are not covered.",
        "An MDL leaves the report when it terminates; it is then not recorded, not zero.",
      ],
      coverage,
    },
    {
      ...common,
      id: `${MDL_METRIC_PREFIX}total_actions`,
      label: "Total actions in each MDL (pending and closed)",
      description:
        "The report's total column: every action ever in the MDL, including closed ones.",
      unit: "actions",
      numerator: "Total actions in the MDL's row of the report",
      method: "Read from each monthly report; a month without a report row for the MDL is a gap.",
      caveats: ["The total includes actions already closed or remanded."],
      coverage,
    },
  ];
}

/** Facts per MDL and report date (period type snapshot; entity id is the MDL number as text). */
export function mdlFacts(
  data: MdlAnalytics,
  metricId: string,
  options: {
    entityIds?: readonly string[] | undefined;
    period?: string | undefined;
    from?: string | null | undefined;
    to?: string | null | undefined;
  } = {},
): Fact[] {
  const field =
    metricId === `${MDL_METRIC_PREFIX}pending_actions`
      ? "pending"
      : metricId === `${MDL_METRIC_PREFIX}total_actions`
        ? "total"
        : null;
  if (!field) return [];
  const wanted = options.entityIds ? new Set(options.entityIds) : null;
  const out: Fact[] = [];
  for (const r of data.mdls) {
    const id = String(r.mdl);
    if (wanted && !wanted.has(id)) continue;
    for (const p of r.series) {
      if (!ISO.test(p.date)) continue;
      if (options.period && p.date !== options.period) continue;
      if (options.from && p.date < options.from) continue;
      if (options.to && p.date > options.to) continue;
      const v = p[field];
      out.push({
        metricId,
        entityType: "mdl",
        entityId: id,
        period: p.date,
        periodStart: p.date,
        periodEnd: p.date,
        value: typeof v === "number" && Number.isFinite(v) ? v : null,
        moe: null,
        partial: false,
        n: null,
        notRecordedReason: null,
      });
    }
  }
  return out;
}

export type SurvivalInput = {
  subjects: SurvivalSubject[];
  massTort: Set<string>;
  dropped: { mdl: number; reason: string }[];
  window: { from: string; to: string };
};

/**
 * Subjects for "years from MDL creation (first transfer order) to termination". Observation runs from the first report
 * in the dataset (or the transfer date, if later) to the termination date (event) or the latest report (censored).
 * An MDL created before the first report enters late (delayed entry), so it only counts as at risk from the age it had
 * when the reports begin.
 */
export function mdlSurvival(data: MdlAnalytics): SurvivalInput {
  const from = data.overview.first_report;
  const to = data.overview.as_of;
  const subjects: SurvivalSubject[] = [];
  const dropped: SurvivalInput["dropped"] = [];
  const massTort = new Set<string>();
  for (const r of data.mdls) {
    const start = r.dateTransferred;
    const ageAtFirst = daysBetween(start, from);
    if (ageAtFirst === null) {
      dropped.push({ mdl: r.mdl, reason: "transfer date not recorded" });
      continue;
    }
    const entry = Math.max(0, ageAtFirst) / 365.25;
    const terminated = r.status === "terminated";
    const endDate = terminated ? r.dateClosed : to;
    const exitDays = daysBetween(start, endDate);
    if (exitDays === null) {
      dropped.push({ mdl: r.mdl, reason: "termination date not recorded" });
      continue;
    }
    const exit = exitDays / 365.25;
    if (exit < entry) {
      dropped.push({ mdl: r.mdl, reason: "terminated before the reports begin" });
      continue;
    }
    if (r.massTort) massTort.add(String(r.mdl));
    subjects.push({ id: String(r.mdl), entry, exit, event: terminated });
  }
  return { subjects, massTort, dropped, window: { from, to } };
}

export type AlignedRow = { mdl: number; offset: number; pending: number };
export type AlignedCase = {
  mdl: number;
  label: string;
  transferred: string;
  months: number;
  massTort: boolean;
  latestPending: number | null;
};

/**
 * Pending actions by calendar months since the MDL's first transfer order, for MDLs created inside the report window
 * (so month 0 is observed rather than inferred). One row per MDL and report.
 */
export function mdlGrowthAligned(
  data: MdlAnalytics,
  options: { massTortOnly?: boolean } = {},
): { rows: AlignedRow[]; cases: AlignedCase[] } {
  const from = data.overview.first_report;
  const rows: AlignedRow[] = [];
  const cases: AlignedCase[] = [];
  for (const r of data.mdls) {
    if (options.massTortOnly && !r.massTort) continue;
    const t = r.dateTransferred;
    if (!t || !ISO.test(t) || t < from) continue;
    let months = -1;
    for (const p of r.series) {
      const off = monthOffset(t, p.date);
      if (off === null || off < 0 || typeof p.pending !== "number") continue;
      rows.push({ mdl: r.mdl, offset: off, pending: p.pending });
      months = Math.max(months, off);
    }
    if (months >= 0)
      cases.push({
        mdl: r.mdl,
        label: mdlLabel(r),
        transferred: t,
        months,
        massTort: r.massTort,
        latestPending: r.series.length ? (r.series[r.series.length - 1]!.pending ?? null) : null,
      });
  }
  cases.sort((a, b) => a.transferred.localeCompare(b.transferred) || a.mdl - b.mdl);
  return { rows, cases };
}

/**
 * Sankey from MDL hierarchy records: member actions' originating courts (top `perMdl` per MDL; the rest of the
 * recorded originating dockets grouped as "Other originating courts", computed as the record's total minus the courts
 * listed) into each MDL.
 */
export function originSankey(
  records: readonly MdlHierarchy[],
  perMdl = 6,
): { nodes: SankeyNodeInput[]; links: SankeyLinkInput[]; total: number } {
  const nodes = new Map<string, SankeyNodeInput>();
  const links: SankeyLinkInput[] = [];
  let total = 0;
  for (const h of records) {
    if (!h.origin) continue;
    const mdlId = `mdl:${h.mdl}`;
    nodes.set(mdlId, {
      id: mdlId,
      label: `MDL ${h.mdl}${h.transfereeCourt ? ` (${h.transfereeCourt.id.toUpperCase()})` : ""}`,
      column: 1,
    });
    const top = h.origin.byCourt.slice(0, perMdl);
    let listed = 0;
    for (const c of top) {
      const id = `court:${c.courtId}`;
      if (!nodes.has(id)) nodes.set(id, { id, label: c.court, column: 0 });
      links.push({ source: id, target: mdlId, value: c.dockets });
      listed += c.dockets;
    }
    const rest = h.origin.dockets - listed;
    if (rest > 0) {
      nodes.set("court:other", { id: "court:other", label: "Other originating courts", column: 0 });
      links.push({ source: "court:other", target: mdlId, value: rest });
    }
    total += h.origin.dockets;
  }
  return { nodes: [...nodes.values()], links, total };
}

/** Co-counsel network: firms as nodes (weight = pairs shown that include the firm), pairs as edges (shared parties). */
export function coCounselNetwork(net: FirmNetwork): { nodes: NetNode[]; edges: NetEdge[] } {
  const degree = new Map<string, number>();
  const edges: NetEdge[] = [];
  for (const p of net.cocounsel) {
    if (p.a.firm === p.b.firm) continue;
    degree.set(p.a.firm, (degree.get(p.a.firm) ?? 0) + 1);
    degree.set(p.b.firm, (degree.get(p.b.firm) ?? 0) + 1);
    edges.push({ a: p.a.firm, b: p.b.firm, weight: p.weight });
  }
  return {
    nodes: [...degree.entries()].map(([firm, d]) => ({ id: firm, label: firm, weight: d })),
    edges,
  };
}
