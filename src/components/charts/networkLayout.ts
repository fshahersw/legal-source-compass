/**
 * Deterministic force-directed layout (Fruchterman–Reingold) for small networks (tens of nodes): seeded start on a
 * circle, fixed number of cooling iterations, positions kept inside the box. Same input, same picture. Pure and tested
 * (networkLayout.test.ts). Position carries no meaning beyond "linked nodes are drawn near each other".
 */
import { seededRandom } from "./stats";

export type NetNode = { id: string; label: string; weight: number };
export type NetEdge = { a: string; b: string; weight: number };
export type Placed = NetNode & { x: number; y: number; degree: number };

export function networkLayout(
  nodes: readonly NetNode[],
  edges: readonly NetEdge[],
  options: { width: number; height: number; iterations?: number; seed?: number; padding?: number },
): { nodes: Placed[]; edges: NetEdge[] } {
  const pad = options.padding ?? 24;
  const W = Math.max(1, options.width - 2 * pad);
  const H = Math.max(1, options.height - 2 * pad);
  const ids = new Map(nodes.map((n, i) => [n.id, i] as const));
  const valid = edges.filter((e) => ids.has(e.a) && ids.has(e.b) && e.a !== e.b && e.weight > 0);
  const n = nodes.length;
  if (!n) return { nodes: [], edges: [] };
  const rand = seededRandom(options.seed ?? 7);
  // deterministic start: circle in input order with a small seeded jitter
  const pos = nodes.map((_, i) => {
    const t = (2 * Math.PI * i) / n;
    return {
      x: W / 2 + (W / 3) * Math.cos(t) + (rand() - 0.5) * 2,
      y: H / 2 + (H / 3) * Math.sin(t) + (rand() - 0.5) * 2,
    };
  });
  const area = W * H;
  const k = Math.sqrt(area / n);
  const maxW = Math.max(1, ...valid.map((e) => e.weight));
  const iterations = options.iterations ?? 300;
  let temp = Math.min(W, H) / 8;
  const cool = temp / (iterations + 1);
  for (let it = 0; it < iterations; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i]!.x - pos[j]!.x;
        const dy = pos[i]!.y - pos[j]!.y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (k * k) / d;
        disp[i]!.x += (dx / d) * f;
        disp[i]!.y += (dy / d) * f;
        disp[j]!.x -= (dx / d) * f;
        disp[j]!.y -= (dy / d) * f;
      }
    for (const e of valid) {
      const i = ids.get(e.a)!;
      const j = ids.get(e.b)!;
      const dx = pos[i]!.x - pos[j]!.x;
      const dy = pos[i]!.y - pos[j]!.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = ((d * d) / k) * (0.5 + (0.5 * e.weight) / maxW);
      disp[i]!.x -= (dx / d) * f;
      disp[i]!.y -= (dy / d) * f;
      disp[j]!.x += (dx / d) * f;
      disp[j]!.y += (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      // gentle pull to the centre keeps disconnected parts on screen
      disp[i]!.x += (W / 2 - pos[i]!.x) * 0.1;
      disp[i]!.y += (H / 2 - pos[i]!.y) * 0.1;
      const d = Math.max(0.01, Math.hypot(disp[i]!.x, disp[i]!.y));
      pos[i]!.x = Math.min(W, Math.max(0, pos[i]!.x + (disp[i]!.x / d) * Math.min(d, temp)));
      pos[i]!.y = Math.min(H, Math.max(0, pos[i]!.y + (disp[i]!.y / d) * Math.min(d, temp)));
    }
    temp = Math.max(0.5, temp - cool);
  }
  const degree = new Map<string, number>();
  for (const e of valid) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  return {
    nodes: nodes.map((nd, i) => ({
      ...nd,
      x: pad + pos[i]!.x,
      y: pad + pos[i]!.y,
      degree: degree.get(nd.id) ?? 0,
    })),
    edges: valid,
  };
}
