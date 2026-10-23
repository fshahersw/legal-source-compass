/** Pure view helpers for the state overview: percentage change text, circuits, court groupings. */
import type { CourtRow } from "@/lib/external/directoryTree";
import { isJudicialCourtRecord } from "@/lib/corpus/courtDirectoryKind";
import type { DistrictRow } from "@/lib/external/stateOverviewModel";

/** "+3.2%" / "−1.4%" between two published counts, or null when there is no earlier count or it is zero. */
export function filingsChange(f: { value: number; previous: number | null }): string | null {
  if (f.previous == null || f.previous <= 0) return null;
  const pct = ((f.value - f.previous) / f.previous) * 100;
  if (!Number.isFinite(pct)) return null;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%`;
}

/** Distinct circuits of the districts, in first-seen order. */
export function uniqueCircuits(districts: Pick<DistrictRow, "circuit">[]): string[] {
  return [...new Set(districts.flatMap((d) => (d.circuit ? [d.circuit] : [])))];
}

/** The state's highest and appellate courts: recorded type contains supreme, appellate, appeals or last resort. */
export function appellateCourts(courts: CourtRow[]): CourtRow[] {
  return courts
    .filter(isJudicialCourtRecord)
    .filter(
      (c) =>
        c.system.toLowerCase() === "state" &&
        /supreme|appellate|appeals|last resort|court of criminal appeals/i.test(c.type),
    )
    .sort((a, b) => rank(a.type) - rank(b.type) || a.title.localeCompare(b.title));
}
const rank = (type: string) => (/supreme|last resort/i.test(type) ? 0 : 1);

/** Judicial courts grouped by system for the count line. */
export function courtCounts(courts: CourtRow[]) {
  const judicial = courts.filter(isJudicialCourtRecord);
  const by = (system: string) => judicial.filter((c) => c.system.toLowerCase() === system).length;
  return {
    total: judicial.length,
    federal: by("federal"),
    state: by("state"),
    other: judicial.length - by("federal") - by("state"),
  };
}
