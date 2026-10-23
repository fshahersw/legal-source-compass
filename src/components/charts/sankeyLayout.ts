/**
 * Sankey layout without a library: nodes in fixed columns, heights proportional to flow, link ribbons stacked at
 * both ends, a few barycentre sweeps to reduce crossings. Pure and deterministic (sankeyLayout.test.ts).
 */

export type SankeyNodeInput = { id: string; label: string; column: number };
export type SankeyLinkInput = { source: string; target: string; value: number };

export type SankeyNode = SankeyNodeInput & {
  value: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

export type SankeyLink = SankeyLinkInput & {
  width: number;
  /** Centre of the ribbon where it leaves the source and where it enters the target. */
  y0: number;
  y1: number;
  x0: number;
  x1: number;
};

export type SankeyLayout = { nodes: SankeyNode[]; links: SankeyLink[]; scale: number };

export function sankeyLayout(
  nodesIn: readonly SankeyNodeInput[],
  linksIn: readonly SankeyLinkInput[],
  options: { width: number; height: number; nodeWidth?: number; padding?: number; sweeps?: number },
): SankeyLayout {
  const nodeWidth = options.nodeWidth ?? 10;
  const padding = options.padding ?? 8;
  const ids = new Set(nodesIn.map((n) => n.id));
  const links = linksIn.filter(
    (l) => ids.has(l.source) && ids.has(l.target) && Number.isFinite(l.value) && l.value > 0,
  );
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const l of links) {
    outflow.set(l.source, (outflow.get(l.source) ?? 0) + l.value);
    inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.value);
  }
  const value = (id: string) => Math.max(inflow.get(id) ?? 0, outflow.get(id) ?? 0);
  const columns = [...new Set(nodesIn.map((n) => n.column))].sort((a, b) => a - b);
  const byColumn = columns.map((c) =>
    nodesIn
      .filter((n) => n.column === c && value(n.id) > 0)
      .sort((a, b) => value(b.id) - value(a.id) || a.label.localeCompare(b.label)),
  );
  const scale = Math.min(
    ...byColumn.map((col) => {
      const total = col.reduce((s, n) => s + value(n.id), 0);
      const room = options.height - padding * Math.max(0, col.length - 1);
      return total > 0 ? Math.max(0, room) / total : Infinity;
    }),
  );
  const k = Number.isFinite(scale) ? scale : 0;
  const colX = (ci: number) =>
    columns.length <= 1 ? 0 : (ci / (columns.length - 1)) * (options.width - nodeWidth);

  const place = (col: SankeyNodeInput[]) => {
    const out = new Map<string, { y0: number; y1: number }>();
    let y = 0;
    for (const n of col) {
      const h = value(n.id) * k;
      out.set(n.id, { y0: y, y1: y + h });
      y += h + padding;
    }
    return out;
  };
  let positions = new Map<string, { y0: number; y1: number }>();
  for (const col of byColumn) for (const [id, p] of place(col)) positions.set(id, p);

  // Barycentre sweeps: order each column by the flow-weighted centre of its neighbours in the previous column.
  for (let s = 0; s < (options.sweeps ?? 4); s++) {
    for (let ci = 1; ci < byColumn.length; ci++) {
      const centre = (id: string) => {
        let w = 0;
        let sum = 0;
        for (const l of links)
          if (l.target === id) {
            const p = positions.get(l.source);
            if (p) {
              sum += ((p.y0 + p.y1) / 2) * l.value;
              w += l.value;
            }
          }
        return w ? sum / w : Infinity;
      };
      byColumn[ci]!.sort((a, b) => centre(a.id) - centre(b.id) || value(b.id) - value(a.id));
      const next = new Map(positions);
      for (const [id, p] of place(byColumn[ci]!)) next.set(id, p);
      positions = next;
    }
  }

  const nodes: SankeyNode[] = [];
  byColumn.forEach((col, ci) => {
    for (const n of col) {
      const p = positions.get(n.id)!;
      nodes.push({
        ...n,
        value: value(n.id),
        x0: colX(ci),
        x1: colX(ci) + nodeWidth,
        y0: p.y0,
        y1: p.y1,
      });
    }
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const centreOf = (id: string) => {
    const n = nodeById.get(id);
    return n ? (n.y0 + n.y1) / 2 : 0;
  };
  const ordered = [...links].sort(
    (a, b) =>
      centreOf(a.source) - centreOf(b.source) ||
      centreOf(a.target) - centreOf(b.target) ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target),
  );
  const outLinks = new Map<string, SankeyLinkInput[]>();
  const inLinks = new Map<string, SankeyLinkInput[]>();
  for (const l of ordered) {
    outLinks.set(l.source, [...(outLinks.get(l.source) ?? []), l]);
    inLinks.set(l.target, [...(inLinks.get(l.target) ?? []), l]);
  }
  for (const list of outLinks.values())
    list.sort((a, b) => centreOf(a.target) - centreOf(b.target));
  for (const list of inLinks.values()) list.sort((a, b) => centreOf(a.source) - centreOf(b.source));
  const yOut = new Map<SankeyLinkInput, number>();
  const yIn = new Map<SankeyLinkInput, number>();
  for (const [id, list] of outLinks) {
    const n = nodeById.get(id)!;
    let y = n.y0;
    for (const l of list) {
      yOut.set(l, y + (l.value * k) / 2);
      y += l.value * k;
    }
    outOffset.set(id, y);
  }
  for (const [id, list] of inLinks) {
    const n = nodeById.get(id)!;
    let y = n.y0;
    for (const l of list) {
      yIn.set(l, y + (l.value * k) / 2);
      y += l.value * k;
    }
    inOffset.set(id, y);
  }
  const outLinksLaid: SankeyLink[] = ordered.map((l) => ({
    ...l,
    width: l.value * k,
    y0: yOut.get(l)!,
    y1: yIn.get(l)!,
    x0: nodeById.get(l.source)!.x1,
    x1: nodeById.get(l.target)!.x0,
  }));
  return { nodes, links: outLinksLaid, scale: k };
}

/** SVG path of a ribbon's centre line (drawn with stroke-width = ribbon width). */
export function ribbonPath(l: Pick<SankeyLink, "x0" | "x1" | "y0" | "y1">): string {
  const mid = (l.x0 + l.x1) / 2;
  return `M${l.x0},${l.y0}C${mid},${l.y0} ${mid},${l.y1} ${l.x1},${l.y1}`;
}
