import { describe, expect, it } from "vitest";
import { parseAgencyOptions } from "./agencyTree";
describe("agency directory metadata", () => {
  it("keeps an unknown document count distinct from zero", () => {
    expect(
      parseAgencyOptions([
        { value: "1", label: "Example Department" },
        { value: "2", label: "Example Agency", count: 0 },
      ]),
    ).toEqual([
      { id: "1", name: "Example Department", count: null },
      { id: "2", name: "Example Agency", count: 0 },
    ]);
  });
  it("rejects negative, noninteger and nonnumeric count claims", () => {
    for (const count of [-1, 2.3, "100", null])
      expect(
        parseAgencyOptions([{ value: "1", label: "Example Agency", count }])[0]?.count,
      ).toBeNull();
  });
  it("does not build an agency URL from a non-agency filter option", () => {
    expect(
      parseAgencyOptions([
        { value: "all", label: "All agencies" },
        { value: "1", label: "Recorded Name", count: 3 },
      ]),
    ).toEqual([{ id: "1", name: "Recorded Name", count: 3 }]);
  });
});
