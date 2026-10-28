import { describe, expect, it } from "vitest";
import { agencyOrganization, officialOrganizationReference } from "./organization";

describe("recorded agency relationships", () => {
  it("preserves exact parent and child identities without inferring a reporting chain", () => {
    const result = agencyOrganization({ id: 2, name: "Component", parent: { id: 1, name: "Department" }, children: [{ id: 3, name: "Office" }] });
    expect(result.parent).toEqual({ id: 1, name: "Department" });
    expect(result.children).toEqual([{ id: 3, name: "Office" }]);
  });
  it("does not draw self links, duplicates, or the parent as a child", () => {
    const result = agencyOrganization({ id: 2, name: "Component", parent: { id: 1, name: "Department" }, children: [{ id: 2, name: "Self" }, { id: 1, name: "Parent" }, { id: 3, name: "Office" }, { id: 3, name: "Duplicate" }] });
    expect(result.children).toEqual([{ id: 3, name: "Office" }]);
  });
  it("links official CDC charts only on the exact organization name", () => {
    expect(officialOrganizationReference("Centers for Disease Control and Prevention")?.url).toBe("https://www.cdc.gov/about/divisions-offices/index.html");
    expect(officialOrganizationReference("Disease Control Office")).toBeNull();
  });
});