import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "./ttlCache";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("TtlCache", () => {
  it("shares one in-flight load between concurrent callers", async () => {
    const cache = new TtlCache<number>({ max: 4, ttlMs: 1000 });
    let resolve!: (n: number) => void;
    const loader = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    const a = cache.load("k", loader);
    const b = cache.load("k", loader);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    resolve(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
  });

  it("serves a settled value until it expires, then loads again", async () => {
    const c = clock();
    const cache = new TtlCache<string>({ max: 4, ttlMs: 1000, now: c.now });
    const loader = vi.fn(async () => "v");
    await cache.load("k", loader);
    c.advance(999);
    await cache.load("k", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    c.advance(2);
    await cache.load("k", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not expire an in-flight load, however long it takes", async () => {
    const c = clock();
    const cache = new TtlCache<string>({ max: 4, ttlMs: 10, now: c.now });
    let resolve!: (v: string) => void;
    const loader = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const first = cache.load("k", loader);
    c.advance(60_000);
    const second = cache.load("k", loader);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    resolve("done");
    expect(await first).toBe("done");
    expect(await second).toBe("done");
  });

  it("uses a per-value lifetime and drops values whose lifetime is zero", async () => {
    const c = clock();
    const cache = new TtlCache<{ ok: boolean }>({
      max: 4,
      ttlMs: 1000,
      ttlFor: (v) => (v.ok ? 1000 : 0),
      now: c.now,
    });
    const good = vi.fn(async () => ({ ok: true }));
    const bad = vi.fn(async () => ({ ok: false }));
    await cache.load("good", good);
    await cache.load("good", good);
    await cache.load("bad", bad);
    await cache.load("bad", bad);
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it("forgets rejections at once by default and remembers them briefly when asked", async () => {
    const c = clock();
    const plain = new TtlCache<string>({ max: 4, ttlMs: 1000, now: c.now });
    const failing = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(plain.load("k", failing)).rejects.toThrow("down");
    await expect(plain.load("k", failing)).rejects.toThrow("down");
    expect(failing).toHaveBeenCalledTimes(2);

    const brief = new TtlCache<string>({ max: 4, ttlMs: 1000, errorTtlMs: 50, now: c.now });
    const failing2 = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(brief.load("k", failing2)).rejects.toThrow("down");
    await expect(brief.load("k", failing2)).rejects.toThrow("down");
    expect(failing2).toHaveBeenCalledTimes(1);
    c.advance(51);
    await expect(brief.load("k", failing2)).rejects.toThrow("down");
    expect(failing2).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used entry beyond its size", async () => {
    const cache = new TtlCache<string>({ max: 2, ttlMs: 1000 });
    const loader = (v: string) => vi.fn(async () => v);
    const a = loader("a");
    const b = loader("b");
    const c3 = loader("c");
    await cache.load("a", a);
    await cache.load("b", b);
    await cache.load("a", a); // a is now the most recently used
    await cache.load("c", c3); // evicts b
    expect(cache.size).toBe(2);
    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("a")).toBeDefined();
    expect(cache.peek("c")).toBeDefined();
  });
});
