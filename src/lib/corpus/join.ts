import type { Source } from "@/lib/atlas/types";
import { STATES } from "./geo";
import type { Insights } from "./insights";
import { recordedStateCode } from "./courtLocations";

function jurisdictionValues(s: Source): string[] {
  const v = (s as Record<string, unknown>)["jurisdiction_values"];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return s.jurisdiction ? s.jurisdiction.split("; ").filter(Boolean) : [];
}

/** Explicit state names or USPS codes in imported jurisdiction fields; no URL/title inference. */
export function statesOfSource(s: Source): { usps: string[]; unmatched: string[] } {
  const usps: string[] = [];
  const unmatched: string[] = [];
  for (const j of jurisdictionValues(s)) {
    const code = recordedStateCode(j);
    if (code) usps.push(code);
    else unmatched.push(j);
  }
  return { usps: [...new Set(usps)], unmatched };
}

export type StateSummary = { usps: string; fips: string; name: string; sources: number; occurrences: number; matters: number };

export type JoinReport = {
  byState: Map<string, StateSummary>;
  sourcesWithoutState: number;
  unmatchedJurisdictions: Map<string, number>;
  mattersWithoutState: number;
};

export function joinByState(sources: Source[], insights: Insights | null): JoinReport {
  const byState = new Map<string, StateSummary>(
    STATES.map((s) => [s.usps, { usps: s.usps, fips: s.fips, name: s.name, sources: 0, occurrences: 0, matters: 0 }]),
  );
  const unmatchedJurisdictions = new Map<string, number>();
  let sourcesWithoutState = 0;
  for (const s of sources) {
    const { usps, unmatched } = statesOfSource(s);
    for (const u of unmatched) unmatchedJurisdictions.set(u, (unmatchedJurisdictions.get(u) ?? 0) + 1);
    if (usps.length === 0) sourcesWithoutState++;
    for (const u of usps) {
      const row = byState.get(u)!;
      row.sources++;
      row.occurrences += s.occurrences;
    }
  }
  let mattersWithoutState = 0;
  for (const m of insights?.matters ?? []) {
    const row = byState.get(m.state);
    if (row) row.matters++;
    else mattersWithoutState++;
  }
  return { byState, sourcesWithoutState, unmatchedJurisdictions, mattersWithoutState };
}

export function sourcesForState(sources: Source[], usps: string): Source[] {
  return sources.filter((s) => statesOfSource(s).usps.includes(usps));
}
