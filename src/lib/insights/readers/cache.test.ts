import { describe, expect, it } from "vitest";
import { memoAsync } from "./cache";

describe("memoAsync", () => {
  it("serves a successful result from memory until the ttl passes", async () => {
    let t = 0;
    let calls = 0;
    const read = memoAsync(
      1000,
      async () => ++calls,
      () => t,
    );
    expect(await read()).toBe(1);
    t = 999;
    expect(await read()).toBe(1);
    t = 1000;
    expect(await read()).toBe(2);
    expect(calls).toBe(2);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    let calls = 0;
    let release: (v: number) => void = () => {};
    const read = memoAsync(1000, () => {
      calls++;
      return new Promise<number>((r) => (release = r));
    });
    const a = read();
    const b = read();
    release(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(calls).toBe(1);
  });

  it("never caches a failure: the next call tries again", async () => {
    let calls = 0;
    const read = memoAsync(1000, async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return "fine";
    });
    await expect(read()).rejects.toThrow("boom");
    expect(await read()).toBe("fine");
    expect(await read()).toBe("fine");
    expect(calls).toBe(2);
  });

  it("caches a null result too, so an unpublished dataset is not re-read on every request", async () => {
    let calls = 0;
    const read = memoAsync<number | null>(1000, async () => (calls++, null));
    expect(await read()).toBeNull();
    expect(await read()).toBeNull();
    expect(calls).toBe(1);
  });
});
