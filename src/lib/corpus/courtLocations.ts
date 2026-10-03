import { stateByName, stateByUsps } from "./geo";
import type { Insights } from "./insights";

export type CourtLocation = { id: string; state: string; title?: string };

/** Explicit state names or USPS codes only. A court title or case caption is never geography evidence. */
export function recordedStateCode(value: string): string | null {
  const trimmed = value.trim();
  return stateByUsps.get(trimmed.toUpperCase())?.usps ?? stateByName.get(trimmed)?.usps ?? null;
}

/** Exact court IDs only; conflicting or unknown duplicate locations remain unresolved. */
export function exactCourtLocations(courts: readonly CourtLocation[]): Map<string, string> {
  const grouped = new Map<string, Set<string | null>>();
  for (const court of courts) {
    if (!court.id) continue;
    const states = grouped.get(court.id) ?? new Set<string | null>();
    states.add(recordedStateCode(court.state));
    grouped.set(court.id, states);
  }
  return new Map([...grouped].flatMap(([id, states]) => {
    const state = [...states][0];
    return states.size === 1 && state ? [[id, state] as [string, string]] : [];
  }));
}

/** Derived court-location view. Original state literals remain available; raw snapshots are unchanged. */
export function deriveCourtLocationInsights(insights: Insights, courts: readonly CourtLocation[]): Insights {
  const locations = exactCourtLocations(courts);
  const locate = <T extends { court: string; state: string; recorded_state?: string }>(row: T) => {
    const location = locations.get(row.court);
    const literal = row.recorded_state ?? row.state;
    const recorded = recordedStateCode(literal);
    return {
      ...row,
      recorded_state: literal,
      state: location ?? recorded ?? "",
      state_basis: location ? "exact_court_location" as const : recorded ? "recorded_state" as const : "unresolved" as const,
      state_conflict: !!location && !!recorded && location !== recorded,
    };
  };
  return { ...insights, matters: insights.matters.map(locate), masters: insights.masters.map(locate) };
}
