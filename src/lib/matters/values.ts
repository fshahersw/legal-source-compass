/** Shared value guards for parsing untyped registry and corpus payloads. */

export const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Non-blank string, trimmed; null otherwise. */
export const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Non-blank string returned exactly as stored (no trimming); null otherwise. */
export const nonBlank = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

/** Non-negative integer. */
export const uint = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

/** Non-negative integer that is exactly representable. */
export const safeUint = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

export const finiteNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Native identifier written either as a number or a string. */
export const idStr = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : str(v);

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const NOT_RECORDED_TEXT = /^(not recorded|—|-|none|n\/a|unknown)$/i;
/** Trimmed text, with placeholder values such as "Not recorded" treated as absent. */
export const cleaned = (v: unknown): string | null => {
  const s = str(v);
  return s && !NOT_RECORDED_TEXT.test(s) ? s : null;
};
