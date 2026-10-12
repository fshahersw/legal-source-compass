import type { LimitationSource } from "../types";

/** Reusing bytes must not silently change the kind of authority those bytes represent. */
export function reuseSourceAuthority(
  existing: Pick<LimitationSource, "id" | "authorityKind"> | undefined,
  id: string,
  requestedKind: LimitationSource["authorityKind"],
): string {
  if (!existing) throw new Error(`Reused source ${id} is not present in the base bundle`);
  if (existing.authorityKind !== requestedKind) {
    throw new Error(
      `Source ${id} authority kind conflict: recorded ${existing.authorityKind}, requested ${requestedKind}. Review the source classification explicitly.`,
    );
  }
  return existing.id;
}
