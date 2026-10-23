/**
 * Court hierarchy explorer: one level of the tree at a time (Supreme Court → circuits → district courts → judges, and
 * the state court systems held), each node with its latest complete insights facts. Pure and client-safe; the server
 * reads `litviz_court_children_v1` or, before it is applied, the insights RPCs (see litviz.server.ts).
 */

export type CourtLevelType = "root" | "court" | "circuit" | "judges" | "states" | "state";
export type CourtNodeType =
  "court" | "circuit" | "judges" | "judge" | "states" | "state" | "other_courts";

export type CourtFact = { value: number; period: string; level: string };

export type CourtNode = {
  type: CourtNodeType;
  id: string;
  label: string;
  href: string | null;
  courtType: string | null;
  /** Number of children the next level lists; 0 for a leaf. */
  children: number;
  metrics: Record<string, CourtFact>;
  judge: { pendingMdls: number; actionsPending: number | null; asOf: string | null } | null;
};

export type MetricInfo = {
  label: string;
  unit: string;
  format: string;
  periodType: string;
  sources: { label: string; url: string }[];
};

export type CourtLevel = {
  type: CourtLevelType;
  id: string | null;
  nodes: CourtNode[];
  catalog: Record<string, MetricInfo>;
};

/** The bar metrics a reader can pick, in menu order. `judge_pending_mdls` is computed from the `mdls` records. */
export const COURT_METRICS = [
  { id: "usc_civil_pending", short: "Civil cases pending" },
  { id: "usc_civil_median_months", short: "Median months to civil disposition" },
  { id: "mdl_court_pending_mdls", short: "Pending MDLs" },
  { id: "mdl_court_actions_pending", short: "Actions pending in its MDLs" },
  { id: "usc_weighted_filings_per_judgeship", short: "Weighted filings per judgeship" },
  { id: "fjc_sitting_judges", short: "Sitting Article III judges" },
  { id: "caselaw_opinion_clusters", short: "Opinions filed (latest year)" },
  { id: "usc_appeals_pending", short: "Appeals pending" },
  { id: "usc_appeals_filed", short: "Appeals filed" },
] as const;
export type CourtMetricId = (typeof COURT_METRICS)[number]["id"];
export const COURT_METRIC_IDS: string[] = COURT_METRICS.map((m) => m.id);

const TYPES = new Set<CourtNodeType>([
  "court",
  "circuit",
  "judges",
  "judge",
  "states",
  "state",
  "other_courts",
]);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const safeHref = (v: unknown): string | null => {
  const s = text(v);
  return s && s.startsWith("/") && !s.startsWith("//") ? s : null;
};

export function parseCourtLevel(raw: unknown): CourtLevel | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o["nodes"])) return null;
  const type = text(o["type"]) as CourtLevelType | null;
  const nodes = (o["nodes"] as unknown[]).flatMap((n): CourtNode[] => {
    const x = obj(n);
    const t = text(x?.["type"]) as CourtNodeType | null;
    const id = text(x?.["id"]);
    const label = text(x?.["label"]);
    if (!x || !t || !TYPES.has(t) || !id || !label) return [];
    const metrics: Record<string, CourtFact> = {};
    for (const [k, v] of Object.entries(obj(x["metrics"]) ?? {})) {
      if (!Array.isArray(v)) continue;
      const value = num(v[0]);
      const period = text(v[1]);
      if (value !== null && period) metrics[k] = { value, period, level: text(v[2]) ?? "court" };
    }
    const j = obj(x["judge"]);
    const pending = num(j?.["pending_mdls"]);
    return [
      {
        type: t,
        id,
        label,
        href: safeHref(x["href"]),
        courtType: text(x["court_type"]),
        children: Math.max(0, Math.floor(num(x["children"]) ?? 0)),
        metrics,
        judge:
          j && pending !== null
            ? {
                pendingMdls: pending,
                actionsPending: num(j["actions_pending"]),
                asOf: text(j["as_of"]),
              }
            : null,
      },
    ];
  });
  const catalog: Record<string, MetricInfo> = {};
  for (const [k, v] of Object.entries(obj(o["catalog"]) ?? {})) {
    const c = obj(v);
    if (!c) continue;
    const links = Array.isArray(c["source_links"]) ? (c["source_links"] as unknown[]) : [];
    catalog[k] = {
      label: text(c["label"]) ?? k,
      unit: text(c["unit"]) ?? "",
      format: text(c["format"]) ?? "count",
      periodType: text(c["period_type"]) ?? "",
      sources: links.flatMap((l) => {
        const x = obj(l);
        const url = text(x?.["url"]);
        return url && /^https?:\/\//.test(url) ? [{ label: text(x?.["label"]) ?? url, url }] : [];
      }),
    };
  }
  return { type: type ?? "root", id: text(o["id"]), nodes, catalog };
}

/** The level that lists a node's children, or null for a leaf. */
export function childLevel(
  n: Pick<CourtNode, "type" | "id" | "children">,
): { type: CourtLevelType; id: string | null } | null {
  if (n.children <= 0) return null;
  switch (n.type) {
    case "court":
      return { type: "court", id: n.id };
    case "circuit":
      return { type: "circuit", id: n.id };
    case "judges":
      return { type: "judges", id: n.id };
    case "states":
      return { type: "states", id: null };
    case "state":
      return { type: "state", id: n.id };
    default:
      return null;
  }
}

/** A stable tree id for a node (types can share ids: circuit "ca2" and court "ca2"). */
export const nodeKey = (n: Pick<CourtNode, "type" | "id">) => `${n.type}:${n.id}`;

/**
 * Value a node shows for the chosen metric, and whether it is from the period its siblings mostly have. Siblings are
 * compared on their latest complete period; a value from an older period is flagged, never silently mixed.
 */
export function metricFor(
  nodes: readonly CourtNode[],
  metric: string,
): Map<string, { value: number | null; period: string | null; stale: boolean }> {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const p = n.metrics[metric]?.period;
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const latest = [...counts.keys()].sort().pop() ?? null;
  const out = new Map<string, { value: number | null; period: string | null; stale: boolean }>();
  for (const n of nodes) {
    const f = n.metrics[metric];
    out.set(nodeKey(n), {
      value: f?.value ?? null,
      period: f?.period ?? null,
      stale: !!f && latest !== null && f.period !== latest,
    });
  }
  return out;
}

/** Text a judge node shows: MDLs it presides over in the latest JPML report (exact profile match only). */
export function judgeNote(n: CourtNode): string | null {
  if (n.type !== "judge") return null;
  if (!n.judge) return null;
  const mdls = `${n.judge.pendingMdls} pending MDL${n.judge.pendingMdls === 1 ? "" : "s"}`;
  return n.judge.actionsPending !== null
    ? `${mdls}, ${n.judge.actionsPending.toLocaleString("en-US")} actions pending`
    : mdls;
}
