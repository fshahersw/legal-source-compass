/**
 * Trend cards on profile pages (an MDL, a matter, ...): which charts exist, what each one counts and where it links.
 * Client-safe, so a page can lay out and label a card before its data arrives. The data itself comes from
 * `getProfileTrend` (profile.functions.ts), which reads the corpus; builders in ./mdl.ts and ./entries.ts shape it
 * into the same `TrendBlockData` the Analytics hub draws.
 */
import type { BlockDef } from "@/lib/analytics/registry";
import type { TrendBlockData } from "@/lib/analytics/trend";

export type ProfileTrendResult =
  { status: "ok"; data: TrendBlockData } | { status: "empty"; reason: string };

const MDL_KEY = /^[1-9]\d{0,4}$/;

type KindSpec = {
  /** Shape of the key the kind accepts (an MDL number). */
  key: RegExp;
  group: BlockDef["group"];
  title: (key: string) => string;
  measure: string;
  detail: BlockDef["detail"];
};

export const PROFILE_KINDS = {
  "mdl-monthly-pending": {
    key: MDL_KEY,
    group: "courts",
    title: (k) => `Actions pending in MDL ${k}, by JPML monthly report`,
    measure: "actions pending in the MDL",
    detail: { to: "/matters/analytics", label: "MDL analytics" },
  },
  "mdl-fy-pending": {
    key: MDL_KEY,
    group: "courts",
    title: (k) => `Actions pending in MDL ${k} at the end of each fiscal year`,
    measure: "actions pending in the MDL at fiscal-year end",
    detail: { to: "/matters/analytics", label: "MDL analytics" },
  },
  "mdl-fjc-years": {
    key: MDL_KEY,
    group: "courts",
    title: (k) => `Civil cases carrying MDL ${k}'s docket number, by fiscal year filed`,
    measure: "civil cases carrying the MDL docket number",
    detail: { to: "/courts/caseload", label: "Federal civil caseload" },
  },
  "mdl-members-years": {
    key: MDL_KEY,
    group: "courts",
    title: (k) => `Member actions of MDL ${k} in the matter registry, by year filed`,
    measure: "member actions in the matter registry",
    detail: { to: "/matters/analytics", label: "MDL analytics" },
  },
  "mdl-transferred-years": {
    key: MDL_KEY,
    group: "courts",
    title: (k) => `Member dockets of MDL ${k} first filed in another court, by year filed`,
    measure: "member dockets first filed in another court",
    detail: { to: "/matters/analytics", label: "MDL analytics" },
  },
  "mdl-faers-years": {
    key: MDL_KEY,
    group: "adverse-events",
    title: (k) => `FAERS reports about the product of MDL ${k}, by year received`,
    measure: "FAERS reports about the MDL's product",
    detail: { to: "/safety/signals", label: "Mass-tort product signals" },
  },
  "mdl-maude-years": {
    key: MDL_KEY,
    group: "adverse-events",
    title: (k) => `MAUDE device reports about the product of MDL ${k}, by year received`,
    measure: "MAUDE reports about the MDL's product",
    detail: { to: "/safety/signals", label: "Mass-tort product signals" },
  },
  "matter-docket-entries": {
    key: MDL_KEY,
    group: "courts",
    title: (k) => `Master-docket entries of MDL ${k} captured in the registry, by month filed`,
    measure: "master-docket entries captured in the registry",
    detail: { to: "/matters/analytics", label: "MDL analytics" },
  },
} as const satisfies Record<string, KindSpec>;

export type ProfileKind = keyof typeof PROFILE_KINDS;
export const PROFILE_KIND_IDS = Object.keys(PROFILE_KINDS) as [ProfileKind, ...ProfileKind[]];

export const isProfileKey = (kind: ProfileKind, key: string): boolean =>
  PROFILE_KINDS[kind].key.test(key);

/** The card's identity: the same shape the Analytics hub registers, built for one profile. */
export function profileDef(kind: ProfileKind, key: string): BlockDef {
  const spec: KindSpec = PROFILE_KINDS[kind];
  return {
    id: `${kind}-${key}`,
    group: spec.group,
    title: spec.title(key),
    measure: spec.measure,
    detail: spec.detail,
  };
}

/** A small in-memory cache keyed by profile, so opening a page twice costs one read per window. Server-only use. */
export function keyedMemo<T>(
  ttlMs: number,
  max: number,
  now: () => number = Date.now,
): (key: string, load: () => Promise<T>) => Promise<T> {
  const hits = new Map<string, { at: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();
  return (key, load) => {
    const hit = hits.get(key);
    if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    const pending = inflight.get(key);
    if (pending) return pending;
    const run = load().then(
      (value) => {
        inflight.delete(key);
        hits.set(key, { at: now(), value });
        if (hits.size > max) {
          const oldest = hits.keys().next().value;
          if (oldest !== undefined) hits.delete(oldest);
        }
        return value;
      },
      (error: unknown) => {
        inflight.delete(key);
        throw error;
      },
    );
    inflight.set(key, run);
    return run;
  };
}
