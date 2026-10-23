/** Query options and card identities for the profile trend cards (kept apart from the components for fast refresh). */
import type { BlockDef } from "@/lib/analytics/registry";
import type { ProfileKind } from "@/lib/trends/profile";
import { getProfileTrend } from "@/lib/trends/profile.functions";

export const profileTrendQuery = (kind: ProfileKind, key: string) => ({
  queryKey: ["profile-trend", kind, key] as const,
  queryFn: () => getProfileTrend({ data: { kind, key } }),
  staleTime: 10 * 60 * 1000,
  retry: 1,
});

/** Identity of a card whose block a page shapes itself. */
export function staticDef(args: {
  id: string;
  title: string;
  measure: string;
  detail: BlockDef["detail"];
  group?: BlockDef["group"];
}): BlockDef {
  return {
    group: args.group ?? "courts",
    id: args.id,
    title: args.title,
    measure: args.measure,
    detail: args.detail,
  };
}
