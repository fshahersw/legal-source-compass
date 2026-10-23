/**
 * A small in-memory cache for the source viewer: entries expire, the size is bounded (least recently used leaves first)
 * and concurrent loads of the same key share one in-flight promise, so a hover prefetch and the click that follows it
 * make a single request. Works in the browser and on the server; it holds no secrets and caches only public pages.
 */
export type TtlCacheOptions<V> = {
  /** Most entries kept. */
  max: number;
  /** How long a settled value stays fresh. */
  ttlMs: number;
  /** Per-value lifetime; zero or less drops the entry as soon as it settles (so the next call tries again). */
  ttlFor?: (value: V) => number;
  /** How long a rejected load is remembered (default: not at all). */
  errorTtlMs?: number;
  now?: () => number;
};

type Entry<V> = { promise: Promise<V>; expires: number };

export class TtlCache<V> {
  private readonly map = new Map<string, Entry<V>>();

  constructor(private readonly options: TtlCacheOptions<V>) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  get size(): number {
    return this.map.size;
  }

  /** The fresh or in-flight value for the key, if any. Reading refreshes the entry's place in the eviction order. */
  peek(key: string): Promise<V> | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.promise;
  }

  /** The fresh value, or a single shared load of it. */
  load(key: string, loader: () => Promise<V>): Promise<V> {
    const hit = this.peek(key);
    if (hit) return hit;
    const promise = Promise.resolve().then(loader);
    // An in-flight entry never expires until it settles.
    const entry: Entry<V> = { promise, expires: Number.POSITIVE_INFINITY };
    this.map.set(key, entry);
    while (this.map.size > this.options.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    promise.then(
      (value) => {
        if (this.map.get(key) !== entry) return;
        const ttl = this.options.ttlFor ? this.options.ttlFor(value) : this.options.ttlMs;
        if (ttl > 0) entry.expires = this.now() + ttl;
        else this.map.delete(key);
      },
      () => {
        if (this.map.get(key) !== entry) return;
        const ttl = this.options.errorTtlMs ?? 0;
        if (ttl > 0) entry.expires = this.now() + ttl;
        else this.map.delete(key);
      },
    );
    return promise;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
