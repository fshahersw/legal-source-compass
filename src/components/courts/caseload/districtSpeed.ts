/**
 * Districts against the national median time from filing to disposition (FJC IDB, latest complete fiscal year): the
 * slowest and fastest districts among those that closed at least `minTerminations` civil cases, so a court with a
 * handful of closings does not top the list. A district without a recorded median is left out, never estimated.
 */
export type DistrictSpeedInput = {
  id: string;
  name: string;
  terminations: number | null;
  medianDays: number | null;
};

export type DistrictSpeed = {
  baseline: number;
  slowest: { id: string; name: string; value: number }[];
  fastest: { id: string; name: string; value: number }[];
  /** Districts that met the threshold and have a median. */
  counted: number;
  /** Districts left out: below the threshold or no recorded median. */
  excluded: number;
};

export function districtSpeed(
  rows: readonly DistrictSpeedInput[],
  nationalMedianDays: number | null,
  { n = 5, minTerminations = 500 }: { n?: number; minTerminations?: number } = {},
): DistrictSpeed | null {
  if (nationalMedianDays == null) return null;
  const counted = rows
    .filter(
      (r): r is DistrictSpeedInput & { medianDays: number; terminations: number } =>
        r.medianDays != null && r.terminations != null && r.terminations >= minTerminations,
    )
    .map((r) => ({ id: r.id, name: r.name, value: r.medianDays }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  if (counted.length < n * 2) return null;
  return {
    baseline: nationalMedianDays,
    slowest: counted.slice(0, n),
    fastest: counted.slice(-n),
    counted: counted.length,
    excluded: rows.length - counted.length,
  };
}
