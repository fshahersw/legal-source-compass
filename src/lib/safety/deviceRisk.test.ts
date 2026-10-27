import { describe, expect, it } from "vitest";
import { buildDeviceRisk } from "./deviceRisk";

describe("buildDeviceRisk", () => {
  it("joins classification and PMA exactly on product code and splits originals from supplements", () => {
    const p = buildDeviceRisk(
      [
        { pc: "DTK", name: "Filter, intravascular", cls: "2", implant: "Y", life: "N" },
        { pc: "LWS", name: "Defibrillator", cls: "3", implant: "Y", life: "Y" },
        { pc: "BRT", name: "Restraint", cls: "1", implant: "N", life: "N" },
        { pc: "BRT", name: "Restraint duplicate", cls: "1", implant: "N", life: "N" },
      ],
      [
        { pc: "LWS", nid: "P010012", dd: "2001-05-01" },
        { pc: "LWS", nid: "P010012:S001", dd: "2024-02-01" },
        { pc: "LWS", nid: "P010012:S002", dd: "2026-03-01" },
        { pc: "DTK", nid: "P900001:S010", dd: "2024-07-01" },
        { pc: "ZZZ", nid: "P1:S1", dd: "2024-01-01" },
      ],
      "2026-10-27T00:00:00Z",
    );
    expect(p.totals).toMatchObject({ codes: 3, implantCodes: 2, classIIICodes: 1, codesWithPma: 2, pmaRows: 5, pmaUnmatched: 1, implantSupplements: 3 });
    expect(p.codes[0]).toMatchObject({ code: "LWS", originals: 1, supplements: 2, latestDecision: "2026-03-01" });
    expect(p.cells[0]).toMatchObject({ cls: "3", implant: "Implant", codes: 1, codesWithPma: 1 });
    const y2025 = p.years.find((y) => y.year === "2025")!;
    expect(y2025).toMatchObject({ implant: 0, other: 0 });
    expect(p.years.at(-1)).toMatchObject({ year: "2026", implant: 1, partial: true });
  });
});
