import type { MdlRow } from "@/lib/external/mdlAnalytics.functions";
import type { MassTortSignal } from "@/lib/external/massTortSignals.functions";

/** Regulator by product type, as recorded on the product signal (not inferred from the MDL caption). */
export const REGULATOR: Record<MassTortSignal["kind"], { short: string; name: string }> = {
  drug: { short: "FDA", name: "Food and Drug Administration" },
  device: { short: "FDA", name: "Food and Drug Administration" },
  food: { short: "FDA", name: "Food and Drug Administration" },
  cosmetic: { short: "FDA", name: "Food and Drug Administration" },
  vehicle: { short: "NHTSA", name: "National Highway Traffic Safety Administration" },
};

export const pct = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "Not recorded" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
export const n = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v)
    ? "Not recorded"
    : v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Pending MDLs of the same JPML type, ranked by pending actions, with this MDL's position. */
export function peerRanking(all: readonly MdlRow[], mdl: number, type: string | null) {
  const peers = all
    .filter((m) => m.status === "pending" && (type ? m.type === type : true))
    .sort((a, b) => b.pending - a.pending);
  const index = peers.findIndex((m) => m.mdl === mdl);
  const growth = peers
    .filter((m) => m.change12m != null && m.pending - (m.change12m ?? 0) > 0)
    .map((m) => ({
      mdl: m.mdl,
      pct: (100 * (m.change12m ?? 0)) / (m.pending - (m.change12m ?? 0)),
    }))
    .sort((a, b) => b.pct - a.pct);
  const growthIndex = growth.findIndex((g) => g.mdl === mdl);
  return {
    peers,
    position: index >= 0 ? index + 1 : null,
    count: peers.length,
    growthPosition: growthIndex >= 0 ? growthIndex + 1 : null,
    growthCount: growth.length,
    window: (() => {
      if (index < 0) return peers.slice(0, 9);
      const start = Math.max(0, Math.min(index - 4, peers.length - 9));
      return peers.slice(start, start + 9);
    })(),
  };
}

/** Year rows for the agency report series, complete years only (the current year is partial). */
export function reportYears(signal: MassTortSignal, currentYear: number, from = 2010) {
  const rows: { year: string; reports: number }[] = [];
  for (let y = from; y < currentYear; y++)
    rows.push({ year: String(y), reports: signal.eventsByYear[String(y)] ?? 0 });
  return rows;
}

/** 12-month growth of pending actions in percent, from the change and current pending count. */
export function growthPct(pending: number | null, change12m: number | null) {
  if (pending == null || change12m == null) return null;
  const base = pending - change12m;
  return base > 0 ? (100 * change12m) / base : null;
}
