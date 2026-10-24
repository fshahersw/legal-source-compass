import { describe, expect, it } from "vitest";
import { latestWithYear } from "./courtGlance";

describe("latestWithYear", () => {
  it("returns the latest recorded value with its own year", () => {
    expect(latestWithYear([2023, 2024, 2025, 2026], [10, 20, 25, null])).toEqual({
      year: 2025,
      value: 25,
      previous: 20,
      changePct: 25,
    });
  });
  it("never compares across a missing year", () => {
    expect(latestWithYear([2023, 2024, 2025], [10, null, 30])?.changePct).toBeNull();
    expect(latestWithYear([2022, 2025], [10, 30])?.changePct).toBeNull();
  });
  it("is null when nothing is recorded", () => {
    expect(latestWithYear([2024, 2025], [null, null])).toBeNull();
    expect(latestWithYear([2024], undefined)).toBeNull();
  });
});
