/** URL search-parameter parsing shared by the Insights routes. Anything unexpected is dropped, never guessed. */
import { ENTITY_TYPES, type EntityType } from "@/lib/insights/contract";

/** A plain token (metric id, period, entity id list); numbers arrive parsed (e.g. "2738"), so they are accepted too. */
export function urlToken(v: unknown, max = 120): string | undefined {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : v;
  return typeof s === "string" && s && s.length <= max && /^[A-Za-z0-9_.:,-]*$/.test(s)
    ? s
    : undefined;
}

export function urlEntityType(v: unknown): EntityType | undefined {
  return ENTITY_TYPES.includes(v as EntityType) ? (v as EntityType) : undefined;
}

export function urlChoice<T extends string>(v: unknown, choices: readonly T[]): T | undefined {
  return choices.includes(v as T) ? (v as T) : undefined;
}
