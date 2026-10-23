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

/** "computed Oct 23, 2026" from a build timestamp. */
export const builtLabel = (at: string | null) => (at ? `computed ${fmtDate(at)}` : undefined);
