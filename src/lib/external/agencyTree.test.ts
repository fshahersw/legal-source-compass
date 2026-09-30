import { describe, expect, it } from "vitest";
import { isDepartment, splitAgencies } from "./agencyTree";

describe("agency grouping", () => {
  it("splits departments from other agencies by listed name only", () => {
    expect(isDepartment("Transportation Department")).toBe(true);
    expect(isDepartment("Food and Drug Administration")).toBe(false);
    const s = splitAgencies([
      { id: "199", name: "Food and Drug Administration", count: 24026 },
      { id: "221", name: "Health and Human Services Department", count: 109214 },
      { id: "492", name: "Transportation Department", count: 99714 },
    ]);
    expect(s.departments.map((a) => a.id)).toEqual(["221", "492"]);
    expect(s.others.map((a) => a.id)).toEqual(["199"]);
  });
});
