/**
 * Icicle layout of a code title's outline: one row per level, each container as wide as its share of the title's
 * sections. The partition is checked exactly at every node: sections printed directly in a container get their own
 * cell, a shortfall becomes "Not broken down", and a container whose children add up to more than its own total keeps
 * its cell but loses its child rows (a row never claims more than its parent). Pure and client-safe.
 */
export type OutlineInput = {
  index: number;
  parent: number | null;
  depth: number;
  num: string | null;
  heading: string | null;
  status: string | null;
  total: number;
  direct: number;
  /** "chapter", "subtitle"… (used only to name the top row). */
  kind?: string | undefined;
};

export type IcicleCell = {
  key: string;
  /** Outline index of the container; null for a "directly in" or "not broken down" cell. */
  index: number | null;
  kind: "container" | "direct" | "unbroken";
  row: number;
  x0: number;
  x1: number;
  total: number;
  num: string | null;
  heading: string | null;
  status: string | null;
  /** Outline index of the container the cell sits in (null at the title level). */
  parent: number | null;
  /** Nothing is drawn below this cell (a leaf, a "directly in" or "not broken down" cell, or the last drawn row). */
  leaf: boolean;
};

export type IcicleLayout = {
  cells: IcicleCell[];
  total: number;
  rows: number;
  /** Containers whose children were left undrawn because they add up to more than the container's own total. */
  excess: number[];
  /** Sections counted at a level but not assigned to any child there (summed over the drawn rows). */
  unbroken: number;
};

const count = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function icicleLayout(outline: readonly OutlineInput[], maxRows = 3): IcicleLayout {
  const byParent = new Map<number | null, OutlineInput[]>();
  for (const n of outline) {
    const list = byParent.get(n.parent) ?? [];
    list.push(n);
    byParent.set(n.parent, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.index - b.index);
  const roots = byParent.get(null) ?? [];
  // the title itself is the single depth-0 root when the outline records one; otherwise the top-level containers are
  // the first row and the title total is their sum
  const titleNode = roots.length === 1 && roots[0]!.depth === 0 ? roots[0]! : null;
  const top = titleNode ? (byParent.get(titleNode.index) ?? []) : roots;
  const total = titleNode ? count(titleNode.total) : top.reduce((a, n) => a + count(n.total), 0);
  const cells: IcicleCell[] = [];
  const excess: number[] = [];
  let unbroken = 0;
  let deepest = 0;

  const place = (
    parent: OutlineInput | null,
    kids: OutlineInput[],
    own: number,
    direct: number,
    x0: number,
    x1: number,
    row: number,
  ) => {
    // a leaf's sections are all printed directly in it: nothing is drawn below it
    if (row >= maxRows || own <= 0 || !kids.length) return;
    const kidSum = kids.reduce((a, k) => a + count(k.total), 0);
    if (kidSum + direct > own) {
      if (parent) excess.push(parent.index);
      return;
    }
    const scale = (x1 - x0) / own;
    let x = x0;
    for (const k of kids) {
      const t = count(k.total);
      if (!t) continue;
      const w = t * scale;
      cells.push({
        key: `c${k.index}`,
        index: k.index,
        kind: "container",
        row,
        x0: x,
        x1: x + w,
        total: t,
        num: k.num,
        heading: k.heading,
        status: k.status,
        parent: parent?.index ?? null,
        leaf: false,
      });
      deepest = Math.max(deepest, row + 1);
      place(k, byParent.get(k.index) ?? [], t, count(k.direct), x, x + w, row + 1);
      x += w;
    }
    if (direct > 0) {
      cells.push({
        key: `d${parent?.index ?? "root"}`,
        index: null,
        kind: "direct",
        row,
        x0: x,
        x1: x + direct * scale,
        total: direct,
        num: parent?.num ?? null,
        heading: parent?.heading ?? null,
        status: null,
        parent: parent?.index ?? null,
        leaf: true,
      });
      x += direct * scale;
    }
    const rest = own - kidSum - direct;
    if (rest > 0) {
      unbroken += rest;
      cells.push({
        key: `u${parent?.index ?? "root"}`,
        index: null,
        kind: "unbroken",
        row,
        x0: x,
        x1: x1,
        total: rest,
        num: parent?.num ?? null,
        heading: parent?.heading ?? null,
        status: null,
        parent: parent?.index ?? null,
        leaf: true,
      });
    }
  };

  place(titleNode, top, total, titleNode ? count(titleNode.direct) : 0, 0, 1, 0);
  const parents = new Set(cells.map((c) => c.parent));
  for (const c of cells) c.leaf = c.index === null || !parents.has(c.index);
  return { cells, total, rows: deepest, excess, unbroken };
}

/** "CHAPTER 6A—" → "Chapter 6A—": only the level word is re-cased; the designation stays exactly as printed. */
export function readableDesignation(num: string | null): string | null {
  if (!num) return num;
  return num.replace(
    /^(\[?)([A-Z]{2,})\b/,
    (_m, br: string, w: string) => `${br}${w[0]}${w.slice(1).toLowerCase()}`,
  );
}

const ABBR: Record<string, string> = {
  title: "T.",
  subtitle: "Subt.",
  chapter: "Ch.",
  subchapter: "Subch.",
  part: "Pt.",
  subpart: "Subpt.",
  division: "Div.",
  subdivision: "Subdiv.",
  article: "Art.",
};

/** "CHAPTER 21—" → "Ch. 21"; "subpart i—" → "Subpt. i"; anything else is kept, without its trailing dash. */
export function shortContainer(num: string | null): string {
  const n = (num ?? "")
    .trim()
    .replace(/[—–-]+$/, "")
    .trim();
  if (!n) return "";
  const m = /^\[?([A-Za-z]+)\s+(.+)$/.exec(n);
  if (!m) return n;
  const abbr = ABBR[m[1]!.toLowerCase()];
  return abbr ? `${abbr} ${m[2]!.replace(/\]$/, "")}` : n;
}

const PLURAL: Record<string, string> = { subchapter: "subchapters", chapter: "chapters" };

/** "196 chapters": the top row named by its most common recorded kind ("levels" when none is recorded). */
export function topRowName(outline: readonly OutlineInput[], layout: IcicleLayout): string {
  const byIndex = new Map(outline.map((n) => [n.index, n]));
  const kinds = new Map<string, number>();
  let n = 0;
  for (const c of layout.cells) {
    if (c.row !== 0 || c.index === null) continue;
    n++;
    const k = byIndex.get(c.index)?.kind?.toLowerCase();
    if (k) kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  const common = [...kinds].sort((a, b) => b[1] - a[1])[0];
  const noun =
    common && common[1] === n
      ? n === 1
        ? common[0]
        : (PLURAL[common[0]] ?? `${common[0]}s`)
      : n === 1
        ? "top-level container"
        : "top-level containers";
  return `${n.toLocaleString("en-US")} ${noun}`;
}

/** Top-level containers by share of the title, for the chart's data table. */
export function topLevelRows(layout: IcicleLayout) {
  return layout.cells
    .filter((c) => c.row === 0)
    .map((c) => ({
      key: c.key,
      index: c.index,
      kind: c.kind,
      num: c.num,
      heading: c.heading,
      status: c.status,
      total: c.total,
      share: layout.total ? (c.total / layout.total) * 100 : null,
    }));
}
