/**
 * Where a CFR title's sections sit: its largest parts by recorded section count, the rest as one "All other parts"
 * row. Reserved parts and parts without a recorded count are counted separately, never as zero. Pure and client-safe.
 */
export type CfrPartInput = {
  identifier: string;
  title: string;
  reserved: boolean;
  sections: number | null;
};

export type CfrPartShare = { identifier: string; title: string; sections: number; share: number };

export type CfrConcentration = {
  top: CfrPartShare[];
  other: { parts: number; sections: number; share: number } | null;
  totalSections: number;
  recordedParts: number;
  reservedParts: number;
  unrecordedParts: number;
};

export function cfrConcentration(
  parts: readonly CfrPartInput[],
  limit = 8,
): CfrConcentration | null {
  const recorded = parts.filter(
    (p) =>
      !p.reserved &&
      typeof p.sections === "number" &&
      Number.isFinite(p.sections) &&
      p.sections > 0,
  ) as (CfrPartInput & { sections: number })[];
  const reservedParts = parts.filter((p) => p.reserved).length;
  const unrecordedParts = parts.length - reservedParts - recorded.length;
  const totalSections = recorded.reduce((a, p) => a + p.sections, 0);
  if (!totalSections) return null;
  const sorted = [...recorded].sort(
    (a, b) =>
      b.sections - a.sections || a.identifier.localeCompare(b.identifier, "en", { numeric: true }),
  );
  const share = (n: number) => (n / totalSections) * 100;
  const top = sorted.slice(0, limit).map((p) => ({
    identifier: p.identifier,
    title: p.title,
    sections: p.sections,
    share: share(p.sections),
  }));
  const rest = sorted.slice(limit);
  const restSections = rest.reduce((a, p) => a + p.sections, 0);
  return {
    top,
    other: rest.length
      ? { parts: rest.length, sections: restSections, share: share(restSections) }
      : null,
    totalSections,
    recordedParts: recorded.length,
    reservedParts,
    unrecordedParts,
  };
}
