import { describe, expect, it } from "vitest";
import {
  CLIENT_MAX_ENTRIES,
  CLIENT_TTL_MS,
  SUMMARY_STORE_KEY,
  SummaryCache,
  type StorageLike,
} from "./summaryCache";

function memoryStorage(initial?: string): StorageLike & { raw: () => string | null } {
  let value: string | null = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
    raw: () => value,
  };
}
const entry = (n: string) => ({
  bullets: [`Point ${n}.`],
  omitted: 0,
  generatedAt: "2026-10-24T10:00:00Z",
});

describe("SummaryCache", () => {
  it("returns what it stored, keyed by the context hash", () => {
    const cache = new SummaryCache(() => memoryStorage());
    expect(cache.get("a")).toBeNull();
    cache.set("a", entry("one"));
    expect(cache.get("a")?.bullets).toEqual(["Point one."]);
    expect(cache.get("b")).toBeNull();
  });

  it("expires entries after six hours", () => {
    let now = 1_000;
    const cache = new SummaryCache(
      () => memoryStorage(),
      () => now,
    );
    cache.set("a", entry("one"));
    now += CLIENT_TTL_MS - 1;
    expect(cache.get("a")).not.toBeNull();
    now += 2;
    expect(cache.get("a")).toBeNull();
  });

  it("keeps the newest entries when it is full", () => {
    const cache = new SummaryCache(() => memoryStorage());
    for (let i = 0; i < CLIENT_MAX_ENTRIES + 5; i += 1) cache.set(`k${i}`, entry(String(i)));
    expect(cache.get("k0")).toBeNull();
    expect(cache.get(`k${CLIENT_MAX_ENTRIES + 4}`)).not.toBeNull();
  });

  it("survives a reload through storage, and ignores damaged storage", () => {
    const storage = memoryStorage();
    new SummaryCache(() => storage).set("a", entry("one"));
    expect(storage.raw()).toContain("Point one.");
    expect(new SummaryCache(() => storage).get("a")?.bullets).toEqual(["Point one."]);
    expect(new SummaryCache(() => memoryStorage("{not json")).get("a")).toBeNull();
    expect(
      new SummaryCache(() => memoryStorage(JSON.stringify({ a: { bullets: [1] } }))).get("a"),
    ).toBeNull();
  });

  it("works with no storage at all", () => {
    const cache = new SummaryCache(() => null);
    cache.set("a", entry("one"));
    expect(cache.get("a")?.bullets).toEqual(["Point one."]);
  });

  it("uses a versioned storage key", () => {
    expect(SUMMARY_STORE_KEY).toMatch(/:v1$/);
  });
});
