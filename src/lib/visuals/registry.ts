import rawRegistry from "./registry.json";
import { canonicalState } from "@/lib/corpus/stateHub";

export type VisualAsset = {
  name: string;
  path: string;
  source: string;
  sha256: string;
  license: string;
  kind: string;
};

const registry = rawRegistry as unknown as {
  states: Record<string, VisualAsset>;
  agencies: Record<string, VisualAsset>;
  courts: Record<string, VisualAsset>;
  stateCourts: Record<string, VisualAsset>;
  flags: Record<string, VisualAsset>;
};

export function stateArtwork(state: string): VisualAsset | null {
  const identity = canonicalState(state);
  return identity ? (registry.states[identity.usps] ?? null) : null;
}

/** State flag by exact canonical state identity; never a neighbouring or similarly named state. */
export function stateFlag(state: string): VisualAsset | null {
  const identity = canonicalState(state);
  return identity ? (registry.flags[identity.usps] ?? null) : null;
}

export function agencyArtwork(name: string): VisualAsset | null {
  return registry.agencies[name.trim().toLowerCase()] ?? null;
}

/** Exact court-id seal: federal marks only for federal courts, state marks only for state courts. */
export function communityCourtArtwork(id: string, system?: string | null): VisualAsset | null {
  const s = system?.trim().toLowerCase();
  if (s === "federal") return registry.courts[id] ?? null;
  if (s === "state") return registry.stateCourts[id] ?? null;
  return null;
}
