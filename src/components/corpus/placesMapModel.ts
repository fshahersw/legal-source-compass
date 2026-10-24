/**
 * The map page's ranked panel: every state with its value and rank (missing values last, never zero) and the takeaway
 * sentence for the panel title. Pure and tested (placesMapModel.test.ts).
 */

export type MapRow = {
  id: string;
  usps: string;
  name: string;
  value: number | null;
  rank: number | null;
};

/** All states, highest value first; a state without a value keeps its place at the end, in name order. */
export function mapRows(
  states: readonly { fips: string; usps: string; name: string }[],
  values: Readonly<Record<string, number>>,
  ranks: Readonly<Record<string, { rank: number } | undefined>>,
): MapRow[] {
  return states
    .map((s) => {
      const v = values[s.fips];
      return {
        id: s.fips,
        usps: s.usps,
        name: s.name,
        value: typeof v === "number" && Number.isFinite(v) ? v : null,
        rank: ranks[s.fips]?.rank ?? null,
      };
    })
    .sort((a, b) => {
      if (a.value === null || b.value === null)
        return a.value === b.value ? a.name.localeCompare(b.name) : a.value === null ? 1 : -1;
      return b.value - a.value || a.name.localeCompare(b.name);
    });
}

const joinNames = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** "District of Columbia is highest, at 617.9 per 100,000 residents"; ties are named together (up to three). */
export function mapTakeaway(
  rows: readonly MapRow[],
  format: (v: number) => string,
  unit: string,
): string | null {
  const top = rows[0];
  if (!top || top.value === null) return null;
  const tied = rows.filter((r) => r.value === top.value).map((r) => r.name);
  const at = `${format(top.value)}${unit ? ` ${unit}` : ""}`;
  if (tied.length > 3) return `${tied.length} states share the highest value, ${at}`;
  return `${joinNames(tied)} ${tied.length > 1 ? "are" : "is"} highest, at ${at}`;
}
