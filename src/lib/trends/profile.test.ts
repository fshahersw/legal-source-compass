import { describe, expect, it, vi } from "vitest";
import { isProfileKey, keyedMemo, PROFILE_KIND_IDS, profileDef } from "./profile";

describe("profile kinds", () => {
  it("accepts only a plain MDL number as the key", () => {
    expect(isProfileKey("mdl-fy-pending", "2873")).toBe(true);
    expect(isProfileKey("mdl-fy-pending", "02873")).toBe(false);
    expect(isProfileKey("mdl-fy-pending", "100000")).toBe(false);
    expect(isProfileKey("matter-docket-entries", "2804; drop")).toBe(false);
    expect(isProfileKey("mdl-fjc-years", "")).toBe(false);
  });

  it("builds a card identity whose title says what is counted and names the profile", () => {
    for (const kind of PROFILE_KIND_IDS) {
      const def = profileDef(kind, "2804");
      expect(def.title).toContain("2804");
      expect(def.id).toBe(`${kind}-2804`);
      expect(def.detail.to.startsWith("/")).toBe(true);
    }
    expect(profileDef("mdl-fjc-years", "2885").title).toBe(
      "Civil cases carrying MDL 2885's docket number, by fiscal year filed",
    );
  });
});

describe("keyedMemo", () => {
  it("shares one load per key inside the window and reloads after it", async () => {
    let t = 0;
    const load = vi.fn(async () => t);
    const memo = keyedMemo<number>(100, 10, () => t);
    expect(await memo("a", load)).toBe(0);
    t = 50;
    expect(await memo("a", load)).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
    t = 150;
    expect(await memo("a", load)).toBe(150);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight load between concurrent callers and never caches a failure", async () => {
    const memo = keyedMemo<number>(1000, 10);
    let calls = 0;
    const slow = async () => {
      calls += 1;
      await Promise.resolve();
      return 7;
    };
    const [a, b] = await Promise.all([memo("k", slow), memo("k", slow)]);
    expect([a, b, calls]).toEqual([7, 7, 1]);
    const failing = keyedMemo<number>(1000, 10);
    await expect(failing("x", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(await failing("x", async () => 1)).toBe(1);
  });

  it("evicts the oldest entry past its size limit", async () => {
    const memo = keyedMemo<number>(1000, 2);
    const load = vi.fn(async () => 1);
    await memo("a", load);
    await memo("b", load);
    await memo("c", load);
    await memo("a", load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
