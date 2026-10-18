/**
 * Daily rotation for the "insight of the day" cards. Pure functions, no clock reads.
 *
 * Rule (documented here because the UI promises it):
 *   1. The UTC calendar day is the only input. `utcDayKey()` turns an instant into `YYYY-MM-DD`; the key is
 *      computed once, on the server, and travels with the result, so server render and client hydration
 *      always show the same insight and nothing re-reads a clock while rendering.
 *   2. A section's candidates are put in ascending `id` order (plain code-unit comparison, so the order is
 *      the same in every runtime and locale).
 *   3. With N candidates and day number D (whole days since 1970-01-01 UTC), the pick is index
 *      `(D + offset) mod N`, where `offset` is a stable hash of the section id (the "salt") so that sections
 *      do not all show their first candidate on the same day.
 *   4. Consecutive days therefore always differ whenever N > 1, and every candidate is shown once in any run
 *      of N consecutive days. With N = 1 the same insight shows every day; with N = 0 there is no pick.
 *
 * The position is "which candidate in today's order", not a promise about tomorrow: when the underlying
 * data changes, the pool (and so the order) can change.
 */

export const DAY_MS = 86_400_000;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` of the UTC calendar day containing `instant`. */
export function utcDayKey(instant: Date | number): string {
  const t = instant instanceof Date ? instant.getTime() : instant;
  if (!Number.isFinite(t)) throw new RangeError("utcDayKey needs a finite instant");
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${m}-${day}`;
}

/** Whole days since 1970-01-01 (UTC) for a valid `YYYY-MM-DD` key; null for anything else (including 2026-02-30). */
export function utcDayNumber(dayKey: string): number | null {
  const m = DAY_KEY.exec(dayKey);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
    return null;
  return Math.round(ms / DAY_MS);
}

/** FNV-1a, 32-bit: small, dependency-free and identical on server and client. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Candidates in rotation order: ascending id by code unit; later duplicates of an id are ignored. */
export function rotationOrder<T extends { id: string }>(pool: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of pool) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type DailyPick<T> = {
  item: T;
  /** 1-based place of `item` in the rotation order. */
  position: number;
  poolSize: number;
  /** The whole pool in rotation order (the pick included). */
  order: T[];
};

/**
 * The candidate for `dayKey`. Returns null for an empty pool or an invalid day key (never a guess).
 * `salt` (the section id) only shifts where in the order a section starts.
 */
export function pickDaily<T extends { id: string }>(
  pool: readonly T[],
  dayKey: string,
  salt = "",
): DailyPick<T> | null {
  const day = utcDayNumber(dayKey);
  const order = rotationOrder(pool);
  const n = order.length;
  if (day === null || n === 0) return null;
  const offset = salt ? stableHash(salt) % n : 0;
  const index = (((day + offset) % n) + n) % n;
  return { item: order[index]!, position: index + 1, poolSize: n, order };
}
