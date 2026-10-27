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

/** Fewest plaintiff-side appearances an MDL needs before its concentration (HHI, top-5 share) is ranked. */
export const MIN_CONCENTRATION_APPEARANCES = 30;

export type MdlSort = "appearances" | "hhi" | "top5" | "firms" | "mdl";

type SortableMdl = {
  mdl: number;
  plaintiff: {
    appearances: number | null;
    hhi: number | null;
    top5: number | null;
    firms: number | null;
  };
};

/**
 * MDLs in table order. Concentration sorts (HHI, top-5 share) rank only MDLs with at least `min` plaintiff-side
 * appearances: with a handful of counsel entries one firm makes the HHI swing to its maximum, so a three-entry docket
 * would otherwise top the list. MDLs under the minimum follow, ordered by appearances, and are marked small.
 */
export function sortMdls<T extends SortableMdl>(
  mdls: readonly T[],
  sort: MdlSort,
  min = MIN_CONCENTRATION_APPEARANCES,
): { rows: T[]; small: Set<number> } {
  const n = (m: T) => m.plaintiff.appearances ?? -1;
  const small = new Set(mdls.filter((m) => n(m) < min).map((m) => m.mdl));
  const key = (m: T): number =>
    sort === "mdl"
      ? -m.mdl
      : sort === "hhi"
        ? (m.plaintiff.hhi ?? -1)
        : sort === "top5"
          ? (m.plaintiff.top5 ?? -1)
          : sort === "firms"
            ? (m.plaintiff.firms ?? -1)
            : n(m);
  const byKey = (a: T, b: T) => key(b) - key(a) || n(b) - n(a) || a.mdl - b.mdl;
  if (sort !== "hhi" && sort !== "top5") return { rows: [...mdls].sort(byKey), small };
  const ranked = mdls.filter((m) => !small.has(m.mdl)).sort(byKey);
  const rest = mdls.filter((m) => small.has(m.mdl)).sort((a, b) => n(b) - n(a) || a.mdl - b.mdl);
  return { rows: [...ranked, ...rest], small };
}
