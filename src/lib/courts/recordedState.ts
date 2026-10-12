import { canonicalState } from "@/lib/corpus/stateHub";

/** Accept an exact state or the corpus's explicit USPS + dash + provenance fact. */
export function recordedCourtState(value: unknown) {
  const exact = canonicalState(value);
  if (exact) return exact;
  if (typeof value !== "string") return null;
  const qualified = /^([A-Z]{2})\s+[—–-]\s+\S/.exec(value.trim());
  return qualified ? canonicalState(qualified[1]) : null;
}
