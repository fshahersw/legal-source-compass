/** Formatting helpers and constants shared by the calculators (kept apart from components for fast refresh). */
export const FRED_NOTICE =
  "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";
export const FRED_TERMS = "https://fred.stlouisfed.org/docs/api/terms_of_use.html";
export const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const num = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const controlClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Parse a money/number input ("100,000.50"); null when it is not a number. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
