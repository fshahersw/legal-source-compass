/**
 * "What moved most" on /insights: the takeaway sentence for the chart title and the rows behind it. Every figure is
 * the tile's own printed change; the order follows notableMovements (kpis.ts). Pure and tested (movements.test.ts).
 */
import { formatSignedPercent, splitChangeText } from "@/components/kit/format";
import type { Kpi } from "./kpis";

/** "Largest move: Consumer complaints received by the CFPB, +99.1% vs 2024." — or null without a movement. */
export function movementTakeaway(moves: readonly Kpi[]): string | null {
  const top = moves[0];
  if (!top || top.changePercent === null || !Number.isFinite(top.changePercent)) return null;
  const comparison = top.changeText ? splitChangeText(top.changeText).comparison : null;
  return `Largest move: ${top.title}, ${formatSignedPercent(top.changePercent)}${comparison ? ` vs ${comparison}` : ""}`;
}

/** Every tile with a change, largest percentage first (no percentage last), for the "View data" table. */
export function changeRows(tiles: readonly Kpi[]): Kpi[] {
  return tiles
    .filter((k) => k.changeText)
    .sort((a, b) => {
      const pa = a.changePercent !== null && Number.isFinite(a.changePercent);
      const pb = b.changePercent !== null && Number.isFinite(b.changePercent);
      if (pa !== pb) return pa ? -1 : 1;
      return (
        (pa ? Math.abs(b.changePercent!) - Math.abs(a.changePercent!) : 0) ||
        a.title.localeCompare(b.title)
      );
    });
}
