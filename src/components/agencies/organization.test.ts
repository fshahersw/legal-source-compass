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
  it("binds official charts to the exact Federal Register agency id only", () => {
    expect(officialOrganizationReference(44)?.url).toBe("https://www.cdc.gov/about/divisions-offices/index.html");
    expect(officialOrganizationReference(271)?.url).toBe("https://www.dol.gov/general/aboutdol/orgchart");
    // a component never inherits its department's chart (OSHA sits under Labor)
    expect(officialOrganizationReference(386)).toBeNull();
  });
  it("keeps the publisher's printed date and leaves it empty when none is printed", () => {
    expect(officialOrganizationReference(227)?.publisherDate).toBe("2026-05-19");
    expect(officialOrganizationReference(268)?.publisherDate).toBeNull();
    expect(officialOrganizationReference(268)?.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});