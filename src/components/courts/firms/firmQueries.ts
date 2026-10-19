import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { getFirmLandscape, type Side } from "@/lib/external/firmIntel.functions";

export const FIRM_STALE = 10 * 60 * 1000;

export const landscapeQuery = {
  queryKey: ["firm-landscape"],
  queryFn: () => getFirmLandscape(),
  staleTime: FIRM_STALE,
};

/** Words that mark a party name as an organisation; anything else may be a person and is counted, not named. */
const ORGANISATION =
  /\b(inc|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|lp|l\.p|llp|plc|n\.a|bank|group|holdings?|fund|trust|association|authority|university|hospital|health|department|board|county|city|state|district|systems?|technologies|pharmaceuticals?|laboratories|international|partners|services|agency|commission|ag|sa|gmbh|nv|bv|se)\b\.?/i;

export function isOrganisation(name: string): boolean {
  return ORGANISATION.test(name);
}

export const SIDE_COLOR: Record<Side, string> = {
  plaintiff: FDA_COLORS[1]!,
  defense: FDA_COLORS[2]!,
  other: FDA_COLORS[5]!,
};
export const SIDE_LABEL: Record<Side, string> = {
  plaintiff: "Plaintiff side",
  defense: "Defense side",
  other: "Other parties",
};
export const NOT_RECORDED = "Not recorded";
