import { describe, expect, it } from "vitest";
import { isOrganisation } from "./firmQueries";

describe("isOrganisation", () => {
  it("names organisations and holds back names that may be people", () => {
    expect(isOrganisation("North Jersey Municipal Employee Benefits Fund")).toBe(true);
    expect(isOrganisation("Meta Platforms, Inc.")).toBe(true);
    expect(isOrganisation("Johnson & Johnson Consumer Co.")).toBe(true);
    expect(isOrganisation("Michael Jack Schomer , II")).toBe(false);
    expect(isOrganisation("Jane Roe")).toBe(false);
  });
});
