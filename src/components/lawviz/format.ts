/** Formatting shared by the law visualizations: a missing value is always "Not recorded", never 0. */
export const fmtInt = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.round(n).toLocaleString("en-US")
    : "Not recorded";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? "Not recorded"
    : d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
}

/** Footnote naming when the database computed the figures (from the build timestamp); none when unknown. */
export const builtNote = (at: string | null): string[] =>
  at ? [`Figures computed ${fmtDate(at)} from the stored records.`] : [];

/** "1 report entry", "2 report entries", "1 press release" — the unit as the series names it, singular for one. */
export function countOf(n: number, unit: string): string {
  const one = unit.endsWith("ies") ? `${unit.slice(0, -3)}y` : unit.replace(/s$/, "");
  return `${fmtInt(n)} ${n === 1 ? one : unit}`;
}
