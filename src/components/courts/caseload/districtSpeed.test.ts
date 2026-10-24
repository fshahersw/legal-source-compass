import { describe, expect, it } from "vitest";
import { districtSpeed, type DistrictSpeedInput } from "./districtSpeed";

const rows: DistrictSpeedInput[] = Array.from({ length: 12 }, (_, i) => ({
  id: `d${i}`,
  name: `District ${i}`,
  terminations: 1000,
  medianDays: 100 + i * 10,
}));

describe("districtSpeed", () => {
  it("picks the slowest and fastest districts against the national median", () => {
    const s = districtSpeed(rows, 150, { n: 2 })!;
    expect(s.baseline).toBe(150);
    expect(s.slowest.map((d) => d.value)).toEqual([210, 200]);
    expect(s.fastest.map((d) => d.value)).toEqual([110, 100]);
  });

  it("leaves out districts below the closing threshold or without a median", () => {
    const s = districtSpeed(
      [
        ...rows,
        { id: "tiny", name: "Tiny", terminations: 40, medianDays: 999 },
        { id: "none", name: "None", terminations: 5000, medianDays: null },
      ],
      150,
      { n: 2, minTerminations: 500 },
    )!;
    expect(s.slowest[0]!.id).toBe("d11");
    expect(s.counted).toBe(12);
    expect(s.excluded).toBe(2);
  });

  it("returns nothing without a national median or enough districts", () => {
    expect(districtSpeed(rows, null)).toBeNull();
    expect(districtSpeed(rows.slice(0, 3), 150, { n: 2 })).toBeNull();
  });
});
