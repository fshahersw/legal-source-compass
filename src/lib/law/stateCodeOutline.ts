/**
 * State-code outline releases (schema `state-code-outline-release/1`): private, hash-verified snapshot files at
 * `state-codes/<usps>/outline-v1/root.json` plus shards, built by
 * scripts/legal/state-codes/outline/build_outline_release.py from the public projection's own records.
 *
 * They exist because the public outline read identifies a level only by (level, number, node_id): where a publisher
 * prints no number (Texas, Ohio, Minnesota parts, Nevada headings) every sibling opened as one merged list, and Texas
 * had no code level. A release keeps each level's recorded heading as part of its identity. Pure functions only:
 * reading and hash checks happen in stateCodeCatalog.server.ts; nothing here invents a level, number or heading.
 */
import { cleanHeading } from "./stateCodeHeading";
import type { HierarchyStep, ProjectedOutline } from "./stateCodeContract";

export const OUTLINE_SCHEMA = "state-code-outline-release/1";

export type ReleaseSection = [string, string | null, string | null, string | null];
export type ReleaseNode = {
  id: string;
  l: string;
  n: string | null;
  h: string | null;
  nid?: string;
  hv?: string[];
  c: number;
  k?: ReleaseNode[];
  s?: ReleaseSection[];
};
export type ReleaseTop = Omit<ReleaseNode, "k" | "s"> & { shard: string };
export type OutlineRoot = {
  jurisdiction: string;
  sourceSystem: string;
  projectionSections: number;
  restorations: string[];
  top: ReleaseTop[];
  direct: ReleaseSection[];
  shards: Record<string, { sha256: string; bytes: number }>;
};

const ID = /^[a-f0-9]{16}$/;
const LEVEL = /^[a-z][a-z_]{1,40}$/;

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function section(value: unknown): ReleaseSection | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [id, citation, heading, status] = value as unknown[];
  if (typeof id !== "string" || !id || id.length > 512) return null;
  const opt = (v: unknown) => (v === null ? null : text(v, 200_000));
  if ((citation !== null && opt(citation) === null) || (heading !== null && opt(heading) === null))
    return null;
  if (status !== null && opt(status) === null) return null;
  return [id, opt(citation), opt(heading), opt(status)];
}

function nodeHead(value: unknown): Omit<ReleaseNode, "k" | "s"> | null {
  const row = obj(value);
  if (!row) return null;
  const id = row["id"];
  const level = row["l"];
  const count = row["c"];
  if (typeof id !== "string" || !ID.test(id)) return null;
  if (typeof level !== "string" || !LEVEL.test(level)) return null;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
  const n = row["n"] === null ? null : text(row["n"], 300);
  const h = row["h"] === null ? null : text(row["h"], 5000);
  if ((row["n"] !== null && n === null) || (row["h"] !== null && h === null)) return null;
  const out: Omit<ReleaseNode, "k" | "s"> = { id, l: level, n, h, c: count };
  if (row["nid"] !== undefined) {
    const nid = text(row["nid"], 256);
    if (!nid) return null;
    out.nid = nid;
  }
  if (row["hv"] !== undefined) {
    if (!Array.isArray(row["hv"]) || row["hv"].some((v) => typeof v !== "string")) return null;
    out.hv = row["hv"] as string[];
  }
  return out;
}

function node(value: unknown, depth: number): ReleaseNode | null {
  if (depth > 14) return null;
  const head = nodeHead(value);
  const row = obj(value);
  if (!head || !row) return null;
  const out: ReleaseNode = { ...head };
  if (row["k"] !== undefined) {
    if (!Array.isArray(row["k"])) return null;
    const kids: ReleaseNode[] = [];
    for (const child of row["k"]) {
      const parsed = node(child, depth + 1);
      if (!parsed) return null;
      kids.push(parsed);
    }
    out.k = kids;
  }
  if (row["s"] !== undefined) {
    if (!Array.isArray(row["s"])) return null;
    const rows: ReleaseSection[] = [];
    for (const item of row["s"]) {
      const parsed = section(item);
      if (!parsed) return null;
      rows.push(parsed);
    }
    out.s = rows;
  }
  return out;
}

/** The release root for one state, or null when it is not a well-formed release for that state. */
export function parseOutlineRoot(data: unknown, state: string): OutlineRoot | null {
  const row = obj(data);
  if (!row || row["schema_version"] !== OUTLINE_SCHEMA || row["jurisdiction"] !== state)
    return null;
  const st = state.toLowerCase();
  const sourceSystem = text(row["source_system"], 80);
  const sections = row["projection_sections"];
  if (!sourceSystem || typeof sections !== "number" || !Number.isSafeInteger(sections)) return null;
  const shards: OutlineRoot["shards"] = {};
  const rawShards = obj(row["shards"]);
  if (!rawShards) return null;
  for (const [name, entry] of Object.entries(rawShards)) {
    const e = obj(entry);
    if (
      !new RegExp(`^state-codes/${st}/outline-v1/s\\d{1,4}\\.json$`).test(name) ||
      !e ||
      typeof e["sha256"] !== "string" ||
      !/^[a-f0-9]{64}$/.test(e["sha256"]) ||
      typeof e["bytes"] !== "number"
    )
      return null;
    shards[name] = { sha256: e["sha256"], bytes: e["bytes"] };
  }
  if (!Array.isArray(row["top"]) || !Array.isArray(row["direct"])) return null;
  const top: ReleaseTop[] = [];
  for (const item of row["top"]) {
    const head = nodeHead(item);
    const shard = obj(item)?.["shard"];
    if (!head || typeof shard !== "string" || !shards[shard]) return null;
    top.push({ ...head, shard });
  }
  const direct: ReleaseSection[] = [];
  for (const item of row["direct"]) {
    const parsed = section(item);
    if (!parsed) return null;
    direct.push(parsed);
  }
  const restorations = Array.isArray(row["restorations"])
    ? row["restorations"].filter((v): v is string => typeof v === "string")
    : [];
  return {
    jurisdiction: state,
    sourceSystem,
    projectionSections: sections,
    restorations,
    top,
    direct,
    shards,
  };
}

/** The top-level nodes a shard holds, keyed by id; null when the shard is malformed or for another state. */
export function parseOutlineShard(data: unknown, state: string): Map<string, ReleaseNode> | null {
  const row = obj(data);
  if (!row || row["schema_version"] !== OUTLINE_SCHEMA || row["jurisdiction"] !== state)
    return null;
  if (!Array.isArray(row["nodes"])) return null;
  const out = new Map<string, ReleaseNode>();
  for (const item of row["nodes"]) {
    const parsed = node(item, 0);
    if (!parsed || out.has(parsed.id)) return null;
    out.set(parsed.id, parsed);
  }
  return out;
}

/** Comparison form of a heading, the same as the builder's norm_heading(). */
export function normHeading(value: string | null | undefined): string {
  const clean = cleanHeading(value) ?? "";
  return clean
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s*\.$/, "")
    .trim();
}

type Step = HierarchyStep & { heading?: string | null };

/** Does a node stand for this path step: its own id, or its recorded level, number and (any printed) heading. */
export function stepMatches(
  item: Pick<ReleaseNode, "id" | "l" | "n" | "h" | "hv">,
  step: Step,
): boolean {
  if (step.node_id && ID.test(step.node_id)) return item.id === step.node_id;
  if (item.l !== step.level || (item.n ?? null) !== (step.number ?? null)) return false;
  if (step.heading === undefined) return true;
  const want = normHeading(step.heading);
  return [item.h, ...(item.hv ?? [])].some((h) => normHeading(h) === want);
}

/**
 * The outline below a path. `topNode` loads the full top-level node (from its shard). A path step must name exactly
 * one node at its depth; anything else is an unsupported path rather than a guess.
 */
export async function releaseOutline(
  root: OutlineRoot,
  path: Step[],
  topNode: (top: ReleaseTop) => Promise<ReleaseNode | null>,
): Promise<ProjectedOutline> {
  if (!path.length) return outlineOf(root.top, root.direct);
  const first = root.top.filter((item) => stepMatches(item, path[0]!));
  if (first.length !== 1) return { available: true, kind: "unsupported_path" };
  const loaded = await topNode(first[0]!);
  if (!loaded) return { available: false };
  let current: ReleaseNode = loaded;
  for (const step of path.slice(1)) {
    const next: ReleaseNode[] = (current.k ?? []).filter((item) => stepMatches(item, step));
    if (next.length !== 1) return { available: true, kind: "unsupported_path" };
    current = next[0]!;
  }
  return outlineOf(current.k ?? [], current.s ?? []);
}

function outlineOf(
  children: Omit<ReleaseNode, "k" | "s">[],
  sections: ReleaseSection[],
): ProjectedOutline {
  const directSections = sections.map(([native_id, citation, heading, status_note]) => ({
    native_id,
    citation,
    heading,
    status_note,
  }));
  if (!children.length)
    return {
      available: true,
      kind: "sections",
      read: "release",
      level: "section",
      total: directSections.length,
      truncated: false,
      sections: directSections,
    };
  const counts = new Map<string, number>();
  for (const child of children) counts.set(child.l, (counts.get(child.l) ?? 0) + child.c);
  const level = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  return {
    available: true,
    kind: "groups",
    read: "release",
    level,
    total: children.length,
    truncated: false,
    groups: children.map((child) => ({
      level: child.l,
      number: child.n,
      heading: child.h,
      node_id: child.id,
      count: child.c,
      ...(child.hv?.length ? { variants: child.hv } : {}),
    })),
    directSections,
    directTotal: directSections.length,
    directTruncated: false,
  };
}

/** The path (ids and recorded headings) from the release root to the node that lists `nativeId`, or null. */
export function locateInNode(top: ReleaseNode, nativeId: string): Step[] | null {
  const trail: ReleaseNode[] = [];
  const walk = (current: ReleaseNode): boolean => {
    trail.push(current);
    if ((current.s ?? []).some((row) => row[0] === nativeId)) return true;
    for (const child of current.k ?? []) if (walk(child)) return true;
    trail.pop();
    return false;
  };
  if (!walk(top)) return null;
  return trail.map((item) => ({
    level: item.l,
    number: item.n,
    node_id: item.id,
    heading: item.h,
  }));
}

/**
 * Top-level nodes that can hold a section, from its citation and recorded hierarchy, following the builder's
 * restorations: Texas by the citation's code prefix, the District of Columbia by the title in its recorded path,
 * every other state by its first recorded level. Several candidates are searched in turn; none is guessed.
 */
export function topCandidates(
  root: OutlineRoot,
  citation: string | null,
  hierarchy: { level: string; number: string | null; heading: string | null }[],
): ReleaseTop[] {
  if (root.jurisdiction === "TX") {
    const code =
      citation && citation.includes(":") ? citation.slice(0, citation.indexOf(":")) : null;
    return code ? root.top.filter((item) => item.l === "code" && item.n === code) : [];
  }
  const first = hierarchy[0];
  if (!first) return [];
  if (root.jurisdiction === "DC" && first.level === "chapter") {
    const title = /^titles-([0-9A-Za-z]+)(?:-|$)/.exec(first.number ?? "")?.[1];
    return title ? root.top.filter((item) => item.l === "title" && item.n === title) : [];
  }
  const exact = root.top.filter((item) => stepMatches(item, { ...first, heading: first.heading }));
  return exact.length
    ? exact
    : root.top.filter((item) => stepMatches(item, { level: first.level, number: first.number }));
}

type OutlineGroup = Extract<ProjectedOutline, { kind: "groups" }>["groups"][number];

/**
 * Groups from the projection's own outline read that share (level, number, node_id) open the same list there, so
 * they are one entry: counts are added, the heading with the most sections is shown and the other printed forms are
 * kept as variants. Order is the first occurrence. Groups without a number stay separate (their headings differ).
 */
export function mergeSameIdentityGroups(groups: OutlineGroup[]): OutlineGroup[] {
  const out: OutlineGroup[] = [];
  const index = new Map<string, number>();
  const best = new Map<number, number>();
  for (const group of groups) {
    if (group.number === null) {
      out.push(group);
      continue;
    }
    const key = JSON.stringify([group.level ?? null, group.number, group.node_id ?? null]);
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      best.set(out.length, group.count);
      out.push({ ...group });
      continue;
    }
    const kept = out[at]!;
    const variants = new Set([...(kept.variants ?? [])]);
    if (group.count > best.get(at)!) {
      if (kept.heading !== null) variants.add(kept.heading);
      kept.heading = group.heading;
      best.set(at, group.count);
    } else if (group.heading !== null) variants.add(group.heading);
    if (kept.heading !== null) variants.delete(kept.heading);
    kept.count += group.count;
    kept.variants = [...variants];
    if (!kept.variants.length) delete kept.variants;
  }
  return out;
}

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanValue(text: string): number | null {
  if (!/^[IVXLCDM]+$/.test(text)) return null;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const value = ROMAN_VALUES[text[i]!]!;
    const next = ROMAN_VALUES[text[i + 1] ?? ""] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

/**
 * Printed-number order, the same rule as the release builder's sort_key: digits numerically; after a period, digits
 * with a leading zero as a decimal fraction ("1.001" < "1.0015" < "1.002"), others numerically ("1.9" < "1.10").
 */
export function numberKey(text: string): (number | string)[] {
  const key: (number | string)[] = [];
  let prev = "";
  for (const token of text.match(/\d+|[A-Za-z]+|[^\dA-Za-z]/g) ?? []) {
    if (/^\d+$/.test(token)) {
      if (prev === "." && token.startsWith("0")) key.push(1, 0, token);
      else key.push(2, Number(token), "");
    } else if (/^[A-Za-z]+$/.test(token)) key.push(3, 0, token.toLowerCase());
    else key.push(0, 0, token);
    prev = token;
  }
  return key;
}

function compareKeys(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * The projection's own outline read sorts printed numbers as text ("Division 1", "1.5", "10", "2"). Within one level,
 * when every number there starts with a digit, or every one is a Roman numeral, groups are put in numeric order; any
 * other level keeps the order it came in.
 */
export function orderGroupsByNumber(groups: OutlineGroup[]): OutlineGroup[] {
  const byLevel = new Map<string, OutlineGroup[]>();
  for (const group of groups) {
    const level = group.level ?? "";
    byLevel.set(level, [...(byLevel.get(level) ?? []), group]);
  }
  const out: OutlineGroup[] = [];
  for (const items of byLevel.values()) {
    const numbers = items.map((g) => g.number);
    if (numbers.every((n) => n !== null && /^\d/.test(n)))
      out.push(
        ...[...items].sort((a, b) => compareKeys(numberKey(a.number!), numberKey(b.number!))),
      );
    else if (numbers.every((n) => n !== null && romanValue(n) !== null))
      out.push(...[...items].sort((a, b) => romanValue(a.number!)! - romanValue(b.number!)!));
    else out.push(...items);
  }
  return out;
}
