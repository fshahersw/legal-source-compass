/**
 * Server-side read of the insights metric layer: one read RPC (contract.ts INSIGHTS_RPC), parsed with ./layer,
 * memoized per input for 10 minutes. A missing RPC (the insights SQL not installed yet) is an explicit "unavailable"
 * result, never an empty list; any other failure throws and is not cached. Server-only.
 */
import { rpcPostOptional } from "@/lib/external/rest.server";
import type { LayerResult } from "./layer";
import { READ_TTL_MS } from "./readers/cache";

export const UNAVAILABLE = "The insights metric layer is not installed yet.";
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: LayerResult<unknown> }>();

type Call = <T>(fn: string, body: Record<string, unknown>) => Promise<T | null>;

export async function readLayer<T>(
  fn: string,
  body: Record<string, unknown>,
  parse: (raw: unknown) => T,
  options: { call?: Call; now?: () => number } = {},
): Promise<LayerResult<T>> {
  const call = options.call ?? rpcPostOptional;
  const now = options.now ?? Date.now;
  const key = `${fn}:${JSON.stringify(body)}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < READ_TTL_MS) return hit.value as LayerResult<T>;
  const raw = await call<unknown>(fn, body);
  if (raw === null) return { status: "unavailable", message: UNAVAILABLE };
  const value: LayerResult<T> = { status: "ok", data: parse(raw) };
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now(), value });
  return value;
}

/** Test hook: forget memoized answers. */
export function clearLayerCache() {
  cache.clear();
}
