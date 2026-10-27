/**
 * Emerging-tort radar: the pure model behind /safety/signals "Emerging (no MDL linked)". Parses the records of
 * dataset agency_safety_tort_radar (scripts/enrichment/build_emerging_tort_radar.py), drops any row whose stored
 * total does not equal the sum of its components (so a shown score always reconciles), and derives the KPIs, the
 * chart inputs and the AI context from those rows only. No I/O.
 *
 * Wording rule: a unit is "No MDL linked" (by the exact keys listed), never "no MDL exists".
 */
import { z } from "zod";
import { buildSectionContext, type FigureInput, type SectionContext } from "@/components/kit/ai";

export const RADAR_DATASET = "agency_safety_tort_radar";
/** A radar unit id as the builder writes it ("drug:faers:pimavanserin-tartrate", "jpml:3204"). */
export const UNIT_ID = /^(drug|vehicle|jpml|device):[A-Za-z0-9._:-]{1,120}$/;
export const FAMILIES = ["A", "B", "C", "D"] as const;
export type RadarFamily = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<RadarFamily, string> = {
  A: "Reports",
  B: "Severity",
  C: "Regulator",
  D: "Litigation",
};
export const STATUS_LABEL = {
  none_linked: "No MDL linked",
  terminated_mdl: "Earlier MDL closed",
  pending_mdl: "In an MDL",
} as const;
export type RadarStatus = keyof typeof STATUS_LABEL;
export const KIND_LABEL = {
  drug: "Drug",
  vehicle: "Vehicle",
  jpml: "JPML matter",
  device: "Device",
} as const;
export type RadarKind = keyof typeof KIND_LABEL;

const num = z.number().finite().nullable().optional();
/** Identifier and coverage values: text, numbers, flags or lists of them (always serializable). */
const plain = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number()])),
]);
const text = z.string().nullable().optional();

const componentSchema = z.object({
  family: z.enum(FAMILIES),
  metric: z.string(),
  observed: num,
  expected: num,
  ratio: num,
  ci_low: num,
  ci_high: num,
  points: z.number().int().min(0),
  max_points: z.number().int().min(0),
  window: text,
  source: text,
  source_url: text,
  rated: z.boolean().optional(),
  note: text,
  share: num,
  national_share: num,
});
export type RadarComponent = z.infer<typeof componentSchema>;

const linkSchema = z.object({
  mdl: z.number().int(),
  basis: z.string(),
  note: text,
  status: z.string(),
  title: text,
  source_url: text,
  date: text,
});
export type RadarLink = z.infer<typeof linkSchema>;

const evidenceSchema = z.object({
  dataset: z.string(),
  id: z.string(),
  url: text,
  date: text,
  label: z.string(),
  basis: text,
  points: num,
  excerpt: text,
});
export type RadarEvidence = z.infer<typeof evidenceSchema>;

const flagSchema = z.object({ key: z.string(), label: z.string(), detail: text });
export type RadarFlag = z.infer<typeof flagSchema>;

const seriesSchema = z.object({
  unit: z.string(),
  start: z.string().regex(/^\d{4}-\d{2}$/),
  values: z.array(z.number().int().min(0)),
  source: text,
  source_url: text,
});
export type RadarSeries = z.infer<typeof seriesSchema>;

const termSchema = z.object({
  term: z.string(),
  recent: num,
  prior: num,
  quality: z.boolean().optional(),
});
export type RadarTerm = z.infer<typeof termSchema>;

export const unitSchema = z.object({
  unit_id: z.string().regex(UNIT_ID),
  kind: z.enum(["drug", "vehicle", "jpml", "device"]),
  label: z.string().min(1),
  identifiers: z.record(plain).default({}),
  mdl_status: z.object({
    status: z.enum(["none_linked", "pending_mdl", "terminated_mdl"]),
    links: z.array(linkSchema),
  }),
  components: z.array(componentSchema).min(1),
  points: z.number().int().min(0),
  families_present: z.number().int().min(0).max(4),
  families: z.array(z.enum(FAMILIES)),
  excess: num,
  series: seriesSchema.nullable().optional(),
  evidence: z.array(evidenceSchema).default([]),
  flags: z.array(flagSchema).default([]),
  window: z.object({ recent: text, baseline: text }).partial().default({}),
  caveat: text,
  as_of: text,
  rank: z.number().int().positive().nullable().optional(),
  /** Terms with a measured prior count that rose (recent > prior), by the rise. */
  top_rising_terms: z.array(termSchema).optional(),
  /** Terms in every recent quarter's stored top N whose prior count is not recorded (their rise is not measured). */
  entered_terms: z.array(termSchema).optional(),
  terms_window: z.object({ recent: text, prior: text, top_n: num }).partial().nullable().optional(),
  jpml_status: text,
});
export type RadarUnit = z.infer<typeof unitSchema>;

const laneEventSchema = z.object({
  kind: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string(),
  url: text,
  id: text,
  dataset: text,
});
const laneSchema = z.object({
  mdl: z.number().int(),
  title: z.string(),
  status: z.enum(["pending", "denied", "centralized"]),
  session: z.string(),
  events: z.array(laneEventSchema),
  district: text,
});
export type RadarLane = z.infer<typeof laneSchema>;

const nationalSeries = z
  .object({ unit: z.string(), values: z.array(z.number()), start: z.string() })
  .optional();

export const summarySchema = z.object({
  as_of: z.string(),
  basis: text,
  windows: z.record(z.string()).default({}),
  national: z
    .object({
      faers: z
        .object({
          factor: num,
          serious_share: num,
          window: text,
          baseline_window: text,
          series: nationalSeries,
        })
        .optional(),
      nhtsa: z
        .object({
          factor: num,
          window: text,
          baseline_window: text,
          latest_received: text,
          series: nationalSeries,
        })
        .optional(),
    })
    .default({}),
  coverage: z.record(plain).default({}),
  counts: z.record(z.number()).default({}),
  jpml_lanes: z.array(laneSchema).default([]),
  method: z.record(z.string()).default({}),
  caveat: text,
});
export type RadarSummary = z.infer<typeof summarySchema>;

/** Sum of the component points and the families that scored: what every displayed total must equal. */
export function reconcile(u: { components: readonly RadarComponent[] }): {
  points: number;
  families: RadarFamily[];
} {
  const points = u.components.reduce((s, c) => s + c.points, 0);
  const families = FAMILIES.filter((f) => u.components.some((c) => c.family === f && c.points > 0));
  return { points, families };
}

/** One stored unit, or null when it is malformed or its total does not reconcile with its components. */
export function parseUnit(raw: unknown): RadarUnit | null {
  const parsed = unitSchema.safeParse(raw);
  if (!parsed.success) return null;
  const u = parsed.data;
  const { points, families } = reconcile(u);
  if (points !== u.points || families.length !== u.families_present) return null;
  if (families.join("") !== [...u.families].sort().join("")) return null;
  if (u.components.some((c) => c.points > c.max_points)) return null;
  return u;
}

export function parseSummary(raw: unknown): RadarSummary | null {
  const parsed = summarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A stored record's item: a unit (`item.radar`) or the overview (`item.summary`). */
export function parseRecords(items: readonly unknown[]): {
  units: RadarUnit[];
  summary: RadarSummary | null;
  dropped: number;
} {
  const units: RadarUnit[] = [];
  let summary: RadarSummary | null = null;
  let dropped = 0;
  for (const item of items) {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    if (o["kind"] === "radar_summary") {
      summary = parseSummary(o["summary"]) ?? summary;
      continue;
    }
    const u = parseUnit(o["radar"]);
    if (u) units.push(u);
    else dropped += 1;
  }
  return { units, summary, dropped };
}

/** The list row the page needs (series, terms and evidence text stay on the server until a row is opened). */
export type RadarRow = Pick<
  RadarUnit,
  | "unit_id"
  | "kind"
  | "label"
  | "components"
  | "points"
  | "families_present"
  | "families"
  | "excess"
  | "flags"
  | "window"
  | "rank"
  | "jpml_status"
> & {
  status: RadarStatus;
  mdls: { mdl: number; status: string; basis: string }[];
  /** Open NHTSA investigations that scored on this unit (one investigation can score on several units). */
  openInvestigations: number;
  openInvestigationIds: string[];
  recalls: number;
  secMentions: number;
};

export function toRow(u: RadarUnit): RadarRow {
  const ev = u.evidence;
  const invIds = [
    ...new Set(
      ev
        .filter((e) => e.dataset === "agency_safety_nhtsa_investigations" && (e.points ?? 0) > 0)
        .map((e) => e.id),
    ),
  ];
  return {
    unit_id: u.unit_id,
    kind: u.kind,
    label: u.label,
    components: u.components,
    points: u.points,
    families_present: u.families_present,
    families: u.families,
    excess: u.excess ?? null,
    flags: u.flags,
    window: u.window,
    rank: u.rank ?? null,
    jpml_status: u.jpml_status ?? null,
    status: u.mdl_status.status,
    mdls: u.mdl_status.links.map((l) => ({ mdl: l.mdl, status: l.status, basis: l.basis })),
    openInvestigations: invIds.length,
    openInvestigationIds: invIds,
    recalls: ev.filter((e) => /recall|enforcement/.test(e.dataset)).length,
    secMentions: ev.filter((e) => e.dataset === "company_sec_legal_proceedings").length,
  };
}

/** The reports component (family A), if any. */
export const reportsOf = (r: Pick<RadarRow, "components">) =>
  r.components.find((c) => c.family === "A") ?? null;

/**
 * Units shown in the emerging list: no OPEN MDL linked, that is none linked, or linked only to MDLs the JPML lists as
 * closed (those carry `closedMdlNote` wherever they are listed); ranked.
 */
export function emerging(rows: readonly RadarRow[]): RadarRow[] {
  return rows
    .filter((r) => r.status !== "pending_mdl" && r.rank != null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

/** "Earlier MDL closed: 2331" for a unit linked only to closed MDLs; undefined otherwise. */
export function closedMdlNote(r: Pick<RadarRow, "status" | "mdls">): string | undefined {
  if (r.status !== "terminated_mdl") return undefined;
  const ids = [...new Set(r.mdls.map((m) => m.mdl))];
  return `${STATUS_LABEL.terminated_mdl}: ${ids.join(", ") || "Not recorded"}`;
}

/** Counts per kind of unit (drug / vehicle / JPML matter), kinds with none left out. */
export type KindCounts = Partial<Record<RadarKind, number>>;

const countByKind = (rows: readonly Pick<RadarRow, "kind">[]): KindCounts => {
  const out: KindCounts = {};
  for (const r of rows) out[r.kind] = (out[r.kind] ?? 0) + 1;
  return out;
};

/** "80 vehicle units · 3 drugs" (kinds in a fixed order; "none" when empty). */
export function kindBreakdown(c: KindCounts): string {
  const names: Record<RadarKind, [string, string]> = {
    vehicle: ["vehicle unit", "vehicle units"],
    drug: ["drug", "drugs"],
    jpml: ["JPML matter", "JPML matters"],
    device: ["device", "devices"],
  };
  const parts = (["vehicle", "drug", "jpml", "device"] as const)
    .filter((k) => (c[k] ?? 0) > 0)
    .map((k) => `${(c[k] ?? 0).toLocaleString("en-US")} ${names[k][c[k] === 1 ? 0 : 1]}`);
  return parts.join(" · ") || "none";
}

export type RadarKpis = {
  threePlusFamilies: number;
  threePlusByKind: KindCounts;
  pendingMotions: number;
  denied36: number;
  risingNoMdl: number;
  risingByKind: KindCounts;
  /** Distinct open NHTSA investigations that scored on the ranked vehicle units. */
  openInvestigations: number;
  /** Ranked vehicle units with at least one of them. */
  investigatedUnits: number;
  /** Ranked units linked only to closed MDLs (marked wherever listed). */
  closedMdlRanked: number;
  excluded: number;
};

const monthsBefore = (iso: string, months: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

export function radarKpis(rows: readonly RadarRow[], summary: RadarSummary | null): RadarKpis {
  const el = emerging(rows);
  const lanes = summary?.jpml_lanes ?? [];
  const cutoff = summary ? monthsBefore(summary.as_of, 36) : "";
  const three = el.filter((r) => r.families_present >= 3);
  const rising = el.filter((r) => r.kind !== "jpml" && (reportsOf(r)?.ci_low ?? 0) > 1.5);
  // One investigation can name several makes, models or components: count each id once.
  const invIds = new Set(el.flatMap((r) => r.openInvestigationIds ?? []));
  return {
    threePlusFamilies: three.length,
    threePlusByKind: countByKind(three),
    pendingMotions: lanes.filter((l) => l.status === "pending").length,
    denied36: lanes.filter((l) => l.status === "denied" && l.session >= cutoff).length,
    risingNoMdl: rising.length,
    risingByKind: countByKind(rising),
    openInvestigations: invIds.size,
    investigatedUnits: el.filter((r) => (r.openInvestigationIds ?? []).length > 0).length,
    closedMdlRanked: el.filter((r) => r.status === "terminated_mdl").length,
    excluded: rows.filter((r) => r.status === "pending_mdl").length,
  };
}

/** Median of the numbers (null when empty). */
export function median(values: readonly number[]): number | null {
  const v = [...values].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/**
 * Rate ratios of the top units of one kind against the median of every rated unit of that kind (chart-kit rule:
 * a dot plot's baseline is the median of the compared units; the national change, 1.0 by construction, is stated
 * beside it).
 */
export function ratioDots(rows: readonly RadarRow[], kind: "drug" | "vehicle", n = 12) {
  const rated = emerging(rows).filter((r) => r.kind === kind && reportsOf(r)?.ratio != null);
  const base = median(rated.map((r) => reportsOf(r)!.ratio!));
  const top = [...rated]
    .sort((a, b) => (reportsOf(b)!.ci_low ?? 0) - (reportsOf(a)!.ci_low ?? 0))
    .slice(0, n);
  return {
    items: top.map((r) => ({ id: r.unit_id, label: r.label, value: reportsOf(r)!.ratio ?? null })),
    rows: top,
    baseline: base,
    compared: rated.length,
  };
}

/** Monthly points of one unit and of the national total, aligned by month, for the index chart. */
export function indexSeries(
  unit: { label: string; series?: RadarSeries | null | undefined },
  national: { unit: string; values: readonly number[]; start: string } | undefined,
) {
  const months = (start: string, count: number) => {
    const [y, m] = start.split("-").map(Number) as [number, number];
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      return d.toISOString().slice(0, 7);
    });
  };
  const s = unit.series;
  if (!s || s.values.length < 2) return [];
  const own = months(s.start, s.values.length);
  const out = [
    {
      id: "unit",
      label: unit.label,
      points: own.map((date, i) => ({ date, value: s.values[i] ?? null })),
    },
  ];
  if (national && national.values.length) {
    const nm = months(national.start, national.values.length);
    const byMonth = new Map(nm.map((d, i) => [d, national.values[i] ?? null]));
    out.push({
      id: "national",
      label: national.unit.includes("NHTSA") ? "All vehicles (NHTSA)" : "All products (FAERS)",
      points: own.map((date) => ({ date, value: byMonth.get(date) ?? null })),
    });
  }
  return out;
}

/** "1.53" / "Not rated". */
export const fmtRatio = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "Not rated" : v.toFixed(2);
export const fmtCount = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "Not recorded" : Math.round(v).toLocaleString("en-US");

/** The units' unit of count, by kind. */
export const countUnit = (kind: RadarKind) =>
  kind === "vehicle" ? "complaints" : kind === "drug" ? "reports" : "events";

export const RADAR_SOURCES = [
  { label: "FDA FAERS via openFDA", url: "https://open.fda.gov/apis/drug/event/" },
  {
    label: "NHTSA ODI complaints, investigations and recalls",
    url: "https://www.nhtsa.gov/nhtsa-datasets-and-apis",
  },
  { label: "JPML hearing sessions and orders", url: "https://www.jpml.uscourts.gov/" },
] as const;

/** AI context for the emerging list: only the KPIs and the top rows the page shows. */
export function overviewContext(
  kpis: RadarKpis,
  top: readonly RadarRow[],
  summary: RadarSummary | null,
): SectionContext {
  const figures: FigureInput[] = [
    {
      label: `Candidates with points in 3 or more families, no open MDL linked (${kindBreakdown(kpis.threePlusByKind)})`,
      value: kpis.threePlusFamilies,
      unit: "units",
    },
    {
      label: "Pending products-liability motions with no MDL",
      value: kpis.pendingMotions,
      unit: "motions",
    },
    {
      label: "Centralizations denied in the last 36 months",
      value: kpis.denied36,
      unit: "motions",
    },
    {
      label: `Units rising (95% lower bound above 1.5), no open MDL linked (${kindBreakdown(kpis.risingByKind)})`,
      value: kpis.risingNoMdl,
      unit: "units",
    },
    {
      label: `Distinct open NHTSA investigations scoring on these vehicle units (on ${kpis.investigatedUnits} units)`,
      value: kpis.openInvestigations,
      unit: "investigations",
    },
    {
      label: "Ranked units linked only to closed MDLs (marked 'Earlier MDL closed')",
      value: kpis.closedMdlRanked,
      unit: "units",
    },
    ...top.slice(0, 6).flatMap((r) => {
      const a = reportsOf(r);
      const closed = closedMdlNote(r);
      return [
        {
          label: `${r.label}${closed ? ` (${closed})` : ""}: points (of families ${r.families.join("") || "none"})`,
          value: r.points,
        },
        ...(a?.ratio != null
          ? [{ label: `${r.label}: rate ratio vs expected`, value: a.ratio, decimals: 2 }]
          : []),
      ];
    }),
  ];
  return buildSectionContext({
    title: "Emerging torts: rising safety reports with no open MDL linked",
    period: summary
      ? `FAERS ${summary.windows["faers"] ?? ""}; NHTSA ${summary.windows["nhtsa"] ?? ""}`
      : null,
    source: "FDA FAERS, NHTSA, JPML and SEC records in the corpus",
    figures,
    maxFigures: 20,
  });
}

/** AI context for one candidate: its components and flags only. */
export function candidateContext(u: RadarUnit): SectionContext {
  const figures: FigureInput[] = [
    { label: "Total points", value: u.points },
    { label: "Families with points", value: u.families_present },
    ...u.components.flatMap((c) => {
      const out: FigureInput[] = [
        { label: `${FAMILY_LABEL[c.family]}: ${c.metric}, points`, value: c.points },
      ];
      if (c.observed != null) out.push({ label: `${c.metric}, observed`, value: c.observed });
      if (c.expected != null)
        out.push({ label: `${c.metric}, expected`, value: c.expected, decimals: 1 });
      if (c.ratio != null)
        out.push({ label: `${c.metric}, rate ratio`, value: c.ratio, decimals: 2 });
      if (c.ci_low != null)
        out.push({
          label: `${c.metric}, 95% lower bound of the ratio`,
          value: c.ci_low,
          decimals: 2,
        });
      return out;
    }),
    ...u.flags.map((f) => ({ label: `Flag: ${f.label}`, value: "yes" })),
    { label: "MDL status", value: STATUS_LABEL[u.mdl_status.status] },
  ];
  return buildSectionContext({
    title: `${u.label}: radar score`,
    period: u.window["recent"]
      ? `${u.window["recent"]} vs ${u.window["baseline"] ?? "prior period"}`
      : null,
    source: u.components.find((c) => c.source)?.source ?? "Corpus records",
    figures,
    maxFigures: 24,
  });
}

/** Swimlane inputs for the "path to the Panel" chart. */
export function laneInputs(lanes: readonly RadarLane[], asOf: string, monthsBack = 36) {
  const from = monthsBefore(asOf, monthsBack);
  const keep = lanes.filter(
    (l) =>
      l.status !== "centralized" ||
      l.events.some((e) => e.kind === "recall") ||
      l.session >= monthsBefore(asOf, 3),
  );
  const shown = keep.filter((l) => l.events.some((e) => e.date >= from));
  const last =
    shown
      .flatMap((l) => l.events.map((e) => e.date))
      .sort()
      .at(-1) ?? asOf;
  const end = last > asOf ? last : asOf;
  return {
    groups: [
      { id: "pending", label: "Motion pending", slot: 0 },
      { id: "denied", label: "Centralization denied", slot: 3 },
      { id: "centralized", label: "Centralized", slot: 2 },
    ],
    lanes: shown
      .sort((a, b) => a.status.localeCompare(b.status) || b.session.localeCompare(a.session))
      .map((l) => ({
        id: `mdl-${l.mdl}`,
        group: l.status,
        label: `MDL ${l.mdl} · ${l.title.replace(/^IN RE:?\s*/i, "")}`,
        events: l.events.map((e, i) => ({
          id: `${l.mdl}-${i}`,
          date: e.date,
          label: e.label,
          href: e.url ?? null,
        })),
      })),
    domain: [from, end] as const,
  };
}
