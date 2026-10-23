/**
 * Bill-to-law flow model (pure, isomorphic). Parses `lawviz_bill_flow_v1` (database/contracts/lawviz-v1.sql): counts of
 * congress_bills by Congress, type, policy area and the milestones the builder derived only from published action
 * codes and text (introduced, reported, passed House/Senate, became law; vitiated passages excluded). Builds the
 * stage funnel for the current filters: every bill flows left to right through five columns and stops at the last
 * stage its record shows. Nothing is inferred: a bill whose introduction is not recorded is its own node, and the few
 * bills recorded as law with only one chamber's passage recorded flow from "One chamber only" to "Became law".
 */

export type BillRow = {
  congress: number;
  type: string;
  policy: string;
  introduced: boolean;
  reported: boolean;
  chambers: 0 | 1 | 2;
  law: boolean;
  n: number;
  withLawNumber: number;
};
export type BillFlowData =
  | {
      status: "ok";
      rows: BillRow[];
      policies: string[];
      publicLaws: Record<number, number>;
      builtAt: string | null;
      dropped: number;
    }
  | { status: "unavailable" | "empty"; builtAt: string | null };

export const LAW_TYPES = ["hr", "s", "hjres", "sjres"] as const;
export const RESOLUTION_TYPES = ["hres", "sres", "hconres", "sconres"] as const;
const TYPES = new Set<string>([...LAW_TYPES, ...RESOLUTION_TYPES]);
export const FIRST_CONGRESS = 108;
export const LAST_CONGRESS = 119;

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const nat = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function parseBillFlow(raw: unknown, builtAt: string | null = null): BillFlowData {
  const r = obj(raw);
  if (!r) return { status: "unavailable", builtAt };
  if (r["status"] === "empty") return { status: "empty", builtAt };
  if (r["status"] !== "ok" || !Array.isArray(r["rows"])) return { status: "unavailable", builtAt };
  const rows: BillRow[] = [];
  let dropped = 0;
  for (const x of r["rows"] as unknown[]) {
    if (!Array.isArray(x)) {
      dropped++;
      continue;
    }
    const [congress, type, policy, intro, rep, ch, law, n, wl] = x as unknown[];
    const c = nat(congress);
    const cnt = nat(n);
    const chambers = nat(ch);
    if (
      c === null ||
      c < FIRST_CONGRESS ||
      c > LAST_CONGRESS ||
      typeof type !== "string" ||
      !TYPES.has(type) ||
      typeof policy !== "string" ||
      typeof intro !== "boolean" ||
      typeof rep !== "boolean" ||
      typeof law !== "boolean" ||
      chambers === null ||
      chambers > 2 ||
      !cnt
    ) {
      dropped++;
      continue;
    }
    rows.push({
      congress: c,
      type,
      policy: policy.trim(),
      introduced: intro,
      reported: rep,
      chambers: chambers as 0 | 1 | 2,
      law,
      n: cnt,
      withLawNumber: Math.min(cnt, nat(wl) ?? 0),
    });
  }
  const publicLaws: Record<number, number> = {};
  for (const [k, v] of Object.entries(obj(r["public_laws"]) ?? {})) {
    const c = Number(k);
    const n = nat(v);
    if (Number.isInteger(c) && c >= FIRST_CONGRESS && c <= LAST_CONGRESS && n !== null)
      publicLaws[c] = n;
  }
  const policies = [...new Set(rows.map((x) => x.policy))].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
  );
  return { status: "ok", rows, policies, publicLaws, builtAt, dropped };
}

export type BillFilter = { congress: number | "all"; policy: string | "all" };
export const matches = (row: BillRow, f: BillFilter, types: readonly string[] = LAW_TYPES) =>
  types.includes(row.type) &&
  (f.congress === "all" || row.congress === f.congress) &&
  (f.policy === "all" || row.policy === f.policy);

// ------------------------------------------------------------------------------------------------ stages
export type StageId =
  | "intro"
  | "intro_nr"
  | "reported"
  | "not_reported"
  | "passed"
  | "no_passage"
  | "both"
  | "one_only"
  | "law"
  | "not_law";

export type StageNode = {
  id: StageId;
  column: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Reached the stage (blue) or not recorded as reaching it (grey). */
  reached: boolean;
  /** No later column receives flow from it. */
  terminal: boolean;
  value: number;
};
export type StageLink = { source: StageId; target: StageId; value: number };

const NODE_DEFS: Omit<StageNode, "value">[] = [
  { id: "intro", column: 0, label: "Introduced", reached: true, terminal: false },
  {
    id: "intro_nr",
    column: 0,
    label: "Introduction not recorded",
    reached: false,
    terminal: false,
  },
  { id: "reported", column: 1, label: "Reported by committee", reached: true, terminal: false },
  {
    id: "not_reported",
    column: 1,
    label: "No report recorded",
    reached: false,
    terminal: false,
  },
  { id: "passed", column: 2, label: "Passed a chamber", reached: true, terminal: false },
  {
    id: "no_passage",
    column: 2,
    label: "No passage recorded",
    reached: false,
    terminal: true,
  },
  { id: "both", column: 3, label: "Passed both chambers", reached: true, terminal: false },
  { id: "one_only", column: 3, label: "One chamber only", reached: false, terminal: false },
  { id: "law", column: 4, label: "Became law", reached: true, terminal: true },
  { id: "not_law", column: 4, label: "Not enacted", reached: false, terminal: true },
];
export const STAGE_LABEL: Record<StageId, string> = Object.fromEntries(
  NODE_DEFS.map((d) => [d.id, d.label]),
) as Record<StageId, string>;

/** The path of one row through the five columns. */
export function stagePath(r: BillRow): StageId[] {
  const out: StageId[] = [
    r.introduced ? "intro" : "intro_nr",
    r.reported ? "reported" : "not_reported",
  ];
  if (r.chambers === 0) {
    out.push("no_passage");
    // A law with no chamber passage recorded cannot be drawn without inventing a stage; it stays at this node and is
    // reported apart (`lawWithoutPassage`).
    return out;
  }
  out.push("passed", r.chambers === 2 ? "both" : "one_only");
  if (r.chambers === 2) out.push(r.law ? "law" : "not_law");
  else if (r.law) out.push("law");
  return out;
}

export type StageFlow = {
  nodes: StageNode[];
  links: StageLink[];
  total: number;
  lawWithoutPassage: number;
  withLawNumber: number;
};

export function stageFlow(rows: readonly BillRow[]): StageFlow {
  const value = new Map<StageId, number>();
  const link = new Map<string, number>();
  let total = 0;
  let lawWithoutPassage = 0;
  let withLawNumber = 0;
  for (const r of rows) {
    total += r.n;
    if (r.law) withLawNumber += r.withLawNumber;
    if (r.law && r.chambers === 0) lawWithoutPassage += r.n;
    const path = stagePath(r);
    for (const s of path) value.set(s, (value.get(s) ?? 0) + r.n);
    for (let i = 1; i < path.length; i++) {
      const k = `${path[i - 1]}>${path[i]}`;
      link.set(k, (link.get(k) ?? 0) + r.n);
    }
  }
  const nodes = NODE_DEFS.map((d) => ({ ...d, value: value.get(d.id) ?? 0 })).filter(
    (n) => n.value > 0,
  );
  const terminalOf = new Set(nodes.map((n) => n.id));
  for (const k of link.keys()) terminalOf.delete(k.split(">")[0] as StageId);
  const links = [...link.entries()]
    .map(([k, v]) => {
      const [source, target] = k.split(">") as [StageId, StageId];
      return { source, target, value: v };
    })
    .sort(
      (a, b) =>
        NODE_DEFS.findIndex((d) => d.id === a.source) -
          NODE_DEFS.findIndex((d) => d.id === b.source) ||
        NODE_DEFS.findIndex((d) => d.id === a.target) -
          NODE_DEFS.findIndex((d) => d.id === b.target),
    );
  return {
    nodes: nodes.map((n) => ({ ...n, terminal: terminalOf.has(n.id) })),
    links,
    total,
    lawWithoutPassage,
    withLawNumber,
  };
}

// ------------------------------------------------------------------------------------------------ layout
export type LaidNode = StageNode & { x0: number; x1: number; y0: number; y1: number };
export type LaidLink = StageLink & {
  width: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

/**
 * Fixed-order layout: five columns, the "reached" node on top of each column, heights proportional to bills, ribbons
 * stacked in node order at both ends (no crossing within a column pair). Pure and deterministic.
 */
export function layoutFlow(
  flow: StageFlow,
  o: { width: number; height: number; nodeWidth?: number; gap?: number },
): { nodes: LaidNode[]; links: LaidLink[]; scale: number } {
  const nw = o.nodeWidth ?? 10;
  const gap = o.gap ?? 14;
  const cols = [0, 1, 2, 3, 4].map((c) => flow.nodes.filter((n) => n.column === c));
  const scale = Math.min(
    ...cols
      .filter((c) => c.length)
      .map((c) => {
        const sum = c.reduce((a, n) => a + n.value, 0);
        return sum > 0 ? Math.max(0, o.height - gap * (c.length - 1)) / sum : Infinity;
      }),
  );
  const k = Number.isFinite(scale) ? scale : 0;
  const x = (c: number) => (c / 4) * (o.width - nw);
  const nodes: LaidNode[] = [];
  for (const col of cols) {
    let y = 0;
    for (const n of col) {
      const h = n.value * k;
      nodes.push({ ...n, x0: x(n.column), x1: x(n.column) + nw, y0: y, y1: y + h });
      y += h + gap;
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const out = new Map<StageId, number>();
  const inn = new Map<StageId, number>();
  const order = (id: StageId) => NODE_DEFS.findIndex((d) => d.id === id);
  const links: LaidLink[] = [];
  for (const l of [...flow.links].sort(
    (a, b) => order(a.source) - order(b.source) || order(a.target) - order(b.target),
  )) {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (!s || !t) continue;
    const w = l.value * k;
    const so = out.get(l.source) ?? s.y0;
    out.set(l.source, so + w);
    links.push({ ...l, width: w, x0: s.x1, x1: t.x0, y0: so + w / 2, y1: 0 });
  }
  // target ends: stack incoming ribbons in source order
  for (const l of [...links].sort(
    (a, b) => order(a.target) - order(b.target) || order(a.source) - order(b.source),
  )) {
    const t = byId.get(l.target)!;
    const ti = inn.get(l.target) ?? t.y0;
    inn.set(l.target, ti + l.width);
    l.y1 = ti + l.width / 2;
  }
  return { nodes, links, scale: k };
}

/** Counts per Congress for the data table: each stage reached, and the public laws in the Statutes at Large table. */
export function congressTable(
  rows: readonly BillRow[],
  publicLaws: Record<number, number>,
  policy: string | "all",
): {
  congress: number;
  introduced: number;
  reported: number;
  passed: number;
  both: number;
  law: number;
  total: number;
  publicLaws: number | null;
}[] {
  const out = new Map<number, ReturnType<typeof congressTable>[number]>();
  for (let c = FIRST_CONGRESS; c <= LAST_CONGRESS; c++)
    out.set(c, {
      congress: c,
      introduced: 0,
      reported: 0,
      passed: 0,
      both: 0,
      law: 0,
      total: 0,
      publicLaws: policy === "all" ? (publicLaws[c] ?? null) : null,
    });
  for (const r of rows) {
    if (!(LAW_TYPES as readonly string[]).includes(r.type)) continue;
    if (policy !== "all" && r.policy !== policy) continue;
    const t = out.get(r.congress)!;
    t.total += r.n;
    if (r.introduced) t.introduced += r.n;
    if (r.reported) t.reported += r.n;
    if (r.chambers >= 1) t.passed += r.n;
    if (r.chambers === 2) t.both += r.n;
    if (r.law) t.law += r.n;
  }
  return [...out.values()];
}

export const ordinal = (n: number) => {
  const s =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${s}`;
};

/** Years a Congress sat (the 108th began in 2003). */
export const congressYears = (c: number) => `${1789 + 2 * (c - 1)}–${1789 + 2 * (c - 1) + 2}`;
