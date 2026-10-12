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
};

export function stateArtwork(state: string): VisualAsset | null {
  const identity = canonicalState(state);
  return identity ? (registry.states[identity.usps] ?? null) : null;
}

export function agencyArtwork(name: string): VisualAsset | null {
  return registry.agencies[name.trim().toLowerCase()] ?? null;
}

export function communityCourtArtwork(id: string, system?: string | null): VisualAsset | null {
  return system?.trim().toLowerCase() === "federal" ? (registry.courts[id] ?? null) : null;
}
