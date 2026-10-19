import { getScacAlignment, getScacStatistics } from "@/lib/external/scac.functions";

const STALE = 30 * 60 * 1000;

export const statisticsQuery = {
  queryKey: ["scac-statistics"],
  queryFn: () => getScacStatistics(),
  staleTime: STALE,
};
export const alignmentQuery = {
  queryKey: ["scac-alignment"],
  queryFn: () => getScacAlignment(),
  staleTime: STALE,
};

export const CREDIT =
  "Source: Stanford Law School Securities Class Action Clearinghouse, in cooperation with Cornerstone Research; used with permission reported by the site owner.";

/** "$7.23 billion", "$688.0 million", "$950,000". */
export function moneyShort(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)} billion`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)} million`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}
