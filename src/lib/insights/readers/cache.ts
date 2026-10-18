/**
 * Small in-memory memo for server reads. A successful result is kept for `ttlMs` (the other analytics reads
 * use 10 minutes); concurrent callers share one in-flight request; a failure is never cached, so the next
 * request tries again.
 */
export const READ_TTL_MS = 10 * 60 * 1000;

export function memoAsync<T>(
  ttlMs: number,
  fn: () => Promise<T>,
  now: () => number = Date.now,
): () => Promise<T> {
  let hit: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;
  return () => {
    if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    if (inflight) return inflight;
    const run = fn().then(
      (value) => {
        hit = { at: now(), value };
        inflight = null;
        return value;
      },
      (error: unknown) => {
        inflight = null;
        throw error;
      },
    );
    inflight = run;
    return run;
  };
}
