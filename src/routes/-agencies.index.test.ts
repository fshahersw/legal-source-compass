import { describe, expect, it } from "vitest";
import { normalizeAgencySearch } from "@/components/agencies/agencyView";

describe("agency directory URL state", () => {
  it("keeps the landing-page search links working", () => {
    expect(normalizeAgencySearch({ q: "" })).toEqual({});
    expect(normalizeAgencySearch({ q: "  Food and Drug Administration " })).toEqual({
      q: "Food and Drug Administration",
    });
  });

  it("drops unknown values instead of guessing", () => {
    expect(
      normalizeAgencySearch({
        view: "map",
        kind: "bureau",
        sort: "budget",
        layout: "grid",
        active: "yes",
      }),
    ).toEqual({});
  });

  it("stores a sort direction only when it differs from the column default", () => {
    expect(normalizeAgencySearch({ sort: "significantRules", dir: "desc" })).toEqual({
      sort: "significantRules",
    });
    expect(normalizeAgencySearch({ sort: "significantRules", dir: "asc" })).toEqual({
      sort: "significantRules",
      dir: "asc",
    });
    expect(normalizeAgencySearch({ sort: "name", dir: "asc" })).toEqual({ sort: "name" });
    expect(normalizeAgencySearch({ sort: "rulesLastYear" })).toEqual({});
  });

  it("keeps the register view, hierarchy layout and activity filter", () => {
    expect(
      normalizeAgencySearch({ view: "register", kind: "component", layout: "tree", active: true }),
    ).toEqual({ view: "register", kind: "component", layout: "tree", active: true });
  });
});
