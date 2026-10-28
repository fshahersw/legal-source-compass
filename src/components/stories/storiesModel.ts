/**
 * Visual stories model: the JPML pending-docket frames (one per captured "Pending MDL Dockets" report) and the
 * defendant network (SEC filings that link a company to an MDL as a defendant). Parsing drops malformed rows;
 * interpolation is for drawing motion between two reports only, and every printed figure is a report's own count.
 */
import { z } from "zod";

export type DocketMdl = {
  mdl: number;
  title: string;
  type: string | null;
  district: string | null;
  peak: number;
  /** Pending actions in each report; null when the MDL is not listed in that report. */
  values: (number | null)[];
  category: Category;
};
export type Docket = {
  dates: string[];
  totals: number[];
  listed: number[];
  mdls: DocketMdl[];
  dropped: number;
};

export const CATEGORIES = [
  "products",
  "antitrust",
  "privacy",
  "consumer",
  "securities",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  products: "Products liability",
  antitrust: "Antitrust",
  privacy: "Data breach and privacy",
  consumer: "Sales practices and consumer",
  securities: "Securities",
  other: "Other or not recorded",
};

/**
 * The litigation type the JPML records where the pending-history rows carry one; otherwise the words of the MDL's
 * own title ("Products Liability", "Antitrust", "Data Security Breach", "Sales Practices", "Securities").
 */
export function categorize(type: string | null, title: string): Category {
  const t = `${type ?? ""} ${title}`.toLowerCase();
  if (/products? liability/.test(t)) return "products";
  if (/antitrust/.test(t)) return "antitrust";
  if (/data (security )?breach|privacy|customer data/.test(t)) return "privacy";
  if (/sales practices|marketing|consumer/.test(t)) return "consumer";
  if (/securities/.test(t)) return "securities";
  return "other";
}

/** Short display name of an MDL from its JPML title: "IN RE: 3M Combat Arms Earplug Products Liability Litigation"
 * → "3M Combat Arms Earplug"; the panel's abbreviated captions ("Neurontin Marketing, SP & PL") → "Neurontin". */
export function shortTitle(title: string): string {
  const s = title
    .replace(/^\s*in re:?\s*/i, "")
    .replace(
      /\s*,?\s*(marketing,?\s*)?((sales practices|sp),?\s*)?(&\s*|and\s*)?(products? liability|\bpl\b|antitrust|securities|data security breach|consumer privacy|privacy|litigation)[\s\S]*$/i,
      "",
    )
    .replace(/["“”]/g, "")
    .replace(/[,\s]+$/, "")
    .trim();
  return s || title.trim();
}

const docketSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  totals: z.array(z.number()),
  listed: z.array(z.number()),
  mdls: z.array(z.unknown()),
});
const mdlSchema = z.object({
  mdl: z.number().int(),
  title: z.string().nullable(),
  type: z.string().nullable(),
  district: z.string().nullable(),
  peak: z.number(),
  values: z.array(z.number().nullable()),
});

export function parseDocket(raw: unknown): Docket {
  const d = docketSchema.parse(raw);
  const n = d.dates.length;
  if (d.totals.length !== n || d.listed.length !== n) throw new Error("Docket frames do not align");
  const mdls: DocketMdl[] = [];
  let dropped = 0;
  for (const r of d.mdls) {
    const m = mdlSchema.safeParse(r);
    if (!m.success || m.data.values.length !== n) {
      dropped++;
      continue;
    }
    const title = m.data.title ?? `MDL ${m.data.mdl}`;
    mdls.push({ ...m.data, title, category: categorize(m.data.type, title) });
  }
  return { dates: d.dates, totals: d.totals, listed: d.listed, mdls, dropped };
}

/** Value at fractional frame t: linear between the two reports for motion; an unlisted report counts as 0. */
export function valueAt(values: readonly (number | null)[], t: number): number {
  const i = Math.max(0, Math.min(values.length - 1, Math.floor(t)));
  const j = Math.min(values.length - 1, i + 1);
  const a = values[i] ?? 0;
  const b = values[j] ?? 0;
  const f = Math.max(0, Math.min(1, t - i));
  return a + (b - a) * f;
}

/** Ranked MDLs at frame t (only those with a positive value), largest first. */
export function rankAt(mdls: readonly DocketMdl[], t: number, top: number) {
  return mdls
    .map((m) => ({ m, v: valueAt(m.values, t) }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v || a.m.mdl - b.m.mdl)
    .slice(0, top);
}

/** The leader of each report and the frames where the leader changes (for the race's captions). */
export function leaders(d: Docket): { frame: number; mdl: number }[] {
  const out: { frame: number; mdl: number }[] = [];
  d.dates.forEach((_, i) => {
    const lead = rankAt(d.mdls, i, 1)[0];
    if (lead && out.at(-1)?.mdl !== lead.m.mdl) out.push({ frame: i, mdl: lead.m.mdl });
  });
  return out;
}

/** Stream layers: the `top` MDLs by peak, then every other MDL folded into "All other MDLs" (the report total minus
 * the named layers, so the stack always sums to the report's total). */
export function streamLayers(d: Docket, top = 12) {
  const named = [...d.mdls].sort((a, b) => b.peak - a.peak).slice(0, top);
  const rows = d.dates.map((date, i) => {
    const row: Record<string, number> & { date: number } = {
      date: Date.parse(`${date}T00:00:00Z`),
    } as never;
    let sum = 0;
    for (const m of named) {
      const v = m.values[i] ?? 0;
      row[`m${m.mdl}`] = v;
      sum += v;
    }
    row["other"] = Math.max(0, (d.totals[i] ?? 0) - sum);
    return row;
  });
  return { named, keys: [...named.map((m) => `m${m.mdl}`), "other"], rows };
}

// ---------------------------------------------------------------------------------------------------------- network

export type NetLink = {
  cik: string;
  company: string;
  mdl: number;
  tier: string;
  tierLabel: string;
  verified: number | null;
  first: string | null;
  last: string | null;
};
export type NetMdl = {
  mdl: number;
  title: string;
  status: string | null;
  type: string | null;
  pending: number | null;
  district: string | null;
};
export type NetProduct = { id: string; label: string; kind: string; mdl: number };
export type Network = { links: NetLink[]; mdls: NetMdl[]; products: NetProduct[] };

const netSchema = z.object({
  links: z.array(
    z.object({
      cik: z.string().regex(/^\d{10}$/),
      company: z.string().nullable(),
      mdl: z.number().int(),
      tier: z.string().nullable(),
      tierLabel: z.string().nullable(),
      verified: z.number().nullable(),
      first: z.string().nullable(),
      last: z.string().nullable(),
    }),
  ),
  mdls: z.array(
    z.object({
      mdl: z.number().int(),
      title: z.string().nullable(),
      status: z.string().nullable(),
      type: z.string().nullable(),
      pending: z.number().nullable(),
      district: z.string().nullable(),
    }),
  ),
  products: z.array(
    z.object({ id: z.string(), label: z.string(), kind: z.string(), mdl: z.number().int() }),
  ),
});

export function parseNetwork(raw: unknown): Network {
  const n = netSchema.parse(raw);
  return {
    links: n.links.map((l) => ({
      ...l,
      company: l.company ?? `CIK ${l.cik}`,
      tier: l.tier ?? "?",
      tierLabel: l.tierLabel ?? "Not recorded",
    })),
    mdls: n.mdls.map((m) => ({ ...m, title: m.title ?? `MDL ${m.mdl}` })),
    products: n.products,
  };
}

export type GraphNode = {
  id: string;
  kind: "mdl" | "company" | "product";
  label: string;
  /** Degree in the graph. */
  degree: number;
  mdl?: number | undefined;
  cik?: string | undefined;
  pending?: number | null | undefined;
  status?: string | null | undefined;
  productId?: string | undefined;
};
export type GraphEdge = {
  source: string;
  target: string;
  tier: string;
  kind: "defendant" | "product";
};

/** Nodes and edges: company ↔ MDL (one edge per recorded link, its tier kept) and MDL ↔ product group. */
export function buildGraph(n: Network, opts: { products?: boolean } = {}) {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const mdlInfo = new Map(n.mdls.map((m) => [m.mdl, m] as const));
  const add = (node: GraphNode) => {
    const prior = nodes.get(node.id);
    if (prior) prior.degree++;
    else nodes.set(node.id, { ...node, degree: 1 });
  };
  for (const l of n.links) {
    const m = mdlInfo.get(l.mdl);
    add({ id: `c:${l.cik}`, kind: "company", label: l.company, degree: 0, cik: l.cik });
    add({
      id: `m:${l.mdl}`,
      kind: "mdl",
      label: shortTitle(m?.title ?? `MDL ${l.mdl}`),
      degree: 0,
      mdl: l.mdl,
      pending: m?.pending ?? null,
      status: m?.status ?? null,
    });
    edges.push({ source: `c:${l.cik}`, target: `m:${l.mdl}`, tier: l.tier, kind: "defendant" });
  }
  if (opts.products !== false)
    for (const p of n.products) {
      if (!nodes.has(`m:${p.mdl}`)) continue;
      add({
        id: `p:${p.id}`,
        kind: "product",
        label: p.label,
        degree: 0,
        productId: p.id,
        mdl: p.mdl,
      });
      nodes.get(`m:${p.mdl}`)!.degree++;
      edges.push({ source: `p:${p.id}`, target: `m:${p.mdl}`, tier: "product", kind: "product" });
    }
  return { nodes: [...nodes.values()], edges };
}
