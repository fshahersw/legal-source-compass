import { describe, expect, it } from "vitest";
import { safetyAgencyBlockIds } from "./safetyBlocks";

describe("safetyAgencyBlockIds", () => {
  it("leaves out the FDA blocks that count product rows (events are drawn by FdaRecallEventsSection)", () => {
    const fda = safetyAgencyBlockIds("FDA");
    expect(fda).not.toContain("fda-recalls");
    expect(fda).not.toContain("fda-class-i");
    expect(fda).toContain("faers");
  });

  it("is empty for an agency without a page", () => {
    expect(safetyAgencyBlockIds("XYZ")).toEqual([]);
  });
});
