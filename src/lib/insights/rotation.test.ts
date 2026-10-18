import { afterEach, describe, expect, it } from "vitest";
import { DAY_MS, pickDaily, rotationOrder, stableHash, utcDayKey, utcDayNumber } from "./rotation";

const pool = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s.item-${String(i).padStart(2, "0")}` }));
const addDays = (key: string, days: number) =>
  utcDayKey(utcDayNumber(key)! * DAY_MS + days * DAY_MS);

describe("utcDayKey", () => {
  it("formats the UTC calendar day", () => {
    expect(utcDayKey(Date.UTC(2026, 9, 18, 12, 30))).toBe("2026-10-18");
    expect(utcDayKey(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });

  it("changes exactly at 00:00:00.000 UTC", () => {
    expect(utcDayKey(Date.parse("2026-10-18T23:59:59.999Z"))).toBe("2026-10-18");
    expect(utcDayKey(Date.parse("2026-10-19T00:00:00.000Z"))).toBe("2026-10-19");
    expect(utcDayKey(Date.parse("2026-12-31T23:59:59.999Z"))).toBe("2026-12-31");
    expect(utcDayKey(Date.parse("2027-01-01T00:00:00.000Z"))).toBe("2027-01-01");
  });

  it("handles leap days", () => {
    expect(utcDayKey(Date.parse("2028-02-29T10:00:00Z"))).toBe("2028-02-29");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("rejects a non-finite instant instead of guessing", () => {
    expect(() => utcDayKey(Number.NaN)).toThrow(RangeError);
  });

  describe("time zone independence", () => {
    const original = process.env["TZ"];
    afterEach(() => {
      if (original === undefined) delete process.env["TZ"];
      else process.env["TZ"] = original;
    });
    it("does not depend on the process time zone", () => {
      const instant = Date.parse("2026-10-19T01:30:00Z");
      for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"]) {
        process.env["TZ"] = tz;
        expect(utcDayKey(instant)).toBe("2026-10-19");
        expect(utcDayKey(Date.parse("2026-10-18T23:30:00Z"))).toBe("2026-10-18");
      }
    });
  });
});

describe("utcDayNumber", () => {
  it("counts whole days since 1970-01-01", () => {
    expect(utcDayNumber("1970-01-01")).toBe(0);
    expect(utcDayNumber("1970-01-02")).toBe(1);
    expect(utcDayNumber("2026-10-18")! - utcDayNumber("2026-10-17")!).toBe(1);
  });
  it("returns null for malformed or impossible dates", () => {
    for (const bad of [
      "",
      "2026-1-18",
      "2026-02-30",
      "2026-13-01",
      "20261018",
      "2026-10-18T00:00:00Z",
      "x",
    ])
      expect(utcDayNumber(bad)).toBeNull();
  });
});

describe("stableHash", () => {
  it("is deterministic and spreads different inputs", () => {
    expect(stableHash("state")).toBe(stableHash("state"));
    expect(stableHash("state")).not.toBe(stableHash("court"));
    expect(stableHash("")).toBe(0x811c9dc5);
  });
});

describe("rotationOrder", () => {
  it("orders by id regardless of input order and ignores repeated ids", () => {
    const items = [{ id: "b" }, { id: "a" }, { id: "c" }, { id: "a" }];
    expect(rotationOrder(items).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(rotationOrder([...items].reverse()).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("uses code-unit order, not locale order", () => {
    expect(rotationOrder([{ id: "b" }, { id: "B" }, { id: "a" }]).map((i) => i.id)).toEqual([
      "B",
      "a",
      "b",
    ]);
  });
});

describe("pickDaily", () => {
  it("returns the same pick for the same day, whatever the input order", () => {
    const items = pool(7);
    const a = pickDaily(items, "2026-10-18", "state");
    const b = pickDaily([...items].reverse(), "2026-10-18", "state");
    expect(a?.item.id).toBe(b?.item.id);
    expect(a?.position).toBe(b?.position);
    expect(pickDaily(items, "2026-10-18", "state")?.item.id).toBe(a?.item.id);
  });

  it("differs on consecutive days whenever the pool has more than one entry", () => {
    for (const n of [2, 3, 4, 5, 7, 8, 10]) {
      const items = pool(n);
      let day = "2026-03-01";
      for (let i = 0; i < 80; i++) {
        const today = pickDaily(items, day, "court")!;
        const tomorrow = pickDaily(items, addDays(day, 1), "court")!;
        expect(tomorrow.item.id).not.toBe(today.item.id);
        day = addDays(day, 1);
      }
    }
  });

  it("shows every candidate once in any run of N consecutive days", () => {
    const items = pool(9);
    const seen = new Set<string>();
    let day = "2026-12-28"; // crosses the year boundary
    for (let i = 0; i < 9; i++) {
      seen.add(pickDaily(items, day, "mdl")!.item.id);
      day = addDays(day, 1);
    }
    expect(seen.size).toBe(9);
  });

  it("changes at the UTC day boundary", () => {
    const items = pool(5);
    const before = pickDaily(items, utcDayKey(Date.parse("2026-10-18T23:59:59.999Z")), "judge")!;
    const after = pickDaily(items, utcDayKey(Date.parse("2026-10-19T00:00:00.000Z")), "judge")!;
    expect(after.item.id).not.toBe(before.item.id);
    expect(after.position).toBe((before.position % 5) + 1);
  });

  it("reports a 1-based position and the pool size", () => {
    const items = pool(4);
    for (let i = 0; i < 12; i++) {
      const p = pickDaily(items, addDays("2026-10-01", i))!;
      expect(p.poolSize).toBe(4);
      expect(p.position).toBeGreaterThanOrEqual(1);
      expect(p.position).toBeLessThanOrEqual(4);
      expect(p.order[p.position - 1]).toBe(p.item);
    }
  });

  it("shows the only candidate every day when the pool has one entry", () => {
    const one = pool(1);
    for (let i = 0; i < 5; i++) {
      const p = pickDaily(one, addDays("2026-10-18", i), "safety")!;
      expect(p.item.id).toBe("s.item-00");
      expect(p.position).toBe(1);
      expect(p.poolSize).toBe(1);
    }
  });

  it("returns null for an empty pool and for an invalid day key", () => {
    expect(pickDaily([], "2026-10-18")).toBeNull();
    expect(pickDaily(pool(3), "not-a-day")).toBeNull();
    expect(pickDaily(pool(3), "2026-02-30")).toBeNull();
  });

  it("uses the salt only to shift where a section starts", () => {
    const items = pool(10);
    const starts = new Set(
      ["state", "court", "judge", "mdl", "enforcement", "safety", "payments"].map(
        (s) => pickDaily(items, "2026-10-18", s)!.position,
      ),
    );
    expect(starts.size).toBeGreaterThan(1);
    expect(pickDaily(items, "2026-10-18", "")!.position).toBe(
      (((utcDayNumber("2026-10-18")! % 10) + 10) % 10) + 1,
    );
  });

  it("does not depend on the clock", () => {
    const first = pickDaily(pool(6), "2026-10-18", "state")!.item.id;
    const realNow = Date.now;
    Date.now = () => 0;
    try {
      expect(pickDaily(pool(6), "2026-10-18", "state")!.item.id).toBe(first);
    } finally {
      Date.now = realNow;
    }
  });
});
