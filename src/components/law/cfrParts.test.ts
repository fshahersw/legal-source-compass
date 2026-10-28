import { describe, expect, it } from "vitest";
import { cfrConcentration } from "./cfrParts";

const part = (identifier: string, sections: number | null, reserved = false) => ({
  identifier,
  title: `Part ${identifier}`,
  reserved,
  sections,
});

describe("cfrConcentration", () => {
  it("ranks parts by recorded sections and rolls the rest into one row", () => {
    const c = cfrConcentration([part("1", 10), part("2", 50), part("3", 25), part("4", 15)], 2)!;
    expect(c.top.map((p) => [p.identifier, p.sections, p.share])).toEqual([
      ["2", 50, 50],
      ["3", 25, 25],
    ]);
    expect(c.other).toEqual({ parts: 2, sections: 25, share: 25 });
    expect(c.totalSections).toBe(100);
  });

  it("counts reserved and unrecorded parts apart instead of as zero", () => {
    const c = cfrConcentration([part("1", 4), part("2", null), part("3", 0, true), part("4", 0)])!;
    expect(c.recordedParts).toBe(1);
    expect(c.reservedParts).toBe(1);
    expect(c.unrecordedParts).toBe(2);
    expect(c.top[0]!.share).toBe(100);
    expect(c.other).toBeNull();
  });

  it("is null when no part has a recorded section count", () => {
    expect(cfrConcentration([part("1", null), part("2", 0, true)])).toBeNull();
  });

  it("orders ties by part number", () => {
    const c = cfrConcentration([part("10", 5), part("9", 5), part("2", 5)])!;
    expect(c.top.map((p) => p.identifier)).toEqual(["2", "9", "10"]);
  });
});
