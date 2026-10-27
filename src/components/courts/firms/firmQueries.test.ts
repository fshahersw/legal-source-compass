import { describe, expect, it } from "vitest";
import { isOrganisation, sortMdls } from "./firmQueries";

describe("sortMdls", () => {
  const m = (mdl: number, appearances: number | null, hhi: number | null) => ({
    mdl,
    plaintiff: { appearances, hhi, top5: hhi === null ? null : hhi / 100, firms: 3 },
  });
  // Shapes from firm_matter_overview: MDL 2592 has 3 plaintiff-side entries and an HHI of 3,333.3.
  const rows = [
    m(2592, 3, 3333.3),
    m(2606, 84, 1557.6),
    m(2738, 1200, 3317.3),
    m(3000, null, null),
  ];
  it("defaults to appearances and keeps every MDL", () => {
    expect(sortMdls(rows, "appearances").rows.map((r) => r.mdl)).toEqual([2738, 2606, 2592, 3000]);
  });
  it("ranks concentration only above the minimum sample and lists small dockets after", () => {
    const s = sortMdls(rows, "hhi");
    expect(s.rows.map((r) => r.mdl)).toEqual([2738, 2606, 2592, 3000]);
    expect([...s.small].sort()).toEqual([2592, 3000]);
    expect(sortMdls(rows, "hhi", 1).rows[0]?.mdl).toBe(2592);
  });
});

describe("isOrganisation", () => {
  it("names organisations and holds back names that may be people", () => {
    expect(isOrganisation("North Jersey Municipal Employee Benefits Fund")).toBe(true);
    expect(isOrganisation("Meta Platforms, Inc.")).toBe(true);
    expect(isOrganisation("Johnson & Johnson Consumer Co.")).toBe(true);
    expect(isOrganisation("Michael Jack Schomer , II")).toBe(false);
    expect(isOrganisation("Jane Roe")).toBe(false);
  });
});
